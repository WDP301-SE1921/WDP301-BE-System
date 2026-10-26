# API GET: phân trang và bộ lọc

Áp dụng cho `/api/v1`. Mọi danh sách độc lập đã được rà soát. Swagger của từng route mô tả DTO query được chấp nhận. Bộ lọc luôn được kết hợp **AND với phạm vi quyền**, không thay thế điều kiện sở hữu học sinh hoặc phân công giáo viên.

## Contract chung

- `page`: số nguyên 1–1.000.000, mặc định 1; giới hạn trên ngăn offset vượt khả năng truy vấn.
- `limit`: số nguyên 1–100, mặc định 20. Riêng `parents/search` mặc định 10, tối đa 10.
- `paginated=true`: yêu cầu metadata cho endpoint vốn trả array. Nếu bỏ qua hoặc đặt false, các endpoint này vẫn trả array của **trang hiện tại**, không trả toàn bộ dữ liệu.
- Các danh sách vốn có metadata (danh bạ, đăng ký, thanh toán, thông báo, học sinh back office, bill, curriculum của con) tiếp tục trả metadata; `paginated` được chấp nhận để client dùng chung query.
- Các filter không gửi lên thì không thu hẹp dữ liệu. Boolean chỉ nhận `true`/`false`; `false` được giữ đúng giá trị. Trạng thái dùng enum đúng tài nguyên.
- Filter chuỗi `search` là tìm một phần theo trường ghi trong bảng; ID là khớp chính xác. Bộ lọc áp dụng **trước** skip/take và trước đếm tổng.
- `total` là số dòng **đúng phạm vi và bộ lọc**, không phải số dòng trang hiện tại. Trang vượt tổng trả `items: []` và giữ tổng thật.
- Danh sách có thứ tự mặc định và khóa phụ ổn định ở các route được bổ sung paging. Chưa cung cấp sort field tùy ý.

Ví dụ:

```http
GET /api/v1/academic/assignments?paginated=true&page=1&limit=20&classId=CLASS_ID&kind=TEST&status=PUBLISHED&search=giữa
```

```json
{
  "success": true,
  "data": { "items": [], "page": 1, "limit": 20, "total": 0 }
}
```

`page=0`, `limit=101`, trạng thái không hợp lệ, boolean không hợp lệ và khoảng ngày đảo ngược bị từ chối. Query field không có trong DTO bị từ chối bởi validation hiện có.

## Danh mục, lớp và đăng ký

Mọi route sau có `page`, `limit`, `paginated`; ngoài ra:

| GET route | Bộ lọc |
| --- | --- |
| `/subjects` | `search` theo mã/tên, `isActive` |
| `/programs` | `search` theo tên, `subjectId`, `grade`, `isActive` |
| `/rooms` | `search` theo tên, `isActive`, `minCapacity` |
| `/classes` | `search` theo tên, `programId`, `subject`, `grade`, `teacherId` (giáo viên hiệu lực hiện tại), `roomId`, `isOpen`, `isActive`, `studentId`; cặp `startDate` + `packageMonths` để tính điều kiện đăng ký |
| `/classes/:id` | Detail lớp có roster phân trang: `at` thời điểm hiệu lực, `search` tên học sinh, `studentId`, `grade` |
| `/classes/:id/schedules` | `weekday` 1–7, `classId`, `subject`, `search` tên lớp; sắp theo thứ/ngày bắt đầu |
| `/academic/sessions/:id/substitute-candidates` | `search` theo email/tên; giữ điều kiện giáo viên đang hoạt động và không trùng lịch |
| `/me/students` | `search` theo tên, `grade`, `status=ACTIVE/INACTIVE`; luôn đúng con của parent |
| `/students` | Giữ bộ lọc hiện có: `search`, `grade`, `status`, `parentUserId`, `quick=no-class/long-leave/pending-makeup` |
| `/me/students/:id/enrollments`, `/students/:id/enrollments` | `status=ACTIVE/ENDED`, `classId` (lớp gốc hoặc đã placement), `subject` theo lớp gốc, `search` tên lớp gốc |
| `/me/students/:id/schedule`, `/students/:id/schedule` | `weekday`, `classId`, `subject`, `search` tên lớp; lọc từng slot của lịch placement trước khi phân trang |
| `/parents/search` | Giữ `email` tối thiểu 2 ký tự và quyền STAFF; thêm `page`, `paginated`, giữ limit tối đa 10. Tìm literal, ký tự `%`/`_` không biến thành wildcard |
| `/registrations` | `status`, `createdBy=me`, `classId`, `search` email/tên học sinh/số receipt, `fromDate`, `toDate` theo ngày tạo |
| `/payments` | `search` receipt/email/tên học sinh, `classId`, `studentId`, `fromDate`, `toDate` theo thời điểm xác nhận; tổng tiền vẫn tính trên toàn bộ phạm vi lọc |
| `/me/bills` | `status`, `classId`, `studentId`, `search` tên học sinh/số receipt, `fromDate`, `toDate` theo ngày tạo |

