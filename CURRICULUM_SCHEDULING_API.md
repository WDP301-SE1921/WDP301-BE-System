# API giáo trình và sinh lịch học

Luồng này bổ sung cho đăng ký học tại trung tâm. API dùng prefix `/api/v1`, Bearer access token, response thành công `{ "success": true, "data": ... }` và lỗi `{ "success": false, "error": { "code": "...", "message": "...", "requestId": "..." } }`.

## Thứ tự thực hiện

1. `MANAGER` tạo chương trình/lớp, gán giáo viên đang hoạt động và lịch tuần bằng `/programs`, `/classes`, `/classes/:id/schedules` như tài liệu đăng ký học. Lớp 8A và 8B có thể học khác ngày nhưng cùng môn/khối.
2. `CURRICULUM_DESIGNER` tạo học phần và bài học theo thứ tự; tạo nội dung kiểm tra cho từng tháng có lịch.
3. `MANAGER` duyệt học phần. Backend tính số buổi từ lịch tuần của các lớp cùng môn/khối trong toàn khoảng học phần, yêu cầu đủ bài cho lớp có nhiều buổi học thường nhất và đủ bài kiểm tra tháng.
4. `MANAGER` xem trước lịch của từng lớp, xử lý xung đột, rồi sinh buổi học. Có thể chia khoảng ngày thành nhiều yêu cầu; thứ tự bài luôn tính từ đầu học phần.
5. Giáo viên dùng buổi đã sinh để chuẩn bị danh sách học sinh và điểm danh. Phụ huynh xem buổi trong kỳ ghi danh của con.

## API giáo trình

| API | Role | Body / kết quả chính |
| --- | --- | --- |
| `POST /academic/curriculum-units` | CURRICULUM_DESIGNER | `{ "programId": "...", "title": "Toán 8 - học phần 1", "fromDate": "2027-01-04", "toDate": "2027-01-31" }`; trả học phần `DRAFT` |
| `GET /academic/curriculum-units?programId=...` | MANAGER, CURRICULUM_DESIGNER, TEACHER | Liệt kê; giáo viên chỉ thấy học phần đã duyệt thuộc môn/khối lớp được phân công |
| `GET /academic/curriculum-units/:id` | Như trên | Chi tiết và các bài; người soạn chỉ xem học phần của mình |
| `PATCH /academic/curriculum-units/:id` | CURRICULUM_DESIGNER | Sửa `title`, `fromDate`, `toDate` khi còn DRAFT |
| `POST /academic/curriculum-units/:id/lessons` | CURRICULUM_DESIGNER | `{ "sequence": 1, "title": "Bài 1", "content": "..." }` |
| `PATCH /academic/curriculum-units/:id/lessons/:lessonId` | CURRICULUM_DESIGNER | Sửa bài học DRAFT với cùng các trường |
| `POST /academic/curriculum-units/:id/monthly-tests` | CURRICULUM_DESIGNER | `{ "monthKey": "2027-01", "title": "Kiểm tra tháng 1", "content": "..." }`; tạo mới hoặc cập nhật tháng đó |
| `POST /academic/curriculum-units/:id/approve` | MANAGER | Kiểm tra đủ bài và chuyển toàn bộ học phần/bài sang APPROVED |
| `POST /academic/curriculum-units/:id/revisions` | CURRICULUM_DESIGNER | Sao chép học phần đã duyệt thành phiên bản DRAFT mới |

Giáo trình được chia sẻ theo **khối và tên môn đã chuẩn hóa** (trim, gộp khoảng trắng, chữ thường, bỏ dấu). Vì thế hai `Program` khác ID nhưng đều là Toán khối 8 dùng chung học phần. Bài học cũ không có `unitId` vẫn được giữ và tiếp tục dùng với API học vụ cũ. Mỗi học phần mới giới hạn tối đa 366 ngày; các ngày gửi dạng `YYYY-MM-DD`.

Một buổi học gắn một `lessonId`. Bài kiểm tra tháng cũng là một nội dung giáo trình (`kind: MONTHLY_TEST`), gắn vào buổi cuối cùng của tháng trong lịch lớp. Nội dung kiểm tra là tiêu đề và nội dung do người soạn nhập; làm bài/chấm điểm điện tử dùng các API `Assignment` hiện có.

## API sinh lịch

Xem trước:

```http
POST /api/v1/academic/classes/<classId>/session-preview
Authorization: Bearer <managerAccessToken>
Content-Type: application/json
```

```json
{
  "curriculumUnitId": "<approvedUnitId>",
  "fromDate": "2027-01-04",
  "toDate": "2027-01-31"
}
```

