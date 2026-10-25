# Kiểm thử Frontend theo role và lỗi Backend — 13/10/2026

## Phạm vi, môi trường và quy ước

- FE: `D:\FALL26\WDP301\WDP301-FE-System`, `http://localhost:3000`; BE QA: repo này, `http://localhost:3001/api/v1` với `PORT=3001` và `DATABASE_URL` trỏ đến `edugrade_qa_fe_20261013` trên MySQL `localhost:3307`.
- DB QA đã áp dụng 16 migration. Không dùng `edugrade_db` ứng dụng để chạy các case trong tài liệu này. FE hiện được chạy lại với biến môi trường tạm `BACKEND_API_URL=http://localhost:3001/api/v1`; file `.env` FE chưa thay đổi. Lần chạy FE sau cần đặt lại biến này.
- Chỉ gọi **đã chạy** khi có bằng chứng API/BFF hoặc màn hình ở mục kết quả. Các test case chưa chạy được đánh dấu **Chưa chạy**, không suy diễn Pass. Role Parent chỉ có luồng tự đăng ký trên web; các chức năng hồ sơ con/lịch của Parent thuộc mobile hoặc chưa có màn web.
- Kỹ thuật: EP = phân vùng tương đương; BVA = giá trị biên; ST = chuyển trạng thái; DT = bảng quyết định. Mức P1 ảnh hưởng luồng chính/dữ liệu/quyền; P2 ảnh hưởng chức năng; P3 hiển thị/tiện dụng.

## Dữ liệu chuẩn trên DB QA

Mật khẩu dùng chung cho **tài khoản QA trong DB test riêng**: `QaTest2026!`. Đây không phải mật khẩu của tài khoản trong `edugrade_db`.

| Role | Tài khoản | Trạng thái FE |
| --- | --- | --- |
| Manager | `qa.manager@edugrade.local` | Có dashboard và màn quản lý |
| Staff | `qa.staff@edugrade.local` | Có màn ghi danh, thanh toán, nghỉ học |
| Teacher | `qa.teacher@edugrade.local` | Có màn lớp, lịch, điểm danh, bài tập |
| Curriculum Designer | `qa.designer@edugrade.local` | Dùng `/manager/curriculum` theo quyền designer |
| Parent | `qa.parent@edugrade.local` | Web từ chối đăng nhập bằng `WEB_ROLE_UNSUPPORTED`; kiểm thử tự đăng ký trên web |
| Parent mới | `qa.newparent.20261013@edugrade.local` | Tạo qua FE Register; ACTIVE nhưng `emailVerifiedAt=null`, chưa tạo hồ sơ con |

| Mã dữ liệu | Nội dung và trạng thái | Dùng cho |
| --- | --- | --- |
| `qa-subject-math`, `qa-subject-english` | Toán và Tiếng Anh | Catalog, tìm kiếm, lọc |
| `qa-program-math6`, `qa-program-eng7` | Hai khóa khối 6/7 | Khóa học, khác khối |
| `qa-class-open`, `qa-class-full`, `qa-class-closed` | Lớp mở 12 chỗ, lớp 1 chỗ đã có 1 ghi danh ACTIVE, lớp đóng; học phí 500.000 đ/tháng và lịch thứ 7 09:00–10:30 | Danh sách lớp, ghi danh, xung đột/sức chứa |
| `qa-room-1` | Phòng 20 chỗ | Phòng và lịch |
| `qa-student-active`, `qa-student-inactive` | Hai hồ sơ con khối 6/7, một ACTIVE và một INACTIVE | Tra cứu, ghi danh, trạng thái |
| `qa-unit-draft`, `qa-unit-review`, `qa-unit-approved` | Giáo trình DRAFT, PENDING_REVIEW, APPROVED; nháp và bản chờ duyệt đều có 1 bài học + 1 kiểm tra tháng, bản duyệt có 1 bài | Designer gửi duyệt, Manager duyệt/khóa sửa |
| `qa-session-future`, `qa-assignment-draft` | Buổi tương lai và bài tập nháp | Lịch Teacher, bài tập |
| `qa-order-draft`, `qa-order-completed`, `qa-payment-completed`, `qa-enrollment-active` | Đăng ký nháp; đăng ký đã thanh toán với biên lai `QA-RECEIPT-001` và ghi danh ACTIVE | Staff, bill, giới hạn sĩ số, dashboard |

Các fixture nghiệp vụ có ID `qa-*` cố định và đã được tạo bằng upsert; tài khoản Parent mới được tạo qua giao diện có ID do BE sinh. Dữ liệu này phục vụ trạng thái màn hình; case thay đổi nghiệp vụ cần tạo bản ghi QA riêng cho mỗi lần chạy để tránh phụ thuộc thứ tự và không sửa bản ghi nền.

## Ma trận luồng theo role

| Role | Luồng FE có giao diện | Phạm vi kiểm thử | Giới hạn đã biết |
| --- | --- | --- | --- |
| Parent | Đăng ký, đăng nhập thử, quên/reset mật khẩu | Form, phản hồi BE, điều hướng sang mobile | Không có portal Parent web; không báo Pass cho hồ sơ con/lịch từ web |
| Staff | Tra cứu phụ huynh/học sinh, tạo đăng ký, bill/thanh toán, lớp/lịch, nghỉ/chuyển lớp/học bù | Luồng thực và lỗi nghiệp vụ theo API | Một số chức năng BE nghỉ/học bù còn một phần; ghi bug hoặc Blocked riêng |
| Teacher | Dashboard, lớp/lịch, điểm danh, bài tập/nộp/chấm/feedback/report | Trạng thái lớp/buổi và quyền Teacher | Queue/detail/progress tổng hợp chưa có API hoàn chỉnh |
| Designer | Giáo trình, bài học, CSV, gửi duyệt, phản hồi | Draft → Pending → Approved và quyền sửa | Đi vào route `/manager/curriculum` bằng role Designer |
| Manager | Dashboard, danh mục, lớp/lịch, duyệt giáo trình, nhân sự/phòng/thông báo/audit | Luồng chính và lỗi quyền/xung đột | Invitation, quyền con Manager, phòng, email còn một phần ở BE |

## Test case FE

