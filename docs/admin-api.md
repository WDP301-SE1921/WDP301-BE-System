# API Admin tổng (role `ADMIN`)

Cập nhật 10/11/2026. Client: web Admin tổng (`WDP301-ADMIN-System`, Vite SPA, bearer token).

## Vai trò và quyền

- `ADMIN` là vai trò cao nhất (migration `20261110000000_admin_role`).
- ADMIN **được làm mọi việc mà MANAGER hoặc STAFF được làm** ở các API sẵn có: mọi kiểm quyền theo vai trò
  đi qua `src/common/auth/role-access.ts` (`roleAllowed`, `isManagerOrAdmin`, `isBackOffice`, `actsAsStaff`).
  Không so sánh `user.role` trực tiếp trong code mới.
- ADMIN **không** đóng vai TEACHER / CURRICULUM_DESIGNER / PARENT: việc gắn với chính người làm (điểm danh lớp
  mình dạy, soạn giáo trình của mình, hồ sơ con) vẫn thuộc vai trò đó.
- Thông báo gửi theo vai trò MANAGER (`recipients.roles(['MANAGER'])`) chưa gửi cho ADMIN.

## Tài khoản ADMIN đầu tiên

Seed tạo sẵn một tài khoản: `SEED_ADMIN_EMAIL` (mặc định `admin@edugrade.local`), mật khẩu `SEED_DEFAULT_PASSWORD`.
Không có endpoint đăng ký ADMIN công khai. Admin tạo thêm Admin khác qua `POST /admin/accounts`.

## Endpoint riêng (`/api/v1/admin/*`, chỉ ADMIN, khác → 403 `ADMIN_ONLY`)

