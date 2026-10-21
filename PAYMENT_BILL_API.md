# Bill học phí cho phụ huynh

Phạm vi: bill cho một đăng ký lớp của một học sinh. Bill được lập từ dữ liệu đã chọn trong luồng đăng ký và **không chứa QR**. QR chung của trung tâm, thao tác kiểm tra tiền vào tài khoản, phương thức thanh toán và báo cáo thu chi nằm ngoài API bill này.

Tất cả đường dẫn có prefix `/api/v1`, cần Bearer access token và trả response theo dạng `{ "success": true, "data": ... }`.

## Luồng sử dụng

1. Nhân viên chọn hồ sơ con, lớp, ngày bắt đầu và gói tháng rồi gọi `POST /registrations`. Backend lấy học phí tháng từ lớp, tính `monthlyFee × packageMonths`, lưu `quotedAmount` và snapshot thông tin bill. Nhân viên không gửi hoặc nhập học phí trên đơn.
2. Nhân viên hoặc phụ huynh gọi `GET /registrations/:id/bill`. Bill ở trạng thái `UNPAID`, cho xem thông tin trước khi thu tiền. Phụ huynh có thể mở `GET /me/bills` để thấy các bill của con mình.
3. Sau khi đã thu đủ tiền theo nghiệp vụ tại quầy, nhân viên dùng API `POST /registrations/:id/confirm-payment` hiện có. Lúc đó bill chuyển thành `PAID` và có thông tin biên lai. Phụ huynh tải lại bill hoặc dùng `GET /registrations/:id/receipt`.

Bản nháp chưa giữ chỗ. Xác nhận thu tiền vẫn kiểm tra lại sĩ số, lịch và điều kiện ghi danh. Nếu bill bị hủy, trạng thái bill là `CANCELLED`; không được hiển thị như đã thanh toán.

Nếu tên/môn/khối/lịch tuần của lớp thay đổi sau khi lập bill, bước xác nhận trả 409 `BILL_CLASS_CHANGED`; nhân viên hủy đơn cũ và lập bill mới. Giá lớp thay đổi không sửa số tiền đã chốt trên bill.

## API bill

| API | Quyền | Kết quả |
| --- | --- | --- |
| `GET /me/bills?page=1&limit=20` | PARENT | Danh sách bill của các con thuộc tài khoản; sắp mới nhất trước, trả `{ items, page, limit, total }`. |
| `GET /registrations/:id/bill` | STAFF hoặc PARENT sở hữu học sinh | Chi tiết một bill. ID không tồn tại trả 404 `BILL_NOT_FOUND`; phụ huynh không sở hữu trả 403 `FORBIDDEN`. |

Ví dụ `data` từ API chi tiết:

```json
{
  "billNumber": "<registrationId>",
  "registrationId": "<registrationId>",
  "status": "UNPAID",
  "issuedAt": "2026-10-06T04:00:00.000Z",
  "parent": {
    "displayName": "Nguyễn Văn A",
    "email": "parent@example.com",
    "phone": "0900000000"
  },
  "student": { "id": "<studentId>", "fullName": "Nguyễn An", "grade": 8 },
  "class": {
    "id": "<classId>",
    "name": "Toán 8A",
    "subject": "Toán",
    "grade": 8,
    "schedules": [{ "weekday": 2, "startTime": "18:00", "endTime": "20:00" }]
  },
  "term": { "packageMonths": 3, "startDate": "2026-10-06", "endDate": "2027-01-06" },
  "pricing": {
    "monthlyFee": "800000.00",
    "packageMonths": 3,
    "total": "2400000.00",
    "currency": "VND"
  },
  "payment": null
}
```

Các khoản tiền là chuỗi thập phân để tránh mất độ chính xác. `endDate` là ngày hết hạn, không thuộc kỳ học. Khi `PAID`, `payment` chứa `receiptNumber`, `paidAmount` và `confirmedAt`; bill không suy đoán phương thức thanh toán vì backend hiện chưa lưu trường đó.

Snapshot giữ thông tin phụ huynh, học sinh, lớp, lịch tuần và học phí tháng tại lúc lập đơn; tổng tiền lấy từ `quotedAmount` đã lưu. Việc sửa tên lớp, lịch hay giá lớp sau đó không làm đổi bill mới tạo. Migration thêm `billSnapshot` nullable để giữ các đơn cũ; bill của đơn cũ dùng dữ liệu hiện có khi chưa có snapshot.

Frontend có thể dựng màn hình/in bill từ JSON. Với bill `UNPAID`, hiển thị nhãn “Chưa thanh toán”; chỉ dùng nhãn “Đã thanh toán” và số biên lai khi `status = PAID`. Không đặt QR chung của trung tâm vào bill.
