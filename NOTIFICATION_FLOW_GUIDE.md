# Hướng dẫn luồng thông báo realtime — EduGrade

Ngày kiểm tra: **19/10/2026**. Backend chạy một instance, dùng MySQL và Socket.IO.

## 1. Đã nhận được thông báo chưa?

**Đã xác nhận nhận được bằng client Socket.IO thật trong môi trường kiểm thử.** Lệnh chạy lại:

```powershell
pnpm test:e2e --runInBand notifications
```

Kết quả lần này: **21/21 test đạt**, thời gian khoảng 17,5 giây. Test mở HTTP server thực, kết nối bằng `socket.io-client`, sử dụng DB riêng `edugrade_notifications_test`.

Đã xác nhận:

- Hai thiết bị cùng tài khoản nhận cùng `notificationId` trong dưới 2 giây ở tình huống kiểm thử tải bình thường.
- Tài khoản khác không nhận sự kiện của người đó.
- Đọc trên thiết bị thứ nhất phát `notifications.read-changed` tới thiết bị thứ hai.
- Offline vẫn lưu thông báo; reconnect lấy lại được bằng REST.
- Token sai/hết hạn, refresh token, phiên logout hoặc tài khoản bị khoá không tiếp tục nhận dữ liệu.
- Retry, phục hồi lease và thao tác lặp không tạo bản ghi thông báo trùng.
- Có test nghiệp vụ cho thông báo lớp, bài tập/bài nộp, điểm, nghỉ/bù, điểm danh, đổi giáo viên/phòng và phản hồi giáo trình.

**DB ứng dụng hiện tại chưa sẵn sàng:** `prisma migrate status` trên `edugrade_db` tại `localhost:3307` cho thấy hai migration chưa áp dụng:

1. `20261019000000_assignment_metadata`
2. `20261019001000_notifications`

Kết quả test chứng minh backend gửi/nhận được trong môi trường kiểm thử; **chưa xác nhận web/mobile thực tế của bạn đã hiện chuông hoặc popup**. Cần migrate DB ứng dụng và tích hợp client. Lần kiểm tra này không thay đổi schema/data của `edugrade_db`.

## 2. Luồng tổng thể

```mermaid
sequenceDiagram
    participant Actor as Người thực hiện
    participant API as API nghiệp vụ
    participant DB as MySQL
    participant Worker as Notification worker
    participant Socket as Socket.IO
    participant Client as Web/mobile người nhận
    Client->>Socket: Kết nối /notifications bằng access token
    Socket->>DB: Kiểm tra tài khoản và phiên
    Socket-->>Client: Kết nối thành công
    Client->>API: Lấy inbox và số chưa đọc
    Actor->>API: Thực hiện thao tác nghiệp vụ
    API->>DB: Transaction: nghiệp vụ + Notification + Dispatch
    DB-->>API: Commit
    API-->>Actor: Thao tác thành công
    Worker->>DB: Mỗi giây lấy dispatch đến hạn
    Worker->>Socket: Phát đến đúng tài khoản
    Socket-->>Client: notification.created với notificationId
    Client->>API: Tải lại inbox và số chưa đọc
    API-->>Client: Nội dung được phép xem
```

- `notifications`: hộp thông báo bền vững, gồm nội dung và `readAt`.
- `notification_dispatches`: công việc phát realtime, có retry/lease.
- Socket.IO: báo có thay đổi để client tải dữ liệu; không gửi toàn bộ nội dung thông báo.

Transaction thất bại thì không để lại thông báo. Socket lỗi sau commit không huỷ nghiệp vụ; người dùng vẫn đọc lại qua REST.

## 3. Bật tính năng trên môi trường ứng dụng

Tại thư mục gốc backend, kiểm tra `.env` trỏ đúng DB rồi chạy:

```powershell
pnpm prisma:migrate:deploy
pnpm prisma:generate
pnpm exec prisma migrate status
pnpm dev
```

`migrate status` phải không còn migration chờ áp dụng. Nếu backend đang chạy, khởi động lại sau migrate/generate. Khi chạy bản build, dùng `pnpm build` rồi `pnpm start`.