`data.slots` gồm `date`, `startsAt`, `endsAt`, `lessonId`, `lessonTitle`, `kind`, `monthKey`, `conflicts` và `makeupCandidates`. `startsAt`/`endsAt` là UTC; hiển thị theo `Asia/Ho_Chi_Minh`. `makeupCandidates` chỉ chứa buổi **đã được sinh** ở lớp khác, cùng bài, diễn ra sau buổi gốc và vẫn ở tương lai; việc học bù thực tế vẫn phải qua API đăng ký học bù và kiểm tra sĩ số/quyền.

Sinh lịch dùng body trên và thêm header `Idempotency-Key`:

```http
POST /api/v1/academic/classes/<classId>/session-generations
Authorization: Bearer <managerAccessToken>
Content-Type: application/json
Idempotency-Key: <uuid-once-per-operation>
```

`data.sessions` chứa các buổi đã tạo, kèm thông tin bài. Frontend giữ nguyên key/body khi retry do timeout; cùng key và body trả cùng kết quả, cùng key với body khác trả `IDEMPOTENCY_CONFLICT`. Yêu cầu khác chồng lên buổi đã có trả `SCHEDULE_CONFLICT` và không tạo lịch dở dang. Không tự tạo danh sách điểm danh: gọi `POST /academic/sessions/:id/roster` khi cần, sau khi học sinh đã ghi danh.

`GET /academic/scheduled-sessions?studentId=...&classId=...&fromDate=2027-01-04&toDate=2027-01-31&page=1&limit=20` trả buổi học và bài (`kind`, `monthKey`, `unitId`). MANAGER/STAFF xem lớp, TEACHER chỉ xem buổi được phân công. PARENT có thể chọn một con bằng `studentId`; kết quả gồm lịch placement, học bù khác lớp và lịch sử hợp lệ, với `participations` chỉ thuộc con của Parent. Nếu Parent không gửi khoảng ngày, API mặc định từ hôm nay đến 30 ngày sau.

## Quy tắc và lỗi cần hiển thị

- Học phần phải được duyệt, lớp phải đúng môn/khối, có lịch tuần và giáo viên đang hoạt động. Khoảng sinh phải nằm trong khoảng học phần. Hệ thống tính bài từ **đầu học phần**, nên sinh hai đoạn liên tiếp cho cùng lớp không làm bài quay về số 1.
- Duyệt yêu cầu bài học có `sequence` liên tục từ 1 và bài kiểm tra cho mỗi tháng có buổi học. Nếu lớp được tạo sau khi duyệt, bước xem trước/sinh lịch vẫn kiểm tra lại đủ nội dung.
- Hai lớp dùng cùng ID bài nhưng có thể học khác ngày. Buổi học bù chỉ có ứng viên nếu lớp khác đã sinh buổi cùng ID bài; riêng ranh giới tháng có thể làm vị trí bài kiểm tra giữa các lớp khác nhau.
- `INSUFFICIENT_LESSONS`, `LESSON_SEQUENCE_GAP`, `MISSING_MONTHLY_TEST`, `NO_SCHEDULED_CLASS`: hoàn thiện giáo trình/lịch trước khi duyệt.
- `UNIT_NOT_APPROVED`, `CURRICULUM_MISMATCH`, `CLASS_NEEDS_SCHEDULE`, `INVALID_TEACHER`, `RANGE_OUTSIDE_UNIT`, `NO_SESSIONS`: sửa lựa chọn khi xem trước.
- `SCHEDULE_CONFLICT`: có buổi của lớp hoặc giáo viên trùng giờ; xem `conflicts` ở API xem trước.
- Khi lớp đã có buổi học tương lai, API cấu hình lớp chặn đổi lịch tuần hoặc đổi giáo viên để lịch đã sinh không lệch cấu hình.
- `UNIT_LOCKED`: nội dung đã duyệt; tạo phiên bản mới. Buổi đã sinh tiếp tục trỏ tới phiên bản cũ.

Schema và migration mới chỉ bổ sung bảng/cột. Dữ liệu `Lesson`, `ClassSession` và các API học vụ cũ không bị đổi hoặc xóa.

## Số buổi/tuần của khóa và giáo trình hiệu lực

**Số buổi/tuần (`Program.sessionsPerWeek`).** Số nguyên 1–14, trả trong `GET /programs`, `GET /programs/:id`, `program` của lớp và của giáo trình. `POST /programs`, `PATCH /programs/:id` (và `POST /academic/programs` cũ) nhận trường này:

