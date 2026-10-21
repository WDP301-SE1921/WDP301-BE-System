# EduGrade Backend

NestJS REST API dùng chung cho web và mobile. Backend là nguồn duy nhất cho nghiệp vụ,
xác thực, phân quyền, validation và truy cập MySQL.

## Chạy local

Yêu cầu Node.js 22+, pnpm và MySQL (Docker Compose dùng cổng 3307).

```bash
cp .env.example .env
pnpm install
pnpm prisma:generate
pnpm prisma:migrate:dev
pnpm seed
pnpm dev
```

Các URL mặc định:

- API: `http://localhost:3000/api/v1`
- Swagger: `http://localhost:3000/docs`
- Liveness: `GET /api/v1/health/live`
- Readiness: `GET /api/v1/health/ready`

Điền `SEED_DEFAULT_PASSWORD` trong `.env` trước khi seed. Bộ demo gồm Toán, Vật lý,
Hóa học, Sinh học cho khối 6–9 và các dữ liệu đăng ký/học tập liên quan; chạy lại giữ
nguyên dữ liệu đã có. Xem [hướng dẫn seed](docs/demo-seed.md) để biết tài khoản và các
tình huống mẫu.

Hai lệnh dữ liệu:

```bash
pnpm seed    # Bổ sung seed, giữ dữ liệu đã có
pnpm reseed  # Xóa toàn bộ dữ liệu database, chạy lại migrations và seed mới
```

`reseed` dùng `DATABASE_URL` trong `.env`, chỉ chạy ở development/test. Dừng backend
trước khi reseed. Các tên `pnpm db:seed` và `pnpm db:reseed` cũng được hỗ trợ.

## Kiểm tra chất lượng

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm test:e2e
pnpm build
pnpm prisma:validate
```

Xem [kiến trúc](docs/architecture.md) và [quy ước API](docs/api-conventions.md) trước khi
thêm module nghiệp vụ.

Chi tiết các API dành cho phụ huynh và migration mới: [Parent learning API](docs/parent-learning-api.md).

Thông báo realtime, contract và ví dụ tích hợp web/mobile: [Notifications API](docs/notifications-api.md).

[Hướng dẫn luồng và demo notification](NOTIFICATION_FLOW_GUIDE.md) — kết quả kiểm tra gửi/nhận, cấu hình và kịch bản demo bằng tiếng Việt.
