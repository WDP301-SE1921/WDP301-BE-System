# TỔNG HỢP NGHIỆP VỤ VÀ TÌNH TRẠNG TRIỂN KHAI BACKEND EDUGRADE

Ngày đối chiếu: **12/10/2026**. Phạm vi: mã nguồn trong workspace WDP301-BE-System tại thời điểm lập tài liệu, bao gồm thay đổi chưa commit.

**Cập nhật sau merge dev ngày 13/10/2026:** PUT/POST thay toàn bộ lịch tuần đã dùng chung `assertScheduleEditable` với PATCH/DELETE từng slot. Kiểm tra này giữ cả khóa do Teacher xác nhận và khóa do enrollment/placement/session. GET /classes/:id giữ roster theo `at` và bổ sung `scheduleLocked`, bao gồm cả trạng thái xác nhận. Vì vậy các ghi chú bên dưới về replace bỏ qua placement hoặc confirmation đã được khắc phục trong lần merge này; những giới hạn khác vẫn cần xử lý. Regression test bao gồm khóa replacement bởi placement chuyển vào và khóa PUT/POST bởi confirmation.

Tài liệu này giải thích hệ thống đang làm gì, chạy theo trình tự nào, ghi dữ liệu nào và phần nào chưa hoàn thiện. “Có endpoint” không đồng nghĩa “đã đáp ứng toàn bộ nghiệp vụ”. Những giới hạn phát hiện qua đọc code được ghi ngay tại chức năng liên quan.

**Đính chính báo cáo trước:** chưa có căn cứ để kết luận toàn bộ BE-01–BE-18 đã hoàn thành. Email, invitation, phân quyền Manager, phòng, đổi giáo viên, chuyên cần và khóa lịch vẫn còn những phần thiếu cụ thể được liệt kê dưới đây. Không coi kết quả test cũ là bằng chứng nghiệm thu tất cả API mới.

## Mục lục

1. Cách đọc và thuật ngữ
2. Vai trò và quyền
3. Dữ liệu và trạng thái
4. Tài khoản, đăng nhập, profile và mật khẩu
5. Nhân sự, invitation và Manager
6. Môn, chương trình, lớp, phòng và lịch tuần
7. Giáo trình, duyệt và phiên bản
8. Sinh lịch, đổi lịch, hủy buổi
9. Hồ sơ học sinh, đăng ký và thanh toán
10. Roster, báo nghỉ và điểm danh
11. Học bù và chuyên cần
12. Chuyển lớp, kết thúc học và học lại
13. Lịch Parent và dữ liệu từng con
14. Bài tập, nộp bài, chấm và công bố điểm
15. Báo cáo, dashboard và analytics
16. Thông báo, email và retry
17. Phân công giáo viên và xác nhận lịch
18. Audit, hạ tầng và an toàn dữ liệu
19. Ma trận BE-01–BE-18
20. Luồng chưa triển khai và thứ tự hoàn thiện
21. Kịch bản xuyên suốt và nghiệm thu
22. Phụ lục API đầy đủ
23. Nguồn đối chiếu và giới hạn kiểm chứng

## 1. Cách đọc và thuật ngữ

### 1.1. Trạng thái sử dụng trong tài liệu

| Nhãn | Ý nghĩa |
| --- | --- |
| Đã có luồng chính | Controller gọi service và có xử lý dữ liệu cho luồng nêu trong tài liệu; không mặc nhiên chứng nhận production |
| Một phần | Đã có code nhưng còn thiếu bước hoặc có sai lệch so với nghiệp vụ |
| Chưa có API | Chưa tìm thấy endpoint thực thi chức năng này |
| Chưa chốt | Chưa có quy tắc nghiệp vụ đủ chi tiết để xác định kết quả cần đạt |
| Loại khỏi phạm vi | Người dùng đã yêu cầu không triển khai |

Tất cả đường dẫn API trong tài liệu tính từ **/api/v1**. Ví dụ `POST /academic/leaves` là `POST /api/v1/academic/leaves`.

### 1.2. Các khái niệm cần hiểu trước

| Khái niệm | Cách hiểu |
| --- | --- |
| Subject | Môn học, ví dụ Toán |
| Program | Chương trình của môn và khối, ví dụ Toán lớp 7 |
| Class | Lớp cụ thể triển khai một Program, có học phí, sức chứa và lịch tuần |
| Weekly schedule | Lịch lặp theo thứ, giờ bắt đầu và giờ kết thúc; chưa phải một buổi có ngày cụ thể |
| Curriculum unit | Đơn vị giáo trình có khoảng ngày, phiên bản và trạng thái duyệt |
| Lesson | Bài học hoặc bài kiểm tra được gắn vào buổi |
| ClassSession | Một buổi cụ thể, ví dụ 18:00 ngày 20/10 |
| StudentProfile | Hồ sơ một người con; không phải tài khoản đăng nhập |
| Enrollment | Một lần đăng ký học có kỳ hạn của một học sinh |
| EnrollmentPlacement | Khoảng thời gian enrollment thuộc lớp nào; cần khi chuyển lớp |
| Roster | Danh sách học sinh thuộc lớp hoặc tham gia một buổi; phải nói rõ loại roster |
| SessionParticipant | Chỗ tham gia của enrollment trong một buổi, thường hoặc học bù |
| LeaveRequest | Yêu cầu nghỉ một buổi hoặc tạm nghỉ một khoảng |
| MakeupBooking | Liên kết buổi nguồn bị vắng với chỗ học bù tại buổi đích |
| AssignmentRecipient | Enrollment được nhận một bài tập |
| Submission | Một lần nộp bài; một người nhận có thể nộp nhiều lần theo giới hạn |
| GradeReview | Một phiên bản chấm điểm có bước duyệt và công bố |
| OutboxEvent | Công việc gửi email được lưu bền vững trong database |
| Idempotency | Gửi lại cùng lệnh với cùng khóa không tạo thêm kết quả nghiệp vụ |
| Revision | Số phiên bản để phát hiện dữ liệu đã bị người khác sửa |

### 1.3. Nguyên tắc thời gian và tiền

- Ngày học dùng múi giờ UTC+7 tại nhiều luồng. Database lưu DateTime; các trường kỳ học và nghỉ dùng ngày.
- Kỳ enrollment thường được kiểm tra theo `startDate <= ngày học < endDate`.
- Placement có hiệu lực theo `effectiveFrom <= thời điểm < effectiveTo`; effectiveTo rỗng nghĩa là chưa kết thúc.
- Khoảng nghỉ có hai đầu ngày được tính bao gồm.
- Không được dùng một phép so sánh ngày tùy ý cho mọi API: attendance summary hiện nhận DateTime trực tiếp, trong khi lịch Parent chuyển ngày địa phương sang UTC.
- Học phí lưu Decimal; báo cáo doanh thu chỉ cộng Payment đã xác nhận.
- Chuyển lớp hiện yêu cầu **cùng Program và cùng monthlyFee**; chưa có quy tắc bù trừ chênh lệch học phí.

## 2. Vai trò và quyền

| Vai trò | Công việc chính đang có | Giới hạn đáng chú ý |
| --- | --- | --- |
| MANAGER | Danh mục, lớp/lịch, duyệt giáo trình, nhân sự, phòng, phân công giáo viên, announcement, dashboard, audit | Không được thay Staff duyệt nghỉ/đặt học bù/chuyển lớp/kết thúc học; không được chốt điểm danh |
| STAFF | Tra cứu Parent/học sinh, tạo đăng ký, xác nhận tiền, vận hành nghỉ/học bù/chuyển/kết thúc/học lại | Không chốt điểm danh, không soạn giáo trình |
| TEACHER | Roster buổi được phân công, điểm danh, bài tập/chấm điểm, báo cáo, feedback, xác nhận lịch | Quyền buổi dựa session.teacherId; quyền bài tập còn yêu cầu cả giáo viên hiện tại của lớp và người tạo bài |
| CURRICULUM_DESIGNER | Soạn Unit/bài/CSV/revision, xử lý feedback thuộc nội dung của mình | Không tự duyệt giáo trình như Manager |
| PARENT | Đăng ký tài khoản, quản lý con, xem bill/lịch, xin nghỉ, nộp bài, đọc điểm công bố | Chỉ con thuộc ParentProfile của mình; không tự duyệt nghỉ hoặc đặt học bù |

Quyền rộng theo role và quyền sở hữu là hai lớp kiểm tra khác nhau. Có JWT Teacher chưa đủ để sửa buổi của Teacher khác. Actor ghi dữ liệu phải lấy từ JWT; một số cột cũ còn mang tên managerId dù actor thực tế là Staff.

**Phân quyền Manager hiện chưa đồng bộ:** có JSON permissions với MANAGE_MANAGERS, MANAGE_ACCOUNTS, MANAGE_CLASSES, nhưng helper kiểm tra quyền con mới được dùng ở một số API Manager/invitation. Nhiều API lớp và CRUD nhân sự vẫn chỉ kiểm tra role MANAGER.

## 3. Dữ liệu và trạng thái

### 3.1. Quan hệ nghiệp vụ

```text
User(PARENT) → ParentProfile → nhiều StudentProfile
Subject → Program → nhiều Class
Class → WeeklySchedule → sinh nhiều ClassSession
CurriculumUnit → Lesson → ClassSession
RegistrationOrder → Payment + Enrollment
Enrollment → Placement → lớp tại từng thời điểm
Enrollment + ClassSession → SessionParticipant
Participant nguồn → MakeupBooking → Participant đích
Class → Assignment → Recipient(Enrollment) → Submission → GradeReview
Lệnh nghiệp vụ → AuditLog và/hoặc OutboxEvent khi đã được nối
```

### 3.2. State machine đang dùng

| Đối tượng | Trạng thái và diễn tiến |
| --- | --- |
| User | ACTIVE hoặc DISABLED |
| StudentProfile | ACTIVE → INACTIVE khi end-study; INACTIVE → ACTIVE khi reactivate |
| RegistrationOrder | Luồng hiện tại: DRAFT → COMPLETED sau confirm-payment; DRAFT → CANCELLED. PAYMENT_CONFIRMED/LINKED còn trong enum cho mô hình cũ |
| Enrollment | Luồng hiện tại tạo ACTIVE sau thanh toán; ACTIVE → ENDED. PENDING_LINK vẫn được hỗ trợ ở một số xử lý dữ liệu cũ |
| AccountInvitation | INVITED → ACCEPTED → APPROVED hoặc REJECTED; INVITED → REVOKED. Hết hạn kiểm tra bằng expiresAt |
| CurriculumUnit | DRAFT → PENDING_REVIEW → APPROVED; yêu cầu sửa đưa về DRAFT; có ARCHIVED và quan hệ phiên bản |
| ClassSession | SCHEDULED → COMPLETED khi chốt điểm danh; SCHEDULED → CANCELLED khi hủy |
| Attendance | UNMARKED → PRESENT/ABSENT/EXCUSED; EXCUSED do period pause hợp lệ điều khiển |
| LeaveRequest | PENDING → APPROVED/REJECTED; đơn đủ điều kiện có thể CANCELLED |
| MakeupBooking | BOOKED → COMPLETED nếu đi bù PRESENT; BOOKED → MISSED nếu không đi; BOOKED → CANCELLED khi hủy |
| Assignment | DRAFT → PUBLISHED → CLOSED; có reopen nếu đáp án chưa công bố |
| GradeReview | DRAFT → APPROVED → PUBLISHED; bản công bố cũ chuyển SUPERSEDED |
| GradingJob | QUEUED → PROCESSING → SUCCEEDED/FAILED |
| Email outbox | PENDING → PROCESSING → SENT; lỗi quay về PENDING hoặc FAILED khi hết số lần thử |

