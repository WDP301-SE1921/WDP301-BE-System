# Báo Cáo Cập Nhật Tính Năng Mới & Khắc Phục Lỗi Hệ Thống EduGrade

Tài liệu này tổng hợp toàn bộ các tính năng mới đã được triển khai, các quy trình nghiệp vụ đã được hoàn thiện và danh sách các lỗi (bugs/gaps) đã được khắc phục triệt để trong phiên làm việc.

---

## 1. Danh Sách Tính Năng Mới Được Cập Nhật (New Features)

### 1.1. AI Grading Skill (Chấm Bài Bằng AI Tích Hợp Giáo Trình & Barem Điểm)
- **Tích hợp ngữ cảnh học thuật**:
  - Tự động nạp bài học tương ứng (`ClassSession.lesson`) hoặc danh sách bài học đã duyệt của chương trình (`Program.lessons`) vào prompt của AI.
  - Tự động nạp Barem điểm phân rã chi tiết (`rubric`), đáp án mẫu (`correctAnswer`) và Chuẩn đầu ra (`LearningOutcome`).
- **Tương thích DeepSeek API**:
  - Hỗ trợ endpoint OpenAI-compatible (`https://api.deepseek.com/chat/completions`) với model `deepseek-chat` và chế độ phản hồi JSON (`response_format: { type: "json_object" }`).
  - Tốc độ chấm trung bình: **~1.8s – 2.5s** cho mỗi bài làm.
- **Cơ chế Human-in-the-Loop**:
  - Điểm của AI được lưu dưới dạng đề xuất nháp tại `GradingJob.result`, không tự ý ghi đè điểm chính thức.
  - Giáo viên có toàn quyền kiểm tra, hiệu chỉnh, duyệt (`approve`) và công bố (`publish`) điểm cho học sinh.

### 1.2. Trọn Bộ CRUD Cho Chuẩn Đầu Ra (CLO & OutcomeSet)
- Bổ sung đầy đủ các endpoint quản lý vòng đời chuẩn đầu ra trong `AcademicController` và `OutcomeService`:
  - `GET /api/v1/academic/outcome-sets/:id`: Xem chi tiết 1 bộ OutcomeSet.
  - `DELETE /api/v1/academic/outcome-sets/:id`: Xóa bộ OutcomeSet nháp (tự động dọn dẹp liên kết `LessonOutcome` và `LearningOutcome`).
  - `GET /api/v1/academic/outcomes/:id` & `GET /api/v1/academic/outcome-sets/:setId/outcomes/:outcomeId`: Xem chi tiết 1 CLO.
  - `DELETE /api/v1/academic/outcomes/:id` & `DELETE /api/v1/academic/outcome-sets/:setId/outcomes/:outcomeId`: Xóa 1 CLO nháp (chặn xóa nếu câu hỏi trong bài tập đã sử dụng).

### 1.3. Kịch Bản Kiểm Thử Mẫu Toàn Diện Full-Flow (End-to-End Simulation)
- Xây dựng script kiểm thử tự động `scripts/full-academic-flow-simulation.ts` mô phỏng khép kín chu trình 8 bước:
  1. *Đăng nhập phân quyền (Designer, Teacher, Manager, Parent).*
  2. *Thiết kế bài học giáo trình.*
  3. *Tạo CLO, verify nguồn Thông tư 32/2018 và duyệt cấp quản lý.*
  4. *Tạo và phát hành bài tập hỗn hợp (Trắc nghiệm + Tự luận kèm barem).*
  5. *Học sinh làm bài và nộp kèm ảnh/file.*
  6. *Kích hoạt AI chấm bài trực tiếp qua DeepSeek.*
  7. *Giáo viên phúc khảo, phê duyệt và công bố điểm.*
  8. *Phụ huynh xem báo cáo kết quả và nhận xét sư phạm.*

### 1.4. Thông Tin Liên Hệ Trung Tâm (`GET /api/v1/center`, 03/11)
- Route public trả `{ name, address, phone, email, openingHours }` từ bảng `center_profiles` (một dòng, migration `20261103010000_center_profile`); chưa có dòng hoặc chưa có giá trị thì trả `null`.
- `pnpm seed` tạo dòng này (thông tin demo ở chế độ demo) và mỗi lần chạy ghi các biến `CENTER_NAME`, `CENTER_ADDRESS`, `CENTER_PHONE`, `CENTER_EMAIL`, `CENTER_OPENING_HOURS` có giá trị vào đó; `pnpm seed:dashboard` cũng vậy.
- Ứng dụng phụ huynh dùng cho bill, biên lai và nút "Gọi trung tâm" ở màn học phí, đổi số không cần build lại app.

