# Tiến độ luồng đào tạo và lịch học

Cập nhật: 08/10/2026. Trạng thái dưới đây phản ánh source của repo backend này; migration chưa được triển khai lên môi trường chạy thật.

## Đã hoàn thành trong backend

| Chức năng | Trạng thái và API chính |
| --- | --- |
| Danh mục môn | CRUD `GET/POST /api/v1/subjects`, `GET/PATCH/DELETE /api/v1/subjects/:id`; môn đã có khóa được ngừng sử dụng. Migration backfill môn từ `Program.subject`, giữ chuỗi `subject` cho client cũ. |
| Khóa học | Giữ CRUD `/programs`, thêm chi tiết `GET /programs/:id`, lọc `search/subjectId/grade/isActive`, hỗ trợ `subjectId`. Xóa khóa đã dùng chuyển sang ngừng sử dụng; chặn đổi môn/khối khi đã có lớp, bài hoặc học phần. |
| Lớp học | Giữ tạo/đọc/sửa, thêm `DELETE /classes/:id` cho lớp chưa có dữ liệu và `isActive` để ngừng sử dụng. Kiểm tra ghi danh, học viên chuyển vào, đăng ký đang xử lý và buổi tương lai; lớp ngừng hoạt động không thể mở đăng ký. |
| Lịch tuần | Giữ `POST /classes/:id/schedules`; thêm GET/PUT toàn bộ và PATCH/DELETE từng khung giờ. Chặn sửa khi lớp có ghi danh gốc, học viên chuyển vào hoặc đã có buổi học. |
| Giáo trình theo khóa | Danh sách/preview/sinh lịch và quyền giáo viên kiểm tra đúng `programId`; unique học phần và cấp version theo khóa. |
| Gửi và duyệt giáo trình | Designer soạn DRAFT → `POST .../submit` → PENDING_REVIEW. Manager `POST .../approve` hoặc `POST .../request-changes` kèm lý do. Duyệt nội dung độc lập với lớp, ghi audit; bản APPROVED bất biến, chỉnh tiếp bằng revision mới. |
| Kiểm tra giáo trình | `POST .../validation` trả mức sẵn sàng, lỗi cấu trúc và số bài/kiểm tra. Danh sách hỗ trợ status/search và chế độ phân trang tùy chọn. |
| Bài học/kiểm tra tháng | Giữ thêm/sửa/upsert; thêm xóa bài và `PUT .../lesson-order`. Mọi thao tác chỉ trên nháp của designer, tăng revision; các thao tác sửa hỗ trợ `expectedRevision`. |
| Xóa/lưu trữ học phần | `DELETE /academic/curriculum-units/:id`: xóa nháp chưa có tham chiếu; manager lưu trữ bản APPROVED. |
| Nhập CSV | `POST .../import-preview` nhận file UTF-8, hỗ trợ dấu tiếng Việt/quote/multiline, giới hạn 5 MiB và 1.000 dòng, kiểm tra số cột, trả lỗi nội dung từng dòng. `POST .../import-commit` hỗ trợ APPEND/REPLACE, chỉ nhận đúng các dòng đã preview, chặn thay bài có tham chiếu, transaction, revision và Idempotency-Key. |
| Sinh lịch | Preview trả `previewId`, hạn sử dụng, tổng số buổi và xung đột. Generate kiểm tra lại dữ liệu lớp/giáo trình và `previewId` nếu client gửi, giữ idempotency. Có GET lịch sử đợt sinh/học phần đã áp dụng. |
| Buổi học | Thêm chi tiết, preview đổi giờ, đổi giờ và hủy buổi tương lai. Kiểm tra xung đột, thứ tự bài, điểm danh/đơn nghỉ/học bù liên quan; giữ cùng session ID và lịch sử. Lệnh đổi/hủy yêu cầu `Idempotency-Key` và `expectedRevision`, ghi audit. |
| Chi tiết buổi cho phụ huynh | `GET /academic/scheduled-sessions/:id?studentId=...` kiểm tra hồ sơ con, kỳ ghi danh/placement hoặc participant học bù; chỉ trả ngữ cảnh điểm danh của con được chọn. |

## Kiểm thử đã chạy

- Prisma generate/validate, TypeScript typecheck và ESLint: đạt.
- Unit test lịch và CSV: 5/5 đạt.
- E2E giáo trình, gửi duyệt, sinh lịch, đổi/hủy buổi và CSV: 2/2 đạt trên database test riêng.
- E2E ghi danh/danh mục/lớp/lịch tuần: 34/34 đạt trên database test riêng.
- Rà soát lại ngày 08/10/2026: typecheck, ESLint, unit CSV 2/2 và hai bộ E2E trên đều đạt sau khi bổ sung kiểm tra lớp chuyển vào và cấu trúc CSV.
- `pnpm format:check` toàn repo còn báo 50 file không thuộc thay đổi này; các file đã chỉnh được format riêng.

## Chưa hoàn thành trong phạm vi nhiều repo hoặc đợt sau

- FE web và BFF chưa được sửa vì workspace hiện chỉ có repo backend. Cần nối màn Subject, khóa, giáo trình, hàng chờ duyệt, CSV, lớp, lịch tuần, preview/generate, đổi/hủy buổi theo API mới.
- Các route academic đời cũ (`/academic/programs`, `/academic/classes`, `/academic/lessons`, `/academic/sessions`) vẫn tồn tại để tương thích. Client mới cần dùng các route chính nêu trên; việc ngừng nhận thao tác ghi trực tiếp ở route cũ cần phối hợp chuyển client trước khi đóng.
- Mobile và các API lịch theo từng con gồm học bù khác lớp, placement/lịch sử ghi danh, chuyên cần, điểm và lộ trình học chưa nằm trong đợt backend này.
- AI gợi ý giáo trình, đổi toàn bộ lịch tuần theo ngày hiệu lực, dạy thay và tính công thuộc đợt sau theo quyết định phạm vi.
- Chưa triển khai migration trên môi trường dùng thật; cần chạy `prisma migrate deploy` theo quy trình phát hành và nghiệm thu client trước khi sử dụng API mới.
- Trước khi chạy migration trên cơ sở dữ liệu có sẵn, kiểm tra các học phần trùng `programId/fromDate/toDate/version` ở nhiều track; unique mới sẽ từ chối dữ liệu trùng này. Chưa có bài kiểm thử nâng cấp từ dữ liệu cũ.