**MADE_UP không phải raw attendance enum.** Đây là trạng thái hiệu lực suy ra từ booking nguồn đã COMPLETED; buổi nguồn vẫn ABSENT.

## 4. Tài khoản, đăng nhập, profile và mật khẩu

Nguồn: AuthService, AuthSessionsRepository, UsersRepository.

### 4.1. Parent tự đăng ký — đã có luồng chính

1. Gửi email, password, displayName và phone nếu có vào POST /auth/register.
2. DTO kiểm tra đầu vào; service kiểm tra giới hạn bcrypt 72 byte.
3. Mật khẩu được hash bcrypt, tạo User role PARENT và ParentProfile.
4. Tạo token xác minh email, lưu hash và hạn 24 giờ.
5. Nếu có SMTP, gửi token xác minh.
6. Trả user an toàn và cặp access/refresh token.
7. Parent gọi verify-email để ghi emailVerifiedAt.
8. Các thao tác quản lý con yêu cầu Parent đã xác minh email.

Không cho field role tùy ý để tự đăng ký Teacher/Manager.

Giới hạn: gửi xác minh chưa dùng outbox. Nếu provider gửi lỗi sau khi tài khoản đã tạo, không thể hiểu response lỗi là tài khoản chưa tồn tại; cần xử lý UX đăng nhập/gửi lại.

### 4.2. Đăng nhập, refresh, logout — đã có luồng chính

1. Login tìm email và yêu cầu User ACTIVE, có passwordHash.
2. So sánh bcrypt; sai trả AUTH_INVALID_CREDENTIALS.
3. Tạo AuthSession và lưu hash refresh token.
4. JWT chứa định danh user/session; access request kiểm tra session còn hoạt động.
5. Refresh xác minh JWT và hash hiện tại, xoay cả cặp token.
6. Dùng lại refresh cũ làm session bị thu hồi.
7. Logout thu hồi session hiện tại, không tự logout mọi thiết bị.

### 4.3. Tự sửa profile — đã có luồng chính, response còn hạn chế

- PATCH /auth/me chỉ nhận displayName, phone.
- Phone chỉ dành cho PARENT; role khác gửi phone bị PROFILE_PHONE_NOT_ALLOWED.
- Phone rỗng được lưu null; displayName có trim và giới hạn.
- Update User/ParentProfile và audit trong transaction.
- Không sửa email, role hoặc status qua API này.
- Response SafeUser hiện không chứa phone; GET /auth/me cũng không trả permissions của Manager.

### 4.4. Đổi mật khẩu — đã có luồng chính

1. POST /auth/change-password nhận currentPassword và newPassword.
2. Kiểm tra mật khẩu hiện tại.
3. Hash mật khẩu mới.
4. Trong transaction: cập nhật hash, thu hồi các session khác, ghi PASSWORD_CHANGED.
5. Giữ session đang gọi.

Còn thiếu: vô hiệu token reset còn hiệu lực khi đổi mật khẩu và kiểm tra cạnh tranh giữa đổi/reset.

### 4.5. Quên và reset mật khẩu — một phần

1. POST /auth/forgot-password nhận email.
2. Không có account hoặc account DISABLED vẫn trả accepted=true.
3. Account hợp lệ được tạo token ngẫu nhiên, lưu SHA-256, hạn 30 phút.
4. Gửi SMTP trực tiếp; lỗi gửi được bắt và vẫn trả accepted=true.
5. POST /auth/reset-password kiểm tra token chưa dùng và chưa hết hạn.
6. Hash mật khẩu mới; transaction đánh dấu usedAt, đổi passwordHash, thu hồi toàn bộ session.
7. Người dùng đăng nhập lại.

Còn thiếu:
- SMTP thất bại không có retry bền vững.
- Kiểm tra usedAt ở ngoài transaction, update không có điều kiện usedAt=null: chưa bảo đảm hai request đồng thời chỉ một request được dùng token.
- Chưa vô hiệu các reset token khác sau một lần reset thành công.
- Chưa có audit reset tương đương change-password.

## 5. Nhân sự, invitation và Manager

### 5.1. Tạo trực tiếp Staff/Teacher — đã có luồng chính

Manager POST /staff hoặc /teachers với email, displayName, password ban đầu. Service hash mật khẩu, tạo ACTIVE và emailVerifiedAt, ghi audit. Email trùng bị từ chối. PATCH cho đổi tên/trạng thái; không trả hash mật khẩu.

Danh sách Teacher cho Manager/Staff; quản trị Staff cho Manager. Parent directory có list, detail và sửa contact/status theo quyền service.

**Giới hạn:** API Teacher trực tiếp và PATCH ACTIVE vẫn tồn tại. Vì vậy approval invitation chưa phải cổng duy nhất để Teacher được kích hoạt.

### 5.2. Mời Teacher/Manager — một phần

**Đầu vào:** POST /teacher-invitations hoặc /manager-invitations với email.

Luồng hiện tại:
1. Kiểm tra Manager và permission tương ứng.
2. Chặn email đã có User.
3. Chặn invitation đang INVITED/ACCEPTED chưa hết hạn cùng email/role.
4. Sinh token ngẫu nhiên 32 byte, lưu SHA-256 và expiresAt sau 48 giờ.
5. Tạo AccountInvitation INVITED.
6. Trả invitation cùng acceptanceToken cho người gọi.

**Thực tế chưa gửi email invitation.** Không có endpoint resend; không được mô tả rằng người nhận tự động nhận thư.

### 5.3. Người nhận accept và Manager review — một phần

1. Public POST /account-invitations/accept nhận token, password, displayName.
2. Kiểm tra token INVITED và còn hạn.
3. Tạo User DISABLED, emailVerifiedAt hiện tại, role lấy từ invitation.
4. Nếu role MANAGER, permissions ban đầu là mảng rỗng.
5. Đổi invitation sang ACCEPTED và lưu acceptedUserId/acceptedAt.
6. Manager POST /account-invitations/:id/review với APPROVE hoặc REJECT.
7. APPROVE bật User ACTIVE, invitation APPROVED; REJECT giữ DISABLED, invitation REJECTED.
8. Ghi reviewer/time/note và audit review.
9. POST revoke chỉ cho invitation INVITED chuyển REVOKED.

Còn thiếu:
- Resend phải xoay token và vô hiệu token cũ; chưa có.
- Gửi thư mời chưa nối email.
- Accept/review đọc trạng thái trước transaction, chưa có update có điều kiện hoặc lock đầy đủ để chống accept/revoke/review cạnh tranh.
- Một số response mutation trả model chứa tokenHash; cần response DTO chỉ trả trường công khai.
- Audit invite/accept/revoke chưa đầy đủ.
- Luồng reject rồi mời lại chưa trọn vẹn vì User DISABLED đã tồn tại và chặn email.
- Accept public chưa có throttle riêng như login/reset.
- Chưa có test mới chứng minh toàn bộ các trường hợp trên.

### 5.4. Nhiều Manager và permissions — một phần

- GET /managers trả danh sách cùng permissions.
- PATCH /managers/:id/permissions thay toàn bộ danh sách quyền.
- Chỉ nhận MANAGE_MANAGERS, MANAGE_ACCOUNTS, MANAGE_CLASSES.
- Không cho tự sửa quyền chính mình.
- Ghi before/after audit khi đổi quyền.
- permissions=null được coi như Manager cũ có đầy đủ quyền ở helper này.
- Manager mới qua invitation có [] nên cần được cấp quyền.

**Khoảng thiếu quan trọng:** quyền con chưa áp dụng trên mọi API tương ứng. Manager không có MANAGE_CLASSES vẫn có thể qua những service chỉ xét role MANAGER. GET /auth/me chưa công bố quyền. Chưa có PATCH /managers/:id để quản lý tên/status như Staff/Teacher; chưa có bảo vệ Manager quản trị cuối cùng.

Luồng cần hoàn thiện: xác định permission → kiểm tra trên mọi command → trả effective permissions cho phiên hiện tại → thay quyền có hiệu lực server-side ngay → bảo vệ không mất toàn bộ người có quyền quản trị.

## 6. Môn, chương trình, lớp, phòng và lịch tuần

### 6.1. Subject và Program — đã có luồng chính

Manager tạo/sửa/xóa danh mục qua /subjects và /programs. Program gắn môn và khối. Các quan hệ đang sử dụng bị chặn xóa hoặc thay thuộc tính làm sai dữ liệu lịch sử; có isActive để ngừng sử dụng thay vì xóa.

Trình tự sử dụng: tạo Subject → Program theo khối → Class thuộc Program → giáo trình phù hợp Program.

### 6.2. Tạo và cập nhật lớp — đã có luồng chính, còn đường legacy

1. Manager chọn Program, tên lớp, teacherId tùy chọn, capacity, monthlyFee và roomId tùy chọn.
2. Kiểm tra Program/môn còn hoạt động và Teacher ACTIVE nếu có.
3. Room được chọn phải hoạt động và capacity phòng >= capacity lớp.
4. POST /classes tạo lớp đóng đăng ký.
5. Cấu hình lịch tuần.
6. PATCH isOpen=true chỉ khi lớp hoạt động và có lịch.
7. Sửa teacherId bằng PATCH thông thường bị chặn nếu đã có buổi tương lai.
8. Archive/xóa bị kiểm tra enrollment, order, session và các dữ liệu phụ thuộc.

**Legacy:** POST /academic/classes tạo trực tiếp theo CatalogService, kiểm tra đơn giản hơn và không cùng mọi quy tắc với /classes. Các đường legacy cần hợp nhất kiểm tra trước khi khẳng định mọi đường ghi đều nhất quán.

### 6.3. Lịch tuần — đã có luồng chính

- Slot gồm weekday 1–7, startTime/endTime dạng HH:mm.
- Bắt đầu phải trước kết thúc; không cho các slot trong cùng lớp chồng nhau.
- Có lấy danh sách, thay toàn bộ, sửa một slot và xóa.
- Lớp mở đăng ký không được mất slot cuối.
- Có khóa khi đã có dữ liệu enrollment/session.
- Luồng sửa/xóa từng slot và luồng replace chưa dùng toàn bộ cùng một helper; xem phần khóa lịch.