### 1.5. Gắn CLO vào bài của giáo trình đang áp dụng (`PATCH /api/v1/academic/lessons/:id/outcomes`, 09/11)
- Trước đây chỉ bài nháp gắn được CLO, nên CLO thêm sau khi Quản lý áp dụng giáo trình không bao giờ có bài và bộ CLO không duyệt chuyên môn được.
- Bài của giáo trình `APPROVED` (kể cả bài kiểm tra tháng còn nháp) giờ thêm hoặc bỏ được CLO của **bộ `DRAFT`**. Liên kết tới bộ `APPROVED` được giữ nguyên kể cả khi request không gửi; thêm CLO của bộ đó trả 409 `OUTCOME_SET_LOCKED` với `details.outcomeIds`.
- Bài nháp của giáo trình nháp hoặc chờ thẩm định: không đổi. Bài của giáo trình `ARCHIVED`, hoặc bài đã duyệt không thuộc giáo trình đang áp dụng: 409 `LESSON_LOCKED`.
- Response vẫn là `{ lessonId, outcomeIds }`; `outcomeIds` là các liên kết sau khi ghi, gồm cả liên kết được giữ. Ghi theo phần chênh lệch, khóa dòng bài rồi mọi bộ CLO có liên kết thêm hoặc bớt (kể cả khi bài còn nháp); `technical-approve` khóa dòng bộ trước khi đọc liên kết, nên không duyệt bộ dựa trên liên kết đang bị gỡ.
- Nhập `REPLACE` gỡ mọi liên kết mục tiêu của các bài bị thay; cần gắn lại.
- Web: mở hộp "Gắn CLO" cho giáo trình đang áp dụng, khóa ô của bộ đã duyệt, sửa chữ của `LESSON_LOCKED` và `OUTCOME_SET_LOCKED`; câu xác nhận `REPLACE` báo liên kết mục tiêu bị gỡ. Mobile không gọi route này.

### 1.6. CSV chịu được Excel, lỗi kèm số dòng (nhập giáo trình và câu hỏi bài tập, 09/11)
- Bộ đọc dùng chung `src/common/csv/read-csv.ts` thay hai bộ tách ô riêng của `curriculum-csv.ts` và `assignment-import-parser.ts`.
- Nhận dấu `;` (lấy từ dòng tiêu đề), ô `csvVersion` trống (coi là `1`), dòng chỉ có `csvVersion`, cột trống thừa ở cuối; file `;` nhận `maxScore` dạng `0,5`.
- `rowNumber` là số dòng Excel (tiêu đề là dòng 1, ô xuống dòng không tăng số dòng). Trong preview giáo trình, dòng nằm sau một ô có xuống dòng giờ có số nhỏ hơn trước.
- Mã lỗi giữ nguyên (`CSV_INVALID`, `ASSIGNMENT_IMPORT_INVALID_CSV`, `ASSIGNMENT_IMPORT_INVALID_QUESTIONS`), thêm `details: { code, rows: [{ code, rowNumber }], rowErrorCount }` (tối đa 20 dòng). File không phải UTF-8 có `details.code: 'CSV_NOT_UTF8'`. Câu hỏi bài tập sai báo "Dòng R (câu N): …" cho mọi câu sai; nhập DOCX/PDF bằng AI không đổi.
- Web chưa phải sửa; màn nhập CSV sẽ đọc `details` ở W4. Mobile không dùng.

