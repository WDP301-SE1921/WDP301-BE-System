# Danh mục CLO bản nháp: Toán, Hóa học, Sinh học lớp 6–9

Ngày tạo: 24/10/2026. Dữ liệu trong `src/database/seeds/seed-learning-outcomes.ts` tạo **12 bộ CLO, 48 CLO** từ các chủ đề demo hiện có trong `src/database/seeds/curriculum-content.ts`. Mỗi chủ đề tạo một CLO có câu “Sau chủ đề … học sinh có thể …” và liên kết với các bài học cùng chủ đề. Đây là **đề xuất của trung tâm**, chưa phải câu chữ của Bộ GDĐT; tất cả có `status=DRAFT`, `sourceStatus=CANDIDATE`.

| Chương trình | 4 CLO được tạo theo chủ đề |
| --- | --- |
| Toán 6 | Số tự nhiên và thứ tự phép tính; Ước và bội; Phân số và số thập phân; Hình học trực quan |
| Toán 7 | Số hữu tỉ; Tỉ lệ thức và đại lượng tỉ lệ; Biểu thức đại số; Tam giác và quan hệ góc |
| Toán 8 | Đa thức nhiều biến; Hằng đẳng thức và phân tích nhân tử; Phương trình bậc nhất; Tứ giác và định lý Thalès |
| Toán 9 | Căn bậc hai; Hệ phương trình; Phương trình bậc hai; Hệ thức lượng và đường tròn |
| Hóa học 6 | Chất và vật thể; Ba thể của chất; Chất tinh khiết và hỗn hợp; Tách chất khỏi hỗn hợp |
| Hóa học 7 | Nguyên tử; Nguyên tố hóa học; Phân tử, đơn chất và hợp chất; Hóa trị và công thức hóa học |
| Hóa học 8 | Phản ứng hóa học; Mol và khối lượng mol; Dung dịch và nồng độ; Acid, base và pH |
| Hóa học 9 | Oxide, acid, base và muối; Kim loại và dãy hoạt động; Hydrocarbon; Ethanol và acetic acid |
| Sinh học 6 | Tế bào; Cơ thể đơn bào và đa bào; Đa dạng sinh vật; Thực vật và môi trường |
| Sinh học 7 | Trao đổi chất và năng lượng; Quang hợp; Cảm ứng và sinh trưởng; Sinh sản ở sinh vật |
| Sinh học 8 | Vận động và cơ thể người; Tiêu hóa và dinh dưỡng; Tuần hoàn và hô hấp; Thần kinh và giác quan |
| Sinh học 9 | Quy luật di truyền; DNA và gene; Nhiễm sắc thể và phân bào; Sinh thái và môi trường |