Lịch tuần chỉ là mẫu lặp. Muốn có ngày/bài/điểm danh phải sinh ClassSession.

### 6.4. Phòng học — một phần

Đã có:
1. GET /rooms cho Manager/Staff/Teacher/Parent.
2. POST /rooms tạo tên unique, capacity.
3. PATCH /rooms/:id sửa tên/capacity/isActive.
4. Không cho giảm capacity xuống thấp hơn lớp đang hoạt động được gán.
5. Không cho deactivate nếu có session tương lai SCHEDULED trong phòng.
6. Class và ClassSession có roomId nullable để không phá dữ liệu cũ.
7. Sinh lịch copy roomId lớp xuống session.
8. Kiểm tra overlap ở generation và reschedule có xét roomId.

Còn thiếu hoặc sai lệch:
- PATCH lớp chỉ tăng capacity mà không gửi roomId chưa kiểm tra lại phòng đang gán.
- Phòng đổi trạng thái/sức chứa sau khi gán lớp chưa được kiểm tra lại đầy đủ ở mọi đường sinh buổi.
- POST /academic/sessions legacy chưa gán/check room.
- Thông tin room chưa được trả nhất quán ở các projection lịch/detail.
- Thay room của lớp chưa có lệnh điều phối các session đã sinh hoặc quy định ngày hiệu lực.
- Chưa kiểm tra xung đột phòng trên toàn bộ lịch tuần trước khi có session.
- Chưa có test chuyên biệt chứng minh concurrency hai lớp đặt cùng phòng.

Ví dụ mong muốn: phòng 20 chỗ không nhận lớp 25; hai lớp không được cùng dùng phòng 18:00–19:30 một ngày; đổi phòng tuần sau không sửa phòng của buổi quá khứ.

## 7. Giáo trình, duyệt và phiên bản

Nguồn chính: CurriculumSchedulingService; các bài legacy và feedback ở CatalogService.

### 7.1. Soạn Unit — đã có luồng chính

1. Designer tạo Unit gắn Program, tiêu đề và khoảng ngày.
2. Nội dung được giữ DRAFT và gắn designer từ actor.
3. Thêm/sửa/xóa bài, sắp thứ tự, thêm bài kiểm tra tháng.
4. Bài có kind LESSON hoặc MONTHLY_TEST, có sequence/monthKey theo loại.
5. Designer chỉ sửa nội dung mình sở hữu và ở trạng thái được phép.
6. Revision/expectedRevision ở các thao tác liên quan giúp phát hiện nội dung đã thay đổi.

### 7.2. Nhập CSV — đã có luồng chính

1. Designer gửi CSV ở import-preview.
2. Backend parse/validate hàng, loại bài, thứ tự và dữ liệu.
3. Lưu preview có actor, revision, hạn dùng và mode.
4. Người dùng kiểm tra preview.
5. import-commit kiểm tra lại quyền, preview/revision và khóa idempotency.
6. Chỉ khi commit thành công mới ghi nội dung.
7. Preview lỗi hoặc cũ phải sửa/xem trước lại.

### 7.3. Gửi duyệt và duyệt — đã có luồng chính

1. Designer gọi validation để kiểm tra giáo trình.
2. Submit chuyển sang PENDING_REVIEW.
3. Manager review; request-changes trả về để chỉnh sửa.
4. Approve kiểm tra điều kiện như đủ bài, sequence liên tục, bài kiểm tra tháng, lịch phù hợp.
5. Unit được APPROVED để dùng sinh lịch.
6. Không sửa trực tiếp bản đã duyệt; tạo revision liên kết basedOn.

Buổi đã sinh giữ lesson ID cũ; duyệt phiên bản mới không tự thay nội dung của session quá khứ.

Các lỗi tiêu biểu: UNIT_LOCKED, PREVIEW_STALE, REVISION_CONFLICT, INSUFFICIENT_LESSONS, LESSON_SEQUENCE_GAP, MISSING_MONTHLY_TEST.

### 7.4. Feedback Teacher–Designer — đã có luồng chính

Teacher phản hồi bài mình được phân công. Manager xem giám sát; Designer xem phản hồi trên bài của mình. Resolve có status/response, có thể trỏ resolutionLessonId là revision đã duyệt của bài gốc.

### 7.5. AI soạn giáo trình — loại khỏi phạm vi

Không có luồng tạo Unit/Lesson bằng AI trong phạm vi yêu cầu này. AI chấm bài và AI tóm tắt báo cáo là hai chức năng riêng vẫn tồn tại.

## 8. Sinh lịch, đổi lịch và hủy buổi

### 8.1. Sinh buổi từ giáo trình — đã có luồng chính

1. Manager chọn lớp, Unit đã duyệt và khoảng ngày.
2. Session-preview tính slot theo lịch tuần.
3. Ghép bài theo sequence; bài kiểm tra tháng vào slot tương ứng.
4. Kiểm tra Program/Unit/Teacher, phạm vi ngày và xung đột.
5. Trả preview để xem trước.
6. Session-generations nhận khóa idempotency; kiểm tra preview nếu được cung cấp.
7. Transaction ghi ScheduleGeneration, các ClassSession và audit.
8. Buổi mới SCHEDULED, có teacherId, lessonId và roomId hiện tại của lớp.
9. Có API xem lại generation và các session đã sinh.

Preview là ảnh chụp tại thời điểm xem; commit phải kiểm tra lại. Cùng khóa và cùng nội dung được replay, cùng khóa khác nội dung bị từ chối.

### 8.2. Đổi giờ buổi — đã có luồng chính

1. Chọn session tương lai SCHEDULED.
2. Gửi startsAt, endsAt, expectedRevision, reason vào reschedule-preview.
3. Kiểm tra thời gian mới, cùng tháng gốc và nằm trong Unit.
4. Kiểm tra participant vẫn thuộc kỳ học/placement tại thời gian mới.
5. Chặn nếu đã có attendance/leave hoặc booking học bù chưa giải quyết.
6. Kiểm tra trùng lớp/giáo viên/phòng.
7. Reschedule command với idempotency key ghi giờ mới, tăng revision, ghi audit và mutation.
8. Giữ sessionId, lesson và quan hệ nghiệp vụ.

### 8.3. Hủy buổi — đã có command

1. Manager gửi reason, expectedRevision và Idempotency-Key.
2. Lock session, kiểm tra mutation cùng khóa để replay hoặc từ chối khác nội dung.
3. Session phải SCHEDULED và startsAt còn ở tương lai; revision phải khớp.
4. Chặn nếu có makeup BOOKED ở vai trò nguồn hoặc đích.
5. Chặn nếu có participant attendance khác UNMARKED hoặc leave của session đang PENDING/APPROVED.
6. Đổi session thành CANCELLED, lưu cancelReason/cancelledAt, tăng revision.
7. Ghi audit và SessionMutation chứa response để replay.
8. Không xóa session hoặc toàn bộ lịch sử liên quan. Chưa tự gửi email hủy buổi.

### 8.4. Legacy tạo buổi thủ công

POST /academic/sessions vẫn tồn tại. Kiểm tra thời lượng không quá 12 giờ, bài approved cùng Program, Teacher ACTIVE và trùng lớp/Teacher. Chưa có đầy đủ room/generation validation như luồng sinh lịch mới.

## 9. Hồ sơ học sinh, đăng ký và thanh toán

### 9.1. Hồ sơ con — đã có luồng chính

1. Parent xác minh email.
2. POST /me/students tạo fullName, grade, dateOfBirth nếu có.
3. Backend gắn parentProfileId từ user hiện tại.
4. Parent GET/PATCH chỉ con của mình.
5. Staff/Manager tra cứu qua /students, /parents/search hoặc /parents/lookup theo quyền.
6. Cập nhật hồ sơ chịu ràng buộc khi đã có dữ liệu học liên quan.

Một Parent có nhiều StudentProfile. Không dùng email Parent để gộp điểm/lịch của các con.

### 9.2. Đăng ký mới — đã có luồng chính

1. Staff chọn hồ sơ con ACTIVE.
2. Chọn lớp đủ điều kiện, startDate, packageMonths.
3. Backend tính endDate theo số tháng lịch.
4. Kiểm tra lớp/môn/chương trình, khối, kỳ học, khả năng đăng ký và chỗ.
5. Tính quotedAmount = monthlyFee × packageMonths.
6. Chụp billSnapshot gồm Parent, con, lớp/lịch và học phí.
7. Tạo RegistrationOrder DRAFT.
8. Có thể dùng Idempotency-Key để tránh tạo hai draft cho cùng lệnh.
9. Parent đọc bill của con qua /me/bills hoặc bill detail; Staff quản lý danh sách.

**DRAFT chưa có nghĩa đã thu tiền và chưa tạo enrollment ACTIVE.**

Các điều kiện cụ thể ở registrationProblem: con ACTIVE; tài khoản Parent ACTIVE và đã xác minh email; lớp ACTIVE/đang mở; khối lớp khớp khối của con; có lịch tuần; ngày bắt đầu đúng một thứ học của lớp; sĩ số cao nhất trong kỳ chưa đầy; không đăng ký trùng lớp trong kỳ; lịch tuần không chồng lớp khác đang học. Các mã lỗi tương ứng gồm STUDENT_INACTIVE, PARENT_DISABLED, PARENT_EMAIL_UNVERIFIED, CLASS_CLOSED, CLASS_GRADE_MISMATCH, INVALID_START_DATE, CLASS_FULL, DUPLICATE_CLASS_REGISTRATION và STUDENT_SCHEDULE_CONFLICT.

### 9.3. Xác nhận thanh toán — đã có luồng chính và enqueue email

1. Staff POST /registrations/:id/confirm-payment cùng khóa idempotency.
2. Nếu cùng khóa đã hoàn tất, trả response cũ.
3. Lock registration, student và class trong transaction.
4. Yêu cầu order DRAFT, có student/kỳ học, ngày bắt đầu chưa qua.
5. Kiểm tra bill snapshot còn khớp lớp; nếu lớp đổi phải tạo lại đăng ký.
6. Kiểm tra lại điều kiện đăng ký và chỗ.
7. Tạo Payment CONFIRMED bằng quotedAmount, receiptNumber unique.
8. Tạo Enrollment ACTIVE cùng học sinh, lớp và kỳ.
9. Tạo Placement bắt đầu từ ngày học theo giờ địa phương.
10. Order chuyển COMPLETED.
11. Ghi audit và OutboxEvent PAYMENT_CONFIRMED với dedupeKey theo order.
12. Ghi response idempotency và trả receipt.
13. Worker gửi email sau đó; SMTP lỗi không rollback Payment/Enrollment.

Đây là **Staff xác nhận việc thu tiền**, chưa phải tích hợp cổng thanh toán online/webhook ngân hàng.

### 9.4. Hủy và lịch sử