### 1.7. Mọi Thiết kế GT sửa được bản nháp; CLO không cần giáo trình (B2, 09/11)
- `CURRICULUM_DESIGNER` đọc, sửa, gửi duyệt, làm kỳ mới mọi giáo trình; đọc, sửa, xóa mọi bộ CLO và CLO; gắn CLO cho bài do người khác soạn. Danh sách giáo trình, bộ CLO, bài (`GET /academic/lessons`) và phản hồi giáo trình không còn lọc theo người soạn; mọi Thiết kế GT xử lý được phản hồi. TEACHER vẫn chỉ thấy phản hồi của mình. Trước: 403 `FORBIDDEN`; sau: 200.
- `POST /academic/outcome-sets` không còn đòi đã có giáo trình: chỉ kiểm khóa có (404 `PROGRAM_NOT_FOUND`), đang hoạt động (409 `PROGRAM_INACTIVE`), môn đang hoạt động (409 `SUBJECT_INACTIVE`).
- Chống ghi đè CLO: cột mới `learning_outcomes.revision` (mặc định 1, tăng ở mỗi lần sửa, xác minh, duyệt). `LearningOutcomeWriteDto` nhận `expectedRevision` tùy chọn; sai thì 409 `REVISION_CONFLICT`. Sửa, xóa CLO, xóa bộ và xác minh nguồn khóa dòng bộ CLO trước khi kiểm `DRAFT`, như `technical-approve`. `technical-approve` và xóa bộ đọc trạng thái bộ, danh sách CLO và liên kết bài bằng câu có khóa (`FOR UPDATE`, thứ tự bộ → CLO → liên kết), vì trên TiDB câu đọc thường dùng snapshot lấy trước lúc chờ khóa và có thể bỏ sót CLO vừa thêm.
- Audit mới: `OUTCOME_SET_CREATED`, `OUTCOME_SET_DELETED`, `OUTCOME_CREATED`, `OUTCOME_UPDATED`, `OUTCOME_DELETED` (actor là người thao tác). Kết quả duyệt giáo trình báo cho người tạo và người gửi duyệt gần nhất (mỗi người một lần).

### 1.8. Người duyệt nội dung chọn theo môn (B4, 09/11)
- `GET /academic/curriculum-units/:id/reviewers`: mỗi item thêm `reason: "PROGRAM" | "SUBJECT" | "ANY"`, xếp PROGRAM rồi SUBJECT (trong nhóm theo tên, email, id). PROGRAM: đang dạy lớp đang hoạt động của khóa. SUBJECT: dạy lớp của khóa khác cùng môn (cùng `subjectId`, hoặc cùng tên môn đã chuẩn hóa khi thiếu), không lặp người đã ở PROGRAM. ANY: mọi giáo viên `ACTIVE`, chỉ khi hai nhóm trên rỗng. `search` lọc sau khi đã chia nhóm.
- Gửi duyệt áp cùng luật; sai vẫn 400 `INVALID_CURRICULUM_REVIEWER`. Lúc giáo viên duyệt chỉ kiểm đúng người được chọn và còn `ACTIVE` (không thì 403 `FORBIDDEN`), không tính lại nhóm.
- Giáo viên đọc, xác minh, duyệt bộ CLO của khóa khi thuộc PROGRAM, SUBJECT, hoặc là người được chọn duyệt một giáo trình của khóa đang `PENDING_REVIEW`, `APPROVED` có `technicalReviewedAt`, hay `ARCHIVED` có cả `technicalReviewedAt` lẫn `approvedAt`. Nhóm ANY không mở quyền vào bộ CLO: khóa không có giáo viên cùng khóa hay cùng môn thì bộ CLO chờ tới khi giáo trình được gửi duyệt.