Lịch tuần là tập slot được tính từ các enrollment/placement của một học sinh: backend cần dựng lịch hiệu lực đầy đủ, lọc slot rồi phân trang. Các danh sách database thông thường dùng `skip/take` và count với cùng điều kiện.

## Học vụ

| GET route | Bộ lọc |
| --- | --- |
| `/academic/programs` | `search` tên, `subjectId`, `subject`, `grade`, `isActive` |
| `/academic/classes` | `search` tên, `programId`, `subjectId`, `subject`, `grade`, `teacherId`, `roomId`, `isOpen`, `isActive` |
| `/academic/lessons` | `search` tiêu đề, `programId`, `unitId`, `status=DRAFT/APPROVED` |
| `/academic/sessions` | `search` tiêu đề bài, `classId`, `teacherId`, `lessonId`, `status`, `fromDate`, `toDate` theo giờ bắt đầu |
| `/academic/sessions/:id/roster` | `search` tên học sinh, `studentId`, `attendance`, `kind=REGULAR/MAKEUP` |
| `/academic/enrollments` | `search` tên học sinh, `studentId`, `classId` theo lớp gốc, `status` |
| `/academic/feedback` | `search` nội dung, `lessonId`, `teacherId`, `status`, `fromDate`, `toDate` theo ngày tạo |
| `/academic/assignments` | `search` tiêu đề, `studentId`, `classId`, `sessionId`, `status`, `kind`, `testType`, `fromDate`, `toDate` theo hạn nộp |
| `/academic/assignments/:id/submissions` | `search` tên học sinh, `studentId`, `recipientId`, `gradeStatus`, `fromDate`, `toDate` theo ngày nộp; parent chỉ lọc được qua điểm đã công bố |
| `/academic/leaves` | `search` tên học sinh, `studentId`, `classId` theo enrollment, `status`, `kind`, `fromDate`, `toDate` theo khoảng nghỉ giao nhau |
| `/academic/makeups` | `search` tên học sinh, `studentId`, `classId` lớp thay thế, `status`, `fromDate`, `toDate` theo giờ bắt đầu buổi thay thế |
| `/academic/makeup-sources` | `search` tên học sinh, `studentId`, `classId`, `completedOnly`, `fromDate`, `toDate` theo giờ bắt đầu buổi gốc |
| `/academic/participants/:id/makeup-candidates` | `search` tên lớp, `classId`, `teacherId`, `lessonId`, `status`, `fromDate`, `toDate`; các điều kiện cứng cùng bài, khác buổi, tương lai, SCHEDULED luôn được giữ |
| `/academic/reports` | `search` tên lớp, `classId`, `fromDate`, `toDate` theo ngày tạo báo cáo; giáo viên chỉ xem lớp được phân công |
| `/academic/announcements` | `search` tiêu đề/nội dung, `classId`, `fromDate`, `toDate` theo ngày tạo |
| `/academic/programs/:id/outcome-sets` | `search` mã/tiêu đề CLO trong bộ, `status`, `level`, `version`; phân trang bộ CLO |
| `/academic/email-deliveries` | `search` người nhận, `eventType`, `status`, `fromDate`, `toDate` theo ngày tạo; không trả payload email |
| `/academic/students/:id/grades` | `search` tiêu đề assignment, `classId`, `subject`, `kind`, `fromDate`, `toDate` theo hạn nộp; thêm paging thay giới hạn cố định 500 |

`GET /academic/me/students/:id/grades` giữ response có `subjects` và `history`: thêm `search` tiêu đề, `classId`, `subject`, `kind`, `fromDate`/`toDate` theo thời điểm **công bố điểm**. Chỉ `history` phân trang; trung bình môn tính trên toàn bộ kết quả đúng bộ lọc, không tính riêng trang.