- Chỉ DRAFT được cancel; gọi lại order CANCELLED trả kết quả hiện tại.
- Không hủy Payment đã xác nhận bằng lệnh hủy draft.
- Receipt chỉ có khi tồn tại Payment.
- Chưa có nghiệp vụ hoàn tiền, trả góp, thu từng phần hoặc bù trừ phí chuyển lớp.
- Danh sách Payment có tổng tiền theo bộ lọc; không lấy DRAFT vào doanh thu.

## 10. Roster, báo nghỉ và điểm danh

### 10.1. Roster lớp theo thời điểm — đã có luồng chính, count khác chưa thống nhất

GET /classes/:id?at=...:
1. Kiểm tra Staff/Manager hoặc Teacher hiện tại của lớp.
2. Dùng thời điểm at, mặc định hiện tại.
3. Chọn enrollment có kỳ bao phủ ngày học.
4. Có placement thì xét khoảng hiệu lực; không có mới fallback classId gốc.
5. Enrollment ENDED chỉ xuất hiện nếu at trước endedAt.
6. Trả rosterAt và enrollments dạng items/page/limit/total.

Ví dụ chuyển A→B hiệu lực 20/10: xem ngày 19/10 ở A, ngày 20/10 ở B. Enrollment.classId vẫn là lớp gốc.

Còn thiếu: listClasses vẫn có _count.enrollments theo quan hệ lớp gốc. Không dùng count đó như sĩ số placement hiện tại. Teacher cũ đọc lịch sử còn bị phụ thuộc teacherId hiện tại của lớp.

### 10.2. Prepare roster của buổi — đã có luồng chính

1. Teacher được gán session gọi POST /academic/sessions/:id/roster.
2. Xác định enrollment theo kỳ học và placement tại startsAt.
3. Tạo/upsert participant unique(sessionId,enrollmentId).
4. Participant thường có kind REGULAR.
5. Nếu có PERIOD_PAUSE approved bao phủ ngày, attendance=EXCUSED; bình thường UNMARKED.
6. Makeup seat đã hủy có thể chuyển lại thành regular; active makeup bị chặn xung đột.
7. Kiểm tra sức chứa danh sách hoạt động.
8. GET roster chỉ đọc participant đã có; không tự động tạo.

### 10.3. Xin nghỉ một buổi — đã có luồng chính

Đầu vào: enrollmentId, kind=SINGLE_ABSENCE, sessionId, fromDate=toDate, reason.

1. Parent của con hoặc Staff gọi.
2. Enrollment và Student phải ACTIVE; ngày nằm trong kỳ.
3. Session SCHEDULED, đúng placement/lớp của con.
4. Ngày đơn phải khớp ngày địa phương của session.
5. Tự upsert regular participant nếu Teacher chưa prepare roster.
6. Tạo LeaveRequest PENDING.
7. Nếu Staff tạo, tự duyệt ngay trong transaction; Parent tạo thì chờ Staff.
8. Buổi được phê duyệt nghỉ có thể dùng làm nguồn đặt học bù trước khi chốt.

Nghỉ một buổi **không tự trở thành EXCUSED** như period pause. Teacher vẫn chốt ABSENT phù hợp quy tắc.

### 10.4. Tạm nghỉ theo khoảng — đã có luồng chính

1. kind=PERIOD_PAUSE, không có sessionId, từ ngày đến ngày và lý do.
2. Kiểm tra trong enrollment.
3. Staff duyệt, chặn overlap approved leave.
4. Chặn các buổi đã hoàn thành hoặc có hoạt động makeup chưa giải quyết.
5. Đặt các participant liên quan EXCUSED.
6. Roster sinh sau cũng nhận biết approved pause.
7. Hết khoảng ngày thì không còn áp dụng pause; không cần lệnh resume cho hết hạn bình thường.

### 10.5. Duyệt/hủy đơn

Staff decide chỉ nhận đơn PENDING. Approve kiểm tra active enrollment, overlap và activity; Reject đổi REJECTED.

Cancel chỉ cho PENDING/APPROVED. Với period pause đã có buổi completed, trả LEAVE_HAS_ACTIVITY. Pause chưa có lịch sử hoàn thành có thể bỏ EXCUSED trên các buổi scheduled trong khoảng rồi CANCELLED.

### 10.6. Kết thúc pause sớm — một phần, chưa an toàn để coi hoàn thiện

POST /academic/leaves/:id/end-early với effectiveDate và reason:
1. Yêu cầu pause APPROVED.
2. effectiveDate nằm sau fromDate và không sau toDate.
3. toDate mới = ngày trước effectiveDate.
4. Mở các participant EXCUSED thuộc session SCHEDULED từ effectiveDate.
5. Ghi audit before/after.

Lỗi/giới hạn đọc được từ code:
- Không bắt buộc effectiveDate từ hôm nay trở đi.
- Nối chuỗi T00:00:00Z trong khi DTO nhận IsDateString; datetime đầy đủ có thể làm parsing sai.
- Mốc mở lại chưa chuyển UTC+7 như các luồng khác.
- Update participant thiếu cận trên ngày kết thúc pause cũ: có thể ảnh hưởng EXCUSED của đơn nghỉ khác trong tương lai.
- Chưa bảo đảm trả sớm không xung đột chỗ học bù đã sử dụng.
- Chưa có test chuyên biệt cho rollback và các trường hợp trên.

### 10.7. Chốt điểm danh — đã có luồng chính

1. Chỉ Teacher được phân công session.
2. Session SCHEDULED và giờ kết thúc đã qua.
3. Phải gửi đúng một kết quả cho mỗi participant không canceled.
4. Không được bỏ UNMARKED.
5. EXCUSED phải khớp trạng thái do leave đã thiết lập.
6. Participant nguồn đang/đã có học bù phải giữ ABSENT.
7. Update attendance từng người.
8. Với người đi bù: PRESENT → booking COMPLETED; trạng thái khác → MISSED.
9. Session chuyển COMPLETED và lưu summary.
10. Tất cả trong transaction.

Gọi chốt lại bị chặn bởi trạng thái; chưa có response replay idempotent. Chưa enqueue email điểm danh.

## 11. Học bù và chuyên cần

### 11.1. Chọn nguồn học bù

GET /academic/makeup-sources:
- Manager/Staff được đọc.
- Participant thường chưa canceled, không PRESENT/EXCUSED.
- Session chưa canceled, enrollment ACTIVE.
- Không có booking BOOKED/COMPLETED cho nguồn.
- Có filter studentId.

Nguồn trước khi buổi completed cần approved SINGLE_ABSENCE khi book.

### 11.2. Candidates — một phần

1. Lấy các session tương lai SCHEDULED cùng lessonId, khác buổi nguồn.
2. Mỗi session gọi chung makeupTargetState với lệnh book.
3. Trả eligible, availableSeats, reasonCodes.
4. Kiểm tra source, kỳ học, approved absence, leave tại target, xung đột participant và capacity.
5. Số chỗ = capacity lớp − regular reservations theo placement/kỳ − makeup participant hoạt động.

**Chính sách hiện tại:** period pause vẫn giữ regular reservation khi đếm chỗ; không tự giải phóng chỗ vì attendance EXCUSED.

Các giới hạn:
- Xung đột lịch học sinh chủ yếu đếm participant đã có; lịch khác chưa prepare roster có thể chưa bị phát hiện.
- Helper chưa kiểm tra đủ source đã có active booking và target đã bị cùng enrollment chiếm; book còn kiểm tra riêng và unique constraint.
- Vì vậy eligible=true chưa bảo đảm book thành công ngoài lý do dữ liệu vừa thay đổi.
- Candidates truy vấn nhiều lần theo mỗi target, cần tối ưu khi số lượng lớn.

### 11.3. Đặt, hủy và đặt lại — đã có luồng chính

1. Staff gửi originalParticipantId và targetSessionId.
2. Transaction kiểm tra eligibility/capacity lại.
3. Tìm participant unique ở target/enrollment.
4. Chỉ tạo mới hoặc dùng lại MAKEUP canceled không có booking active/completed.
5. Tạo MakeupBooking BOOKED; activeOriginalId unique chống hai booking nguồn hoạt động.
6. Cancel chỉ khi booking BOOKED và target còn SCHEDULED.
7. Đánh canceled participant, booking CANCELLED, activeOriginalId=null.
8. Đặt lại cùng target dùng lại participant và tạo booking mới.
9. Booking CANCELLED cũ được giữ; booking COMPLETED không hồi sinh.

### 11.4. Đổi booking atomic — một phần

POST /academic/makeups/:id/reschedule:
1. Kiểm tra booking BOOKED, target cũ còn SCHEDULED.
2. Target mới phải khác.
3. Validate target mới; tạo hoặc dùng lại canceled makeup participant.
4. Hủy participant cũ.
5. Update booking hiện tại trỏ participant mới; ghi audit session cũ/mới.
6. Nếu bước nào lỗi, transaction rollback, chỗ cũ giữ nguyên.

Giới hạn: lịch của chỗ cũ còn được tính trong kiểm tra conflict trước khi hủy; nếu hai target chồng giờ có thể bị từ chối dù chuyển chỗ là hợp lệ. Lịch sử di chuyển nằm trong audit, không tạo một booking lịch sử riêng cho mỗi lần đổi.

### 11.5. Chuyên cần Teacher/Parent — một phần

API:
- Teacher: GET /academic/classes/:id/attendance-summary?fromDate=&toDate=
- Parent: GET /academic/me/students/:id/attendance?fromDate=&toDate=

Luồng:
1. Teacher phải là teacherId hiện tại của lớp; Parent phải sở hữu con.
2. Lấy participant REGULAR không canceled của session COMPLETED trong range.
3. EXCUSED → excused, không tăng required.
4. PRESENT → present, tăng required/attended.
5. Nguồn có booking COMPLETED → madeUp, tăng required/attended.
6. Các trường hợp còn lại → absent, tăng required.
7. Trả counts, attendancePercent và history với source booking/target session.
8. required=0 trả null, không giả định 100%.

Ví dụ: 6 present + 2 madeUp + 2 absent + 1 excused → required=10, attended=8 → 80%. Buổi makeup không tăng mẫu số thêm lần nữa.

Chưa hoàn thiện:
- Report vẫn có code tính riêng; chưa dùng cùng một service.
- Report chỉ tăng required cho PRESENT/ABSENT; summary còn coi UNMARKED trên completed là ABSENT. Dữ liệu chuẩn thường không UNMARKED nhưng dữ liệu cũ có thể lệch.
- DTO summary chưa có studentId cho Teacher, dù tài liệu đề xuất có.
- Summary lớp là counts toàn lớp và history, chưa nhóm kết quả riêng từng con.
- Page/limit kế thừa nhưng chưa được dùng để phân trang history; có giới hạn 20.000 hàng.
- fromDate/toDate parse trực tiếp Date, chưa thống nhất ngày địa phương và hết ngày.

## 12. Chuyển lớp, kết thúc học và học lại

### 12.1. Chuyển lớp — đã có luồng chính

