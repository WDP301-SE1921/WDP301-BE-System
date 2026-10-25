# Quy ước API

## URL và version

Mọi public endpoint dùng prefix `/api/v1`. Route dùng danh từ tài nguyên; command thật sự của domain
có thể dùng suffix như `/confirm-payment`, `/claim` hoặc `/reissue-link`.

## Success response

```json
{
  "success": true,
  "data": {}
}
```

## Error response

```json
{
  "success": false,
  "error": {
    "code": "RESOURCE_NOT_FOUND",
    "message": "Resource not found",
    "requestId": "8d34e165-03b0-4f6f-b0fa-88e14357af81"
  }
}
```

Error code ổn định là một phần của hợp đồng client. Không trả stack trace, Prisma/SQL error hoặc secret.

## Danh sách, phân trang và bộ lọc

Các GET danh sách dùng `page=1`, `limit=20` (tối đa 100). Với endpoint vốn trả array,
thêm `paginated=true` để nhận `{ items, page, limit, total }` trong `data`. Các endpoint
vốn có metadata giữ contract hiện tại. Bộ lọc được áp dụng cùng phạm vi quyền trước
khi phân trang và tính tổng. Xem [bảng toàn bộ route và filter](data-list-api.md).

## Web và mobile

Web có thể dùng cookie `HttpOnly` khi chính sách CSRF được triển khai. Mobile dùng bearer access token
và refresh token trong secure storage. Cả hai phải được guard chuyển thành cùng một identity context;
service nghiệp vụ không rẽ nhánh chỉ vì loại client.