| Cấu hình | Yêu cầu |
| --- | --- |
| `DATABASE_URL` | Đúng DB đã migrate |
| `PORT` | Cổng backend; ví dụ dưới dùng 3000 |
| `CORS_ORIGINS` | Chứa chính xác origin FE, ví dụ `http://localhost:5173` |
| JWT | Access token của phiên còn hoạt động |
| Proxy | Forward WebSocket upgrade cho `/socket.io/` |
| Số instance | Bản hiện tại chạy một instance BE |

SMTP không phải điều kiện nhận notification trong ứng dụng; email có hàng đợi riêng. Nếu pnpm báo `ERR_PNPM_VIRTUAL_STORE_DIR_MAX_LENGTH_DIFF`, dùng đúng pnpm 9 của repo, ví dụ thay tiền tố `pnpm` bằng `npx --yes pnpm@9.0.0`.

Trên điện thoại thật, dùng IP LAN/domain truy cập được của BE. `localhost` trên điện thoại trỏ đến chính điện thoại đó.

## 4. Kết nối client

Sau đăng nhập, lấy access token tại `response.data.tokens.accessToken`.

| Thành phần | Ví dụ |
| --- | --- |
| `BASE_URL` | `http://localhost:3000` |
| REST | `http://localhost:3000/api/v1/notifications` |
| Socket namespace | `http://localhost:3000/notifications` |
| Socket transport path | `/socket.io` |

Không thêm `/api/v1` vào URL namespace. Dùng `socket.io-client`; client WebSocket thuần không dùng được protocol này.

```javascript
import { io } from 'socket.io-client';

const BASE_URL = 'http://localhost:3000';
const accessToken = 'ACCESS_TOKEN_CUA_NGUOI_NHAN';

async function syncNotifications() {
  const headers = { Authorization: `Bearer ${accessToken}` };
  const responses = await Promise.all([
    fetch(`${BASE_URL}/api/v1/notifications?page=1&limit=20`, { headers }),
    fetch(`${BASE_URL}/api/v1/notifications/unread-count`, { headers }),
  ]);
  if (responses.some((response) => !response.ok)) {
    throw new Error('Không tải được thông báo; kiểm tra phiên đăng nhập.');
  }
  const [inbox, count] = await Promise.all(responses.map((response) => response.json()));
  console.log('Danh sách:', inbox.data.items);
  console.log('Số chưa đọc:', count.data.unreadCount);
  // FE cập nhật danh sách, badge hoặc toast tại đây.
}

const socket = io(`${BASE_URL}/notifications`, {
  path: '/socket.io',
  transports: ['websocket'],
  auth: { token: accessToken },
  autoConnect: false,
});

// Đăng ký listener trước khi connect.
socket.on('connect', () => {
  console.log('Đã kết nối notification');
  void syncNotifications().catch(console.error);
});
socket.on('notification.created', ({ notificationId }) => {
  console.log('Đã nhận notificationId:', notificationId);
  void syncNotifications().catch(console.error);
});
socket.on('notifications.read-changed', () => {
  void syncNotifications().catch(console.error);
});
socket.on('connect_error', (error) => console.error(error.message));
socket.on('disconnect', (reason) => console.log('Đã ngắt:', reason));
socket.connect();
```

Ví dụ dùng token cố định để demo. Khi tích hợp thật, dùng [wrapper client](docs/notifications-client.example.js) có debounce, huỷ fetch cũ và callback refresh token. Khi reconnect hoặc trở lại foreground, tải lại inbox/count. Không tự cộng/trừ badge theo số event vì event có thể lặp hoặc bị bỏ lỡ lúc offline.

## 5. Demo: Manager đăng thông báo lớp

### Chuẩn bị

- Tài khoản MANAGER và PARENT khác nhau.
- Parent có con ghi danh `ACTIVE`, còn kỳ học, đang thuộc `CLASS_ID` theo placement hiện tại.
- Mở client bằng **token parent**, chờ kết nối thành công.
- Lấy số chưa đọc ban đầu qua `GET /api/v1/notifications/unread-count`.

### Tạo sự kiện bằng token manager

```http
POST /api/v1/academic/announcements
Authorization: Bearer MANAGER_ACCESS_TOKEN
Content-Type: application/json

{
  "classId": "CLASS_ID",
  "title": "Thông báo kiểm tra realtime",
  "content": "Lớp có thông báo mới."
}
```

### Kết quả mong đợi