1. Staff gửi targetClassId, effectiveAt, reason.
2. Enrollment ACTIVE và mốc hiệu lực không ở quá khứ, nằm trong kỳ.
3. Lớp đích khác lớp hiện tại ở mốc đó, đang mở, cùng Program và cùng phí.
4. Chặn placement tương lai chưa giải quyết.
5. Kiểm tra chỗ hiện tại và reservation tương lai.
6. Chặn nếu còn makeup BOOKED.
7. Lịch đích phải có các lesson còn lại cần học.
8. Kiểm tra chỗ từng target session và trùng lịch participant khác.
9. Đóng placement cũ tại effectiveAt, mở placement mới.
10. Cancel regular participant tương lai của enrollment và upsert participant ở lớp đích.
11. Áp dụng EXCUSED nếu ngày tương ứng thuộc pause.
12. Tạo EnrollmentTransfer chứa lớp cũ/mới, hiệu lực, actor, lý do.
13. Giữ nguyên order/payment/Enrollment.classId gốc và lịch sử đã học.

Giới hạn: kiểm tra lịch khác qua participant có cùng rủi ro chưa prepare; số lượng/count ở mọi projection chưa đồng bộ; không có điều chỉnh học phí.

### 12.2. Kết thúc một enrollment — đã có luồng chính

Staff POST /academic/enrollments/:id/end:
1. Cancel leave PENDING.
2. Đóng placement đang hiệu lực; placement tương lai được biến thành khoảng rỗng.
3. Cancel makeup BOOKED và participant đích.
4. Cancel participant tương lai của enrollment.
5. Revoke link invitation cũ còn active nếu có.
6. Enrollment ENDED và endedAt hiện tại.
7. Ghi audit, trả impact counts.

Tên impact.futureSessionsCancelled hiện đếm **participant bị hủy của học sinh**, không phải hủy cả ClassSession cho mọi học sinh.

Chưa có refund tự động. Replay end có thể ghi lại endedAt hiện tại; cần giữ mốc kết thúc đầu tiên nếu muốn idempotency đầy đủ.

### 12.3. End-study và quay lại — đã có luồng chính

End-study chạy endOne cho các enrollment chưa ended của con rồi StudentProfile INACTIVE. Học sinh khác của Parent không thay đổi.

Reactivate:
1. Staff gửi reason.
2. Nếu con đã ACTIVE, trả hồ sơ đó.
3. Nếu INACTIVE, yêu cầu không còn enrollment chưa ENDED.
4. Đổi ACTIVE và audit.
5. Dùng cùng studentId để tạo đăng ký mới.
6. Xác nhận tiền tạo enrollment mới, không hồi sinh enrollment cũ.

## 13. Lịch Parent và dữ liệu từng con

GET /academic/scheduled-sessions hỗ trợ studentId/fromDate/toDate:
1. Kiểm tra student thuộc Parent.
2. Lấy enrollment của con gồm ACTIVE và ENDED, loại PENDING_LINK.
3. Thu thập classId gốc, placement và session có participant.
4. Ghép regular sessions theo placement và makeup sessions ngoài lớp.
5. Lọc theo kỳ và endedAt để giữ lịch sử, không cấp buổi mới sau kết thúc.
6. Trả participations gồm enrollment, student identity, kind, attendance, canceled và booking nguồn/đích.
7. Detail có kiểm tra quyền tương ứng.
8. Parent không truyền ngày mặc định từ hôm nay đến khoảng 30 ngày sau; muốn lịch sử phải gửi range.

Lịch cũ /me/students/:id/schedule mô tả lịch theo enrollment/placement; không thay thế hoàn toàn lịch session thật.

Cần nghiệm thu thêm tổ hợp hai con, chuyển tương lai, canceled makeup, end-study, khoảng ngày và phân trang. Không đồng nhất raw ABSENT với effective MADE_UP ở client nếu response chưa chuẩn hóa thống nhất.

## 14. Bài tập, nộp bài, chấm và công bố điểm

### 14.1. Tạo và phát bài — đã có luồng chính

1. Teacher lớp tạo assignment DRAFT với title, instructions, dueAt, maxAttempts và questions.
2. Câu hỏi gồm MULTIPLE_CHOICE hoặc ESSAY; maxScore, đáp án/rubric tùy loại.
3. Chỉ sửa draft trong phạm vi Teacher.
4. Publish nhận enrollmentIds.
5. Kiểm tra enrollment tồn tại, linked/đang trong kỳ, distinct student và placement đúng lớp hiện tại.
6. Tạo AssignmentRecipient và đổi PUBLISHED.
7. Teacher có thể close; reopen chỉ nếu không draft và đáp án chưa công bố, hạn mới ở tương lai, số lần nộp không giảm.
8. Publish-answers yêu cầu CLOSED.

### 14.2. Nộp bài — đã có luồng chính

1. Parent chọn recipient của con.
2. Gửi đúng một answer cho mỗi question và fileIds tùy chọn.
3. Kiểm tra quyền con, assignment PUBLISHED, chưa quá hạn và enrollment còn kỳ.
4. Kiểm tra số lần nộp < maxAttempts.
5. Trắc nghiệm phải khớp một choice.
6. File phải thuộc Parent đang nộp.
7. Tạo Submission với attemptNo và submittedAt; giữ các attempt trước.

### 14.3. Tệp đính kèm — đã có integration

Parent upload /academic/files. Cho PDF, PNG, JPEG hợp lệ qua extension/MIME/signature, tối đa 10MB. Upload object storage rồi lưu metadata; lỗi lưu DB có bước dọn object. Download kiểm tra owner hoặc Teacher đủ quyền, trả URL ký.

Thiếu cấu hình S3/object storage trả lỗi; chưa có bằng chứng đã cấu hình production.

### 14.4. Chấm tay/trắc nghiệm — đã có luồng chính

- Chấm tay: Teacher gửi điểm từng câu, kiểm tra đủ câu, không trùng, không âm, không vượt maxScore.
- Tạo GradeReview DRAFT mới với revision tiếp theo.
- Trắc nghiệm tự chấm chỉ khi toàn bộ câu là MULTIPLE_CHOICE; đúng maxScore, sai 0.
- Bài có ESSAY yêu cầu chấm tay hoặc gợi ý AI.

### 14.5. AI chấm bài — đã có worker gợi ý

1. Teacher gọi grade-ai.
2. Kiểm tra assignment ownership, provider được cấu hình, không có file đính kèm.
3. Trả job đang QUEUED/PROCESSING nếu đã có hoặc tạo QUEUED.
4. Worker khoảng 2 giây lấy job, claim bằng update có điều kiện.
5. Gửi rubric/câu/đáp án text cho provider.
6. Validate kết quả, ghi SUCCEEDED/result hoặc FAILED.
7. Job PROCESSING quá 120 giây bị đánh thất bại để yêu cầu chạy lại.
8. AI chỉ gợi ý, không tự duyệt/công bố.

### 14.6. Duyệt và công bố — đã có luồng chính

Teacher approve DRAFT → APPROVED. Publish yêu cầu APPROVED; bản điểm PUBLISHED cũ của cùng recipient chuyển SUPERSEDED, bản mới PUBLISHED và publishedAt.

Parent chỉ đọc điểm công bố theo quyền con. Điểm nháp/gợi ý AI không phải kết quả chính thức.

**Rủi ro đổi Teacher:** assessment.teacher yêu cầu đồng thời assignment.teacherId và class.teacherId đều là user. Khi lớp đổi giáo viên, người cũ không còn là giáo viên lớp, người mới không phải tác giả; cần chính sách bàn giao để tránh không ai xử lý được bài cũ.

### 14.7. Queue/detail/progress tổng hợp — chưa có API đầy đủ

Có list assignments, assignment detail và submissions theo assignment. Chưa có aggregate Teacher queue với filter class/student/status/date và total; chưa có GET submission detail độc lập; chưa có progress summary theo từng con được công bố đầy đủ. Không coi việc đã có grading là đã có các query này.

## 15. Báo cáo, dashboard và analytics

### 15.1. Báo cáo học tập — đã có luồng chính

1. Teacher hiện tại của lớp chọn classId, studentId tùy chọn, from/to, includeAi.
2. Giới hạn range tối đa 366 ngày.
3. Query regular participant ở buổi COMPLETED và grade PUBLISHED.
4. Tính chuyên cần; EXCUSED không tăng required.
5. averageScore chuyển điểm bài sang phần trăm 0–100 trước khi lấy trung bình.
6. Tính tiến độ dạy = số buổi completed / tổng buổi không canceled.
7. Lưu LearningReport snapshot và AI summary nếu yêu cầu/cấu hình phù hợp.
8. List report và download PDF/XLSX từ snapshot.

Report là ảnh chụp lúc tạo. Dữ liệu học thay đổi không tự cập nhật file report cũ.

### 15.2. Manager dashboard — đã có luồng chính

GET /dashboard trả:
- Tiền Payment CONFIRMED và paymentCount trong range ngày địa phương.
- Counts học sinh ACTIVE, đang học, Parent/Teacher/Staff ACTIVE.
- Counts registration theo trạng thái.
- Mặc định range từ đầu tháng đến hôm nay.

### 15.3. Analytics nâng cao — có file nhưng chưa nối API

analytics.service.ts có logic dashboard/export. Tuy nhiên AcademicModule chưa đăng ký AnalyticsService, AcademicController chưa có route tương ứng. Không thể gọi chức năng chỉ vì file tồn tại. File này là thay đổi riêng có sẵn trong workspace; tài liệu không xác nhận đã tích hợp.

## 16. Thông báo, email và retry

### 16.1. Announcement và nhắc học phí — API có, gửi bền vững chưa có

1. Manager tạo announcement theo lớp; lưu chưa đồng nghĩa gửi.
2. Send-email lấy enrollment đúng placement hiện tại, thu thập Parent email và loại trùng.
3. Gửi trực tiếp qua SMTP, trả kết quả sent theo từng recipient.
4. Tuition-reminders nhận through, tối đa khoảng 31 ngày, chọn enrollment gần endDate và gửi nhắc gia hạn.
5. Trả automaticRetry=false.

Những lệnh này chưa nối OutboxEvent. Chưa có lịch tự động nhắc định kỳ, lưu delivery history và dedupe theo kỳ cho reminders.

### 16.2. Outbox email — nền tảng đã có, nghiệp vụ nối một phần

Đã nối chắc chắn: **PAYMENT_CONFIRMED**.

Luồng thực tế:
1. Transaction xác nhận tiền tạo outbox với eventType, aggregateType/id, recipient, subject, payload.text, dedupeKey.
2. Worker chạy mỗi 30 giây.
3. Tìm tối đa 20 PENDING đã đến nextAttemptAt và attemptCount<5.
4. Claim bằng updateMany chỉ nhận PENDING/FAILED, đổi PROCESSING, tăng attempt.
5. Gửi SMTP.
6. Thành công → SENT, sentAt, bỏ lastError.
7. Thất bại → PENDING nếu còn lượt, FAILED nếu hết lượt.
8. nextAttemptAt = hiện tại + min(1 giờ, 60 giây × 2^attempt).
9. Manager/Staff xem /academic/email-deliveries và gọi retry nếu chưa SENT và chưa hết lượt.