**Nguồn ứng viên:** Toán tham chiếu [Chương trình môn Toán, Thông tư 32/2018](https://admintruong.haiphong.shieldix.app/data/haiphong/thcsandong/2023_6/1/3-cttoan_16202319.pdf); Hóa và Sinh tham chiếu các mạch tương ứng trong [Chương trình môn Khoa học tự nhiên THCS, Thông tư 32/2018](https://filethcs.hcm.shieldix.app/data/hcmedu/thcsphongphu/attachments/2020_7/11ctkhoahoctunhien281220188_87202018.pdf). Seed mới chỉ ghi **phạm vi trang của lớp**, chưa chỉ ra yêu cầu cần đạt cụ thể cho mỗi CLO. Giáo viên phải điền vị trí chính xác và giải thích đối chiếu qua API `verify-source` trước khi duyệt.

## Luồng chạy đã triển khai

1. Chạy `pnpm prisma:migrate:deploy`, `pnpm prisma:generate`, rồi `pnpm seed` trong môi trường demo. Seed chạy lặp lại không ghi đè CLO đã được sửa.
2. `GET /api/v1/academic/programs/:id/outcome-sets` trả bộ CLO và danh sách bài học liên kết. Designer xem bộ mình soạn, Teacher xem chương trình mình phụ trách, Manager/Staff xem toàn bộ, Parent chỉ xem bộ đã duyệt của chương trình con theo học.
3. `CURRICULUM_DESIGNER` có thể thêm phiên bản qua `POST /api/v1/academic/outcome-sets`, thêm CLO qua `POST /api/v1/academic/outcome-sets/:id/outcomes`, chỉnh CLO bằng `PATCH /api/v1/academic/outcome-sets/:setId/outcomes/:outcomeId` và gắn bài học nháp bằng `PATCH /api/v1/academic/lessons/:id/outcomes`. Chỉnh CLO sẽ đặt nguồn về `CANDIDATE`.
4. Teacher đang phụ trách chương trình đối chiếu **từng** CLO với phụ lục, gọi `POST /api/v1/academic/outcomes/:id/verify-source` với `sourceLocator` (đúng mục/trang) và `sourceNote` (giải thích đối chiếu). Sau khi tất cả đã xác minh và có bài học, gọi `POST /api/v1/academic/outcome-sets/:id/technical-approve`.
5. Manager gọi `POST /api/v1/academic/outcome-sets/:id/approve`. Chỉ bộ đã duyệt được dùng khi tạo assignment qua `outcomeSetId` và `questions[].outcomeId`. Từ lúc chương trình có bộ đã duyệt, publish assignment mới phải có bộ CLO và mapping cho từng câu.
6. `GET /api/v1/academic/assignments/:id` trả `learningTargets` và `outcomeId` cho từng câu, theo quyền hiện có. Bài đã phát hành trước đó tiếp tục hoạt động mà không cần gán CLO hồi tố.
7. Bộ đã được giáo viên duyệt (`TECHNICALLY_APPROVED`) nhưng Manager thấy cần sửa: `POST /api/v1/academic/outcome-sets/:id/request-changes` với `{ reason }` (1–2000 ký tự). Bộ trở về `DRAFT`, lý do nằm ở `reviewNote`, người duyệt chuyên môn bị xóa; CLO nào được Designer sửa sẽ về `CANDIDATE`, giáo viên duyệt lại toàn bộ. Không áp dụng cho bộ `APPROVED`.
8. Muốn đổi bộ đã `APPROVED`: Designer tạo phiên bản mới bằng `POST /api/v1/academic/outcome-sets` kèm `copyFromId` (bộ cùng chương trình). CLO và liên kết bài học được chép sang bản nháp mới, nguồn trở về `CANDIDATE` để giáo viên xác minh lại.
9. Giáo trình kỳ mới tạo bằng `POST curriculum-units/:id/revisions` giữ liên kết CLO của từng bài (theo `sequence`). `PATCH lessons/:id/outcomes` gắn bài nháp với CLO của bất kỳ bộ nào cùng chương trình, kể cả bộ đã duyệt.

## Giới hạn cần biết

- Nguồn đang ở mức **ứng viên**: không có CLO nào được tự động công nhận là đạt CTGDPT. Review của giáo viên là quyết định chuyên môn; API kiểm tra cấu trúc và quyền, không tự chứng minh nội dung đúng.
- Level seed là “Lớp N - cơ bản”, chỉ là nhãn nội bộ. Chưa có thang năng lực riêng ngoài khối lớp.
- Assignment hiện gắn CLO ở cấp **câu hỏi**, chưa có rubric cấu trúc cấp tiêu chí hay tính mức đạt CLO từ điểm học sinh. Điểm và quy trình chấm hiện hành chưa được đổi thành chứng nhận đạt chuẩn.
- Bộ seed gồm Toán, Hóa, Sinh đúng yêu cầu mới; Vật lý hiện có trong dự án chưa được tạo CLO. Do đó cơ chế bắt buộc khi publish kích hoạt theo từng chương trình sau khi bộ của chương trình ấy đã duyệt.
