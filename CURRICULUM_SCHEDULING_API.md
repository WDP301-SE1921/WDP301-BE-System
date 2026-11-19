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
| `POST /academic/curriculum-units` | CURRICULUM_DESIGNER | `{ "programId": "...", "title": "Giáo trình Toán 8" }`; trả học phần `DRAFT`. `fromDate`/`toDate` bị bỏ qua (đợt F) |
| `GET /academic/curriculum-units?programId=...` | MANAGER, CURRICULUM_DESIGNER, TEACHER | Liệt kê; giáo viên chỉ thấy học phần đã duyệt thuộc môn/khối lớp được phân công |
| `GET /academic/curriculum-units/:id` | Như trên | Chi tiết và các bài; mọi Thiết kế GT xem và sửa được mọi bản nháp (Q6, chống ghi đè bằng `expectedRevision`) |
| `PATCH /academic/curriculum-units/:id` | CURRICULUM_DESIGNER | Sửa `title` khi còn DRAFT (`fromDate`/`toDate` bị bỏ qua) |
| `POST /academic/curriculum-units/:id/lessons` | CURRICULUM_DESIGNER | `{ "sequence": 1, "title": "Bài 1", "content": "..." }` |
| `PATCH /academic/curriculum-units/:id/lessons/:lessonId` | CURRICULUM_DESIGNER | Sửa bài học DRAFT với cùng các trường |
| `POST /academic/curriculum-units/:id/monthly-tests` | CURRICULUM_DESIGNER | `{ "monthKey": "2027-01", "title": "Kiểm tra tháng 1", "content": "..." }`; tạo mới hoặc cập nhật tháng đó |
| `POST /academic/curriculum-units/:id/approve` | MANAGER | Kiểm tra đủ bài và chuyển toàn bộ học phần/bài sang APPROVED |
| `POST /academic/curriculum-units/:id/revisions` | CURRICULUM_DESIGNER | Sao chép học phần đã duyệt thành phiên bản DRAFT mới; Thiết kế GT nào cũng làm được |
| `GET /academic/curriculum-units/:id/reviewers` | MANAGER, CURRICULUM_DESIGNER | Giáo viên chọn được làm người duyệt nội dung, mỗi item `{ id, email, displayName, reason }`. `reason`: `PROGRAM` (dạy lớp của khóa), `SUBJECT` (dạy lớp khóa khác cùng môn), `ANY` (mọi giáo viên ACTIVE, chỉ khi hai nhóm kia rỗng). Xếp PROGRAM rồi SUBJECT |
| `POST /academic/curriculum-units/:id/submit` | CURRICULUM_DESIGNER | `{ "reviewerTeacherId": "..." }`; giáo viên phải nằm trong danh sách `reviewers`, sai thì 400 `INVALID_CURRICULUM_REVIEWER`. Lúc duyệt, giáo viên chỉ cần đúng người được chọn và còn ACTIVE (không thì 403) |

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
  "fromDate": "2027-01-04"
}
```

`curriculumUnitId` tùy chọn (đợt F): bỏ trống thì server lấy bản lớp đang học (bản của buổi gần nhất), lớp chưa có buổi thì lấy bản `APPROVED` của khóa; khóa chưa có bản duyệt: 409 `UNIT_NOT_APPROVED`. `fromDate` là ngày bắt đầu, không xét ngày của giáo trình (đợt F). Bắt đầu lần đầu cần bản `APPROVED`; lớp đang học một bản đã bị thay vẫn nối tiếp được tới bài cuối. `toDate` không còn cần: nếu client cũ vẫn gửi thì bị bỏ qua. Lịch tự chạy tới bài cuối của giáo trình (một bài một buổi, bỏ kỳ nghỉ Tết) và có thể vượt ngày kết thúc kỳ; tối đa 24 tháng kể từ `fromDate` (quá: 400 `SCHEDULE_TOO_LONG`). Kết quả trả thêm `endDate` (ngày buổi cuối, `toDate` bằng giá trị này), `lessonCount` (số buổi), `mode` (`FIRST_LESSON` | `CONTINUE`), `unscheduledLessons` luôn rỗng.

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

### Gán bài khi tạo lịch (D1, từ 19/11/2026)

- Một buổi một bài, theo thứ tự bài 1..N, mỗi tuần theo lịch học của lớp, bỏ kỳ nghỉ Tết, cho tới khi hết bài của giáo trình. Ngày kết thúc do hệ thống tính (`endDate`).
- Lớp **chưa có** buổi nào của giáo trình: bắt đầu từ bài 1 (`mode: FIRST_LESSON`), kể cả khi mở giữa kỳ.
- Lớp **đã có** buổi chưa hủy mang bài của giáo trình này: bắt đầu từ bài liền sau bài của buổi cuối đó (`mode: CONTINUE`). `fromDate` phải sau buổi cuối đã có; nếu không: 409 `SESSIONS_AFTER_RANGE_EXIST`, `details.lastScheduledDate`.
- Lớp đã xếp đủ mọi bài: 409 `CURRICULUM_COMPLETED`. Không vừa trong 24 tháng: 400 `SCHEDULE_TOO_LONG`. `INSUFFICIENT_LESSONS` không còn được trả bởi preview/generate.
- Idempotency: `requestHash` chỉ gồm lớp, giáo trình và `fromDate`.
- Buổi đã hủy trước 19/11/2026 (dữ liệu cũ): hủy bỏ bài ở đúng buổi cuối cùng thì bài đó quay lại ở lần tạo lịch sau; ở buổi giữa thì bài không lặp lại.

## Kỳ nghỉ Tết (từ 19/11/2026)

- Trung tâm nghỉ Tết cố định từ **23 tháng Chạp (đưa ông Táo về trời) đến hết mùng 7**, theo lịch âm Việt Nam (UTC+7). Bảng ngày nằm trong `src/common/lunar-new-year.ts` (`TET_BREAKS`, 2025–2035; thêm năm mới trước 2035). Ví dụ Tết 2027: 30/01 → 12/02/2027.
- `session-preview` và `session-generations` không tạo buổi nào trong kỳ nghỉ Tết. Bài được gán lần lượt theo buổi, nên bài kế tiếp tự rơi vào buổi đầu tiên sau Tết. Kỳ nghỉ Tết được tính trên cả khoảng thật của lịch (từ `fromDate` tới tối đa 24 tháng), không chỉ trong kỳ áp dụng của giáo trình.
- Đổi giờ một buổi vào ngày Tết vẫn được (BE không chặn; web cảnh báo).
- Giảm học phí Tết 50% (tháng gói chứa mùng 1 Tết) giữ nguyên và đọc cùng bảng mùng 1 (`LUNAR_NEW_YEAR`). Mùng 1 Tết 2030 là 02/02 theo lịch Việt Nam.

## Đã gỡ 19/11/2026: hủy buổi và ngày nghỉ trung tâm

- Trung tâm không hủy buổi. Buổi không dạy được thì đổi sang ngày khác (`POST /academic/sessions/:id/reschedule`) hoặc đổi giáo viên (dạy thay).
- Các route sau đã xóa và trả 404: `POST /academic/sessions/:id/cancel`, `POST /academic/sessions/:id/cancel-preview`, `POST /academic/sessions/bulk-cancel-preview`, `POST /academic/sessions/bulk-cancel`, `GET|POST /academic/center-closures`, `PATCH|DELETE /academic/center-closures/:id`.
- Dữ liệu cũ vẫn trả về khi đọc: buổi `status: "CANCELLED"` kèm `cancelReason`, thông báo `SESSION_CANCELLED`, gia hạn `source: "SESSION_CANCELLED"`. Bảng `center_closures` và `session_bulk_cancels` còn trong schema nhưng không được đọc hay ghi.
- Bộ lọc `status` của `GET /academic/scheduled-sessions` vẫn nhận `CANCELLED` để xem buổi hủy cũ.

## Quy tắc và lỗi cần hiển thị

- Không xét ngày của giáo trình (đợt F). Lần tạo lịch đầu của lớp bắt đầu từ bài 1; lịch chạy tới bài cuối.
- Duyệt yêu cầu bài học có `sequence` liên tục từ 1 và bài kiểm tra cho mỗi tháng có buổi học. Nếu lớp được tạo sau khi duyệt, bước xem trước/sinh lịch vẫn kiểm tra lại đủ nội dung.
- Hai lớp dùng cùng ID bài nhưng có thể học khác ngày. Buổi học bù chỉ có ứng viên nếu lớp khác đã sinh buổi cùng ID bài; riêng ranh giới tháng có thể làm vị trí bài kiểm tra giữa các lớp khác nhau.
- `INSUFFICIENT_LESSONS`, `LESSON_SEQUENCE_GAP`, `MISSING_MONTHLY_TEST`, `NO_SCHEDULED_CLASS`: hoàn thiện giáo trình/lịch trước khi duyệt.
- `UNIT_NOT_APPROVED`, `CURRICULUM_MISMATCH`, `CLASS_NEEDS_SCHEDULE`, `INVALID_TEACHER`, `CURRICULUM_COMPLETED`, `SCHEDULE_TOO_LONG`, `CLASS_CURRICULUM_LOCKED` (lớp đã có buổi của giáo trình khác, 409, `details.currentUnitId`, `details.currentUnitTitle`): sửa lựa chọn khi xem trước.
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

**Một giáo trình đang áp dụng mỗi khóa (đợt F, 19/11).** Giáo trình không còn kỳ do người dùng nhập. Khi Manager duyệt một bản, server khóa khóa học, chuyển mọi bản `APPROVED` khác của khóa sang `ARCHIVED`/`SUPERSEDED` (`toDate` = hôm qua, không nhỏ hơn `fromDate`), rồi cho bản mới `fromDate` = hôm nay, `toDate` = `2099-12-31`. Lớp đang học bản cũ học tiếp tới hết bài; lớp tạo lịch sau đó dùng bản mới.

*Dữ liệu trước đợt F* (kỳ do người dùng nhập) vẫn theo luật cũ dưới đây cho tới lần duyệt kế tiếp của khóa:

- Duyệt trước bản tương lai không lưu trữ bản đang dùng. Từ 00:00 giờ Việt Nam ngày bản mới bắt đầu, worker (chạy khi khởi động và mỗi phút) chuyển bản cũ đã kết thúc sang `ARCHIVED` với `archiveReason: "SUPERSEDED"`, `supersededById`, `archivedAt` và audit `CURRICULUM_UNIT_AUTO_ARCHIVED`; chạy lại không tạo audit trùng. Lưu trữ thủ công qua `DELETE` có `archiveReason: "MANUAL"` và không kích hoạt chuyển kỳ.
- Bản tự lưu trữ vẫn hiện cho giáo viên của khóa và trong outline phụ huynh của kỳ đã học; buổi đã sinh giữ `lessonId` cũ. `POST /academic/curriculum-units/:id/revisions` nhận nguồn `APPROVED` hoặc `ARCHIVED` từng được duyệt, từ đợt F không cần ngày.
- Trước khi triển khai, chạy `pnpm db:report-course-curriculum` (chỉ đọc) để liệt kê khóa chưa cấu hình/lớp lệch số buổi và các bản đã duyệt giao ngày; xử lý theo quyết định nghiệp vụ, không tự sửa ngày hay xóa lịch sử. Migration chỉ tự điền số buổi khi mọi lớp đang hoạt động của khóa có cùng số khung giờ hợp lệ.

| Mã lỗi | Khi nào | `details` |
| --- | --- | --- |
| 409 `PROGRAM_FREQUENCY_NOT_CONFIGURED` | Dùng lịch có dữ liệu khi khóa chưa cấu hình | `programId` |
| 409 `CLASS_WEEKLY_SESSION_COUNT_MISMATCH` | Số khung giờ khác số buổi của khóa | `programId`, `classId`, `expected`, `actual` |
| 409 `PROGRAM_FREQUENCY_CHANGE_CONFLICT` | Đổi số buổi làm lệch lớp đang hoạt động | `programId`, `expected`, `conflictingClasses[]` (`id`, `name`, `actual`) |

## Phòng, giáo viên và xác nhận lịch

- Manager quản lý phòng qua `GET/POST /rooms`, `PATCH /rooms/:id`. Phòng phải hoạt động, đủ sức chứa; session sinh mới giữ `roomId` và kiểm tra trùng phòng.
- `POST /classes/:id/teacher-assignments` đổi giáo viên từ `effectiveAt` và chỉ cập nhật các buổi tương lai. `GET /academic/sessions/:id/substitute-candidates` cùng `POST /academic/sessions/:id/substitutions` xử lý dạy thay một buổi.
- Teacher phụ trách xác nhận bằng `PUT /classes/:id/schedule-confirmation { "confirmed": true }`; Manager mở khóa bằng `{ "confirmed": false, "reason": "..." }` trước khi sửa lịch tuần.
- Luồng mời Teacher/Manager dùng `/teacher-invitations`, `/manager-invitations`, `/account-invitations/accept`, review/revoke. Account vừa accept vẫn `DISABLED` đến khi Manager duyệt.