### 16.3. Những phần email chưa hoàn thiện

- Chưa enqueue cho attendance, leave, makeup, transfer, end-study/end enrollment.
- Invitation chưa gửi thư.
- Verify/reset password vẫn gửi trực tiếp, không qua outbox.
- Announcement/reminder chưa lưu delivery/retry trong outbox.
- Worker không có lease/timeout để thu hồi PROCESSING nếu process chết.
- Worker lọc cứng attemptCount<5 trong khi record có maxAttempts.
- Không có thao tác chủ động resend cho SENT; retry không cho vượt maxAttempts.
- Thiếu SMTP bị chặn trước claim nên event vẫn PENDING và attempt chưa tăng.
- Lỗi query ở processDue chưa có catch/log bao toàn vòng chạy.
- Nếu SMTP đã nhận thư nhưng cập nhật SENT thất bại, retry có nguy cơ gửi lặp. Dedupe transaction không bảo đảm “exactly once” ở SMTP.
- Migration outbox cũ thêm recipient/subject rỗng; cần kế hoạch xử lý record cũ thay vì kỳ vọng tự gửi đúng.
- Nội dung xác nhận tiền đã có con/lớp/số tiền/receipt, chưa đủ môn/lịch chi tiết như toàn bộ yêu cầu handoff.

## 17. Phân công giáo viên và xác nhận lịch

### 17.1. Đổi giáo viên dài hạn — một phần, có sai lệch hiệu lực

POST /classes/:id/teacher-assignments nhận teacherId, effectiveAt, reason:
1. Manager, Teacher mới ACTIVE.
2. effectiveAt không quá khứ.
3. Lock lớp.
4. Chọn sessions SCHEDULED bắt đầu từ mốc.
5. Kiểm tra xung đột lịch Teacher mới.
6. Update teacherId các session này và tăng revision.
7. **Update Class.teacherId ngay khi gọi API.**
8. Ghi audit teacher cũ/mới, effectiveAt, reason, số buổi.

Hệ quả: đặt đổi vào tháng sau nhưng quyền/list lớp đã chuyển sang Teacher mới ngay hôm nay; buổi trước mốc vẫn có teacherId cũ. Sinh buổi mới trước mốc cũng có thể dùng sai Teacher vì đọc Class.teacherId mới.

Chưa có lịch sử phân công theo khoảng để tra Teacher hiệu lực, preview/expectedRevision cấp lớp và chính sách bài tập/report lịch sử. Conflict còn có thể tự đụng session cùng lớp khi chọn lại Teacher hiện tại.

### 17.2. Dạy thay một buổi — có luồng chính, cần nghiệm thu thêm

- GET substitute-candidates lấy Teacher ACTIVE khác Teacher hiện tại, không có SCHEDULED overlap.
- POST substitutions yêu cầu Teacher ACTIVE, session tương lai SCHEDULED, expectedRevision khớp.
- Check lịch trùng, sửa session.teacherId và tăng revision, audit lý do.
- Giữ sessionId, lesson, participant.
- Quyền attendance theo session.teacherId nên Teacher thay được chốt buổi.
- Không tự trao quyền tạo/chấm bài tập toàn lớp cho Teacher dạy thay.

Cần kiểm thử cùng lúc hai phân công, trạng thái Teacher đổi khi đang xử lý, và việc candidates của session không còn hợp lệ.

### 17.3. Teacher xác nhận lịch — một phần

PUT /classes/:id/schedule-confirmation:
- confirmed=true: Teacher hiện tại của lớp, lớp có lịch tuần → ghi scheduleConfirmedAt/byId.
- confirmed=false: Manager và reason → xóa hai trường xác nhận.
- Ghi audit confirm/unlock.

**Khóa chưa đồng bộ:** assertScheduleEditable kiểm tra confirmation ở sửa/xóa từng slot; replaceClassSchedules không kiểm tra trường này. Lớp chưa có enrollment/session vẫn có thể thay toàn bộ lịch đã xác nhận bằng đường replace. Chưa có snapshot/revision của nội dung được xác nhận, chưa xác định đổi Teacher có cần xác nhận lại.

Luồng cần đạt: xác nhận một phiên bản lịch cụ thể → mọi đường sửa bị chặn → Manager unlock có lý do → sửa → Teacher xác nhận lại.

## 18. Audit, hạ tầng và an toàn dữ liệu

### 18.1. Audit — API đọc đã có, độ bao phủ chưa toàn bộ

GET /audit-logs dành cho Manager, lọc actorUserId/entityType/entityId/action/from/to, phân trang items/page/limit/total và actor thông tin an toàn.

Các command đã ghi audit gồm nhiều thao tác đăng ký, nhân sự, lịch, kết thúc/học lại, profile, phân quyền. Không phải mọi leave/makeup/attendance/invitation command đều ghi audit chung. EnrollmentTransfer và SessionMutation cũng là lịch sử riêng.

Chưa có permission AUDIT_READ riêng; chưa validate rõ from<=to ở query audit.

### 18.2. API và transaction

- NestJS controller nhận DTO, service xử lý nghiệp vụ, Prisma lưu MySQL.
- Global validation loại/chặn field không hợp lệ theo cấu hình.
- JWT xác định người gọi; không tin actor do client truyền.
- Nhiều command học vụ/registration dùng transaction Serializable và retry conflict.
- Không được suy ra mọi service mới đều có lock giống nhau; invitation/password reset còn đọc trạng thái ngoài transaction.
- Một số list trả array, số khác envelope items/total. FE phải dùng contract từng API; không giả định tất cả cùng định dạng.

### 18.3. Health và cấu hình

Có /health, /health/live, /health/ready phục vụ vận hành. SMTP, AI provider, object storage cần cấu hình riêng. Có code integration không có nghĩa đã xác minh dịch vụ production.

### 18.4. Migration bổ sung trong workspace

| Migration | Mục đích |
| --- | --- |
| 20261012000000_makeup_rebooking | Bỏ unique replacementParticipantId, giữ nhiều booking lịch sử cho participant |
| 20261012001000_password_reset | Token reset mật khẩu |
| 20261012002000_rooms | Room, Class.roomId và ClassSession.roomId |
| 20261012003000_schedule_confirmation | Thời điểm/người xác nhận lịch |
| 20261012004000_account_invitations | Invitation nhân sự và User.permissions |
| 20261012005000_generic_email_outbox | Outbox hỗ trợ aggregate chung, recipient/subject/dedupe/maxAttempts |

Triển khai môi trường thật cần migrate deploy theo quy trình dự án và xem dữ liệu tồn tại. Không dùng migrate reset trên database thật. Báo cáo lượt trước xác nhận chạy migration sạch trên database kiểm thử, không xác nhận đã deploy production.

## 19. Ma trận đối chiếu BE-01–BE-18

| Mã | Trạng thái thực tế | Đã có | Còn thiếu chính |
| --- | --- | --- | --- |
| BE-01 | Luồng quyền trọng tâm đã sửa | Staff vận hành, Teacher chốt, Designer soạn | Rà các đường legacy/quyền sau chuyển Teacher; quyền con Manager thuộc BE-10 chưa đồng bộ |
| BE-02 | Một phần | Roster detail theo at/placement, total phù hợp query | Count list lớp còn theo enrollment gốc, Teacher historical access |
| BE-03 | Đã có luồng chính | Leave tự bảo đảm participant | Nghiệm thu thêm dữ liệu legacy và cạnh tranh |
| BE-04 | Đã có luồng chính | Cancel/rebook và lịch sử booking | Thêm test cạnh tranh/target occupied nếu chưa có |
| BE-05 | Đã có luồng chính | Reactivate giữ studentId, enrollment mới | Luồng end replay cần giữ mốc thời gian ổn định |
| BE-06 | Một phần | Helper chung, eligible/seats/reasons | Conflict chưa có roster, helper chưa đủ mọi rule book, hiệu năng |
| BE-07 | Một phần | Teacher/Parent summary + history | Chưa dùng chung report, filter student, nhóm từng con/range |
| BE-08 | Một phần | Outbox, worker, retry, payment event | Các event còn lại, recover PROCESSING, history manual email |
| BE-09 | Một phần | Invite/accept/review/revoke | Email/resend, chống race, approval không bị bypass, response/audit |
| BE-10 | Một phần | List Manager, permissions, invitation | Enforce toàn hệ thống, /auth/me permissions, update Manager, last-admin rule |
| BE-11 | Một phần | Room CRUD, FK, generation/reschedule overlap | Capacity update, legacy, projection, đổi phòng hiệu lực |
| BE-12 | Một phần | Assignment/substitution commands | Class.teacherId chuyển sớm, lịch sử quyền bài/report, preview/revision |
| BE-13 | Có luồng mở rộng | Parent calendar từng con, makeup, ended history | Nghiệm thu tổ hợp/pagination/effective attendance |
| BE-14 | Một phần | Profile/change/forgot/reset | Reset atomic, token invalidation, email bền vững, response phone |
| BE-15 | Chưa có aggregate API | Assignment/submission list/report đã có | Teacher queue, submission detail độc lập, progress summary |
| BE-16 | Một phần | end-early và atomic reschedule | Mốc ngày/cận trên pause/capacity, conflict chỗ cũ |
| BE-17 | Một phần | Confirm/unlock + audit | Replace bypass, snapshot/revision, re-confirm sau đổi |
| BE-18 | Một phần / ngoài phạm vi | Audit query; AI grading/report có sẵn | Payroll/inbox/Teacher leave chưa chốt; AI soạn giáo trình đã loại |

## 20. Luồng chưa triển khai và thứ tự hoàn thiện

Những luồng dưới đây là **đề xuất cần triển khai**, không phải mô tả tính năng đang hoạt động.

### 20.1. Email đầy đủ

1. Mỗi command thành công ghi event cùng transaction.
2. Event chứa đúng con, enrollment, môn/lớp, buổi nguồn/đích và dữ liệu đã commit.
3. Dedupe theo sự kiện nghiệp vụ; resend chủ động có identity riêng.
4. Worker claim có lease và thu hồi job mắc PROCESSING.
5. Lưu attempt history và lỗi an toàn.
6. Manual retry/resend có quyền và audit.
7. Announcement “đã lưu” tách “đã gửi”.
8. Nhắc học phí cần chốt lịch tần suất và dedupe mỗi kỳ.
9. Test SMTP hỏng → nghiệp vụ vẫn thành công → khôi phục → gửi được.

### 20.2. Invitation hoàn chỉnh

