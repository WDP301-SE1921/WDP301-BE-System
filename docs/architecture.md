# Kiến trúc backend

## Biên hệ thống

Web và mobile gọi cùng REST API có version. Client không import Prisma model, repository
hoặc kiểu nội bộ từ backend. OpenAPI tại `/docs` là hợp đồng tích hợp giữa các client và API.

```text
Web / Mobile
     | HTTPS
     v
Middleware -> Guard -> Validation DTO -> Controller -> Service -> Repository -> Prisma
```

## Cấu trúc hiện tại

```text
src/
├── main.ts                       # bootstrap HTTP và production baseline
├── app.module.ts                 # composition root
├── common/                       # lỗi, filter, interceptor, middleware dùng chung
├── config/                       # đọc và validate environment tập trung
├── database/orm/                 # một Prisma client cho toàn ứng dụng
└── modules/health/               # liveness/readiness thực sự hoạt động

tests/
├── unit/                         # unit test cho service/mapper/helper
└── e2e/                          # HTTP contract test chạy qua Nest app
```

Module nghiệp vụ chỉ được thêm khi triển khai use case. Mỗi module tổ chức theo domain, ví dụ
`registration`, `auth`, `enrollment`, không gom mọi controller/service vào các thư mục toàn cục.

## Lộ trình module EduGrade

1. `auth`: xác thực manager/parent, password hashing, access/refresh token và guards.
2. `registration`: tạo draft, xác nhận thanh toán idempotent, cấp lại invitation.
3. `link-invitations`: inspect và claim token một lần.
4. `payments`: dữ liệu biên lai; không tích hợp máy in ở backend.
5. `notifications`: transactional outbox và worker email.
6. `audit`: ghi nhận payment, reissue và claim.

Transaction xác nhận thanh toán và claim invitation phải giữ các invariant bằng transaction
cùng unique constraint trong database. Không gửi email trong transaction.

## Database

`prisma/schema.prisma` mô tả schema mục tiêu từ flow EduGrade. Không chạy lệnh reset trên database
dùng chung. Với database đã tồn tại, phải introspect bản sao an toàn và baseline trước khi tạo migration
mới. Với database mới, review schema và tạo initial migration bằng `pnpm prisma:migrate:dev`.