| Method   | Path                                     | Body / query                                                                                          | Kết quả / lỗi                                                                                                                                                                                |
| -------- | ---------------------------------------- | ----------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET`    | `/admin/overview`                        | —                                                                                                     | Đếm tài khoản theo trạng thái, Quản lý, lớp đang mở, học sinh đang học, giáo trình chờ duyệt, học phí tháng này (giờ VN), đăng ký chờ thanh toán (số + tiền), email lỗi, lời mời Quản lý chờ |
| `GET`    | `/admin/dashboard/business`              | `fromDate`, `toDate` (ngày trung tâm, mặc định đầu tháng → hôm nay; ngày cuối không quá hôm nay; tối đa 366 ngày) | Tab Kinh doanh: doanh thu kỳ + kỳ trước cùng số ngày, 12 tháng, theo ngày, cơ cấu (môn, khối, gói, loại đăng ký, nhân viên thu), 50 biên lai mới nhất, top 10 phụ huynh, đơn chờ thu / đã hủy, học sinh, lớp (sĩ số hiện tại, doanh thu kỳ), gói hết hạn 30 ngày chưa gia hạn. Chỉ đọc |
| `GET`    | `/admin/dashboard/system`                | `fromDate`, `toDate` (như trên)                                                                       | Tab Hệ thống: tài khoản theo vai trò × trạng thái (+ đã xóa, mới trong kỳ), đăng nhập theo ngày (nội bộ / phụ huynh), tài khoản nội bộ không đăng nhập > 30 ngày, hàng đợi email / đẩy / chấm AI, thao tác nhạy cảm (xóa, khôi phục, hủy, đổi GV, bảo mật, ngừng học), số bản ghi xóa mềm. Chỉ đọc |
| `GET`    | `/admin/services`                        | —                                                                                                     | `[{ id, name, status: AVAILABLE \| DEGRADED \| NOT_CONFIGURED, description, checkedAt }]` cho api, database, email, ai, storage. Không trả URL / khóa / mật khẩu                             |
| `PATCH`  | `/admin/center`                          | `{ name, address?, phone?, email?, openingHours? }` (rỗng → null)                                     | Thông tin trung tâm sau khi lưu; audit `CENTER_PROFILE_UPDATE`                                                                                                                               |
| `GET`    | `/admin/accounts`                        | `page`, `limit ≤ 100`, `search`, `role`, `status`, `paginated`                                        | `{ items, page, limit, total }` mọi vai trò, không có `passwordHash`                                                                                                                         |
| `POST`   | `/admin/accounts`                        | `{ email, displayName, role: ADMIN \| MANAGER \| STAFF \| TEACHER \| CURRICULUM_DESIGNER, password }` | Tài khoản ACTIVE, đã xác minh email; 409 `AUTH_EMAIL_EXISTS`; audit `ADMIN_ACCOUNT_CREATE`                                                                                                   |
| `GET`    | `/admin/accounts/:id`                    | —                                                                                                     | Tài khoản + `phone` (phụ huynh) + `isSelf` + `sessions[{ id, createdAt, lastActiveAt, expiresAt, isCurrent }]`; 404 `ACCOUNT_NOT_FOUND`                                                      |
| `PATCH`  | `/admin/accounts/:id`                    | `{ displayName }`                                                                                     | Audit `ADMIN_ACCOUNT_UPDATE` khi đổi                                                                                                                                                         |
| `PATCH`  | `/admin/accounts/:id/status`             | `{ status: ACTIVE \| DISABLED, reason }`                                                              | 409 `ACCOUNT_STATUS_UNCHANGED`, `ADMIN_SELF_LOCK`, `ADMIN_LAST_ACTIVE`. Khóa thì thu hồi mọi phiên. Audit `ADMIN_ACCOUNT_DISABLE` / `_ENABLE` kèm `reason`, `revokedSessions`                |
| `POST`   | `/admin/accounts/:id/password-reset`     | —                                                                                                     | Gửi email đặt lại (dùng luồng quên mật khẩu); 409 `ACCOUNT_DISABLED`; audit `ADMIN_PASSWORD_RESET_SENT`                                                                                      |
| `DELETE` | `/admin/accounts/:id/sessions`           | —                                                                                                     | `{ revoked }`; với chính mình giữ phiên đang dùng; audit `ADMIN_SESSIONS_REVOKE`                                                                                                             |
| `DELETE` | `/admin/records/:kind/:id`               | `{ reason }`; `kind`: account, parent, student, subject, program, class, room                         | Xóa mềm. 409 `RECORD_IN_USE` (còn ràng buộc), `RECORD_DELETED`; `kind` lạ → 404. Tài khoản: thu hồi mọi phiên. Audit `ADMIN_RECORD_DELETE`                                                   |
| `POST`   | `/admin/records/:kind/:id/restore`       | `{ reason }`                                                                                          | Bỏ `deletedAt` → về đúng trạng thái trước khi xóa. 409 `RESTORE_BLOCKED` (bản ghi cha đã xóa), `RECORD_NOT_DELETED`. Audit `ADMIN_RECORD_RESTORE`                                            |
| `GET`    | `/admin/parents`, `/admin/parents/:id`   | —                                                                                                     | Mọi phụ huynh (gồm đã xóa) + con + lớp đang học; chi tiết thêm đăng ký, số phiên. Không có → `null`                                                                                          |
| `GET`    | `/admin/students`, `/admin/students/:id` | —                                                                                                     | Mọi học sinh (gồm đã xóa) + phụ huynh + lớp đang học (kèm `enrollmentId`); chi tiết thêm lớp đầy đủ, đăng ký                                                                                 |
| `POST`   | `/admin/students`                        | `{ parentId, fullName, grade 6–9, dateOfBirth? }`                                                     | Thêm hồ sơ con cho phụ huynh chưa xóa; audit `ADMIN_STUDENT_CREATE`                                                                                                                          |
| `GET`    | `/admin/catalog`                         | —                                                                                                     | `{ subjects, programs }` gồm đã xóa; khóa kèm lớp, giáo trình                                                                                                                                |
| `GET`    | `/admin/classrooms`                      | —                                                                                                     | `{ classes, rooms, teachers, programs }`; lớp kèm sĩ số đang học (`rosterCount`), lịch tuần                                                                                                  |
| `GET`    | `/admin/classes/:id`                     | —                                                                                                     | Lớp + học sinh đang học + đăng ký                                                                                                                                                            |
| `GET`    | `/admin/registration-options`            | —                                                                                                     | Học sinh đang hoạt động + lớp đang tuyển sinh (cho form tạo đăng ký)                                                                                                                         |

Mọi dòng danh sách Admin có `deletedAt`, `deletedById`, `deletedBy` (tên), `deleteReason`, `deleteBlockers[]`,
`restoreBlockers[]` (câu tiếng Việt: việc phải làm trước).

`POST /admin/accounts` nhận thêm `PARENT` (+ `phone`): tạo luôn hồ sơ phụ huynh, giống luồng tự đăng ký.

## Xóa mềm (Phase 4, migration `20261110010000_soft_delete`)

- Cột mới, cho phép NULL: `deletedAt`, `deletedById`, `deleteReason` trên `users`, `student_profiles`, `subjects`,
  `programs`, `classes`, `rooms`. NULL = chưa xóa; dữ liệu cũ không đổi.
- Xóa **không** đổi `status` / `isActive`; khôi phục chỉ bỏ `deletedAt`.
- **Xóa từ trong ra ngoài** (409 `RECORD_IN_USE`): lớp còn học sinh đang học hoặc hóa đơn chưa thu; khóa còn lớp
  chưa xóa hoặc giáo trình chưa lưu trữ; môn còn khóa; phòng còn lớp; học sinh còn lớp đang học hoặc hóa đơn chưa
  thu; phụ huynh còn hồ sơ con hoặc hóa đơn chưa thu; giáo viên còn / sắp nhận lớp; không xóa chính mình; phải còn
  một ADMIN hoạt động. **Khôi phục từ ngoài vào trong** (409 `RESTORE_BLOCKED`).
- Đăng ký / biên lai **không** có xóa (chứng từ kế toán); hủy hóa đơn chưa thu dùng `POST /registrations/:id/cancel`.

### Ảnh hưởng tới web Quản lý và Mobile (chỉ thêm điều kiện lọc)

Bản ghi đã xóa **không còn** trong: danh sách tài khoản nội bộ / phụ huynh / Quản lý, chi tiết và sửa tài khoản,
tra cứu và tìm phụ huynh, thống kê dashboard, `/students`, `/me/students` (Mobile), `/programs`, `/subjects`,
`/classes`, `/rooms`, `/academic/programs`, `/academic/classes`, ứng viên dạy thay, người duyệt giáo trình, chọn giáo
viên / phòng cho lớp mới. Tài khoản đã xóa: đăng nhập báo sai thông tin (như tài khoản khóa), refresh / access token
bị từ chối, quên mật khẩu không gửi. Request / response và mã lỗi của các API cũ **không đổi**; `/auth/me` không
có trường mới. Các `DELETE` cứng cũ của Quản lý giữ nguyên.

## API sẵn có mà web Admin dùng (ADMIN qua quyền Quản lý / Nhân viên)

`/auth/login|refresh|logout|me|change-password`, `/center` (công khai), `/audit-logs`, `/manager-invitations`,
`/account-invitations/:id/resend|revoke`, `/parents`, `/programs`, `/subjects`, `/classes`,
`/classes/:id/teacher-assignments`, `/rooms`, `/teachers`, `/academic/curriculum-units` (+ `approve`,
`request-changes`, `DELETE` để lưu trữ), `/registrations` (+ `confirm-payment` cần `Idempotency-Key`, `cancel`),
`/academic/email-deliveries` (+ `retry`). Phase 4 thêm: `POST /subjects`, `PATCH /subjects/:id`, `POST /programs`,
`POST /classes`, `PATCH /classes/:id` (gồm `isOpen` = mở tuyển sinh), `PUT /classes/:id/schedules`, `POST /rooms`,
`POST /registrations` (hóa đơn chờ thanh toán), `PATCH /students/:id`, `POST /students/:id/end-study|reactivate`,
`POST /enrollments/:id/transfer`.

### Sau khi gộp với `dev` (đợt 3 refactor thiết lập học vụ, 2026-11-10)

- ADMIN dùng được như Quản lý: `POST /academic/sessions/:id/cancel`, `cancel-preview`, `sessions/bulk-cancel`,
  `sessions/bulk-cancel-preview`, và `POST|PATCH|DELETE /academic/center-closures`. `GET /academic/center-closures`
  mở cho mọi nhân sự, gồm ADMIN.
- Thiết kế giáo trình dùng chung bản nháp (Q6): `GET /academic/lessons` và `GET /academic/feedback` trả mọi bài /
  phản hồi cho Quản lý, ADMIN và mọi người thiết kế giáo trình; giáo viên vẫn chỉ thấy phần của mình. Người thiết kế
  nào cũng gọi được `POST /academic/feedback/:id/resolve`, không còn 403 "Feedback is assigned to another designer".
- Người duyệt giáo trình: giáo viên đã bị xóa mềm không có trong `GET /academic/curriculum-units/:id/reviewers` (cả
  nhóm PROGRAM, SUBJECT lẫn ANY), không tính vào việc chia nhóm, và bị từ chối khi gửi duyệt
  (400 `INVALID_CURRICULUM_REVIEWER`).

## Kiểm thử

- Unit: `tests/unit/admin-role-access.spec.ts`, `tests/unit/admin-rules.spec.ts`.
- Đã chạy adapter API của web Admin với BE local (đọc 15 màn, tạo / đổi tên / khóa / mở tài khoản, chặn tự khóa,
  chặn email trùng, sửa trung tâm, gọi API chỉ dành cho Nhân viên).
- Chưa có e2e trên database test riêng cho module `admin`.

## Việc còn lại (đề xuất)

- Lưu **lý do** khi ngừng khóa học / môn / lớp (hiện `PATCH` không nhận `reason`).
- Ghi **hình thức thanh toán** khi xác nhận học phí; học phí ở mức khóa (hiện chỉ có `monthlyFee` của lớp).
- Lưu `phone` / ghi chú cho tài khoản nội bộ; tên người được mời khi gửi lời mời Quản lý.
- Lưu thiết bị (user agent) của phiên đăng nhập để hiển thị.
- Gửi thông báo vai trò Quản lý cho cả ADMIN nếu cần.