1. Manager mời → outbox email có token/link.
2. Người nhận accept bằng token còn hạn; consume token nguyên tử.
3. Account chờ duyệt không được login/assign.
4. Manager approve/reject theo state có lock.
5. Resend xoay token, email lại, token cũ vô hiệu.
6. Revoke không thể chạy lọt sau accept.
7. Rejected có quy tắc sửa thông tin/mời lại.
8. Direct-create và activate phải theo cùng chính sách approval đã chốt.
9. Mọi bước có audit và response không lộ hash.

### 20.3. Phân quyền và chuyển Teacher đúng hiệu lực

1. Lưu phân công Teacher theo effectiveFrom/effectiveTo.
2. Quyền hiện tại được tính theo ngày, không cập nhật Class.teacherId tương lai sớm.
3. Preview danh sách buổi ảnh hưởng/xung đột.
4. Commit với revision; buổi quá khứ giữ Teacher cũ.
5. Sinh session mới chọn Teacher đúng ngày.
6. Quy định Teacher cũ đọc lịch sử; Teacher mới tiếp nhận bài/report ở phạm vi rõ ràng.
7. Áp permission Manager tại tất cả API, kể cả legacy.
8. Test mất quyền có hiệu lực ngay mà không cần tin frontend.

### 20.4. Teacher queue, detail và progress

1. Teacher chọn range/lớp/học sinh/trạng thái.
2. Backend lọc assignment/submission đúng quyền.
3. Trả queue có total và pagination ổn định.
4. Mở một submission trả answer, attachment, các phiên bản grade theo quyền.
5. Progress của một con chỉ dùng điểm đã công bố, có score scale và range.
6. Không đổi response array API cũ; thêm endpoint/version tương thích.
7. Test dữ liệu nhiều con và thay Teacher.

### 20.5. Các nhóm chưa chốt

| Nhóm | Phải chốt trước khi viết | Luồng dự kiến sau khi chốt |
| --- | --- | --- |
| Payroll | Đơn giá theo buổi/giờ, dạy thay, buổi hủy, duyệt/chốt kỳ, điều chỉnh | Tổng hợp buổi → tính lương → rà soát → duyệt/chốt → xuất; chưa có hiện tại |
| Teacher xin nghỉ | Ai duyệt, thời hạn, tác động buổi, bắt buộc tìm người thay hay hủy | Teacher gửi → Manager duyệt → dạy thay/đổi/hủy → thông báo; chưa có request riêng |
| Inbox/unread/push | Loại thông báo, người nhận, seen/read, retention, thiết bị | Event → notification → inbox → mark read/push; hiện chủ yếu email |
| Transfer khác phí | Thu thêm/hoàn, chia theo ngày/buổi, công nợ | Preview chênh lệch → xác nhận → chứng từ mới; không sửa payment lịch sử |
| AI soạn giáo trình | Không cần chốt trong phạm vi này | Đã loại theo yêu cầu người dùng |

### 20.6. Thứ tự sửa đề xuất

1. Sửa sai lệch có thể ảnh hưởng quyền/dữ liệu: Manager permissions, Teacher hiệu lực, reset/invitation race, end-early và khóa lịch bypass.
2. Đồng bộ rooms/candidates/attendance/report và legacy.
3. Hoàn thiện email end-to-end và invitation delivery/resend.
4. Bổ sung query aggregate và contract FE.
5. Chỉ mở payroll/inbox/Teacher leave khi có đặc tả được chốt.

## 21. Kịch bản xuyên suốt và tiêu chí nghiệm thu

### 21.1. Một học sinh bắt đầu học

Parent register → verify → tạo con → Staff tìm con → tạo draft → Parent đọc bill → Staff nhận đủ tiền/confirm → Payment + Enrollment + Placement + outbox → Manager sinh session → Teacher prepare roster → Teacher chốt → Parent xem lịch/chuyên cần.

Kiểm tra: gọi confirm lại cùng khóa không thêm Payment/Enrollment/email; sai Parent không đọc bill/con.

### 21.2. Nghỉ và học bù

Session chưa có roster → Staff báo SINGLE_ABSENCE → backend tạo participant nguồn/approve → đọc candidates → Staff book → Teacher nguồn chốt ABSENT → Teacher đích chốt PRESENT → booking COMPLETED → source effective MADE_UP → chuyên cần tính một buổi học thành công.

Kiểm tra: lớp đầy dù chưa prepare phải bị loại; hủy/rebook cùng target giữ booking cũ; không cho hai booking nguồn hoạt động.

### 21.3. Chuyển lớp tương lai

Con đang A → Staff chọn B cùng Program/fee, hiệu lực 20/10 → kiểm tra lesson/capacity/conflict → placement A đóng/B mở → xem at=19/10 vẫn A, at=20/10 ở B → điểm/lịch sử A còn.

Kiểm tra: mọi count phải theo cùng nguyên tắc, không đổi bill/payment; lịch khác chưa có participant vẫn cần được xét.

### 21.4. Học lại

End-study → enrollment cũ ENDED, participant tương lai canceled, con INACTIVE → Staff reactivate → con ACTIVE cùng ID → đăng ký/confirm mới → enrollment mới → Parent vẫn đọc được lịch sử cũ.

### 21.5. Bàn giao Teacher

Manager lên lịch T1→T2 tuần sau → trước hiệu lực T1 vẫn có quyền lớp → sau hiệu lực T2 nhận buổi phù hợp → T1 đọc lịch sử, bài cũ có người xử lý theo chính sách → dạy thay chỉ thay một session.

**Luồng này hiện chưa đạt đầy đủ** vì Class.teacherId được đổi ngay và assessment ownership chưa có chính sách bàn giao.

### 21.6. Bộ kiểm thử còn cần cho các chức năng mới

| Nhóm | Case bắt buộc |
| --- | --- |
| Auth | Hai reset đồng thời, token cũ sau reset/change, SMTP lỗi, account disabled |
| Invitation | Email trùng, expired, accept 2 lần, revoke cạnh tranh, reject/mời lại, resend vô hiệu token cũ |
| Permissions | Manager [] bị chặn ở tất cả API quản trị tương ứng; last-manager |
| Room | Capacity tăng, phòng inactive, legacy create, hai transaction đặt cùng phòng |
| Teacher | Hiệu lực tương lai, sinh thêm buổi trước/sau mốc, bài cũ, stale revision |
| Leave | End-early cùng ngày UTC+7, không mở pause khác, rollback khi hết chỗ |
| Attendance | Teacher/Parent/report cùng kết quả, 0 mẫu số, nhiều con, dữ liệu legacy |
| Email | Replay dedupe, lỗi SMTP, worker crash sau send, exhausted/retry, recipient đúng con |
| Confirmation | Mọi POST/PUT/PATCH/DELETE lịch đều tôn trọng khóa |
| Aggregate | Total/pagination/filter đúng quyền và điểm chưa publish không lộ |

Kết quả đã báo ở lượt triển khai trước: unit 14/14, academic+curriculum E2E 12/12, registration E2E 34/34; typecheck/lint/build và migration test đạt. **Đây là kết quả bộ test lúc đó, không bao phủ toàn bộ các case mới ở bảng trên.** Lượt lập tài liệu này đọc source, không chạy lại toàn bộ test và không chứng nhận production.

## 22. Phụ lục API đầy đủ

Bảng bên dưới được trích từ decorator controller trong workspace. Có route không có nghĩa mọi yêu cầu ở phần “còn thiếu” đã hoàn thành. Dùng các phần nghiệp vụ ở trên để hiểu quyền và giới hạn. Prefix chung /api/v1.

Tổng cộng **169 khai báo route** trong các controller được kiểm tra.