1. API thành công, HTTP 201.
2. Parent nhận `notification.created` và `notificationId` trong khoảng dưới 2 giây ở tải bình thường.
3. REST trả item cùng ID, loại `ANNOUNCEMENT`, đúng tiêu đề/nội dung, `readAt: null`.
4. `target.kind: CLASS`, `target.id: CLASS_ID`; `context.studentIds` đúng các con liên quan.
5. Badge phản ánh số chưa đọc mới. Parent có hai con cùng lớp nhận một thông báo chung chứa cả hai con trong context.
6. Giáo viên phụ trách lớp cũng nhận nếu hoạt động và không phải người thực hiện.
7. Manager vừa đăng không tự nhận cho thao tác của mình.

`POST /academic/announcements/:id/send-email` chỉ yêu cầu gửi email; in-app notification đã tạo lúc đăng, không phát lại chỉ vì gửi email.

### Hai thiết bị và đã đọc

Mở hai client cùng parent, rồi gọi:

```http
PATCH /api/v1/notifications/NOTIFICATION_ID/read
Authorization: Bearer PARENT_ACCESS_TOKEN
```

HTTP 200 trả item có `readAt`. Thiết bị còn lại nhận `notifications.read-changed` rồi tải lại badge. Gọi PATCH lần nữa không đổi thời điểm đọc ban đầu.

```http
POST /api/v1/notifications/read-all
Authorization: Bearer PARENT_ACCESS_TOKEN
```

HTTP 200 trả `{ success: true, data: { updatedCount, unreadCount } }`. Thông báo chèn sau snapshot của thao tác đọc tất cả vẫn chưa đọc.

### Offline

Ngắt client parent, đăng announcement mới bằng manager, rồi mở lại parent. Khi kết nối lại, REST trả thông báo đã lưu; không cần socket phát lại toàn bộ lịch sử.

## 6. Các luồng phát thông báo

Mọi thông báo loại người thực hiện và tài khoản không hoạt động khỏi danh sách người nhận.

| Thao tác | Người nhận chính | Type |
| --- | --- | --- |
| Đăng announcement | Giáo viên và parent đang có con trong lớp | `ANNOUNCEMENT` |
| Công bố bài/mở lại hạn/công bố đáp án | Parent của từng học sinh nhận bài | `ASSIGNMENT_PUBLISHED`, `ASSIGNMENT_REOPENED`, `ANSWERS_PUBLISHED` |
| Nộp bài thành công | Giáo viên phụ trách | `SUBMISSION_RECEIVED` |
| Công bố điểm sau approve | Parent tương ứng; điểm nháp không phát | `GRADE_PUBLISHED` |
| Chốt điểm danh | Parent của participant chưa huỷ, gồm cả có mặt | `ATTENDANCE_FINALIZED` |
| Sinh lịch/đổi giờ hoặc phòng/huỷ buổi | Giáo viên và parent có quyền tham gia, gồm học bù | `SESSIONS_GENERATED`, `SESSION_RESCHEDULED`, `SESSION_CANCELLED` |
| Đổi giáo viên/dạy thay | Giáo viên cũ/mới và parent bị ảnh hưởng | `TEACHER_CHANGED`, `SUBSTITUTE_ASSIGNED` |
| Parent gửi đơn nghỉ | STAFF nhận việc cần xử lý | `LEAVE_REQUESTED` |
| Duyệt/từ chối/huỷ/kết thúc nghỉ sớm | Parent và giáo viên liên quan | `LEAVE_APPROVED`, `LEAVE_REJECTED`, `LEAVE_CANCELLED`, `LEAVE_ENDED_EARLY` |
| Xếp/đổi/huỷ/chốt học bù | Parent và giáo viên buổi đích; có thể gồm giáo viên đích cũ | `MAKEUP_*` |
| Chuyển lớp/kết thúc ghi danh | Parent và giáo viên bị ảnh hưởng | `ENROLLMENT_TRANSFERRED`, `ENROLLMENT_ENDED` |
| Lập/huỷ bill/xác nhận thanh toán/nhắc gia hạn | Parent có quyền xem bill; MANAGER nhận bill cần xác nhận | `BILL_CREATED`, `BILL_CANCELLED`, `PAYMENT_CONFIRMED`, `TUITION_REMINDER` |
| Gửi duyệt/duyệt/yêu cầu sửa giáo trình | Manager hoặc designer sở hữu giáo trình | `CURRICULUM_*` |
| Gửi/xử lý phản hồi giáo trình | Designer/manager hoặc giáo viên gửi phản hồi | `FEEDBACK_CREATED`, `FEEDBACK_RESOLVED` |