| ID | Nhóm kiểm thử | Mô tả Test Case | Tiền điều kiện (Preconditions) | Các bước thực hiện (Steps) | Dữ liệu đầu vào (Test Data) | Kết quả mong đợi (Expected Result) | Mức độ ưu tiên (Priority: P1/P2/P3) |
| --- | --- | --- | --- | --- | --- | --- | --- |
| AUTH-01 | Happy path, ST | Đăng nhập từng role web và điều hướng đúng | BE/FE QA hoạt động; 4 account web | Mở Login, nhập tài khoản, submit lần lượt trong phiên riêng | Manager, Staff, Teacher, Designer QA | Đăng nhập thành công; lần lượt tới dashboard Manager, ghi danh Staff, dashboard Teacher, giáo trình Designer | P1 |
| AUTH-02 | Quyền, DT | Parent không được vào portal web | Parent QA ACTIVE | Đăng nhập bằng Parent | `qa.parent@edugrade.local` | Thông báo web không hỗ trợ role Parent; không đặt phiên web; hướng dẫn dùng mobile | P1 |
| AUTH-03 | Negative, EP | Sai mật khẩu | Tài khoản tồn tại | Nhập email đúng, mật khẩu sai, submit | `WrongPass123!` | Hiển thị `AUTH_INVALID_CREDENTIALS`; không lộ email tồn tại hay không; không điều hướng | P1 |
| AUTH-04 | BVA, form | Email/mật khẩu trống, email sai định dạng | Trang Login | Lần lượt bỏ trống và nhập `bad`, blur/Enter/submit | `''`, `bad` | Lỗi inline theo trường; không gửi request khi client validation thất bại | P1 |
| AUTH-05 | BVA | Mật khẩu 7/8 ký tự, 72/73 byte UTF-8 | Login/Register | Nhập từng giá trị biên và submit | 7, 8, 72, 73 byte | FE/BE thống nhất giới hạn; 73 byte bị chặn rõ ràng, không cắt âm thầm | P1 |
| AUTH-06 | API 401, ST | Phiên hết hạn khi mở màn bảo vệ | Đăng nhập web; token bị hết hạn/thu hồi | Mở màn quyền riêng, tải lại | 401 `AUTH_UNAUTHORIZED` hoặc `AUTH_INVALID_REFRESH_TOKEN` | Hiện modal/điều hướng Login; không lặp refresh vô hạn; dữ liệu nhạy cảm không còn thấy | P1 |
| AUTH-07 | API 403 | User đổi URL sang màn ngoài quyền | Đăng nhập Staff/Teacher | Nhập URL Manager | `/manager/dashboard` | Trả trang 403; không rò dữ liệu Manager | P1 |
| AUTH-08 | Form/API | Double-click submit Login | Trang Login, API bị làm chậm | Nhấp nút 2 lần hoặc Enter nhiều lần | Trễ 2 giây | Nút disabled/loading; tối đa một thao tác login logic; không hiện nhiều toast | P2 |
| AUTH-09 | Browser state | Reload sau login và Back về Login | Đăng nhập thành công | F5, Back, Forward | Account Manager | Giữ phiên hợp lệ; không lộ form Login như đang chưa đăng nhập; logout thực sự thu hồi phiên | P1 |
| AUTH-10 | API lifecycle | Timeout/mất mạng khi login | Mock API timeout/offline | Submit login | Timeout, offline, 500 | Thông báo hữu ích; dừng loading; có thể thử lại, không báo đăng nhập thành công | P1 |
| PAR-01 | Happy path | Đăng ký Parent mới | Email chưa tồn tại | Mở Register, nhập hợp lệ, submit | Email QA mới, mật khẩu hợp lệ | Chỉ báo hoàn thành khi BE tạo tài khoản; thông báo tiếp tục trên mobile; không tạo phiên web | P1 |
| PAR-02 | Negative, EP | Đăng ký email đã tồn tại | Parent QA có sẵn | Đăng ký cùng email | `qa.parent@edugrade.local` | Hiển thị `AUTH_EMAIL_EXISTS` rõ ràng; không tạo user thứ hai | P1 |
| PAR-03 | Form/BVA | Email rỗng/sai, password 7/8/73 byte, chuỗi dài | Trang Register | Nhập từng phân vùng, blur/submit | `bad`, 7/8/73 byte, >255 ký tự | Chặn dữ liệu sai ở FE; lỗi inline đúng trường; không gửi request không hợp lệ | P1 |
| PAR-04 | Security | XSS trong trường email và thông báo BE | Trang Register | Nhập payload; mô phỏng lỗi BE chứa payload | `<script>alert(1)</script>` | Payload hiển thị như text hoặc bị từ chối; không chạy script | P1 |
| PAR-05 | API lifecycle | Register 429, 500, timeout và retry | Mock từng phản hồi | Submit form | 429, 500, timeout | Thông báo tương ứng; không gửi trùng khi loading; retry không tạo tài khoản trùng | P1 |
| PAR-06 | Browser state | F5/Back ở form Register | Đã nhập nhưng chưa submit | Reload, Back, Forward | Email chưa gửi | Hành vi giữ/xóa form nhất quán, không tự submit; password không lưu ngoài ý muốn | P2 |
| ST-01 | Happy path | Tra cứu Parent và chọn hồ sơ con | Staff đăng nhập; Parent QA | Tìm email, mở hồ sơ | `qa.parent@edugrade.local` | Đúng Parent và 2 hồ sơ con; không hiển thị dữ liệu Parent khác | P1 |
| ST-02 | Empty/search | Tìm Parent không tồn tại và debounce | Staff đăng nhập | Gõ liên tục, xóa từ khóa | `qa.none@edugrade.local` | Empty state rõ; số request không tăng theo mỗi phím; xóa tìm kiếm khôi phục danh sách | P2 |
| ST-03 | Happy path, ST | Tạo đăng ký nháp rồi xem bill | Staff đăng nhập; lớp mở còn chỗ | Chọn Parent, con, lớp, ngày đúng lịch, gói; tạo đăng ký | `qa-class-open`, gói 3 tháng | Bill 1.500.000 đ và trạng thái DRAFT; dữ liệu khớp BE/DB, không trừ sĩ số trước xác nhận | P1 |
| ST-04 | DT | Chặn ghi danh lớp đóng/đầy/sai khối | Staff đăng nhập | Lần lượt chọn các lớp/HS tương ứng | `qa-class-closed`, `qa-class-full`, khối 7 | Hiển thị `CLASS_CLOSED`/`CLASS_FULL`/`CLASS_GRADE_MISMATCH`; không tạo payment/enrollment | P1 |
| ST-05 | BVA/date | Ngày bắt đầu trước hôm nay, sai thứ học, qua ranh giới tháng | Staff đăng nhập | Nhập từng ngày và xem giá tiền/kỳ | Thứ khác thứ 7, ngày quá khứ | Lỗi `INVALID_START_DATE`; không lệch ngày do timezone Asia/Bangkok; tính kỳ và tiền nhất quán | P1 |
| ST-06 | ST/idempotency | Xác nhận thu tiền hai lần | Có bill DRAFT riêng | Nhấp xác nhận liên tiếp/reload và gửi lại | Cùng Idempotency-Key | Một payment, một enrollment, một biên lai; FE hiện trạng thái cuối và không thu trùng | P1 |
| ST-07 | Xung đột | Bill cũ sau khi lớp thay đổi | Bill DRAFT riêng; lớp được sửa | Mở lại bill rồi xác nhận | `BILL_CLASS_CHANGED` | FE yêu cầu lập bill mới; không xác nhận tiền sai | P1 |
| ST-08 | Lỗi 400/409 | Đăng ký trùng lớp hoặc lịch học sinh trùng | Học sinh có enrollment | Tạo đăng ký trùng | `qa-student-active` | Hiện `DUPLICATE_CLASS_REGISTRATION`/`STUDENT_SCHEDULE_CONFLICT`; giữ form để sửa | P1 |
| ST-09 | API lifecycle | Lỗi 401/403/500/timeout khi ghi danh | Mock từng phản hồi | Submit form | 401, 403, 500, timeout | 401 về Login; 403 nêu không có quyền; 500/timeout giữ dữ liệu và cho retry an toàn | P1 |
| ST-10 | Empty/browser | Danh sách thanh toán rỗng, filter và F5/Back | Staff đăng nhập | Lọc mã không có, reload, Back | Mã bill không tồn tại | Empty state; query/filter/pagination nhất quán sau F5/Back | P2 |
| ST-11 | ST | Xin nghỉ → duyệt/từ chối → học bù | Có enrollment và buổi phù hợp | Gửi đơn, chuyển trạng thái, đặt/hủy học bù | QA session/participant riêng | Trạng thái, chỗ ngồi và lịch khớp BE; không đặt trùng target; lỗi được nêu rõ | P1 |
| ST-12 | ST | Chuyển lớp, kết thúc học, học lại | Có enrollment QA riêng | Thực hiện từng lệnh, tải lại | Ngày hiệu lực tương lai | Placement/enrollment đúng mốc ngày; roster và lịch đổi tương ứng | P1 |
| TEA-01 | Happy path | Teacher xem lớp và lịch đã gán | Teacher đăng nhập | Vào dashboard/lớp/lịch | `qa-class-open`, `qa-session-future` | Chỉ thấy lớp/buổi được gán; giờ hiển thị đúng Asia/Bangkok | P1 |
| TEA-02 | ST | Prepare roster và chốt điểm danh | Buổi đã kết thúc có học viên QA | Mở roster, chọn PRESENT/ABSENT/EXCUSED, chốt | Buổi quá khứ QA riêng | Chốt đúng quy tắc; `INCOMPLETE_ATTENDANCE`, `EXCUSED_REQUIRES_LEAVE`, `SESSION_NOT_FINISHED` hiện rõ khi xảy ra | P1 |
| TEA-03 | ST | Tạo, phát và đóng bài tập | Teacher có lớp QA | Tạo draft, thêm câu, publish, close | `qa-class-open` | Trạng thái DRAFT → PUBLISHED → CLOSED; dữ liệu được lưu và hiển thị sau F5 | P1 |
| TEA-04 | BVA/form | Điểm âm, vượt max, thập phân và làm tròn | Có submission QA | Chấm với các giá trị biên | -1, 0, max, max+0.01 | FE/BE chặn ngoài biên; tổng điểm và định dạng nhất quán; không công bố nhầm bản DRAFT | P1 |
| TEA-05 | API lỗi/quyền | Teacher sửa lớp/bài của người khác hoặc bài đã khóa | Teacher đăng nhập | Mở URL/submit thao tác sai quyền/trạng thái | 403, `ASSIGNMENT_LOCKED` | Không rò/sửa dữ liệu; nêu lỗi và đưa về trạng thái hợp lệ | P1 |
| TEA-06 | Feedback/report | Gửi feedback bài học, xem báo cáo | Có lesson QA | Gửi feedback, lọc report | `qa-lesson-approved` | Lưu đúng lesson/teacher; report empty/error/download thể hiện đúng | P2 |
| DES-01 | Happy path, ST | Soạn nháp và gửi duyệt | Designer đăng nhập | Mở draft, thêm bài, gửi duyệt | `qa-unit-draft` trên bản ghi QA riêng | DRAFT → PENDING_REVIEW, revision tăng; nút sửa thay đổi theo trạng thái | P1 |
| DES-02 | BVA/CSV | CSV rỗng, sai header, quote, UTF-8, quá dung lượng/dòng | Designer đăng nhập | Preview từng file; chỉ commit preview hợp lệ | 0/1/1000/1001 dòng, 5 MiB ±1 byte | Lỗi cụ thể theo dòng; không commit file sai; không mất nháp | P1 |
| DES-03 | Xung đột | Dùng preview hết hạn hoặc revision cũ | Draft bị sửa ở phiên khác | Commit/gửi duyệt bằng snapshot cũ | `IMPORT_PREVIEW_STALE`, `REVISION_CONFLICT` | FE yêu cầu xem trước/tải lại, giữ dữ liệu chưa gửi và tránh ghi đè | P1 |
| DES-04 | Quyền/ST | Sửa bản APPROVED, người khác sửa draft | Designer đăng nhập | Mở unit approved và thao tác sửa | `qa-unit-approved`, `UNIT_LOCKED` | Không cho sửa trực tiếp; hướng dẫn tạo revision mới; không thay nội dung approved | P1 |
| DES-05 | Empty/browser | Lọc giáo trình theo trạng thái và F5/Back | Có 3 unit QA | Chọn filter, reload, Back | DRAFT/PENDING/APPROVED | Danh sách đúng trạng thái; URL và tab/filter được khôi phục nhất quán | P2 |
| MGR-01 | Happy path | Dashboard đối chiếu số liệu QA | Manager đăng nhập | Mở dashboard và đổi khoảng ngày | DB QA có 1 payment, 1 enrollment | Tổng tiền/số lượng đúng khoảng ngày; không đếm bản nháp như đã thu | P1 |
| MGR-02 | Catalog/EP | Tạo/sửa/ngừng môn và khóa | Manager đăng nhập | Thao tác bản ghi QA riêng | Mã trùng, tên trống/dài, môn đã dùng | Lỗi inline; `SUBJECT_IN_USE`/`PROGRAM_IN_USE` không làm mất dữ liệu đã sử dụng | P1 |
| MGR-03 | Lớp/ST | Mở/đóng lớp, sửa lịch tuần trước và sau enrollment | Manager đăng nhập | Sửa lớp QA tự do, rồi lớp đã dùng | `qa-class-full`, `CLASS_SCHEDULE_LOCKED` | Cho sửa khi hợp lệ; chặn lớp đã khóa và giải thích lý do | P1 |
| MGR-04 | BVA/DT | Sức chứa, học phí, giờ lịch và trùng phòng/giáo viên | Manager đăng nhập | Nhập min/max/âm/thập phân, lịch chồng nhau | -1, 0, 1, giờ kết thúc ≤ bắt đầu | FE/BE chặn dữ liệu sai; VND làm tròn đúng; lỗi xung đột dễ sửa | P1 |
| MGR-05 | ST | Duyệt/yêu cầu sửa giáo trình | Manager đăng nhập; unit pending | Approve hoặc request changes trên bản riêng | `qa-unit-review` | PENDING_REVIEW → APPROVED/DRAFT theo contract; audit/revision và quyền đúng | P1 |
| MGR-06 | Lịch/ST | Preview, generate, đổi/hủy buổi | Class/unit QA hợp lệ riêng | Preview rồi generate; sửa/hủy buổi tương lai | previewId, expectedRevision, Idempotency-Key | Không sinh/đổi trùng; lỗi `PREVIEW_STALE`, `SESSION_LOCKED`, `SESSION_HAS_DEPENDENCIES` hiện rõ | P1 |
| MGR-07 | Nhân sự/quyền | Tạo Staff/Teacher, mời/review Manager/Teacher | Manager đăng nhập | Tạo/mời/review, thử email trùng | Email QA riêng | Trạng thái và quyền đúng; lỗi invitation/permission hiện rõ; mục BE một phần ghi Blocked nếu thiếu | P1 |
| MGR-08 | Phòng/lịch | Phòng không đủ sức chứa hoặc đã dùng | Manager đăng nhập | Chọn phòng, sửa capacity, ngừng phòng | `qa-room-1`, capacity thấp | `ROOM_CAPACITY_TOO_SMALL`, `ROOM_IN_USE` hiện đúng; không lưu trạng thái sai | P1 |
| MGR-09 | Thông báo/email | Gửi thông báo, xem delivery và retry | Manager đăng nhập | Gửi bản QA, lọc trạng thái, retry lỗi | `EMAIL_NOT_CONFIGURED`, `EMAIL_RETRY_EXHAUSTED` | Không báo gửi thành công khi BE chưa gửi; trạng thái queue/sent/failed rõ | P1 |
| MGR-10 | Audit/Browser | Lọc audit, F5, Back/Forward | Manager đăng nhập | Lọc actor/date/action rồi reload/Back | QA actor | Filter giữ đúng; empty state và lỗi API không xóa dữ liệu hiển thị trước đó sai cách | P2 |
| ERR-01 | API lifecycle | Mỗi mã lỗi BE có màn FE: kiểm tra message, hành động phục hồi và requestId | Ma trận lỗi bên dưới; mock response có status/envelope chuẩn | Kích hoạt từng mã theo endpoint; so sánh UI sau lỗi | `{success:false,error:{code,message,requestId,details}}` | Lỗi hiện ở đúng trường/toast/modal; không lộ raw stack; trạng thái form không bị mất; requestId xem được khi lỗi hệ thống | P1 |
| ERR-02 | API lifecycle | Envelope lỗi/response hỏng, body rỗng, HTML, JSON thiếu `data` | FE BFF/mocking | Trả lần lượt các dạng response | HTML 404, JSON sai contract, null | FE không crash; nêu lỗi kết nối/contract phù hợp và không báo thành công | P1 |
| ERR-03 | Network | Offline, timeout 25/60 giây và retry | Màn có API | Ngắt mạng/chặn endpoint rồi retry | Network offline/timeout | Loading kết thúc; retry có thể dùng; thao tác ghi không nhân đôi sau phục hồi | P1 |
| ERR-04 | 429/409 | Rate limit, xung đột cập nhật và double submit | Màn có command | Gửi nhiều lần/tạo sửa đồng thời | 429, `REVISION_CONFLICT`, `IDEMPOTENCY_CONFLICT` | Thông báo chờ hoặc reload/preview lại; không tự retry command không idempotent | P1 |
| ERR-05 | Empty/state | GET trả `[]`, null hoặc thiếu trường tùy contract | Màn danh sách từng role | Mock các response; reload và Back | `[]`, null, missing field | Empty state khi hợp lệ; response sai contract thành lỗi, không render dữ liệu giả | P2 |