| Method | Đường dẫn | Controller |
| --- | --- | --- |
| GET | `/academic/email-deliveries` | academic.controller.ts |
| POST | `/academic/email-deliveries/:id/retry` | academic.controller.ts |
| POST | `/academic/programs` | academic.controller.ts |
| PATCH | `/academic/assignments/:id` | academic.controller.ts |
| POST | `/academic/lessons/:id/revisions` | academic.controller.ts |
| GET | `/academic/enrollments` | academic.controller.ts |
| GET | `/academic/sessions/:id/roster` | academic.controller.ts |
| GET | `/academic/makeups` | academic.controller.ts |
| POST | `/academic/assignments/:id/reopen` | academic.controller.ts |
| GET | `/academic/programs` | academic.controller.ts |
| POST | `/academic/classes` | academic.controller.ts |
| GET | `/academic/classes` | academic.controller.ts |
| POST | `/academic/lessons` | academic.controller.ts |
| GET | `/academic/lessons` | academic.controller.ts |
| POST | `/academic/lessons/:id/approve` | academic.controller.ts |
| POST | `/academic/lessons/:id/feedback` | academic.controller.ts |
| GET | `/academic/feedback` | academic.controller.ts |
| POST | `/academic/feedback/:id/resolve` | academic.controller.ts |
| POST | `/academic/sessions` | academic.controller.ts |
| GET | `/academic/sessions` | academic.controller.ts |
| POST | `/academic/sessions/:id/roster` | academic.controller.ts |
| POST | `/academic/sessions/:id/finalize-attendance` | academic.controller.ts |
| POST | `/academic/leaves` | academic.controller.ts |
| GET | `/academic/leaves` | academic.controller.ts |
| GET | `/academic/makeup-sources` | academic.controller.ts |
| POST | `/academic/leaves/:id/decide` | academic.controller.ts |
| POST | `/academic/leaves/:id/cancel` | academic.controller.ts |
| POST | `/academic/leaves/:id/end-early` | academic.controller.ts |
| GET | `/academic/participants/:id/makeup-candidates` | academic.controller.ts |
| GET | `/academic/classes/:id/attendance-summary` | academic.controller.ts |
| GET | `/academic/me/students/:id/attendance` | academic.controller.ts |
| POST | `/academic/makeups` | academic.controller.ts |
| POST | `/academic/makeups/:id/cancel` | academic.controller.ts |
| POST | `/academic/makeups/:id/reschedule` | academic.controller.ts |
| POST | `/academic/enrollments/:id/transfer` | academic.controller.ts |
| POST | `/academic/enrollments/:id/end` | academic.controller.ts |
| POST | `/academic/students/:id/end-study` | academic.controller.ts |
| POST | `/academic/students/:id/reactivate` | academic.controller.ts |
| POST | `/academic/assignments` | academic.controller.ts |
| GET | `/academic/assignments` | academic.controller.ts |
| GET | `/academic/assignments/:id` | academic.controller.ts |
| POST | `/academic/assignments/:id/publish` | academic.controller.ts |
| POST | `/academic/assignments/:id/close` | academic.controller.ts |
| POST | `/academic/assignments/:id/publish-answers` | academic.controller.ts |
| GET | `/academic/assignments/:id/submissions` | academic.controller.ts |
| POST | `/academic/submissions` | academic.controller.ts |
| POST | `/academic/submissions/:id/grades` | academic.controller.ts |
| POST | `/academic/submissions/:id/grade-objective` | academic.controller.ts |
| POST | `/academic/submissions/:id/grade-ai` | academic.controller.ts |
| GET | `/academic/grading-jobs/:id` | academic.controller.ts |
| POST | `/academic/grades/:id/approve` | academic.controller.ts |
| POST | `/academic/grades/:id/publish` | academic.controller.ts |
| POST | `/academic/reports` | academic.controller.ts |
| GET | `/academic/reports` | academic.controller.ts |
| GET | `/academic/reports/:id/download` | academic.controller.ts |
| POST | `/academic/files` | academic.controller.ts |
| GET | `/academic/files/:id/download` | academic.controller.ts |
| POST | `/academic/announcements` | academic.controller.ts |
| GET | `/academic/announcements` | academic.controller.ts |
| POST | `/academic/announcements/:id/send-email` | academic.controller.ts |
| POST | `/academic/tuition-reminders/send-email` | academic.controller.ts |
| POST | `/auth/register` | auth.controller.ts |
| POST | `/auth/login` | auth.controller.ts |
| POST | `/auth/refresh` | auth.controller.ts |
| POST | `/auth/verify-email` | auth.controller.ts |
| POST | `/auth/resend-verification` | auth.controller.ts |
| POST | `/auth/logout` | auth.controller.ts |
| GET | `/auth/me` | auth.controller.ts |
| PATCH | `/auth/me` | auth.controller.ts |
| POST | `/auth/change-password` | auth.controller.ts |
| POST | `/auth/forgot-password` | auth.controller.ts |
| POST | `/auth/reset-password` | auth.controller.ts |
| POST | `/academic/curriculum-units` | curriculum-scheduling.controller.ts |
| GET | `/academic/curriculum-units` | curriculum-scheduling.controller.ts |
| GET | `/academic/curriculum-units/:id` | curriculum-scheduling.controller.ts |
| PATCH | `/academic/curriculum-units/:id` | curriculum-scheduling.controller.ts |
| POST | `/academic/curriculum-units/:id/submit` | curriculum-scheduling.controller.ts |
| POST | `/academic/curriculum-units/:id/validation` | curriculum-scheduling.controller.ts |
| POST | `/academic/curriculum-units/:id/request-changes` | curriculum-scheduling.controller.ts |
| DELETE | `/academic/curriculum-units/:id` | curriculum-scheduling.controller.ts |
| POST | `/academic/curriculum-units/:id/lessons` | curriculum-scheduling.controller.ts |
| PATCH | `/academic/curriculum-units/:id/lessons/:lessonId` | curriculum-scheduling.controller.ts |
| DELETE | `/academic/curriculum-units/:id/lessons/:lessonId` | curriculum-scheduling.controller.ts |
| PUT | `/academic/curriculum-units/:id/lesson-order` | curriculum-scheduling.controller.ts |
| POST | `/academic/curriculum-units/:id/import-preview` | curriculum-scheduling.controller.ts |
| POST | `/academic/curriculum-units/:id/import-commit` | curriculum-scheduling.controller.ts |
| POST | `/academic/curriculum-units/:id/monthly-tests` | curriculum-scheduling.controller.ts |
| POST | `/academic/curriculum-units/:id/approve` | curriculum-scheduling.controller.ts |
| POST | `/academic/curriculum-units/:id/revisions` | curriculum-scheduling.controller.ts |
| POST | `/academic/classes/:id/session-preview` | curriculum-scheduling.controller.ts |
| POST | `/academic/classes/:id/session-generations` | curriculum-scheduling.controller.ts |
| GET | `/academic/scheduled-sessions` | curriculum-scheduling.controller.ts |
| GET | `/academic/scheduled-sessions/:id` | curriculum-scheduling.controller.ts |
| GET | `/academic/classes/:id/session-generations` | curriculum-scheduling.controller.ts |
| GET | `/academic/session-generations/:id` | curriculum-scheduling.controller.ts |
| POST | `/academic/sessions/:id/reschedule-preview` | curriculum-scheduling.controller.ts |
| POST | `/academic/sessions/:id/reschedule` | curriculum-scheduling.controller.ts |
| POST | `/academic/sessions/:id/cancel` | curriculum-scheduling.controller.ts |
| GET | `/staff` | directory.controller.ts |
| POST | `/staff` | directory.controller.ts |
| GET | `/staff/:id` | directory.controller.ts |
| PATCH | `/staff/:id` | directory.controller.ts |
| GET | `/teachers` | directory.controller.ts |
| POST | `/teachers` | directory.controller.ts |
| GET | `/teachers/:id` | directory.controller.ts |
| PATCH | `/teachers/:id` | directory.controller.ts |
| GET | `/parents` | directory.controller.ts |
| GET | `/parents/:id` | directory.controller.ts |
| PATCH | `/parents/:id` | directory.controller.ts |
| GET | `/dashboard` | directory.controller.ts |
| GET | `/audit-logs` | directory.controller.ts |
| GET | `/managers` | directory.controller.ts |
| PATCH | `/managers/:id/permissions` | directory.controller.ts |
| POST | `/teacher-invitations` | directory.controller.ts |
| GET | `/teacher-invitations` | directory.controller.ts |
| POST | `/manager-invitations` | directory.controller.ts |
| GET | `/manager-invitations` | directory.controller.ts |
| POST | `/account-invitations/accept` | directory.controller.ts |
| POST | `/account-invitations/:id/review` | directory.controller.ts |
| POST | `/account-invitations/:id/revoke` | directory.controller.ts |
| GET | `/health` | health.controller.ts |
| GET | `/health/live` | health.controller.ts |
| GET | `/health/ready` | health.controller.ts |
| GET | `/me/bills` | registration-flow.controller.ts |
| GET | `/me/students` | registration-flow.controller.ts |
| POST | `/me/students` | registration-flow.controller.ts |
| PATCH | `/me/students/:id` | registration-flow.controller.ts |
| GET | `/me/students/:id/enrollments` | registration-flow.controller.ts |
| GET | `/me/students/:id/schedule` | registration-flow.controller.ts |
| GET | `/students` | registration-flow.controller.ts |
| GET | `/students/:id/enrollments` | registration-flow.controller.ts |
| GET | `/students/:id/schedule` | registration-flow.controller.ts |
| GET | `/parents/lookup` | registration-flow.controller.ts |
| GET | `/parents/search` | registration-flow.controller.ts |
| POST | `/programs` | registration-flow.controller.ts |
| GET | `/programs` | registration-flow.controller.ts |
| GET | `/programs/:id` | registration-flow.controller.ts |
| PATCH | `/programs/:id` | registration-flow.controller.ts |
| DELETE | `/programs/:id` | registration-flow.controller.ts |
| POST | `/classes` | registration-flow.controller.ts |
| GET | `/rooms` | registration-flow.controller.ts |
| POST | `/rooms` | registration-flow.controller.ts |
| PATCH | `/rooms/:id` | registration-flow.controller.ts |
| POST | `/classes/:id/teacher-assignments` | registration-flow.controller.ts |
| GET | `/academic/sessions/:id/substitute-candidates` | registration-flow.controller.ts |
| POST | `/academic/sessions/:id/substitutions` | registration-flow.controller.ts |
| PUT | `/classes/:id/schedule-confirmation` | registration-flow.controller.ts |
| PATCH | `/classes/:id` | registration-flow.controller.ts |
| GET | `/classes` | registration-flow.controller.ts |
| GET | `/classes/:id` | registration-flow.controller.ts |
| DELETE | `/classes/:id` | registration-flow.controller.ts |
| GET | `/classes/:id/schedules` | registration-flow.controller.ts |
| PUT | `/classes/:id/schedules` | registration-flow.controller.ts |
| PATCH | `/classes/:id/schedules/:scheduleId` | registration-flow.controller.ts |
| DELETE | `/classes/:id/schedules/:scheduleId` | registration-flow.controller.ts |
| POST | `/classes/:id/schedules` | registration-flow.controller.ts |
| POST | `/registrations` | registration-flow.controller.ts |
| GET | `/registrations` | registration-flow.controller.ts |
| GET | `/payments` | registration-flow.controller.ts |
| GET | `/registrations/:id` | registration-flow.controller.ts |
| GET | `/registrations/:id/bill` | registration-flow.controller.ts |
| POST | `/registrations/:id/cancel` | registration-flow.controller.ts |
| POST | `/registrations/:id/confirm-payment` | registration-flow.controller.ts |
| GET | `/registrations/:id/receipt` | registration-flow.controller.ts |
| GET | `/subjects` | subjects.controller.ts |
| GET | `/subjects/:id` | subjects.controller.ts |
| POST | `/subjects` | subjects.controller.ts |
| PATCH | `/subjects/:id` | subjects.controller.ts |
| DELETE | `/subjects/:id` | subjects.controller.ts |

## 23. Nguồn đối chiếu và giới hạn kiểm chứng

| Nguồn trong repository | Nội dung dùng để đối chiếu |
| --- | --- |
| prisma/schema.prisma | Model, enum, unique, quan hệ và index |
| src/modules/auth/auth.service.ts | Đăng ký, session, profile, mật khẩu |
| src/modules/directory/directory.service.ts | Nhân sự, invitation, permissions, dashboard, audit |
| src/modules/registration-flow/registration-flow.service.ts | Student, Program/Class/Room, payment, Teacher assignment, confirmation |
| src/modules/curriculum-scheduling/curriculum-scheduling.service.ts | Unit/CSV/duyệt, generation, lịch Parent, reschedule/cancel |
| src/modules/academic/catalog.service.ts | Legacy, roster, feedback |
| src/modules/academic/enrollment-workflows.service.ts | Leave/makeup/attendance/transfer/end/reactivate |
| src/modules/academic/assessment.service.ts | Assignment/submission/grade |
| src/modules/academic/reports.service.ts | Snapshot, chuyên cần báo cáo, PDF/XLSX |
| src/modules/academic/grading-worker.service.ts | AI grading job |
| src/modules/academic/announcements.service.ts | Announcement/reminder gửi SMTP trực tiếp |
| src/modules/academic/email-deliveries.service.ts | Worker outbox và retry |
| src/modules/academic/academic.module.ts | Các provider thực sự được nối |
| src/integrations/academic-storage.service.ts | Upload/download file |
| Các controller và DTO tương ứng | Route, trường nhận, validation |
| tests/e2e và tests/unit | Kịch bản test hiện có; không tự suy ra đủ coverage |
| BE_HANDOFF_REMAINING_GAPS.md do người dùng cung cấp | Mốc yêu cầu BE-01–BE-18; đề xuất trong file không tự biến thành tính năng đã có |

Tài liệu phản ánh snapshot mã nguồn ngày lập, không phải xác nhận môi trường đang chạy đã migrate/deploy. Các điểm ghi “chưa có” được kết luận theo controller/module/service đã kiểm tra; các điểm lỗi/rủi ro là đối chiếu tĩnh từ logic, chưa phải mọi trường hợp đều được tái hiện bằng HTTP trong lượt này.
