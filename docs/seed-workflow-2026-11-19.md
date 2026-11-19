# Hoàn thiện luồng seed ngày 19/11/2026

## Phạm vi

Nhánh `feature/seed-workflow-20261119`, dựa trên backend `97d6aef`. Sau khi fetch, backend `origin/dev` vẫn ở `75c01c5`; các sửa này bổ sung vào bộ giáo trình Chân trời sáng tạo và E2E đã có. Không có thay đổi schema hoặc thư viện mới.

Luồng tạo mới: kiểm tra cấu hình/manifest → tài khoản, phòng và lớp → giáo trình và CLO → đăng ký và học phí → thanh toán, ghi danh và placement → lịch/điểm danh → nghỉ học/học bù → bài tập, thông báo và báo cáo → kiểm tra tính nhất quán → commit manifest. Dashboard khóa manifest demo, kiểm tra phiên bản rồi ghi toàn bộ lớp dữ liệu bổ sung trong một transaction riêng.

## Các quy tắc được đồng bộ

| Phần               | Hành vi mới                                                                                                                                       |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Sĩ số              | Sức chứa lớp bằng phòng; fixture đầy dùng phòng riêng 2 chỗ với 2 ghi danh cùng hạn.                                                              |
| Học phí            | Dùng `priceTuition` chung với API; snapshot giá gốc, giảm Tết và kỳ giảm; payment dùng giá cuối cùng.                                             |
| Giáo trình         | Chuẩn bị đủ bài cho mọi lịch hai buổi/tuần trước khi tạo bản đã duyệt. Dashboard tham chiếu bản đang được duyệt, giữ nguyên nội dung bản đó.      |
| CLO                | Bài sửa kế thừa CLO gốc; mọi bài dashboard có CLO cùng chương trình. Nguồn `CANDIDATE` và bộ `DRAFT` vẫn chờ thẩm định.                           |
| Lịch sử giáo trình | Học phần lịch sử của dashboard có `ARCHIVED`, `archiveReason=SUPERSEDED` và liên kết phiên bản kế nhiệm.                                          |
| Học bù             | Cùng bài gốc, trong hạn ghi danh và 21 ngày; bỏ Tết/ngày nghỉ, tránh trùng lớp/phòng/giáo viên/học sinh; phân biệt buổi đã học và buổi tương lai. |
| Chạy lại           | Manifest hiện hành đại diện cho một lần tạo hoàn tất. Các chỉnh sửa qua ứng dụng được giữ nguyên.                                                 |

Phiên bản: demo **3**, dashboard **2**, edition `ctst-2026-11-19`. Tiền tố ID cũ được giữ để không đổi khóa ngoại hay nhân đôi bộ dữ liệu.

## Nâng cấp có dữ liệu cũ

Đặt `NODE_ENV=development` hoặc `test`, kiểm tra đúng `DATABASE_URL`, rồi chạy `pnpm db:seed:repair` để xem trước. Preview chỉ đọc; hiển thị ID, loại thay đổi, trước/sau và các ngoại lệ. `pnpm db:seed:repair --apply` đọc lại dữ liệu dưới khóa, kiểm tra điều kiện cập nhật, ghi audit cho từng thay đổi và commit cùng nhau. Có trường hợp bị chặn hoặc bản ghi thay đổi trong lúc sửa thì toàn bộ transaction rollback.

| Dữ liệu                                      | Cách xử lý                                                                                                                                                                      |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Lớp có sức chứa khác phòng                   | Đồng bộ từ phòng sau khi kiểm tra đỉnh số chỗ đã giữ theo thời hạn/placement đang hoạt động.                                                                                    |
| Lớp demo chưa phân công và chưa có buổi học  | Gán phòng demo có sẵn đang hoạt động. Những trường hợp thiếu phòng khác cần xử lý qua ứng dụng.                                                                                 |
| Lớp đầy cũ dùng phòng 30 chỗ                 | Giữ phòng và lịch sử, đồng bộ lên 30 chỗ. Đổi tên mặc định thành “Toán 8C - Nhóm demo”; tên đã chỉnh sửa được giữ.                                                              |
| Bài thiếu CLO                                | Chỉ thêm liên kết khi tên, nội dung và nguồn khớp chính xác bản seed. Nội dung đã chỉnh sửa cần người soạn kiểm tra.                                                            |
| Bài sửa sau góp ý                            | Loại liên kết CLO đầu tiên bị gắn nhầm nếu nó không thuộc bài gốc, kế thừa các liên kết gốc và giữ các liên kết khác đã có. Nội dung sửa khác bản seed được giữ để rà thủ công. |
| Hóa đơn nháp chưa có payment/enrollment      | Chỉ cập nhật snapshot và giá khi còn nguyên công thức seed cũ.                                                                                                                  |
| Chứng từ đã xác nhận, đơn đã hủy, giá đã sửa | Giữ nguyên giá, payment, cơ sở hoàn tiền và lịch sử; liệt kê ngoại lệ. Hệ thống vốn hỗ trợ hóa đơn cũ có `listAmount=null`.                                                     |
| Buổi học bù tương lai rơi vào Tết            | Chỉ chuyển fixture nguyên bản chưa có thay đổi/bài tập sang ca hợp lệ; tăng revision và ghi audit.                                                                              |
| Buổi đã hoàn thành hoặc đã qua               | Giữ nguyên thời gian, điểm danh, điểm và báo cáo, kể cả ngoại lệ Tết cũ.                                                                                                        |
| Học phần lịch sử dashboard còn APPROVED      | Lưu trữ với SUPERSEDED khi tìm được phiên bản kế nhiệm đã xuất bản; giữ bài và lịch.                                                                                            |
| Manifest                                     | Chỉ nâng phiên bản sau khi tất cả thay đổi tương thích được ghi thành công. Ghi nhận số chứng từ/buổi cũ được giữ.                                                              |

Một dataset có ngoại lệ lịch sử được nâng cấp sẽ giữ các ngoại lệ đó; điều này không đồng nghĩa đã dựng lại toàn bộ demo như database mới. Lệnh sửa không reset dữ liệu, không gọi API AI/email và không tạo phiên bản giáo trình được duyệt thay giáo viên.

Nếu edition cũ chưa phải Chân trời sáng tạo, lệnh sửa dừng trước mọi ghi. Dùng `pnpm db:seed:curriculum` để xem các bản nháp bổ sung và quy trình thẩm định của ứng dụng, hoặc tạo database development mới. Nếu giáo trình hiện tại không đủ bài cho lịch dashboard, xuất bản phiên bản đủ nội dung rồi chạy dashboard; nội dung đã duyệt được giữ nguyên.

## Kiểm tra chuẩn bị

- Unit: đủ nội dung cho mọi cặp ngày học, học bù sát Tết, giới hạn thời hạn và kiểm tra tương thích manifest.
- Integration: dữ liệu mới ở ba ngày tham chiếu, hóa đơn 2.400.000đ giảm còn 2.000.000đ, CLO của bài sửa, dữ liệu cũ, preview không ghi, giữ lịch sử thanh toán/buổi học, sửa dashboard và chạy lại không trùng.
- Khi được yêu cầu chạy: `pnpm test:e2e --runInBand seed-workflow`, cùng các bộ demo/dashboard hiện có.

Ngày 19/11/2026: chưa chạy seed, sửa database hoặc thực thi test. TypeScript, lint và định dạng là kiểm tra tĩnh; không thay thế kết quả chạy integration/E2E.
