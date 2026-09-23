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

## Pending / Lam Sau

- Tao API quan ly giao vien do manager/admin tao.
- Seed tai khoan manager dau tien neu can dang nhap bang role quan ly.
- Tich hop invitation/link enrollment cho parent theo flow dang ky hoc.
- Them forgot password / reset password neu can.
- Them email verification neu can.
