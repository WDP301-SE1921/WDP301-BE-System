# Dữ liệu demo EduGrade

`pnpm seed` tạo bộ dữ liệu demo cho backend MySQL trong môi trường development/test. Script dùng `SEED_DEFAULT_PASSWORD` cho tài khoản mới, hash bằng bcrypt và giữ nguyên mật khẩu/tên/trạng thái của tài khoản đã có.

## Chạy seed

```powershell
docker compose up -d mysql
pnpm prisma:migrate:deploy
pnpm seed
```

Điền mật khẩu trong `.env` trước khi chạy. Có thể đổi email của năm tài khoản chính bằng các biến `SEED_*_EMAIL` sẵn có. Các email phải khác nhau và tài khoản đã tồn tại phải có đúng vai trò.

## Hai lệnh seed và reseed

| Lệnh          | Hành vi                                                                                               |
| ------------- | ----------------------------------------------------------------------------------------------------- |
| `pnpm seed`   | Bổ sung dữ liệu seed còn thiếu; giữ bản ghi, mật khẩu và các thay đổi đã có.                          |
| `pnpm reseed` | Reset database trong `DATABASE_URL`, xóa toàn bộ dữ liệu, áp dụng lại tất cả migrations rồi seed mới. |

Các tên `pnpm db:seed` và `pnpm db:reseed` cũng dùng được.

```powershell
# Bổ sung dữ liệu seed
pnpm seed

# Xóa toàn bộ dữ liệu và seed lại từ đầu
pnpm reseed
```

`reseed` chạy không hỏi xác nhận tương tác. **Toàn bộ tài khoản, phiên đăng nhập, dữ liệu nghiệp vụ và bảng ngoài migrations trong database đích đều bị xóa.** Sau đó Prisma tạo lại schema theo migrations, và script tạo dữ liệu seed mới. Lệnh chỉ cho phép `NODE_ENV=development` hoặc `NODE_ENV=test`, chặn database hệ thống MySQL và không thay đổi database khác trên cùng server.

Mật khẩu, email seed, chế độ seed, ngày tham chiếu và URL database được kiểm tra trước bước reset. Nếu reset/migration thất bại, script dừng và không chạy seed. Reset và seed là hai bước riêng: lỗi xảy ra sau khi reset đã thành công không khôi phục dữ liệu cũ.

Dừng backend trước khi chạy `reseed` để tránh request/worker truy cập database đang được reset. Prisma Client dùng bản đã generate khi setup; nếu thay đổi schema, chạy `pnpm prisma:generate` trước. Lệnh không xóa tệp trên object storage.

Mặc định `SEED_MODE=demo` ở development/test. Để chỉ tạo năm tài khoản chính:

```powershell
$env:SEED_MODE = 'accounts'
pnpm seed
Remove-Item Env:SEED_MODE
```

Production chỉ cho phép `seed` ở chế độ `accounts` với `SEED_ALLOW_PRODUCTION=true`; chế độ demo và lệnh `reseed` bị chặn.

## Môn học và giáo trình

Nguồn cấu trúc: [CLASS_CURRICULUM_INPUT_TEMPLATE](../../WDP301-FE-System/docs/CLASS_CURRICULUM_INPUT_TEMPLATE.md). Mẫu còn các ô `CHƯA ĐIỀN`, vì vậy các mức học phí, lịch và nội dung dưới đây là **dữ liệu minh họa**, chưa phải cấu hình chính thức của trung tâm hoặc giáo trình đã được đối chiếu với một bộ sách.

| Môn      | Khối       | Học phí tháng minh họa |
| -------- | ---------- | ---------------------- |
| Toán     | 6, 7, 8, 9 | 800.000 VND            |
| Vật lý   | 6, 7, 8, 9 | 750.000 VND            |
| Hóa học  | 6, 7, 8, 9 | 750.000 VND            |
| Sinh học | 6, 7, 8, 9 | 700.000 VND            |

- Có 16 chương trình môn/khối và 21 lớp, gồm lớp song song, lớp đầy, đóng đăng ký, tạm ngừng và chưa phân công.
- Các lớp cùng môn/khối liên kết cùng chương trình và học phần đã duyệt.
- Học phần trải từ đầu tháng trước đến hết tháng thứ hai sau tháng tham chiếu: tổng cộng bốn tháng.
- Số bài thường tính từ lịch tuần của lớp cần nhiều bài nhất; thứ tự từ 1 và liên tục. Có một bài kiểm tra cho mỗi tháng có lịch học, gắn vào buổi cuối tháng của từng lớp.
- Bài học có mục tiêu, nội dung, bài tập, đáp án/hướng dẫn chấm và ghi chú tài liệu, theo cấu trúc mẫu.
- Có bản lưu trữ, bản đã duyệt, bản nháp và bản chờ duyệt; góp ý và bài sửa liên kết bằng `basedOnId`/`resolutionLessonId`.

Chỉnh nội dung mẫu tại [curriculum-content.ts](../src/database/seeds/curriculum-content.ts). Chỉnh lớp/lịch/học phí tại [seed-catalog.ts](../src/database/seeds/seed-catalog.ts). Script giữ nguyên bản ghi đã tồn tại; thay đổi file nội dung chỉ áp dụng cho bản ghi chưa được tạo. Muốn thử bộ nội dung khác, dùng database development riêng hoặc sửa qua API.

## Tài khoản

