# Giáo trình Chân trời sáng tạo lớp 6–9

Edition `ctst-2026-11-19` bao phủ đủ Toán, Vật lý, Hóa học, Sinh học lớp 6–9 của danh mục dự án. Toán dùng hai tập mỗi lớp; ba phần khoa học lấy từ sách Khoa học tự nhiên cùng khối. Bộ sách và phạm vi cả năm được chủ dự án lựa chọn ngày 19/11/2026.

## Dữ liệu và nguồn

| Chương trình | Lớp 6 | Lớp 7 | Lớp 8 | Lớp 9 |
| ------------ | ----: | ----: | ----: | ----: |
| Toán         |    66 |    54 |    47 |    44 |
| Vật lý       |    18 |    15 |    18 |    20 |
| Hóa học      |    12 |     7 |    16 |    25 |
| Sinh học     |    21 |    19 |    26 |    17 |

425 mục theo chương trình, tương ứng 413 mục sách riêng biệt. Phần chênh là bài mở đầu khoa học được dùng chung cho ba phần. Mục sách gồm bài học, bài tập cuối chương, ôn tập và hoạt động thực hành; số mục không phải số tiết học của trường.

[Danh mục chi tiết](textbook-curriculum-catalog.md) ghi tên, chương, trang in, mục tiêu và nguồn của từng mục. Nguồn trong [sources.ts](../src/database/seeds/textbooks/sources.ts) là 12 bản sách điện tử trong danh mục Tập huấn của Nhà xuất bản Giáo dục Việt Nam. Tên và phân trang đã được đối chiếu trực tiếp mục lục, không dùng mục lục bản in thử thay bản phát hành. Ví dụ Khoa học tự nhiên 8: khối lượng riêng ở trang 72; Bài 34 là Máu và miễn dịch, Bài 35 là Hệ tuần hoàn, Bài 44 là Sinh sản ở người.

Mục tiêu, ghi chú dạy học, bài tập và lời giải được biên soạn theo nội dung bài, không chép toàn văn sách. Việc đối chiếu tên và trang không đồng nghĩa đã được giáo viên thẩm định toàn bộ mục tiêu. Mỗi mục tiêu vì vậy giữ `sourceStatus=CANDIDATE`, mỗi bộ mới giữ `DRAFT`, không có người hoặc ngày xác minh giả.

Các điểm đã sửa so với dữ liệu minh họa cũ:

- Toán có cả thống kê, xác suất và thực hành; giữ thứ tự chương, bài của hai tập.
- Vật lý 8 có khối lượng riêng, áp suất, moment lực, điện, nhiệt; công và công suất thuộc lớp 9.
- Sinh học 8 có sinh vật, môi trường và hệ sinh thái; Sinh học 9 có di truyền và tiến hóa.
- Hóa học 8 ghi rõ 25 °C, 1 bar khi dùng thể tích mol khí 24,79 L/mol.
- Vật lý cũng có bộ mục tiêu học tập và liên kết từng bài, thay vì bị loại khỏi seed mục tiêu.

## Bổ sung cho database đã có dữ liệu

Chạy ở repository backend, sau khi đã cài phụ thuộc và cập nhật Prisma Client theo schema hiện tại:

```powershell
pnpm prisma:migrate:deploy
pnpm prisma:generate

# Xem trước, chỉ đọc database
pnpm db:seed:curriculum

# Thêm các phiên bản nháp được liệt kê
pnpm db:seed:curriculum --apply
```

Lệnh dùng `DATABASE_URL` và `NODE_ENV` trong môi trường hoặc `.env`; chỉ cho phép development/test. Không cần mật khẩu tài khoản demo vì không tạo hay đổi tài khoản. Database phải có đủ chương trình hoạt động cho 16 tổ hợp môn–khối. Chương trình ngoài bốn môn hoặc ngoài lớp 6–9 không được sửa.

Người soạn lấy từ giáo trình trước đó của từng chương trình nếu còn hoạt động. Nếu chưa xác định được người soạn duy nhất, đặt một tài khoản thiết kế giáo trình đã có:

```powershell
$env:CURRICULUM_SEED_DESIGNER_EMAIL = 'designer@edugrade.local'
pnpm db:seed:curriculum
pnpm db:seed:curriculum --apply
Remove-Item Env:CURRICULUM_SEED_DESIGNER_EMAIL
```

Lệnh thêm một học phần nháp, một bộ mục tiêu nháp, toàn bộ bài học và liên kết mục tiêu cho mỗi chương trình. Không đổi bản đang áp dụng, lịch học, đăng ký, bài nộp, điểm hay mật khẩu. Không tự duyệt, lưu trữ bản cũ hoặc sinh lịch mới. Việc áp dụng vào giảng dạy đi qua luồng duyệt hiện có của dự án.

ID gắn edition và chương trình, không gắn ngày chạy. Chạy lại giữ nguyên cả nội dung đã được người dùng sửa hoặc duyệt; không tạo trùng. Các lần ghi nằm trong một transaction và khóa chương trình trước khi cấp số phiên bản. Ngày hiệu lực bản nháp dùng quy tắc `draftPeriod` của backend hiện tại; phạm vi “cả năm” mô tả nội dung sách, không tự đặt lịch năm học của trường.

## Seed demo mới

`pnpm seed` trên database development mới dùng luôn bộ nội dung này. Mỗi mục sách xuất hiện ít nhất một lần; khi lịch demo cần thêm buổi, có buổi luyện tập mang nhãn của trung tâm. Lịch demo vẫn bốn tháng và không bảo đảm mọi bài của cả năm đều đã được xếp lịch.

Các trạng thái `APPROVED` trong dataset demo chỉ mô phỏng luồng nghiệp vụ. Bộ mục tiêu vẫn là nháp chờ xác minh. Database có manifest demo edition cũ bị chặn trước khi ghi để tránh ghép thứ tự bài mới vào các bản ghi minh họa cũ; dùng lệnh bổ sung giáo trình ở trên hoặc database development mới.

## Kiểm tra

```powershell
pnpm typecheck
pnpm lint
pnpm test --runInBand
pnpm build

# Cần MySQL test riêng; không dùng database production
pnpm test:e2e --runInBand demo-seed
```

Unit test kiểm tra độ phủ cả 16 chương trình, không thiếu số bài Khoa học tự nhiên, vị trí nội dung theo khối, phân trang bản phát hành, nguồn từng bài và chặn seed trộn edition cũ. Integration test kiểm tra preview chỉ đọc, thêm đủ 425 bài nháp, nguồn và liên kết từng mục tiêu, giữ lịch sử, chạy lại không trùng và giữ sửa đổi của giáo viên.

## Kết quả kiểm tra ngày 19/11/2026

- TypeScript và build backend: đạt sau khi generate Prisma Client từ schema mới pull.
- Unit test không cần dịch vụ Docker: 74 bộ, 672 kiểm thử, tất cả đạt. Bài MinIO live smoke không chạy do thiếu dịch vụ.
- Lint các file thay đổi: đạt. Lint toàn repository còn 68 lỗi trong các file đã có trên nhánh gốc, ngoài phần seed; không đổi luật lint để bỏ qua lỗi.
- Kiểm thử tích hợp MySQL và chạy seed thực tế: chưa thực hiện theo lựa chọn chỉ hoàn thiện code của chủ dự án.
