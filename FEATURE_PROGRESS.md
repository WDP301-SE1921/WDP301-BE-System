# EduGrade Feature Progress

File nay dung de theo doi cac tinh nang da hoan thanh theo tung luong nghiep vu. Khi co sua doi hoac them chuc nang moi, cap nhat tiep vao file nay trong cung PR/branch.

## Quy uoc cap nhat

- `Done`: Da implement va da verify.
- `Changed`: Da sua hanh vi hoac contract co san.
- `Pending`: Da xac dinh can lam nhung chua implement.
- Moi muc nen ghi ngay cap nhat, endpoint/file lien quan, va lenh verify chinh.

## Luong Auth

### Done - 2026-09-23

- Tao module auth cho NestJS:
  - `src/modules/auth`
  - `src/modules/users`
- Ho tro dang ky tai khoan phu huynh:
  - `POST /api/v1/auth/register`
  - Chi cho phep role `PARENT` tu dang ky.
  - Email duoc trim va lowercase truoc khi luu.
  - Mat khau duoc hash bang `bcrypt`.
- Ho tro dang nhap:
  - `POST /api/v1/auth/login`
  - Tra ve `accessToken`, `refreshToken`, `tokenType`, `expiresIn`.
- Ho tro refresh token:
  - `POST /api/v1/auth/refresh`
  - Refresh token duoc rotate sau moi lan su dung.
  - Refresh token cu bi reuse se lam revoke session.
  - Refresh token duoc hash bang SHA-256 truoc khi luu DB.
- Ho tro logout:
  - `POST /api/v1/auth/logout`
  - Revoke session hien tai.
  - Access token cua session da logout bi tu choi ngay vi guard kiem tra session trong DB.
- Ho tro lay user hien tai:
  - `GET /api/v1/auth/me`
- Them global JWT guard va decorator public:
  - `src/common/guards/jwt-auth.guard.ts`
  - `src/common/decorators/public.decorator.ts`
  - `src/common/decorators/current-user.decorator.ts`
- Them rate limit:
  - Login/register: 5 requests/phut.
  - Refresh: 30 requests/phut.

### Verify

- `pnpm lint`
- `pnpm typecheck`
- `pnpm build`
- `pnpm test:e2e`

## Luong Database

### Done - 2026-09-23

- Chuyen Prisma datasource tu PostgreSQL sang MySQL.
- Cau hinh database local:
  - DB name: `edugrade_db`
  - Connection trong `.env`: `DATABASE_URL`
- Them bang session:
  - `auth_sessions`
- Apply migration MySQL moi:
  - `prisma/migrations/20260923000000_initial_mysql_auth/migration.sql`
- Archive migration PostgreSQL cu de giu lich su tham chieu:
  - `prisma/archive/postgresql`
- Them `.env.example` voi placeholder cho MySQL va JWT secrets.
- Viet lai `docker-compose.yml` tu PostgreSQL sang MySQL 8.4:
  - Service: `mysql`
  - Container: `edugrade_mysql`
  - DB name: `edugrade_db`
  - Host port: `3307`
  - Container port: `3306`
  - Volume: `mysql_data`

### Verify

- `pnpm prisma validate`
- `pnpm prisma generate`
- `pnpm prisma migrate deploy`

## Luong Swagger/API Contract

### Done - 2026-09-23

- Swagger UI duoc expose tai:
  - `GET /api/docs`
- Them Bearer auth vao Swagger.
- Them request/response examples cho auth endpoints.
- Swagger response phan anh dung envelope thuc te:
  - Success: `{ success: true, data: ... }`
  - Error: `{ success: false, error: { code, message, requestId, details } }`
- Them DTO tai lieu hoa loi:
  - `src/common/dto/api-error-response.dto.ts`
- Them DTO logout response:
  - `src/modules/auth/dto/logout-response.dto.ts`

### Verify

- `pnpm lint`
- `pnpm typecheck`
- `pnpm build`
- `pnpm test:e2e`

## Luong Health

### Changed - 2026-09-23

- Danh dau health endpoints la public de khong can Bearer token:
  - `GET /api/v1/health`
  - `GET /api/v1/health/live`
  - `GET /api/v1/health/ready`

### Verify

- `pnpm test:e2e`

## Luong Web/Mobile Integration

### Done - 2026-09-23

- Xac dinh contract tich hop:
  - Web/mobile khong ket noi MySQL truc tiep.
  - Web/mobile chi call REST API cua backend.
  - Endpoint protected gui header:

```http
Authorization: Bearer <accessToken>
```

- Khi access token het han, web/mobile goi:

```http
POST /api/v1/auth/refresh
```

voi `refreshToken`, sau do thay ca access token va refresh token bang cap moi.

## Academic P1 - 2026-09-30

### Implemented

- Branch: `feature/academic-workflows`; API prefix `/api/v1/academic`.
- Don nghi, duyet/huy nghi, hoc bu, diem danh ket thuc buoi, chuyen lop co lich su placement, ket thuc hoc cua mot con.
- Gop y giao an, designer tao ban sua, manager duyet; giu nguyen bai cua buoi cu.
- Bai tap nhap/sua/giao/dong/mo lai; parent nop bai theo recipient, gioi han lan nop, file PDF/PNG/JPEG qua S3.
- Cham trac nghiem, cham tay, AI job de xuat, teacher duyet va cong bo diem; parent khong xem diem nhap.
- Bao cao snapshot, diem chuan hoa, chuyen can va tien do buoi; xuat XLSX/PDF, AI tom tat tuy chon.
- Thong bao lop, lenh gui SMTP va nhac hoc phi; khong trien khai retry/outbox mo rong theo pham vi da chot.
- Migration additive `20260929000000_academic_workflows`.
- Sua test auth de cau hinh database test duoc inject truoc khi ket noi, tranh dung database local do import ConfigModule som.
- Tai lieu chi tiet: `docs/academic-p1-api.md`.

### Integration configuration / Deferred

- AI/S3/SMTP can cau hinh trong `.env`; test AI dung mock, khong gui email that.
- AI cham text; file dinh kem do teacher xem/cham, chua co OCR.
- P0 nhan su, thu phi/claim, curriculum version day du, audit va email retry van la cac module rieng chua trien khai.
- Hoc lai sau khi ket thuc can enrollment da thanh toan moi tu luong dang ky; khong tu tao goi mien phi.

### Verify

- `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm test:e2e`, `pnpm build`, `pnpm prisma:validate`.
- Verified 2026-09-30: 3 unit tests va 13 E2E tests pass; build/typecheck/lint/schema validation pass. `prisma migrate status`: database up to date.

## Pending P0 / Lam Sau

- Tao API quan ly giao vien do manager/admin tao.
- Seed tai khoan manager dau tien neu can dang nhap bang role quan ly.
- Tich hop invitation/link enrollment cho parent theo flow dang ky hoc.
- Them forgot password / reset password neu can.
- Them email verification neu can.