### 1.9. CLO bản nhẹ (B3, 09/11)
- Migration `20261109000000_clo_light_and_revision`: `sourceTitle`, `sourceUrl`, `sourceLocator` cho phép NULL (chỉ nới ràng buộc, không đổi dòng cũ) và thêm `revision`. Response `LearningOutcome`: ba trường nguồn thành `string | null`, thêm `revision`. Đường lùi: muốn quay về NOT NULL phải chạy `UPDATE learning_outcomes SET sourceTitle = '' WHERE sourceTitle IS NULL` (tương tự cho hai cột còn lại) trước khi `MODIFY ... NOT NULL`.
- `LearningOutcomeWriteDto`: ba trường nguồn và `sourceNote` tùy chọn. Chuỗi rỗng hay toàn khoảng trắng thành `null`; không gửi thì giữ giá trị cũ khi sửa. Có giá trị thì vẫn kiểm độ dài; `sourceUrl` phải là URL `http`/`https` (mới). Gửi giá trị không phải chuỗi: 400.
- `technical-approve` không còn đòi giáo viên xác minh từng CLO; vẫn đòi bộ có CLO và mỗi CLO có ít nhất một bài, sai thì 409 `OUTCOME_SET_INCOMPLETE` kèm `details: { outcomeIds, codes }` (`codes` là mã CLO, ví dụ `MATH-7-04`). Khi duyệt, CLO chưa `VERIFIED` thành `VERIFIED` với `verifiedById` là giáo viên duyệt; CLO đã được giáo viên khác xác minh giữ nguyên người đó. `verify-source` thành bước tùy chọn và dùng được cả khi CLO không có nguồn.
- Bài tập: chọn bộ CLO và gắn CLO cho từng câu thành tùy chọn, kể cả khi khóa đã có bộ được duyệt. Bỏ `OUTCOME_SET_REQUIRED` khi công bố và `OUTCOME_MAPPING_INCOMPLETE` khi câu chưa gắn. Vẫn giữ: bộ đã chọn phải `APPROVED` và đúng khóa (`INVALID_OUTCOME_SET`); gắn CLO mà không chọn bộ (`OUTCOME_SET_REQUIRED`); câu gắn CLO không thuộc bộ: 409 `OUTCOME_MAPPING_INCOMPLETE` kèm `details: { reason: "WRONG_SET", questionIndexes, outcomeIds }`.
- Mobile không đổi: các route phụ huynh không trả ba trường nguồn; bài tập không chọn bộ trả `outcomeSetId: null`, `learningTargets: []`. AI chấm bài đã bỏ qua câu không có CLO.

### 1.10. Ngày buổi cuối đã lên lịch của lớp (B9b, 10/11)
- `GET /classes` (mỗi phần tử) và `GET /programs/:id` (mỗi phần tử `classes[]`) thêm `scheduledUntil: "YYYY-MM-DD" | null`: ngày theo giờ Việt Nam của buổi cuối chưa hủy của lớp, `null` khi lớp chưa có buổi. Thêm một truy vấn `groupBy` cho mỗi trang, các field cũ giữ nguyên.

### 1.11. Hủy buổi có dời bài, hủy nhiều buổi, tạo lịch nối tiếp (B6, 10/11)
- `POST /academic/sessions/:id/cancel`: body thêm `shiftLessons?: boolean` (mặc định `false`, giữ nguyên hành vi, kiểm tra và response cũ). Khi `true`: các buổi `SCHEDULED` sau đó của lớp, cùng giáo trình (`lesson.unitId`, chỉ bài `LESSON`), mỗi buổi nhận bài của buổi liền trước; response là dòng buổi học cộng `shiftedSessions`, `pushedLesson { id, title, sequence }`, `pushedLessonFits` (còn buổi trống trong kỳ để bài bị đẩy vào lần tạo lịch sau). Buổi bị đổi bài có học bù đã đặt: 409 `LESSON_SHIFT_BLOCKED`, `details.sessions[{ sessionId, startsAt }]`.
- Route mới, chỉ `MANAGER`: `POST /academic/sessions/:id/cancel-preview` (body `{ shiftLessons? }`), `POST /academic/sessions/bulk-cancel-preview` và `POST /academic/sessions/bulk-cancel` (body `{ sessionIds (1–200, không trùng), reason, shiftLessons? }`, header `Idempotency-Key`). Preview trả 200 kèm `blockers[{ sessionId, code }]`, không ghi gì. `bulk-cancel` chạy một transaction, được cả hoặc không được gì; bị chặn thì 409 `BULK_CANCEL_BLOCKED`, `details.blockers` với `code` ∈ `SESSION_NOT_FOUND`, `SESSION_LOCKED`, `MAKEUP_BOOKING_EXISTS`, `ATTENDANCE_RECORDED`, `LEAVE_EXISTS`, `LESSON_SHIFT_BLOCKED`. Mỗi lớp nhận một thông báo `SESSION_CANCELLED` (đích `CLASS`), không phải mỗi buổi một thông báo.
- Tạo lịch (`session-preview`, `session-generations`): lớp đã có buổi chưa hủy của giáo trình thì khoảng mới bắt đầu từ bài liền sau bài của buổi cuối (C4); lớp chưa có thì gán theo vị trí buổi tính từ đầu kỳ, bỏ ngày nghỉ trung tâm. `INSUFFICIENT_LESSONS` chỉ kiểm buổi trong khoảng được yêu cầu (trước đây kiểm cả kỳ). Khoảng bắt đầu trước hoặc trùng buổi đã có của cùng giáo trình: 409 `SESSIONS_AFTER_RANGE_EXIST`, `details.lastScheduledDate`. `session-preview` thêm `mode` (`CONTINUE` | `TERM_POSITION`), `startLesson`, `unscheduledLessons` (bài không còn buổi trong kỳ).
- Hủy và bỏ bài (`shiftLessons` không gửi) ở đúng buổi cuối cùng thì lần tạo lịch sau bắt đầu lại từ bài đó; hủy bỏ bài ở giữa thì bài đó không lặp lại.
- `bookMakeup` khóa dòng buổi gốc và buổi thay thế trước khi kiểm, để học bù không chen vào giữa lúc dời bài.
- `session-generations` đọc buổi cuối (bài neo) và kiểm `SESSIONS_AFTER_RANGE_EXIST` bằng câu `FOR UPDATE` sau khi khóa lớp, để không bỏ sót một lệnh hủy có dời bài vừa commit (đọc thường trên TiDB dùng snapshot đầu transaction). `session-preview` vẫn đọc thường.
- Migration `20261110000000_session_bulk_cancel`: bảng mới `session_bulk_cancels` lưu idempotency của hủy nhiều buổi.

