# EduGrade Backend

NestJS REST API dùng chung cho web và mobile. Backend là nguồn duy nhất cho nghiệp vụ,
xác thực, phân quyền, validation và truy cập MySQL.

## Chạy local

Yêu cầu Node.js 22+, pnpm, Docker & Docker Compose.

```bash
cp .env.example .env
pnpm install
pnpm prisma:generate
pnpm prisma:migrate:deploy
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

## MinIO Object Storage (Docker)

Hệ thống tích hợp MinIO Community Server và MinIO Client (`mc`) được build trực tiếp từ mã nguồn chính thức ([github.com/minio/minio](https://github.com/minio/minio) và [github.com/minio/mc](https://github.com/minio/mc)), cố định tag phiên bản và commit hash trong cấu hình build đa tầng (multi-stage Docker build).

### Khởi động MinIO và Database

```bash
# Khởi động MySQL, MinIO và chạy minio-init tự động
docker compose up -d
```

- **S3 API Port**: `9000` (`http://localhost:9000`)
- **MinIO Console**: `9001` (`http://localhost:9001`)
- **Root Admin**: `MINIO_ROOT_USER` / `MINIO_ROOT_PASSWORD` trong `.env` (mặc định: `minioadmin123` / `minioadmin123`)

Service `minio-init` sẽ tự động:
1. Chờ MinIO online sẵn sàng tiếp nhận kết nối.
2. Tạo bucket `edugrade` (nếu chưa có).
3. Vô hiệu hóa truy cập ẩn danh (anonymous access blocked / private).
4. Tạo tài khoản ứng dụng `edugrade_app` và cấp quyền `readwrite` trên bucket.
5. Chạy lại nhiều lần an toàn (idempotent), không gây mất dữ liệu và không báo lỗi nếu tài nguyên đã tồn tại.

### Cấu hình Backend Storage

Trong file `.env`:
```env
MINIO_ROOT_USER=minioadmin123
MINIO_ROOT_PASSWORD=minioadmin123

STORAGE_ENDPOINT=http://localhost:9000
STORAGE_PUBLIC_ENDPOINT=http://localhost:9000
STORAGE_REGION=us-east-1
STORAGE_BUCKET=edugrade
STORAGE_ACCESS_KEY=edugrade_app
STORAGE_SECRET_KEY=edugrade_app_secret123
```

> **Lưu ý kiểm thử Mobile thật qua mạng LAN:** Cấu hình `STORAGE_PUBLIC_ENDPOINT=http://<IP_LAN_CUA_MAY_TINH>:9000` để các presigned URL trả về điện thoại có thể truy cập và tải file được.

### Quản lý dữ liệu và Volume

- Dữ liệu MinIO được lưu trữ bền vững tại Docker volume `minio_data:/data`.
- Khởi động lại container (`docker compose restart minio` hoặc `docker compose down && docker compose up -d`) **giữ nguyên toàn bộ dữ liệu và file đã upload**.
- **CẢNH BÁO:** Chạy lệnh `docker compose down -v` sẽ **xóa hoàn toàn** các volume `minio_data` và `mysql_data`, làm mất toàn bộ database và file đã lưu.

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

Phân trang, bộ lọc và ví dụ gọi GET danh sách: [Data list API](docs/data-list-api.md).

Chi tiết các API dành cho phụ huynh và migration mới: [Parent learning API](docs/parent-learning-api.md).

CLO bản nháp cho Toán, Hóa học và Sinh học khối 6–9, nguồn tham chiếu, API và quy trình duyệt: [Danh mục CLO](docs/clo-catalog-6-9.md) và [Hướng dẫn triển khai CLO](docs/clo-implementation-guide.md).

Thông báo realtime, contract và ví dụ tích hợp web/mobile: [Notifications API](docs/notifications-api.md).

[Hướng dẫn luồng và demo notification](NOTIFICATION_FLOW_GUIDE.md) — kết quả kiểm tra gửi/nhận, cấu hình và kịch bản demo bằng tiếng Việt.