## Kết quả đã chạy

| Case/kiểm tra | Kết quả | Bằng chứng ngắn |
| --- | --- | --- |
| DB QA | Pass | 16 migration; 6 users, 2 students, 2 subjects, 2 programs, 3 classes, 3 units, 5 lessons, 1 session, 1 assignment, 2 orders, 1 payment, 1 enrollment |
| AUTH-01 qua BFF | Pass | Manager/Staff/Teacher/Designer đều HTTP 200 và redirect đúng route |
| AUTH-01 qua giao diện 4 role web | Pass | Manager vào `/manager/dashboard`; Designer vào `/manager/curriculum` và thấy 3 trạng thái unit; Staff vào `/staff/enrollments/new`; Teacher vào `/teacher/dashboard` và thấy 3 lớp phụ trách |
| AUTH-02 qua BFF và UI | Pass | Parent nhận HTTP 403 `WEB_ROLE_UNSUPPORTED`; UI nêu rõ Parent dùng ứng dụng di động |
| AUTH-03 qua BFF | Pass | Sai mật khẩu nhận HTTP 401 `AUTH_INVALID_CREDENTIALS` |
| PAR-02 qua BFF và UI | Pass | Đăng ký trùng email nhận HTTP 409 `AUTH_EMAIL_EXISTS`; UI hiện thông báo tiếng Việt và mã yêu cầu |
| PAR-03 qua BFF | Pass một phần | Email `bad` nhận HTTP 400 `VALIDATION_ERROR`; chưa chạy đủ các giá trị biên trên UI |
| AUTH-06 qua BFF | Pass một phần | `GET subjects` không có cookie nhận HTTP 401 `AUTH_UNAUTHORIZED`; chưa kiểm tra modal và refresh trên UI |
| AUTH-07 qua route FE | Pass một phần | Staff login HTTP 200, mở `/manager/dashboard` nhận HTTP 403; chưa kiểm tra trang 403 bằng browser |
| PAR-01 qua UI và DB | Pass | FE báo đã tạo `qa.newparent.20261013@edugrade.local`; DB có user PARENT ACTIVE, parent profile và email chưa xác minh; UI hướng dẫn xác minh trên ứng dụng |
| MGR-03 danh sách lớp | Pass một phần | UI hiển thị đủ 3 lớp QA; tìm chuỗi không có kết quả cho empty state và ghi `search` vào URL |
| MGR-10/F5 filter lớp | Pass một phần | Reload giữ `search` trong URL và input; chưa xác nhận toàn bộ Back/Forward |
| ST-01 qua UI | Pass một phần | Staff tìm `qa.parent@edugrade.local`, chọn Parent; danh sách chọn con chỉ có hồ sơ ACTIVE, sau đó thấy 3 lớp QA để chọn. Chưa tạo đăng ký mới |
| TEA-01 qua UI | Pass một phần | Teacher dashboard hiển thị 3 lớp phụ trách, 0 buổi hôm nay; chưa mở lịch chi tiết |
| Lỗi cấu hình FE ban đầu | Fail, đã cô lập để test | FE và BE cùng cổng 3000; BFF đăng nhập trả HTTP 502 `INVALID_API_RESPONSE` vì nhận HTML 404 từ chính FE. FE QA hiện chạy với BE ở 3001; `.env` FE còn trỏ 3000 |
| Các case còn lại | Chưa chạy | Cần thực hiện từng luồng trên UI/API với dữ liệu riêng và mock lỗi theo ma trận; không được tính Pass |