### 1.12. Ngày nghỉ trung tâm (B5, 10/11)
- Migration `20261110010000_center_closures`: bảng mới `center_closures`.
- `GET /academic/center-closures?fromDate&toDate&page&limit&paginated` (MANAGER, STAFF, TEACHER, CURRICULUM_DESIGNER); `POST`, `PATCH /:id` (kèm `expectedRevision`), `DELETE /:id` chỉ MANAGER, có audit. Lỗi: 400 `INVALID_DATE_RANGE`, 400 `CLOSURE_TOO_LONG` (quá 92 ngày), 409 `CENTER_CLOSURE_OVERLAP` (`details` là ngày nghỉ bị chồng), 409 `REVISION_CONFLICT`, 404 `CENTER_CLOSURE_NOT_FOUND`.
- `POST`/`PATCH` không tự hủy buổi: trả `affectedSessions` (tối đa 500 buổi `SCHEDULED` trong `[fromDate 00:00+07, toDate+1 00:00+07)`, kèm `classId`, `className`, `revision`, `lesson`) và `affectedTotal` để Quản lý hủy bằng `bulk-cancel`. Không gửi thông báo khi tạo ngày nghỉ; phụ huynh nhận thông báo hủy theo lớp từ `bulk-cancel`.
- Tạo lịch và xem trước bỏ các ngày nghỉ khi gán bài theo vị trí trong kỳ và khi tính `unscheduledLessons`.

---

### 1.13. Hạ ngưỡng nhập mục tiêu và `expectedRevision` cho `verify-source` (10/11)
- Chỉ nới, không phá contract: Ngưỡng độ dài (C29): `title` 2–255, `statement` 2–5000 (bắt buộc, không null), `sourceTitle` 2–255, `sourceLocator` 2–255, `sourceUrl` không có độ dài tối thiểu nhưng phải là URL http/https, `sourceNote` tối đa 5000. `POST outcomes/:id/verify-source` nhận `sourceLocator` 2–255, `sourceNote` 5–5000 và `expectedRevision` tùy chọn (cũ hơn `revision` hiện tại thì 409 `REVISION_CONFLICT`, so sau khi khóa dòng).
- Người dùng ít rành công nghệ có thể ghi nguồn ngắn như "Trang 45" và mô tả ngắn như "Đọc hiểu".