- Bài tập/điểm gửi riêng từng con; thông báo lớp chung gộp các con của cùng parent.
- Sinh lịch theo đợt gửi một thông báo tổng hợp, không gửi từng buổi.
- Đổi giáo viên tương lai báo lúc lập lịch; tác vụ tự kích hoạt không gửi lại.
- Participant học bù đã huỷ không còn là căn cứ nhận thông báo buổi đó.
- Lịch sử thông báo vẫn có thể còn sau chuyển lớp; API đích kiểm tra quyền hiện tại khi mở, FE cần xử lý 403/404.
- Bản này nhận realtime khi đang kết nối. FE tự dựng chuông/toast/danh sách; chưa có push hệ điều hành khi đóng app.

## 7. Kiểm tra DB và xử lý khi chưa nhận

Sau migrate, dùng truy vấn chỉ đọc:

```sql
SELECT id, recipientUserId, type, title, createdAt, readAt
FROM notifications ORDER BY createdAt DESC LIMIT 20;

SELECT id, recipientUserId, event, status, attemptCount,
       nextAttemptAt, leaseExpiresAt, lastError, sentAt
FROM notification_dispatches ORDER BY createdAt DESC LIMIT 20;
```

| Hiện tượng | Kiểm tra |
| --- | --- |
| Thiếu bảng/cột, API 500 | Hai migration đã áp dụng trên đúng DB chưa; generate và restart BE |
| Có Notification nhưng không thấy event | Đúng namespace/tài khoản chưa; client có online không; kiểm tra worker/dispatch |
| `PENDING` | Chờ worker mỗi giây hoặc chờ lần retry tiếp theo |
| `PROCESSING` | Worker đã nhận việc; lease 30 giây cho phép phục hồi khi process dừng |
| `FAILED` | Kiểm tra `lastError` và log; tối đa 5 lần thử |
| `SENT` nhưng không có popup | Có thể không có client online; kiểm tra listener/UI và lấy inbox bằng REST |
| Không có Notification | Thao tác đã đổi trạng thái chưa; đúng người nhận chưa; có đang xem người thực hiện không |
| Parent không nhận announcement | Kiểm tra ownership, kỳ học, ACTIVE và placement lúc đăng |
| `AUTH_UNAUTHORIZED` | Access token/phiên còn hạn; không dùng refresh token để nối socket |
| `ORIGIN_NOT_ALLOWED` | Cấu hình đúng origin FE trong `CORS_ORIGINS` rồi restart |
| `REALTIME_RATE_LIMITED` | Giảm số lần handshake và backoff |
| `REALTIME_CONNECTION_LIMIT` | Tối đa 10 socket/user; đóng khi unmount/logout |
| `REALTIME_UNAVAILABLE` | Kiểm tra log/backend, thử lại có backoff |
| Điện thoại không nối được | Dùng IP LAN/domain, kiểm tra mạng/cổng/firewall |
| Qua proxy không nối được | Kiểm tra WebSocket upgrade |

Bằng chứng nhận realtime là **client ghi nhận notificationId và REST của chính tài khoản đó trả item cùng ID**. `SENT` chỉ nghĩa dispatch đã được xử lý, không chứng minh client nhận hoặc người dùng đọc. `readAt` thể hiện thao tác đánh dấu đã đọc.

Khi hết hạn token: refresh bằng API auth, cập nhật token rồi reconnect. Khi logout: dừng socket/wrapper và huỷ fetch đang chờ, tránh tự refresh lại phiên vừa thoát.

## 8. Tham khảo

- [Contract kỹ thuật](docs/notifications-api.md)
- [Wrapper client web/mobile](docs/notifications-client.example.js)
- [Ví dụ Nginx](docs/notifications-nginx.example.conf)
- [E2E gửi/nhận thực](tests/e2e/notifications.e2e-spec.ts)
- [Module backend](src/modules/notifications/notifications.module.ts)