`GET /academic/classes/:id/attendance-summary` và `/academic/me/students/:id/attendance` giữ `fromDate`, `toDate`, `studentId`; thêm `search` tên học sinh. `history` được phân trang và trả `page`, `limit`, `total` ở cấp response. `counts`, `students` và phần trăm tính trên toàn bộ phạm vi lọc, không phụ thuộc trang. Giới hạn an toàn 20.000 bản ghi của các báo cáo tổng hợp vẫn được giữ.

## Giáo trình và xếp lịch

| GET route | Bộ lọc |
| --- | --- |
| `/academic/curriculum-units` | `programId`, `subject`, `grade`, `status`, `search` tiêu đề, `fromDate`, `toDate` theo khoảng giáo trình giao nhau; luôn áp dụng trang kể cả khi không yêu cầu metadata |
| `/academic/curriculum-units/:id/reviewers` | `search` email/tên; chỉ giáo viên phụ trách chương trình và ACTIVE |
| `/academic/scheduled-sessions` | Giữ `classId`, `studentId`, ngày; thêm `teacherId`, `roomId`, `lessonId`, `status`, `search` tiêu đề bài/tên lớp |
| `/academic/classes/:id/session-generations` | `search` tiêu đề giáo trình, `classId`, `fromDate`, `toDate` theo ngày tạo |
| `/academic/me/students/:id/curriculum` | `programId`, `subject`, `grade`, `search` tiêu đề, `fromDate`, `toDate` theo khoảng giáo trình giao nhau; chỉ giáo trình APPROVED trong phạm vi học của đúng con |

Các filter ngày của giáo trình/leave so sánh ngày lịch. `scheduled-sessions` nhận `YYYY-MM-DD` và giữ giới hạn lịch mặc định riêng cho parent.

## Danh bạ, audit và thông báo

| GET route | Bộ lọc |
| --- | --- |
| `/staff`, `/teachers`, `/curriculum-designers`, `/parents`, `/managers` | `status`, `search` email/tên; thêm `fromDate`, `toDate` theo ngày tạo tài khoản |
| `/teacher-invitations`, `/manager-invitations` | `search` email, `status=INVITED/ACCEPTED/APPROVED/REJECTED/REVOKED`, `fromDate`, `toDate` theo ngày tạo |
| `/audit-logs` | Giữ `actorUserId`, `entityType`, `entityId`, `action`, `from`, `to`; dùng cùng quy tắc ngày UTC+7 và kiểm tra thứ tự |
| `/notifications` | Giữ `unreadOnly`, `type`, `studentId`; thêm `classId`, `search` tiêu đề/nội dung, `fromDate`, `toDate` theo ngày tạo; luôn khóa theo người nhận |

Ngày không kèm giờ được hiểu là toàn bộ ngày tại UTC+7, ví dụ `toDate=2026-10-24` bao gồm tới 23:59:59.999 giờ trung tâm. ISO timestamp có giờ và timezone được giữ chính xác ở các endpoint dùng `dateTimeRange`; timestamp chưa có timezone được hiểu là giờ trung tâm UTC+7. Khoảng ngày sai thứ tự hoặc ngày lịch không tồn tại trả `400 INVALID_DATE_RANGE`.

## Các GET không áp dụng paging danh sách

- Detail theo ID (bài tập, chương trình, giáo trình, buổi học, generation, nhân sự, phụ huynh, bill, receipt, grading job), `/auth/me`, `/parents/lookup`: trả một tài nguyên hoặc một kết quả xác định. Các collection con là một phần của detail; muốn duyệt danh sách độc lập dùng route danh sách tương ứng.
- `/health`, `/health/live`, `/health/ready`, `/notifications/unread-count`: trạng thái hoặc số đếm.
- `/dashboard`, `/academic/analytics`: tổng hợp theo phạm vi bộ lọc hiện có; phân trang dữ liệu đầu vào sẽ làm sai thống kê.
- Các route download/export: trả file theo tài nguyên/phạm vi đã chọn, không bọc envelope phân trang.

## Kiểm chứng

`tests/unit/list-query.spec.ts` kiểm tra parsing query, enum, giới hạn trang, boolean false, ngày UTC+7, khoảng ngày đảo ngược và trang rỗng. `tests/e2e/demo-seed.e2e-spec.ts` chạy truy vấn phân trang/bộ lọc trên 46 route bằng MySQL test riêng, kiểm tra metadata, tổng số, hai trang khác nhau, validation và parent không thấy assignment DRAFT qua bộ lọc.