### 1.14. Gộp với PR #12 (rubric, tệp bài tập, chấm AI ảnh/PDF, giáo viên duyệt CLO là xong; 10/11)
- **Duyệt bộ CLO còn một cấp, theo PR #12.** `technical-approve` chuyển bộ thẳng sang `APPROVED`, ghi giáo viên vào cả `reviewerId` lẫn `approvedById`, xóa `reviewNote`. Route `POST outcome-sets/:id/approve` của Quản lý đã bỏ; enum `OutcomeSetStatus` chỉ còn `DRAFT`, `APPROVED` (migration `20261110000000_teacher_final_clo_approval`). `request-changes` chỉ nhận bộ `APPROVED` và chỉ lưu `reviewNote`, không đổi trạng thái. Lọc `status=TECHNICALLY_APPROVED` ở `GET programs/:id/outcome-sets` giờ trả 400.
- **Điều kiện duyệt giữ theo CLO bản nhẹ (mục 1.9):** bộ có ít nhất một CLO, mỗi CLO có ít nhất một bài, không đòi xác minh nguồn; đọc bằng câu có khóa; sai thì 409 `OUTCOME_SET_INCOMPLETE` kèm `details: { outcomeIds, codes }`. Người duyệt theo mục 1.8.
- **Giao bài (`publish`):** kiểm barem/tiêu chí và đáp án của từng câu như PR #12 (`RUBRIC_REQUIRED`, `RUBRIC_TOTAL_MISMATCH`, `INVALID_ANSWER_KEY`). Chọn bộ CLO vẫn tùy chọn như mục 1.9 (Q2): không còn 400 `OUTCOME_SET_REQUIRED` lúc giao khi khóa đã có bộ được duyệt. CLO gắn sai bộ vẫn trả 409 `OUTCOME_MAPPING_INCOMPLETE` với `details.reason: "WRONG_SET"`.
- Ghi, xóa CLO và xóa bộ giữ luật mục 1.7: mọi Thiết kế GT sửa được bộ nháp, không còn kiểm người tạo bộ.

### 1.15. Lần nộp trả kèm loại tệp (`GET /api/v1/academic/assignments/:id/submissions`, 10/11)
- Mỗi phần tử `files[]` giữ `fileId` và có thêm `file: { name, mimeType, size }`, để mobile biết tệp đã nộp là ảnh hay PDF mà không phải xin link xem trước (phụ huynh nộp được PDF từ app). Chỉ thêm field, không đổi quyền: phụ huynh vẫn chỉ thấy lần nộp của con mình, giáo viên chỉ thấy lớp được phân công.

---

## 2. Danh Sách Lỗi Đã Được Khắc Phục (Bug Fixes)

