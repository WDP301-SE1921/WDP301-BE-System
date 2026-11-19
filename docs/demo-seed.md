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

Từ edition `ctst-2026-11-19`, nội dung học bám bộ **Chân trời sáng tạo** của Nhà xuất bản Giáo dục Việt Nam. Toán dùng đủ hai tập mỗi lớp. Vật lý, Hóa học và Sinh học lấy các phần tương ứng trong sách Khoa học tự nhiên; bài mở đầu dùng chung được giữ trong từng phần. Tên bài, chương và trang in đã được đối chiếu mục lục bản sách điện tử đang phát hành. Mục tiêu, ghi chú dạy học, bài tập và lời giải được biên soạn cho trung tâm, không chép nguyên văn sách. Xem [hướng dẫn nguồn và lệnh seed riêng](textbook-curriculum.md) và [danh mục chi tiết](textbook-curriculum-catalog.md).

| Môn      | Lớp 6 | Lớp 7 | Lớp 8 | Lớp 9 | Học phí tháng demo |
| -------- | ----: | ----: | ----: | ----: | -----------------: |
| Toán     |    66 |    54 |    47 |    44 |        800.000 VND |
| Vật lý   |    18 |    15 |    18 |    20 |        750.000 VND |
| Hóa học  |    12 |     7 |    16 |    25 |        750.000 VND |
| Sinh học |    21 |    19 |    26 |    17 |        700.000 VND |

Tổng 425 mục cho 16 chương trình; 413 mục riêng biệt trong 12 tập sách, do các bài mở đầu Khoa học tự nhiên được dùng chung. Số mục gồm bài học, bài tập cuối chương, ôn tập và hoạt động thực hành có trong mục lục. Không phải số tiết phân phối của nhà trường. Học phí và lịch vẫn là cấu hình demo.

- Có 16 chương trình và 21 lớp cho các tình huống nghiệp vụ sẵn có.
- Dataset mới có đủ nội dung cả năm, theo thứ tự sách. Lịch demo vẫn chỉ trải bốn tháng, từ đầu tháng trước đến hết tháng thứ hai sau ngày tham chiếu, bỏ nghỉ Tết. Chỉ một phần danh mục được gắn vào lịch demo; chương trình không tự ép toàn bộ sách vào bốn tháng.
- Mỗi bài sách có ít nhất một lesson. Nếu lịch demo cần nhiều buổi hơn số mục sách của phần đó, seed thêm buổi luyện tập có nhãn của trung tâm bên cạnh bài gốc; đây không phải bài mới của sách. Không tạo kiểm tra tháng trong giáo trình.
- Bộ mục tiêu học tập gồm **16 bộ nháp, 425 mục tiêu**, có nguồn và trang từng bài, gồm cả Vật lý. Nguồn giữ `CANDIDATE`, bộ giữ `DRAFT` để giáo viên xác minh cách diễn đạt và duyệt chuyên môn.
- Trạng thái duyệt trong các học phần demo là mô phỏng luồng nghiệp vụ. Lệnh giáo trình riêng tạo bản nháp, không giả lập xác nhận của giáo viên.
- Seed thông thường không ghi đè dữ liệu đã tồn tại. Dataset dùng edition minh họa cũ bị chặn trước khi ghi để tránh trộn nội dung cũ với thứ tự bài mới. Dùng `pnpm db:seed:curriculum --apply` để thêm bản nháp Chân trời sáng tạo cho các chương trình đã có; bản cũ và lịch sử tiếp tục được giữ. Có thể dùng database development mới để chạy toàn bộ demo edition mới.

Chỉnh cấu hình học phí/lớp tại [seed-catalog.ts](../src/database/seeds/seed-catalog.ts). Dữ liệu bài học đặt theo từng môn/khối tại [textbooks](../src/database/seeds/textbooks); khai báo [sources.ts](../src/database/seeds/textbooks/sources.ts) ghi 12 nguồn sách điện tử.

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

Thông tin liên hệ trung tâm (`GET /center`, bảng `center_profiles`): seed demo ghi tên "Trung tâm bồi dưỡng văn hóa EduGrade", số điện thoại `0123 456 789` (đầu số đã ngừng dùng từ 2018), email `lienhe@edugrade.local`, địa chỉ và giờ mở cửa mẫu. Biến `CENTER_*` có giá trị thì ghi đè lên mỗi lần chạy seed.

Tổng cộng 20 tài khoản; tài khoản bị khóa/chờ duyệt không dùng để đăng nhập luồng thông thường. Không in mật khẩu hoặc token khi chạy seed. Token lời mời chỉ có hash ngẫu nhiên; dùng chức năng gửi lại lời mời nếu muốn thử chấp nhận qua email.

## Các tình huống nghiệp vụ

- 8 phụ huynh, 14 học sinh; có gia đình nhiều con, học sinh chưa đăng ký, học nhiều môn và đã nghỉ học.
- 14 đăng ký: 12 hoàn tất có thanh toán/enrollment/placement, một nháp có thể xác nhận thanh toán và một đã hủy.
- Gói đang học, sắp hết hạn, chưa bắt đầu, hết hạn/kết thúc sớm; lớp đầy có sức chứa 2 và đúng 2 học sinh đang chiếm chỗ.
- Một lịch sử chuyển lớp có hai placement liên tiếp; một thay đổi giáo viên có ngày hiệu lực và một buổi dạy thay.
- Buổi quá khứ đã hoàn thành, buổi sắp tới chưa điểm danh; không có buổi hủy và không có buổi trong kỳ nghỉ Tết (23 tháng Chạp → mùng 7); giáo viên/phòng không trùng giờ.
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