## Bug và giới hạn đã xác nhận

| ID | Mức | Mô tả, bước tái hiện và kết quả | Kỳ vọng |
| --- | --- | --- | --- |
| BUG-01 | P1 | Với FE và BE đều cấu hình cổng 3000, FE tự gọi `http://localhost:3000/api/v1`; login/register trả `INVALID_API_RESPONSE`. Tái hiện: chạy FE ở 3000 theo `.env` FE, mở Register/Login và submit. | Tách cổng FE/BE và cấu hình `BACKEND_API_URL` đúng; có kiểm tra cấu hình khi khởi động. Đây là lỗi môi trường, không kết luận là bug logic FE. |
| GAP-01 | P1 | BE có luồng Parent nhưng FE web chỉ có Register; Parent login trả `WEB_ROLE_UNSUPPORTED`. | Test hồ sơ con/lịch Parent trên mobile; không đánh dấu FE web đã cover. |
| GAP-02 | P1 | BE có các nhóm còn một phần trong `BUSINESS_LOGIC_IMPLEMENTATION_STATUS.md`: invitation, quyền con Manager, email, room, teacher queue/progress, một số nghỉ/học bù. | Chỉ kết luận riêng luồng chính đã chạy; case phụ thuộc API thiếu được đánh dấu Blocked. |