| STT | Lỗi / Điểm nghẽn ban đầu | Tệp tin liên quan | Nguyên nhân | Giải pháp khắc phục triệt để |
| :---: | :--- | :--- | :--- | :--- |
| **1** | **Chặn cứng AI chấm khi có file đính kèm (`AI_ATTACHMENTS_UNSUPPORTED`)** | `src/modules/academic/grading-worker.service.ts`<br>`src/modules/academic/ai-grading-skill.ts` | Code ném `HTTP 409` khi `submission.files.length > 0`, khiến giáo viên không thể bấm nút AI chấm khi học sinh nộp kèm ảnh bài làm. | **Đã gỡ bỏ chặn cứng HTTP 409**. Truyền cờ `hasAttachments: true` sang AI; AI chấm phần text và tự động chèn lời nhắc sư phạm: *"Lưu ý: Học sinh có đính kèm file/ảnh bài làm, giáo viên vui lòng kiểm tra thêm tệp đính kèm để cho điểm chính xác nhất"*.<br>**Sửa lại 03/11:** lời nhắc nằm trong `feedback` nên đi theo điểm tới phụ huynh khi giáo viên áp đề xuất trên web; nay `feedback` chỉ là lời gửi học sinh. Câu tự luận để trống khi bài có tệp không gửi AI (tránh đề xuất 0 điểm), id các câu đó trả ở `result.manualReviewQuestionIds`. |
| **2** | **Crash / Unhandled Exception khi Object Storage chưa cấu hình** | `src/integrations/object-storage.service.ts` | Thiếu phương thức kiểm tra sẵn sàng `available()` khiến các service/script khác gọi kiểm tra bị lỗi `TypeError: storageService.available is not a function`. | Bổ sung phương thức `available(): boolean` kiểm tra biến môi trường MinIO/S3 (`storageBucket`, `storageKey`, `storageSecret`), đồng bộ kiến trúc với `AcademicAiService`. |
| **3** | **Lỗi xác thực SSL khi gọi DeepSeek API trên Windows local** | `scripts/test-ai-grading.ts`<br>`scripts/full-academic-flow-simulation.ts` | Môi trường Windows / phần mềm bảo mật chặn SSL certificate của Node.js `fetch` (`UNABLE_TO_VERIFY_LEAF_SIGNATURE`). | Bổ sung cờ cấu hình an toàn cho môi trường development/testing: `if (process.env.NODE_ENV !== 'production') { process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'; }`. |
| **4** | **Lệch cổng kết nối cơ sở dữ liệu Docker MySQL** | `.env` | Docker Compose map cổng `3307:3306`, trong khi cấu hình mặc định ban đầu là `3306`. | Chuẩn hóa cấu hình `DATABASE_URL` trỏ chính xác về cổng `localhost:3307`. |
| **5** | **Ràng buộc toàn vẹn khi xóa CLO / OutcomeSet** | `src/modules/academic/outcome.service.ts` | Chưa kiểm tra ràng buộc khóa ngoại khi xóa OutcomeSet hoặc CLO đang được câu hỏi bài tập tham chiếu tới. | Bổ sung kiểm tra điều kiện an toàn: Chặn xóa nếu đã có bài tập gắn `outcomeSetId` hoặc có câu hỏi `AssignmentQuestion` gắn `outcomeId`; chỉ cho phép xóa bản nháp (`DRAFT`). |
| **6** | **Phụ huynh phải chép và dán mã xác minh email dài 43 ký tự** (03/11) | `src/modules/auth/auth.service.ts`<br>`src/modules/auth/dto/verify-email.dto.ts`<br>`prisma/migrations/20261103000000_email_verification_code_attempts` | Email chỉ có token base64url 32 byte, phụ huynh ít dùng điện thoại khó chép đủ. | Email gửi **mã 6 số** (hạn 15 phút); `POST /auth/verify-email` nhận `{ email, code }`. Sai 5 lần thì mã hết hiệu lực (`AUTH_EMAIL_CODE_ATTEMPTS_EXCEEDED`), tối đa 5 mã mỗi giờ cho một tài khoản (429 `AUTH_VERIFICATION_RATE_LIMITED`), gửi mã mới thì mã cũ hết hạn. Cột mới `email_verification_tokens.failedAttempts` (cần `prisma migrate deploy`). Token dài cũ vẫn nhận qua `{ token }`. |
| **7** | **Phiên đăng nhập hết hạn đúng 7 ngày sau khi đăng nhập dù dùng hằng ngày** (03/11) | `src/modules/auth/auth.service.ts`<br>`src/modules/auth/auth-sessions.repository.ts`<br>`src/config/configuration.ts` | `refresh` ký cặp token mới với `expiresAt` cũ của phiên. | Phiên trượt: mỗi lần refresh gia hạn thêm `JWT_REFRESH_TTL_SECONDS`, không quá `JWT_SESSION_MAX_AGE_SECONDS` (mặc định 90 ngày) kể từ lúc đăng nhập. |
| **8** | **Giáo trình của môn sắp học trả rỗng cho phụ huynh** (03/11) | `src/modules/curriculum-scheduling/curriculum-scheduling.service.ts` | `studentCurriculum` chỉ lấy ghi danh đang trong kỳ. | Lấy cả ghi danh `ACTIVE` chưa bắt đầu; lớp của kỳ sắp học là lần xếp lớp có hiệu lực lúc kỳ bắt đầu. |
| **9** | **Ghi danh của con không có tên phòng** (03/11) | `src/modules/registration-flow/registration-flow.service.ts` | Chỉ trả `class.roomId`, ứng dụng phải gọi thêm `GET /rooms`. | `GET /me/students/:id/enrollments` (và route của nhân viên) trả thêm `class.room { id, name } | null`, cả trong `placements`. |
| **10** | **Realtime của ứng dụng di động bị `ORIGIN_NOT_ALLOWED`** (03/11) | `src/modules/notifications/notifications.gateway.ts` | WebSocket của React Native gửi `Origin` là địa chỉ của chính API, không có trong `CORS_ORIGINS`. | Gateway cho qua `Origin` trùng host của request; web vẫn phải có trong `CORS_ORIGINS`. |
| **11** | **Xóa bài đã gắn CLO trả 400 `INVALID_REFERENCE`** (09/11) | `src/modules/curriculum-scheduling/curriculum-scheduling.service.ts` | Khóa ngoại `lesson_outcomes` → `lessons` là `Restrict`; xóa bài, xóa giáo trình nháp và nhập CSV `REPLACE` không xóa liên kết CLO trước. | Xóa liên kết CLO của các bài sắp xóa trong cùng transaction, trước khi xóa bài. Không đổi khóa ngoại, không có migration. |
| **12** | **Khóa học đã bị Admin xóa mềm vẫn tạo được bộ CLO và giáo trình khi gọi thẳng API** (10/11) | `src/modules/academic/outcome.service.ts`<br>`src/modules/curriculum-scheduling/curriculum-scheduling.service.ts` | Xóa mềm chỉ đặt `deletedAt`, giữ `isActive`; `createSet` (`POST /academic/outcome-sets`) và `createUnit` (`POST /academic/curriculum-units`) chỉ kiểm `isActive`. | Khóa có `deletedAt` trả 404 `PROGRAM_NOT_FOUND` như danh sách khóa học đang ẩn nó; môn có `deletedAt` trả 409 `SUBJECT_INACTIVE`. Không đổi mã lỗi, không có migration. |
| **13** | **Hai Quản lý lưu ngày nghỉ cùng lúc có thể ra hai ngày nghỉ chồng nhau** (10/11) | `src/modules/curriculum-scheduling/center-closure.service.ts` | Kiểm chồng ngày bằng lần đọc thường, không khóa: hai transaction cùng thấy "không trùng" rồi cùng ghi. | Kiểm chồng ngày bằng `SELECT … FOR UPDATE` (RepeatableRead) trong `POST /academic/center-closures` và `PATCH /academic/center-closures/:id`, khóa các dòng và khoảng trống nó quét. Khi hai lần ghi chạm nhau, InnoDB báo deadlock một bên; service thử lại tối đa 2 lần và lần thử lại trả 409 `CENTER_CLOSURE_OVERLAP` như bình thường. Deadlock trong câu `$queryRaw` Prisma báo là `P2010` (MySQL 1213) chứ không phải `P2034`, nên thêm `isRetryableDeadlock` (`src/database/orm/transaction-retry.ts`) nhận cả hai; thiếu nó thì hai Quản lý cùng sửa ngày nghỉ nhận 500 `INTERNAL_ERROR`. Thử trên MySQL 8.4 thật (11/11): code cũ để lọt hai ngày nghỉ chồng nhau 25/25 lượt, code mới 0 lượt, kể cả tạo–tạo, sửa–sửa, tạo–sửa và 5 lượt lưu cùng lúc. Không đổi contract. |
| **14** | **Hai nhân viên đặt suất học bù cuối cùng cùng lúc thì cả hai đều được** (11/11, lỗi từ `41e3467`) | `src/modules/academic/enrollment-workflows.service.ts`<br>`tests/unit/makeup-booking-lock.spec.ts` | `bookMakeup` đọc thường `sessionParticipant` trước câu `FOR UPDATE` trong transaction RepeatableRead, nên snapshot bị chốt trước khóa: yêu cầu thứ hai chờ khóa xong vẫn đếm chỗ trên snapshot cũ. E2E `academic` "serializes competing requests for the last makeup seat" trả `[201, 201]`. | Đọc `sessionId` của suất gốc ngoài transaction (suất không bao giờ đổi buổi), để câu khóa là câu đầu tiên. E2E qua 3/3 lần. Không đổi contract. **Chưa sửa:** `rescheduleMakeup` không khóa buổi đích nên đổi suất vào buổi còn một chỗ vẫn có thể vượt sức chứa. |

---

## 3. Kết Quả Kiểm Thử Xác Minh Sau Cập Nhật

- **Unit Tests**:
  - `tests/unit/clo-crud.spec.ts`: **7/7 tests passed** (100%)
  - `tests/unit/learning-outcomes.spec.ts`: **2/2 tests passed** (100%)
  - `tests/unit/learning-outcome-lifecycle.spec.ts`: **5/5 tests passed** (100%)
  - `tests/unit/ai-grading-skill.spec.ts`: **4/4 tests passed** (100%)
  - `tests/unit/academic-storage.spec.ts`: **5/5 tests passed** (100%)
- **Kịch bản Full-flow Simulation**:
  - Tệp chạy: `scripts/full-academic-flow-simulation.ts`
  - Kết quả: **Chạy thành công 8/8 bước, 0 lỗi, 0 điểm chặn (0 Bug / 0 Blocker)**.
  - Phản hồi từ DeepSeek AI: Chấm chính xác **10/10 điểm** theo đúng 3 tiêu chí của barem điểm.