| Vai trò / tình huống                  | Email mặc định                                                                                      |
| ------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Quản lý                               | `manager@edugrade.local`                                                                            |
| Nhân viên                             | `staff@edugrade.local`                                                                              |
| Giáo viên Toán                        | `teacher@edugrade.local`                                                                            |
| Giáo viên Vật lý                      | `teacher.physics@edugrade.local`                                                                    |
| Giáo viên Hóa học                     | `teacher.chemistry@edugrade.local`                                                                  |
| Giáo viên Sinh học                    | `teacher.biology@edugrade.local`                                                                    |
| Giáo viên lớp song song/dạy thay      | `teacher.substitute@edugrade.local`                                                                 |
| Thiết kế giáo trình                   | `designer@edugrade.local`, `designer.science@edugrade.local`                                        |
| Phụ huynh                             | `parent@edugrade.local`, `parent.2@edugrade.local` … `parent.5@edugrade.local`                      |
| Chưa có con / bị khóa / chưa xác minh | `parent.empty@edugrade.local`, `parent.disabled@edugrade.local`, `parent.unverified@edugrade.local` |
| Nhân viên đã khóa                     | `staff.disabled@edugrade.local`                                                                     |
| Giáo viên chờ duyệt / bị từ chối      | `candidate.pending@edugrade.local`, `candidate.rejected@edugrade.local`                             |

Tổng cộng 20 tài khoản; tài khoản bị khóa/chờ duyệt không dùng để đăng nhập luồng thông thường. Không in mật khẩu hoặc token khi chạy seed. Token lời mời chỉ có hash ngẫu nhiên; dùng chức năng gửi lại lời mời nếu muốn thử chấp nhận qua email.

## Các tình huống nghiệp vụ

- 8 phụ huynh, 14 học sinh; có gia đình nhiều con, học sinh chưa đăng ký, học nhiều môn và đã nghỉ học.
- 14 đăng ký: 12 hoàn tất có thanh toán/enrollment/placement, một nháp có thể xác nhận thanh toán và một đã hủy.
- Gói đang học, sắp hết hạn, chưa bắt đầu, hết hạn/kết thúc sớm; lớp đầy có sức chứa 2 và đúng 2 học sinh đang chiếm chỗ.
- Một lịch sử chuyển lớp có hai placement liên tiếp; một thay đổi giáo viên có ngày hiệu lực và một buổi dạy thay.
- Buổi quá khứ đã hoàn thành, buổi sắp tới chưa điểm danh, một buổi hủy; giáo viên/phòng không trùng giờ.
- Nghỉ một buổi ở các trạng thái; tạm nghỉ được duyệt có điểm danh `EXCUSED` tương ứng.
- Học bù `BOOKED`, `COMPLETED`, `MISSED`, `CANCELLED`; buổi gốc và buổi bù cùng `lessonId`. Buổi bổ sung 14:00–16:00 được tạo thủ công để không phụ thuộc ngày dạy của hai lớp song song.
- 6 bài tập: nháp, đang nhận bài, đã đóng, công bố đáp án, điều chỉnh điểm và chưa có bài nộp. Có trắc nghiệm/tự luận, hai lần nộp, bài chờ chấm, điểm nháp/đã duyệt/đã công bố/bị thay thế.
- Thông báo, lời mời đủ trạng thái, audit log, lịch sử email và 3 báo cáo tính từ dữ liệu điểm danh/điểm số.

## Chạy lại và ngày tham chiếu

Toàn bộ seed demo chạy trong một transaction. ID cố định có tiền tố `seed_demo_v1_`, các khóa duy nhất được dùng để tìm lại bản ghi; không xóa dữ liệu hay cập nhật bản ghi đã tồn tại. Lần đầu chỉ khởi tạo thêm điểm danh cần thiết cho lịch sử học bù/tạm nghỉ; lần sau giữ các thay đổi qua ứng dụng.

Ngày mặc định là ngày hiện tại theo UTC+7. Có thể đặt `SEED_REFERENCE_DATE=YYYY-MM-DD` trước lần chạy đầu. Ngày được lưu trong audit manifest; các lần `seed` sau dùng lại ngày đó, kể cả không truyền biến môi trường. Truyền một ngày khác vào dataset đã tồn tại sẽ báo lỗi thay vì dời lịch hoặc tạo trùng. Dùng database development riêng hoặc chạy `pnpm reseed` để thay toàn bộ dữ liệu bằng bộ demo có ngày tham chiếu mới. Sau `reseed`, ngày lấy từ `SEED_REFERENCE_DATE` hiện tại hoặc hôm nay nếu không đặt biến này; mật khẩu các tài khoản mới lấy từ `SEED_DEFAULT_PASSWORD` hiện tại.

Không seed session đăng nhập, token reset/xác minh email hoặc bản ghi preview/idempotency; các luồng API tự tạo chúng. Email demo chỉ có `SENT`/`FAILED`, job AI chỉ có `SUCCEEDED`/`FAILED`, nên worker không tự gửi email hoặc gọi AI do seed. Kết quả AI là mẫu minh họa.

Không tạo `FileAsset`/`SubmissionFile` trỏ tới tệp giả. Muốn thử đính kèm, cấu hình storage và upload tệp thật qua API.

## Kiểm tra

```powershell
pnpm typecheck
pnpm lint
pnpm run test --runInBand
pnpm test:e2e --runInBand demo-seed
pnpm build
```

Test seed dùng một database MySQL riêng có tên `edugrade_seed_test_<pid>_<timestamp>`, migrate rồi kiểm tra dữ liệu/HTTP và xóa đúng database test. Kết nối mặc định là MySQL Docker local cổng 3307; có thể đặt `ACADEMIC_TEST_DATABASE_URL` để dùng server test khác. Không chạy test lên tài khoản/database production.