- Giai đoạn chuyển tiếp: bỏ trường thì tạo khóa với `null` (chưa cấu hình), PATCH bỏ trường thì giữ giá trị cũ. Gửi `null`, 0, số âm, số thập phân, chuỗi hoặc > 14 bị 400 `VALIDATION_ERROR`. Chỉ bắt buộc khi tạo khóa sau khi mọi client đã gửi trường này.
- Mỗi khung giờ trong lịch tuần là một buổi; hai khung cùng thứ khác giờ tính là hai buổi. Lưu lịch tuần có dữ liệu (`PUT`/`POST /classes/:id/schedules`, `PATCH`, `DELETE` từng khung) phải đúng số buổi của khóa, lỗi thì lịch cũ giữ nguyên. Lớp đóng đăng ký được để lịch trống.
- Mở đăng ký, kích hoạt lại lớp, giáo viên xác nhận lịch, xem trước/sinh lịch và tạo buổi cũ (`POST /academic/sessions`) đều kiểm tra lại. `POST /academic/classes` cũ tạo lớp ở trạng thái đóng đăng ký.
- Đổi số buổi khi lớp đang hoạt động có lịch khác số mới thì bị chặn, không tự thêm/xóa khung giờ hay buổi đã sinh. Bản xem trước lập trước khi đổi số buổi sẽ báo `PREVIEW_STALE`.

**Một giáo trình hiệu lực mỗi ngày.** Theo `programId`, khoảng `[fromDate, toDate]` tính cả hai đầu. Nhiều bản nháp/chờ duyệt giao ngày vẫn được lưu; khi Manager duyệt, server khóa khóa học rồi chặn bản giao ngày với bản đã duyệt hoặc bản đã tự lưu trữ vì sang kỳ (kể cả bản tạo độc lập, kể cả duyệt đồng thời). Không tự cắt ngày bản cũ.

- Duyệt trước bản tương lai không lưu trữ bản đang dùng. Từ 00:00 giờ Việt Nam ngày bản mới bắt đầu, worker (chạy khi khởi động và mỗi phút) chuyển bản cũ đã kết thúc sang `ARCHIVED` với `archiveReason: "SUPERSEDED"`, `supersededById`, `archivedAt` và audit `CURRICULUM_UNIT_AUTO_ARCHIVED`; chạy lại không tạo audit trùng. Lưu trữ thủ công qua `DELETE` có `archiveReason: "MANUAL"` và không kích hoạt chuyển kỳ.
- Bản tự lưu trữ vẫn hiện cho giáo viên của khóa và trong outline phụ huynh của kỳ đã học; buổi đã sinh giữ `lessonId` cũ. `POST /academic/curriculum-units/:id/revisions` nhận nguồn `APPROVED` hoặc `ARCHIVED` từng được duyệt, kỳ mới vẫn phải sau hôm nay và sau kỳ nguồn.
- Trước khi triển khai, chạy `pnpm db:report-course-curriculum` (chỉ đọc) để liệt kê khóa chưa cấu hình/lớp lệch số buổi và các bản đã duyệt giao ngày; xử lý theo quyết định nghiệp vụ, không tự sửa ngày hay xóa lịch sử. Migration chỉ tự điền số buổi khi mọi lớp đang hoạt động của khóa có cùng số khung giờ hợp lệ.

| Mã lỗi | Khi nào | `details` |
| --- | --- | --- |
| 409 `PROGRAM_FREQUENCY_NOT_CONFIGURED` | Dùng lịch có dữ liệu khi khóa chưa cấu hình | `programId` |
| 409 `CLASS_WEEKLY_SESSION_COUNT_MISMATCH` | Số khung giờ khác số buổi của khóa | `programId`, `classId`, `expected`, `actual` |
| 409 `PROGRAM_FREQUENCY_CHANGE_CONFLICT` | Đổi số buổi làm lệch lớp đang hoạt động | `programId`, `expected`, `conflictingClasses[]` (`id`, `name`, `actual`) |
| 409 `CURRICULUM_EFFECTIVE_PERIOD_CONFLICT` | Duyệt bản giao ngày với bản đã duyệt cùng khóa | `programId`, `conflicts[]` (`id`, `title`, `fromDate`, `toDate`) |
| 409 `RANGE_OUTSIDE_UNIT` | Tạo buổi cũ ngoài kỳ của giáo trình | — |

## Phòng, giáo viên và xác nhận lịch

- Manager quản lý phòng qua `GET/POST /rooms`, `PATCH /rooms/:id`. Phòng phải hoạt động, đủ sức chứa; session sinh mới giữ `roomId` và kiểm tra trùng phòng.
- `POST /classes/:id/teacher-assignments` đổi giáo viên từ `effectiveAt` và chỉ cập nhật các buổi tương lai. `GET /academic/sessions/:id/substitute-candidates` cùng `POST /academic/sessions/:id/substitutions` xử lý dạy thay một buổi.
- Teacher phụ trách xác nhận bằng `PUT /classes/:id/schedule-confirmation { "confirmed": true }`; Manager mở khóa bằng `{ "confirmed": false, "reason": "..." }` trước khi sửa lịch tuần.
- Luồng mời Teacher/Manager dùng `/teacher-invitations`, `/manager-invitations`, `/account-invitations/accept`, review/revoke. Account vừa accept vẫn `DISABLED` đến khi Manager duyệt.