## Ma trận lỗi BE–FE

Phụ lục bên dưới liệt kê mã lỗi tĩnh từ `new AppError`, `this.assert`, `assertRule`, các nhánh trả lỗi gián tiếp và exception filter trong `src`. Cột “Có chuỗi FE” chỉ nói mã có trong `ERROR_TEXT` của FE, **không chứng minh** màn hình xử lý đúng. Mã được tạo động, lỗi do thư viện/validator và một số mã nội bộ CSV phải được kiểm tra thêm qua API thực tế. Với mọi mã **chưa có chuỗi FE**, FE đang fallback sang `message` tiếng Anh từ BE hoặc thông báo chung; cần chạy `ERR-01` trên màn liên quan để xác nhận và tạo bug khi trải nghiệm không đạt.

<!-- BE_ERROR_MATRIX_START -->
**Tổng:** 190 mã lỗi BE được tìm thấy; 139 mã có chuỗi FE; 51 mã chưa có chuỗi FE.

| Mã lỗi BE | Nguồn phát sinh | Có chuỗi FE | Trạng thái kiểm thử UI |
| --- | --- | --- | --- |
| `ABSENCE_NOT_APPROVED` | `academic/enrollment-workflows.service.ts` | Có | Chưa chạy theo mã |
| `ACCOUNT_NOT_FOUND` | `directory/directory.service.ts` | Chưa | Chưa chạy theo mã |
| `ACCOUNT_TOKEN_INVALID` | `academic/email-deliveries.service.ts` | Chưa | Chưa chạy theo mã |
| `AI_ATTACHMENTS_UNSUPPORTED` | `academic/grading-worker.service.ts` | Có | Chưa chạy theo mã |
| `ANALYTICS_TOO_LARGE` | `academic/analytics.service.ts` | Chưa | Chưa chạy theo mã |
| `ANSWERS_ALREADY_VISIBLE` | `academic/assessment.service.ts` | Có | Chưa chạy theo mã |
| `ASSIGNMENT_LOCKED` | `academic/assessment.service.ts` | Có | Chưa chạy theo mã |
| `ASSIGNMENT_NOT_CLOSED` | `academic/assessment.service.ts` | Có | Chưa chạy theo mã |
| `ATTEMPTS_EXHAUSTED` | `academic/assessment.service.ts` | Chưa | Chưa chạy theo mã |
| `ATTENDANCE_TOO_LARGE` | `academic/enrollment-workflows.service.ts` | Có | Chưa chạy theo mã |
| `AUTH_CURRENT_PASSWORD_INVALID` | `auth/auth.service.ts` | Có | Chưa chạy theo mã |
| `AUTH_EMAIL_EXISTS` | `users/users.service.ts` | Có | Chưa chạy theo mã |
| `AUTH_INVALID_CREDENTIALS` | `auth/auth.service.ts` | Có | Chưa chạy theo mã |
| `AUTH_INVALID_EMAIL_TOKEN` | `auth/auth.service.ts` | Chưa | Chưa chạy theo mã |
| `AUTH_INVALID_REFRESH_TOKEN` | `auth/auth.service.ts` | Có | Chưa chạy theo mã |
| `AUTH_INVALID_RESET_TOKEN` | `auth/auth.service.ts` | Có | Chưa chạy theo mã |
| `AUTH_PASSWORD_TOO_LONG` | `auth/auth.service.ts` | Có | Chưa chạy theo mã |
| `AUTH_UNAUTHORIZED` | `common/guards/jwt-auth.guard.ts` | Có | Chưa chạy theo mã |
| `BILL_CLASS_CHANGED` | `registration-flow/registration-flow.service.ts` | Có | Chưa chạy theo mã |
| `BILL_NOT_FOUND` | `registration-flow/registration-flow.service.ts` | Có | Chưa chạy theo mã |
| `CLASS_CLOSED` | `registration-flow/registration-flow.service.ts` | Có | Chưa chạy theo mã |
| `CLASS_FULL` | `academic/enrollment-workflows.service.ts` | Có | Chưa chạy theo mã |
| `CLASS_GRADE_MISMATCH` | `registration-flow/registration-flow.service.ts` | Có | Chưa chạy theo mã |
| `CLASS_INACTIVE` | `registration-flow/registration-flow.service.ts` | Có | Chưa chạy theo mã |
| `CLASS_IN_USE` | `registration-flow/registration-flow.service.ts` | Có | Chưa chạy theo mã |
| `CLASS_NEEDS_SCHEDULE` | `registration-flow/registration-flow.service.ts` | Có | Chưa chạy theo mã |
| `CLASS_NOT_FOUND` | `academic/analytics.service.ts` | Có | Chưa chạy theo mã |
| `CLASS_SCHEDULE_CONFLICT` | `registration-flow/registration-flow.service.ts` | Có | Chưa chạy theo mã |
| `CLASS_SCHEDULE_LOCKED` | `registration-flow/registration-flow.service.ts` | Có | Chưa chạy theo mã |
| `CLASS_TEACHER_LOCKED` | `registration-flow/registration-flow.service.ts` | Có | Chưa chạy theo mã |
| `CSV_INVALID` | `curriculum-scheduling/curriculum-scheduling.service.ts` | Có | Chưa chạy theo mã |
| `CSV_REQUIRED` | `curriculum-scheduling/curriculum-scheduling.service.ts` | Chưa | Chưa chạy theo mã |
| `CURRICULUM_MISMATCH` | `curriculum-scheduling/curriculum-scheduling.service.ts` | Có | Chưa chạy theo mã |
| `DATE_RANGE_TOO_LONG` | `curriculum-scheduling/curriculum-scheduling.service.ts` | Có | Chưa chạy theo mã |
| `DUPLICATE_CLASS_REGISTRATION` | `registration-flow/registration-flow.service.ts` | Có | Chưa chạy theo mã |
| `EMAIL_ALREADY_SENT` | `academic/email-deliveries.service.ts` | Có | Chưa chạy theo mã |
| `EMAIL_DELIVERY_BUSY` | `academic/email-deliveries.service.ts` | Có | Chưa chạy theo mã |
| `EMAIL_DELIVERY_FAILED` | `academic/email-deliveries.service.ts` | Chưa | Chưa chạy theo mã |
| `EMAIL_DELIVERY_NOT_FOUND` | `academic/email-deliveries.service.ts` | Có | Chưa chạy theo mã |
| `EMAIL_NOT_CONFIGURED` | `academic/email-deliveries.service.ts` | Có | Chưa chạy theo mã |
| `EMAIL_RETRY_EXHAUSTED` | `academic/email-deliveries.service.ts` | Có | Chưa chạy theo mã |
| `EMPTY_CURRICULUM` | `curriculum-scheduling/curriculum-scheduling.service.ts` | Có | Chưa chạy theo mã |
| `ENROLLMENT_ENDED` | `academic/enrollment-workflows.service.ts` | Có | Chưa chạy theo mã |
| `ENROLLMENT_NOT_FOUND` | `academic/academic-access.service.ts` | Chưa | Chưa chạy theo mã |
| `ESSAY_REQUIRES_REVIEW` | `academic/assessment.service.ts` | Có | Chưa chạy theo mã |
| `EXCUSED_REQUIRES_LEAVE` | `academic/enrollment-workflows.service.ts` | Có | Chưa chạy theo mã |
| `FORBIDDEN` | `academic/catalog.service.ts` | Có | Chưa chạy theo mã |
| `FUTURE_CLASS_FULL` | `academic/enrollment-workflows.service.ts` | Có | Chưa chạy theo mã |
| `GENERATION_NOT_FOUND` | `curriculum-scheduling/curriculum-scheduling.service.ts` | Chưa | Chưa chạy theo mã |
| `GRADE_NOT_APPROVED` | `academic/assessment.service.ts` | Có | Chưa chạy theo mã |
| `HTTP_ERROR` | `common/filters/all-exceptions.filter.ts` | Chưa | Chưa chạy theo mã |
| `IDEMPOTENCY_CONFLICT` | `curriculum-scheduling/curriculum-scheduling.service.ts` | Có | Chưa chạy theo mã |
| `IDEMPOTENCY_KEY_CONFLICT` | `registration-flow/registration-flow.service.ts` | Có | Chưa chạy theo mã |
| `IDEMPOTENCY_KEY_REQUIRED` | `registration-flow/registration-flow.service.ts` | Có | Chưa chạy theo mã |
| `IMPORT_PREVIEW_STALE` | `curriculum-scheduling/curriculum-scheduling.service.ts` | Có | Chưa chạy theo mã |
| `INCOMPLETE_ATTENDANCE` | `academic/enrollment-workflows.service.ts` | Có | Chưa chạy theo mã |
| `INSUFFICIENT_LESSONS` | `curriculum-scheduling/curriculum-scheduling.service.ts` | Có | Chưa chạy theo mã |
| `INTERNAL_ERROR` | `common/filters/all-exceptions.filter.ts` | Có | Chưa chạy theo mã |
| `INVALID_AI_REPORT` | `academic/reports.service.ts` | Chưa | Chưa chạy theo mã |
| `INVALID_AI_RESULT` | `academic/grading-worker.service.ts` | Chưa | Chưa chạy theo mã |
| `INVALID_ANALYTICS_RANGE` | `academic/analytics.service.ts` | Chưa | Chưa chạy theo mã |
| `INVALID_ANSWERS` | `academic/assessment.service.ts` | Chưa | Chưa chạy theo mã |
| `INVALID_ANSWER_KEY` | `academic/assessment.service.ts` | Chưa | Chưa chạy theo mã |
| `INVALID_ASSIGNMENT_STATE` | `academic/assessment.service.ts` | Có | Chưa chạy theo mã |
| `INVALID_CHOICE` | `academic/assessment.service.ts` | Chưa | Chưa chạy theo mã |
| `INVALID_CONTENT` | `curriculum-scheduling/curriculum-scheduling.service.ts` | Chưa | Chưa chạy theo mã |
| `INVALID_DATE` | `academic/enrollment-workflows.service.ts` | Có | Chưa chạy theo mã |
| `INVALID_DATE_RANGE` | `directory/directory.service.ts` | Có | Chưa chạy theo mã |
| `INVALID_DESIGNER` | `academic/catalog.service.ts` | Chưa | Chưa chạy theo mã |
| `INVALID_DUE_DATE` | `academic/assessment.service.ts` | Có | Chưa chạy theo mã |
| `INVALID_EFFECTIVE_DATE` | `academic/enrollment-workflows.service.ts` | Có | Chưa chạy theo mã |
| `INVALID_FILES` | `academic/assessment.service.ts` | Chưa | Chưa chạy theo mã |
| `INVALID_FILE_SIZE` | `integrations/academic-storage.service.ts` | Chưa | Chưa chạy theo mã |
| `INVALID_FILE_TYPE` | `integrations/academic-storage.service.ts` | Chưa | Chưa chạy theo mã |
| `INVALID_FILTER` | `academic/analytics.service.ts` | Chưa | Chưa chạy theo mã |
| `INVALID_FORMAT` | `academic/reports.service.ts` | Chưa | Chưa chạy theo mã |
| `INVALID_GRADE_STATE` | `academic/assessment.service.ts` | Có | Chưa chạy theo mã |
| `INVALID_IMPORT` | `curriculum-scheduling/curriculum-scheduling.service.ts` | Chưa | Chưa chạy theo mã |
| `INVALID_IMPORT_MODE` | `curriculum-scheduling/curriculum-scheduling.service.ts` | Chưa | Chưa chạy theo mã |
| `INVALID_KIND` | `curriculum-scheduling/curriculum-scheduling.service.ts` | Chưa | Chưa chạy theo mã |
| `INVALID_LEAVE` | `academic/enrollment-workflows.service.ts` | Chưa | Chưa chạy theo mã |
| `INVALID_LEAVE_DATE` | `academic/enrollment-workflows.service.ts` | Có | Chưa chạy theo mã |
| `INVALID_LEAVE_STATE` | `academic/enrollment-workflows.service.ts` | Có | Chưa chạy theo mã |
| `INVALID_LESSON` | `academic/catalog.service.ts` | Chưa | Chưa chạy theo mã |
| `INVALID_LESSON_ORDER` | `curriculum-scheduling/curriculum-scheduling.service.ts` | Chưa | Chưa chạy theo mã |
| `INVALID_MAKEUP_SOURCE` | `academic/enrollment-workflows.service.ts` | Có | Chưa chạy theo mã |
| `INVALID_MAKEUP_TARGET` | `academic/enrollment-workflows.service.ts` | Có | Chưa chạy theo mã |
| `INVALID_MONTH` | `curriculum-scheduling/curriculum-scheduling.service.ts` | Chưa | Chưa chạy theo mã |
| `INVALID_RECIPIENTS` | `academic/assessment.service.ts` | Có | Chưa chạy theo mã |
| `INVALID_REFERENCE` | `academic/academic-errors.filter.ts` | Chưa | Chưa chạy theo mã |
| `INVALID_REGISTRATION` | `registration-flow/registration-flow.service.ts` | Chưa | Chưa chạy theo mã |
| `INVALID_REMINDER_RANGE` | `academic/announcements.service.ts` | Chưa | Chưa chạy theo mã |
| `INVALID_REPORT_RANGE` | `academic/reports.service.ts` | Có | Chưa chạy theo mã |
| `INVALID_REPORT_SNAPSHOT` | `academic/analytics.service.ts` | Chưa | Chưa chạy theo mã |
| `INVALID_RESOLUTION` | `academic/catalog.service.ts` | Chưa | Chưa chạy theo mã |
| `INVALID_ROOM` | `academic/catalog.service.ts` | Có | Chưa chạy theo mã |
| `INVALID_SCHEDULE_TIME` | `registration-flow/registration-flow.service.ts` | Có | Chưa chạy theo mã |
| `INVALID_SCORES` | `academic/assessment.service.ts` | Có | Chưa chạy theo mã |
| `INVALID_SEQUENCE` | `curriculum-scheduling/curriculum-scheduling.service.ts` | Chưa | Chưa chạy theo mã |
| `INVALID_SESSION` | `academic/enrollment-workflows.service.ts` | Có | Chưa chạy theo mã |
| `INVALID_SESSION_TIME` | `academic/catalog.service.ts` | Có | Chưa chạy theo mã |
| `INVALID_START_DATE` | `registration-flow/registration-flow.service.ts` | Có | Chưa chạy theo mã |
| `INVALID_SUBMISSION_WINDOW` | `academic/assessment.service.ts` | Có | Chưa chạy theo mã |
| `INVALID_TEACHER` | `academic/catalog.service.ts` | Có | Chưa chạy theo mã |
| `INVALID_TITLE` | `curriculum-scheduling/curriculum-scheduling.service.ts` | Chưa | Chưa chạy theo mã |
| `INVALID_TRANSFER_CLASS` | `academic/enrollment-workflows.service.ts` | Có | Chưa chạy theo mã |
| `INVALID_TRANSFER_DATE` | `academic/enrollment-workflows.service.ts` | Có | Chưa chạy theo mã |
| `INVITATION_EXISTS` | `directory/directory.service.ts` | Có | Chưa chạy theo mã |
| `INVITATION_INVALID` | `directory/directory.service.ts` | Có | Chưa chạy theo mã |
| `INVITATION_LOCKED` | `directory/directory.service.ts` | Có | Chưa chạy theo mã |
| `INVITATION_NOT_ACCEPTED` | `directory/directory.service.ts` | Có | Chưa chạy theo mã |
| `INVITATION_NOT_FOUND` | `directory/directory.service.ts` | Có | Chưa chạy theo mã |
| `LEAVE_HAS_ACTIVITY` | `academic/enrollment-workflows.service.ts` | Có | Chưa chạy theo mã |
| `LEAVE_OVERLAP` | `academic/enrollment-workflows.service.ts` | Có | Chưa chạy theo mã |
| `LESSON_IN_USE` | `curriculum-scheduling/curriculum-scheduling.service.ts` | Có | Chưa chạy theo mã |
| `LESSON_NOT_APPROVED` | `curriculum-scheduling/curriculum-scheduling.service.ts` | Có | Chưa chạy theo mã |
| `LESSON_NOT_FOUND` | `curriculum-scheduling/curriculum-scheduling.service.ts` | Có | Chưa chạy theo mã |
| `LESSON_SEQUENCE_GAP` | `curriculum-scheduling/curriculum-scheduling.service.ts` | Có | Chưa chạy theo mã |
| `MAKEUP_BOOKING_EXISTS` | `curriculum-scheduling/curriculum-scheduling.service.ts` | Có | Chưa chạy theo mã |
| `MAKEUP_LOCKED` | `academic/enrollment-workflows.service.ts` | Có | Chưa chạy theo mã |
| `MAKEUP_SOURCE_ABSENT` | `academic/enrollment-workflows.service.ts` | Có | Chưa chạy theo mã |
| `MAKEUP_TARGET_OCCUPIED` | `academic/enrollment-workflows.service.ts` | Có | Chưa chạy theo mã |
| `MISSING_MONTHLY_TEST` | `curriculum-scheduling/curriculum-scheduling.service.ts` | Có | Chưa chạy theo mã |
| `MONTH_CHANGE_NOT_SUPPORTED` | `curriculum-scheduling/curriculum-scheduling.service.ts` | Có | Chưa chạy theo mã |
| `NO_SESSIONS` | `curriculum-scheduling/curriculum-scheduling.service.ts` | Có | Chưa chạy theo mã |
| `OUTSIDE_ENROLLMENT` | `academic/enrollment-workflows.service.ts` | Có | Chưa chạy theo mã |
| `PARENT_DISABLED` | `registration-flow/registration-flow.service.ts` | Có | Chưa chạy theo mã |
| `PARENT_EMAIL_UNVERIFIED` | `registration-flow/registration-flow.service.ts` | Có | Chưa chạy theo mã |
| `PARENT_NOT_FOUND` | `directory/directory.service.ts` | Có | Chưa chạy theo mã |
| `PARENT_PROFILE_NOT_FOUND` | `directory/directory.service.ts` | Chưa | Chưa chạy theo mã |
| `PARTICIPANT_OUTSIDE_TERM` | `curriculum-scheduling/curriculum-scheduling.service.ts` | Có | Chưa chạy theo mã |
| `PREVIEW_STALE` | `curriculum-scheduling/curriculum-scheduling.service.ts` | Có | Chưa chạy theo mã |
| `PROFILE_PHONE_NOT_ALLOWED` | `auth/auth.service.ts` | Có | Chưa chạy theo mã |
| `PROGRAM_INACTIVE` | `registration-flow/registration-flow.service.ts` | Có | Chưa chạy theo mã |
| `PROGRAM_IN_USE` | `registration-flow/registration-flow.service.ts` | Có | Chưa chạy theo mã |
| `PROGRAM_NOT_FOUND` | `registration-flow/registration-flow.service.ts` | Có | Chưa chạy theo mã |
| `RANGE_OUTSIDE_UNIT` | `curriculum-scheduling/curriculum-scheduling.service.ts` | Có | Chưa chạy theo mã |
| `REASON_REQUIRED` | `registration-flow/registration-flow.service.ts` | Có | Chưa chạy theo mã |
| `RECEIPT_NOT_FOUND` | `registration-flow/registration-flow.service.ts` | Có | Chưa chạy theo mã |
| `REGISTRATION_NOT_DRAFT` | `registration-flow/registration-flow.service.ts` | Có | Chưa chạy theo mã |
| `REGISTRATION_NOT_FOUND` | `registration-flow/registration-flow.service.ts` | Có | Chưa chạy theo mã |
| `REPORTS_NOT_FOUND` | `academic/analytics.service.ts` | Chưa | Chưa chạy theo mã |
| `REPORT_TOO_LARGE` | `academic/reports.service.ts` | Chưa | Chưa chạy theo mã |
| `REQUEST_DECIDED` | `academic/enrollment-workflows.service.ts` | Chưa | Chưa chạy theo mã |
| `RESOURCE_CONFLICT` | `academic/academic-errors.filter.ts` | Có | Chưa chạy theo mã |
| `RESOURCE_NOT_FOUND` | `academic/academic-errors.filter.ts` | Có | Chưa chạy theo mã |
| `REVISION_CONFLICT` | `registration-flow/registration-flow.service.ts` | Có | Chưa chạy theo mã |
| `ROOM_CAPACITY_TOO_SMALL` | `registration-flow/registration-flow.service.ts` | Có | Chưa chạy theo mã |
| `ROOM_IN_USE` | `registration-flow/registration-flow.service.ts` | Có | Chưa chạy theo mã |
| `ROOM_NOT_FOUND` | `registration-flow/registration-flow.service.ts` | Có | Chưa chạy theo mã |
| `ROOM_SCHEDULE_CONFLICT` | `academic/catalog.service.ts` | Chưa | Chưa chạy theo mã |
| `ROSTER_MAKEUP_CONFLICT` | `academic/catalog.service.ts` | Chưa | Chưa chạy theo mã |
| `RUBRIC_REQUIRED` | `academic/assessment.service.ts` | Chưa | Chưa chạy theo mã |
| `SAME_MAKEUP_TARGET` | `academic/enrollment-workflows.service.ts` | Có | Chưa chạy theo mã |
| `SCHEDULE_CONFIRMED` | `registration-flow/registration-flow.service.ts` | Có | Chưa chạy theo mã |
| `SCHEDULE_CONFLICT` | `academic/catalog.service.ts` | Có | Chưa chạy theo mã |
| `SCHEDULE_NOT_FOUND` | `registration-flow/registration-flow.service.ts` | Chưa | Chưa chạy theo mã |
| `SESSION_FULL` | `academic/catalog.service.ts` | Có | Chưa chạy theo mã |
| `SESSION_HAS_DEPENDENCIES` | `curriculum-scheduling/curriculum-scheduling.service.ts` | Có | Chưa chạy theo mã |
| `SESSION_LOCKED` | `academic/catalog.service.ts` | Có | Chưa chạy theo mã |
| `SESSION_NOT_FINISHED` | `academic/enrollment-workflows.service.ts` | Có | Chưa chạy theo mã |
| `SESSION_NOT_FOUND` | `academic/academic-access.service.ts` | Có | Chưa chạy theo mã |
| `SESSION_ORDER_CONFLICT` | `curriculum-scheduling/curriculum-scheduling.service.ts` | Có | Chưa chạy theo mã |
| `STUDENT_GRADE_LOCKED` | `registration-flow/registration-flow.service.ts` | Chưa | Chưa chạy theo mã |
| `STUDENT_HAS_ACTIVE_ENROLLMENT` | `academic/enrollment-workflows.service.ts` | Có | Chưa chạy theo mã |
| `STUDENT_ID_REQUIRED` | `curriculum-scheduling/curriculum-scheduling.service.ts` | Chưa | Chưa chạy theo mã |
| `STUDENT_INACTIVE` | `registration-flow/registration-flow.service.ts` | Có | Chưa chạy theo mã |
| `STUDENT_NOT_FOUND` | `academic/enrollment-workflows.service.ts` | Có | Chưa chạy theo mã |
| `STUDENT_SCHEDULE_CONFLICT` | `academic/enrollment-workflows.service.ts` | Có | Chưa chạy theo mã |
| `SUBJECT_INACTIVE` | `registration-flow/registration-flow.service.ts` | Có | Chưa chạy theo mã |
| `SUBJECT_IN_USE` | `registration-flow/subjects.controller.ts` | Có | Chưa chạy theo mã |
| `SUBJECT_MISMATCH` | `registration-flow/registration-flow.service.ts` | Chưa | Chưa chạy theo mã |
| `SUBJECT_NOT_FOUND` | `registration-flow/subjects.controller.ts` | Có | Chưa chạy theo mã |
| `SUBJECT_REQUIRED` | `registration-flow/registration-flow.service.ts` | Chưa | Chưa chạy theo mã |
| `TARGET_DURING_LEAVE` | `academic/enrollment-workflows.service.ts` | Có | Chưa chạy theo mã |
| `TEACHER_INVITATION_REQUIRED` | `directory/directory.service.ts` | Chưa | Chưa chạy theo mã |
| `TEACHER_SCHEDULE_CONFLICT` | `registration-flow/registration-flow.service.ts` | Có | Chưa chạy theo mã |
| `TEST_OUTSIDE_UNIT` | `curriculum-scheduling/curriculum-scheduling.service.ts` | Có | Chưa chạy theo mã |
| `TOO_MANY_RECIPIENTS` | `academic/announcements.service.ts` | Chưa | Chưa chạy theo mã |
| `TRANSFER_ALREADY_SCHEDULED` | `academic/enrollment-workflows.service.ts` | Có | Chưa chạy theo mã |
| `TRANSFER_HAS_MAKEUPS` | `academic/enrollment-workflows.service.ts` | Có | Chưa chạy theo mã |
| `TRANSFER_LESSON_GAP` | `academic/enrollment-workflows.service.ts` | Có | Chưa chạy theo mã |
| `TRANSFER_MAKEUP_CONFLICT` | `academic/enrollment-workflows.service.ts` | Có | Chưa chạy theo mã |
| `TRANSFER_SESSION_FULL` | `academic/enrollment-workflows.service.ts` | Có | Chưa chạy theo mã |
| `UNIT_IN_USE` | `curriculum-scheduling/curriculum-scheduling.service.ts` | Có | Chưa chạy theo mã |
| `UNIT_LOCKED` | `curriculum-scheduling/curriculum-scheduling.service.ts` | Có | Chưa chạy theo mã |
| `UNIT_NOT_APPROVED` | `curriculum-scheduling/curriculum-scheduling.service.ts` | Có | Chưa chạy theo mã |
| `UNIT_NOT_FOUND` | `curriculum-scheduling/curriculum-scheduling.service.ts` | Có | Chưa chạy theo mã |
| `UNIT_NOT_PENDING` | `curriculum-scheduling/curriculum-scheduling.service.ts` | Có | Chưa chạy theo mã |
| `VALIDATION_ERROR` | `directory/directory.service.ts` | Có | Chưa chạy theo mã |
<!-- BE_ERROR_MATRIX_END -->

## Cách chạy tiếp

1. Giữ DB QA, chạy BE với `DATABASE_URL` tới `edugrade_qa_fe_20261013`, `PORT=3001`; chạy FE với `BACKEND_API_URL=http://localhost:3001/api/v1` ở cổng 3000. Không đổi `.env` BE ứng dụng.
2. Dùng account QA ở trên. Mỗi case ghi dữ liệu nên tạo ID/email mới có tiền tố `qa-` và không sửa fixture nền. Chạy theo thứ tự AUTH → Manager catalog/class/curriculum → Staff registration/payment → Teacher attendance/assignment.
3. Với lỗi không thể gây an toàn bằng dữ liệu thật, mock đúng HTTP status và envelope BE ở BFF/browser; ghi rõ “mock” trong bằng chứng. Cập nhật kết quả từng case thành Pass/Fail/Blocked sau khi quan sát UI, network và DB.
