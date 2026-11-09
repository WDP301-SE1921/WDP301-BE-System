# Tài khoản giáo viên và CSV — 09/11/2026

## Quản lý tạo giáo viên

`POST /api/v1/teachers` nhận DTO tạo tài khoản nội bộ hiện có (`displayName`, `email`, `password`), chỉ cho `MANAGER`. Tài khoản được tạo `ACTIVE`, email tin cậy, mật khẩu bcrypt, response chọn trường an toàn và audit trong transaction. Email trùng giữ lỗi xung đột; không tự dùng lại hoặc kích hoạt tài khoản cũ.

Đăng ký công khai `/auth/register` vẫn chỉ tạo `PARENT`, không nhận role. Giáo viên đăng nhập bằng tài khoản Quản lý đã cấp và dùng luồng đổi mật khẩu hiện có khi cần.

Luồng mời Giáo viên đã ngừng. Tạo mới, resend, accept token và review lời mời có role `TEACHER` trả `410 TEACHER_INVITATION_DISABLED`; mail worker và manual retry không gửi email lời mời Giáo viên cũ. Lịch sử, revoke lời mời chưa nhận, tài khoản và phân công cũ được giữ. Tài khoản đã nhận nhưng chưa duyệt vẫn khóa cho tới khi Quản lý chủ động xử lý qua API quản lý tài khoản. Luồng lời mời Quản lý không đổi. Không cần migration hoặc bulk update.

## CSV xuất từ Web

Hai parser import nhận thêm định dạng version 1. File cũ không có cột version giữ nguyên cách đọc.

- Assignment: `kind,prompt,choices,correctAnswer,rubric,maxScore,csvVersion`.
- Curriculum: `kind,sequence,title,content,monthKey,csvVersion`.
- Cột `csvVersion` đứng cuối và phải bằng `1` trên mọi dòng có dữ liệu; phiên bản khác hoặc thiếu bị từ chối.
- Dữ liệu có dấu nháy đầu hoặc mở đầu bằng công thức được Web thêm một dấu nháy bảo vệ. Version 1 chỉ bỏ một dấu nháy nếu ký tự tiếp theo là dấu nháy hoặc phần còn lại khớp mẫu công thức mở đầu. Sau đó áp dụng trim hiện có. Không đổi dữ liệu file cũ.
- Lựa chọn version 1 tách bởi `|`, với `\\` là backslash và `\|` là pipe trong một lựa chọn. Escape khác giữ nguyên backslash.
- UTF-8 BOM, CSV quoted/multiline và giới hạn 5 MiB, 100 câu hỏi / 1.000 bài học giữ nguyên. Không thêm endpoint export; Web dùng dữ liệu đọc đã được kiểm quyền.

CSV là nội dung câu hỏi/bài học, không phải backup mọi metadata, trạng thái, ID, CLO hoặc người nhận. Giáo trình chỉ nhận `LESSON`; bài kiểm tra do Giáo viên tạo theo buổi. Preview, commit, revision, idempotency, quyền và giới hạn commit JSON 1 MiB của giáo trình không đổi.

## Xác minh

Sau khi đồng bộ commit dev `1f23dfd` về chat/web push, tạo lại Prisma Client và cài dependency đúng lockfile, unit toàn BE: 38 suite, 283/283 đạt với HTTP loopback và MinIO QA tạm. Registration e2e MySQL: 43/43 đạt, gồm quyền tạo giáo viên, hash/đăng nhập/audit, chặn lời mời cũ và giữ luồng Parent/Manager. FE có 63 ca hồi quy, gồm xuất từ FE rồi đọc bằng parser BE thật; production Chromium/Nest/MySQL đạt 7/7 nhóm. TypeScript/build và lint file sửa đạt.

Lint toàn repo còn 124 lỗi ở các file storage/auth/AI và test ngoài phạm vi thay đổi, gồm 8 lỗi test chat trong commit mới; không tính lint toàn repo là đã đạt. Báo cáo tích hợp Web: `WDP301-FE-System/docs/ADMIN_TEACHERS_CSV_EXPORT_2026-11-09.md`. Evidence local: `../implementation-20261108/`. Database QA và MinIO tạm đã dọn; không migrate/seed database ứng dụng, không gửi email/push ra ngoài.
