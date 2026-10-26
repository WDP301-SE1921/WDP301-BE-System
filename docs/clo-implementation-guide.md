# Hướng dẫn triển khai CLO, luồng chạy và quản lý nguồn căn cứ

**Ngày lập:** 23/10/2026; cập nhật 24/10/2026. **Trạng thái:** repository đã có model/API và seed CLO bản nháp cho Toán, Hóa, Sinh lớp 6–9; chưa có đánh giá mức đạt CLO của từng học sinh hoặc bộ CLO nào được giáo viên xác nhận. Tài liệu này không xác nhận rằng các chương trình hiện tại đã đạt CTGDPT 2018. Bản phân tích và mẫu minh họa trước đó nằm ở [learning-outcomes-design.md](learning-outcomes-design.md).

## 1. Hiểu đúng ba loại nguồn

| Loại | Vai trò | Có được ghi là “chuẩn chính thức” không? |
| --- | --- | --- |
| **Nguồn nội dung học thuật** | Quy định yêu cầu cần đạt theo môn, lớp, phạm vi; ví dụ chương trình môn Toán | Có, sau khi xác minh đúng văn bản/phiên bản và đối chiếu từng mục |
| **Nguồn tham khảo cách thiết kế phần mềm** | Moodle/Canvas chỉ cách quản lý năng lực, rubric, minh chứng | Không; chúng không định nghĩa chuẩn kiến thức Toán Việt Nam |
| **Quy tắc nội bộ EduGrade** | Ngưỡng 70%, hai bài độc lập, lần cuối có giám sát, quy trình duyệt | Không; phải ghi là chính sách trung tâm, có người phê duyệt |

Một CLO của trung tâm là **cách diễn giải có thể đo được** từ yêu cầu nguồn; không được trình bày như câu chữ nguyên văn của Bộ nếu đã sửa hay bổ sung. Nếu chưa có nguồn đến đúng mục/trang, CLO chỉ ở trạng thái `UNVERIFIED`/draft và không được công bố là “đạt chuẩn”. AI có thể gợi ý CLO/mapping, không được tự xác nhận nguồn hoặc phê duyệt.

## 2. Sổ nguồn đã kiểm tra

Các link sau được kiểm tra ngày 23/10/2026. Mức xác minh ghi theo nội dung thực sự truy cập được, không suy đoán từ tiêu đề tìm kiếm.

| ID | Nguồn và phạm vi | Mức xác minh | Được dùng để làm gì |
| --- | --- | --- | --- |
| `SRC-MATH-2018` | [PDF Chương trình giáo dục phổ thông môn Toán](https://admintruong.haiphong.shieldix.app/data/haiphong/thcsandong/2023_6/1/3-cttoan_16202319.pdf), được [trường THCS An Đồng công bố](https://thcsandong.haiphong.edu.vn/van-ban-bo-gddt/chuong-trinh-giao-duc-pho-thong-mon-toan-ban-hanh-kem-theo-thong-tu-so-322018tt/vbct/20343/91425) là tài liệu ban hành kèm Thông tư 32/2018/TT-BGDĐT | **Đã đọc PDF 123 trang**; mục lớp 8 “Phương trình bậc nhất” ở trang in 65 (trang PDF 65 nếu đếm từ 1, chỉ số PDF `P64` nếu đếm từ 0). Yêu cầu gồm hiểu khái niệm/cách giải và giải quyết vấn đề thực tiễn gắn với phương trình bậc nhất | Căn cứ nội dung cho **ví dụ** CLO lớp 8 về phương trình. Trước khi dùng chính thức, kiểm tra bản áp dụng và văn bản sửa đổi hiện hành |
| `SRC-GDPT-GENERAL` | [Chương trình giáo dục phổ thông tổng thể trên cổng Bộ GDĐT](https://moet.gov.vn/content/vanban/Lists/VBPQ/Attachments/1483/vbhn-chuong-trinh-tong-the.pdf) và [văn bản hợp nhất Thông tư 32/2018](https://moet.gov.vn/content/vanban/Lists/VBPQ/Attachments/1453/vbhn-322018-202021-ttbgddt-trinh-ky-xt.pdf) | Kết quả tra cứu xác nhận tiêu đề/nguồn; máy đọc PDF của phiên khảo sát bị timeout, **chưa đối chiếu từng điều/phụ lục** | Khung pháp lý cần kiểm tra thủ công trước khi gắn nhãn CTGDPT |
| `SRC-KHTN-2018` | [PDF Chương trình môn Khoa học tự nhiên](https://filethcs.hcm.shieldix.app/data/hcmedu/thcsphongphu/attachments/2020_7/11ctkhoahoctunhien281220188_87202018.pdf), được [THCS Phong Phú công bố](https://thcsphongphu.hcm.edu.vn/van-ban/chuong-trinh-giao-duc-pho-thong-mon-khoa-hoc-tu-nhien/vbctmb/64151/473422) kèm Thông tư 32/2018 | **Đã đọc PDF 90 trang**: nội dung lớp 6 trang in 22–32, lớp 7 trang 33–42, lớp 8 trang 43–58, lớp 9 trang 59–75. Chưa đối chiếu từng CLO demo tới yêu cầu cụ thể | Nguồn ứng viên cho 32 CLO Hóa/Sinh; từng CLO vẫn `CANDIDATE` cho tới khi giáo viên xác minh mục/trang |
| `SRC-IELTS` | [IELTS scoring in detail](https://www.ielts.org/take-a-test/your-results/ielts-scoring-in-detail) | Đã đọc tiêu chí và thang điểm công khai | Chỉ dùng khi sau này tạo khóa IELTS; **không áp dụng** cho 16 chương trình hiện tại |
| `SRC-CANVAS` | [Canvas Outcomes](https://community.instructure.com/en/kb/articles/662762-what-are-outcomes), [Learning Mastery Gradebook](https://community.instructure.com/en/kb/articles/660867-how-do-i-use-the-learning-mastery-gradebook-to-view-outcome-results-in-a-course-from-the-gradebook) | Đã đọc tài liệu sản phẩm | Tham khảo liên kết outcome–rubric–bài làm và báo cáo theo outcome |
| `SRC-MOODLE` | [Moodle Competencies](https://docs.moodle.org/503/en/Competencies) | Đã đọc tài liệu sản phẩm | Tham khảo khung năng lực, liên kết khóa học/hoạt động và minh chứng |

**Không dùng bản dự thảo Khoa học tự nhiên 2018 như bản ban hành.** Vật lý, Hóa học, Sinh học khối 6–9 trong EduGrade là cách chia chương trình của trung tâm. Muốn tuyên bố đối chiếu CTGDPT phải xác định rõ chúng tương ứng với phần nào của **môn Khoa học tự nhiên THCS** trong phụ lục áp dụng, theo đúng khối. Seed mới tạo mapping chủ đề demo sang phạm vi trang của từng lớp; đây chưa phải ma trận đối chiếu từng yêu cầu cần đạt.

## 3. Minh họa đối chiếu một CLO và ranh giới của nguồn

Trong `SRC-MATH-2018`, trang in 65, lớp 8, mục Số và Đại số → Phương trình → Phương trình bậc nhất ghi yêu cầu về **khái niệm, cách giải và ứng dụng thực tiễn**. Đây là căn cứ nội dung cho một **bộ CLO do EduGrade diễn giải**, ví dụ:

| CLO minh họa | Liên hệ nguồn | Phần do EduGrade tự đặt |
| --- | --- | --- |
| `M8-EQ-01`: nhận biết một phương trình bậc nhất một ẩn | Diễn giải từ yêu cầu hiểu khái niệm | Cách hỏi, số câu, tiêu chí phân loại |
| `M8-EQ-02`: giải và trình bày cách giải | Diễn giải từ yêu cầu hiểu cách giải | Cách chấm lập luận, mức điểm |
| `M8-EQ-03`: giải tình huống thực tiễn bằng phương trình | Diễn giải từ yêu cầu giải quyết vấn đề thực tiễn | Dạng tình huống, độ khó và rubric |

Ví dụ `EQ-CLO1`–`EQ-CLO4` trong tài liệu thiết kế trước là **mẫu tôi viết**, chưa được giáo viên đối chiếu/duyệt; mã `M8-EQ-*` ở bảng này cũng chỉ minh họa. Bộ GDĐT **không** đặt các mã này và **không** quy định trong nguồn trên rằng phải đạt 70%, 4/5 hay hai bài độc lập. CLO kiểm tra “tìm và sửa lỗi” cần đánh dấu là mục tiêu bổ sung nội bộ nếu chưa tìm được yêu cầu nguồn tương ứng.

Mẫu hồ sơ nguồn bắt buộc cho **mỗi CLO thật**:

```text
cloCode: M8-EQ-02
subject: Toán
grade: 8
level: Cơ bản (tên cấp độ do trung tâm định nghĩa)
statement: [năng lực có thể quan sát và đo]
sourceId: SRC-MATH-2018
sourceVersion: 2018, kèm kết quả kiểm tra sửa đổi
sourceLocator: Lớp 8 > Số và Đại số > Phương trình > Phương trình bậc nhất; trang in 65
sourceExcerptOrParaphrase: [trích ngắn có kiểm tra hoặc diễn giải]
mappingRationale: [CLO cụ thể hóa yêu cầu nguồn như thế nào]
internalAdditions: [ngưỡng, số lần đo, mức khó, yêu cầu giám sát]
evidence: [bài học, câu hỏi, rubric, bài xác nhận]
verificationStatus: UNVERIFIED | VERIFIED | REJECTED
verifiedBy / verifiedAt: [giáo viên chuyên môn và thời điểm]
```

Nếu một CLO không tìm được nguồn tương ứng, ghi `sourceType=INTERNAL`, ghi lý do và người duyệt; tuyệt đối không gắn `SRC-MATH-2018` chỉ vì cùng tên chủ đề. Với mỗi level, CLO được phiên bản hóa theo **môn + khối + phạm vi khóa + level**; khối lớp không thay cho level năng lực.

## 4. Hiện trạng code và điểm cần thêm

| Vị trí hiện có | Hiện làm gì | Khi triển khai CLO cần thêm |
| --- | --- | --- |
| `prisma/schema.prisma`: `Program`, `CurriculumUnit`, `Lesson` | Môn/khối, phiên bản giáo trình, bài học | Bộ CLO có phiên bản, nguồn, level và mapping bài học |
| `src/modules/curriculum-scheduling/curriculum-scheduling.service.ts`: `technicalReview`, `approveUnit` | Giáo viên duyệt chuyên môn rồi Manager duyệt; kiểm tra bài học và thứ tự | Chặn duyệt khi thiếu nguồn đã xác minh, CLO bắt buộc, bài dạy hoặc kế hoạch đánh giá |
| `src/modules/academic/academic.dto.ts`: `AssignmentDto`, `QuestionDto`, `GradeDto` | Nhận đề, câu, rubric văn bản và điểm câu | Blueprint, tiêu chí rubric cấu trúc, CLO cho từng tiêu chí, điểm tiêu chí |
| `src/modules/academic/assessment.service.ts`: `validateDefinition`, `publish` | Kiểm tra đề cơ bản và danh sách nhận bài | Kiểm tra đúng bộ CLO/level, rubric và snapshot khi publish |
| `src/modules/academic/assessment.service.ts`: `grade`, `publishGrade` | Duyệt/công bố điểm theo revision | Ghi minh chứng và tính lại đạt CLO từ điểm đã công bố |
| `src/modules/academic/assessment.service.ts`: `detail` | Rubric văn bản chỉ cho TEACHER | Trả tiêu chí công khai cho người nhận; giữ đáp án/ghi chú nội bộ riêng |
| `src/modules/academic/grading-worker.service.ts` | AI gợi ý chấm theo rubric được cấp | Gắn AI với rubric snapshot; chỉ gợi ý, không duyệt CLO hay chứng nhận nguồn |
| `src/database/seeds/curriculum-content.ts` | Nội dung mẫu, có ghi là minh họa | Không tự biến thành nội dung “đạt CTGDPT”; seed CLO mẫu phải ghi nguồn/trạng thái đúng |

**Tên role trong schema là `CURRICULUM_DESIGNER`, không phải `DESIGNER`.** Các role hiện có: `STAFF`, `MANAGER`, `TEACHER`, `CURRICULUM_DESIGNER`, `PARENT`; chưa có role `STUDENT`. Điều này sửa cách gọi tắt của trao đổi trước. Parent là người nộp bài thay học sinh trong API hiện tại.

## 5. Luồng nghiệp vụ chi tiết sau khi triển khai

1. **Manager cấu hình chương trình/level.** Mỗi phiên bản bộ CLO thuộc một `Program` và một level mục tiêu; level của trung tâm phải có tên và mô tả năng lực, không tự quy đổi thành IELTS/CEFR.
2. **CURRICULUM_DESIGNER lập bộ CLO và giáo trình trong draft.** Có thể nhập giáo trình trước để hệ thống gợi ý CLO; cuối cùng phải nối từng CLO với mục/trang nguồn, bài học và cách đánh giá. Chỉnh CLO và giáo trình qua lại trong draft là hợp lệ.
3. **Hệ thống kiểm tra cấu trúc.** Kiểm tra nguồn còn hợp lệ, đúng môn/khối/level, mỗi CLO bắt buộc có bài dạy và ít nhất hai cơ hội đánh giá; bài học/assignment không trỏ CLO ngoài bộ chuẩn. Đây là kiểm tra dữ liệu và độ bao phủ.
4. **Giáo viên duyệt nội dung.** Đọc đoạn nguồn, CLO, giáo trình và đề; xác nhận đúng kiến thức, đúng độ khó và rubric đo đúng năng lực. Nếu có AI rà soát văn bản, AI chỉ nêu đoạn chứng cứ/điểm nghi ngờ; giáo viên phải xác nhận. Backend không thể chứng minh đúng chuyên môn chỉ từ việc có link/mapping.
5. **Manager phê duyệt phiên bản.** Bộ CLO và giáo trình được khóa phiên bản; đổi nội dung sau đó tạo phiên bản mới, giữ lịch sử đánh giá cũ.
6. **Teacher soạn và phát hành assignment.** Chọn CLO đã duyệt; mỗi câu có tiêu chí rubric công khai, điểm tối đa và mapping CLO. Khi publish, backend đối chiếu tổng điểm, phạm vi lớp/level, bản chuẩn và snapshot rubric; bài nháp thiếu CLO bị chặn.
7. **Parent/học sinh xem mục tiêu.** Parent đúng con xem CLO, yêu cầu đạt và rubric công khai trước khi làm bài; đáp án/lời giải và ghi chú chấm nội bộ chỉ công bố theo quyền/mốc hiện có.
8. **Làm bài, chấm và công bố.** Teacher chấm từng tiêu chí hoặc duyệt gợi ý AI; chỉ GradeReview đã công bố mới sinh minh chứng. Chấm lại thay thế kết quả revision trước, không cộng trùng.
9. **Tính đạt CLO và phụ đạo.** Mỗi CLO đạt khi có hai assignment độc lập đạt ngưỡng nội bộ đã duyệt; lần cuối là bài xác nhận có giám sát. Báo cáo ghi `NOT_ASSESSED`, `INSUFFICIENT_EVIDENCE`, `NOT_YET_MET`, `MET` và dẫn tới từng bằng chứng. Giáo viên xem CLO còn yếu để giao bài mới.

**Bài đã phát hành trước triển khai:** giữ luồng nộp/chấm cũ và đánh dấu `LEGACY_UNMAPPED`; không suy CLO từ tổng điểm cũ. **Bài mới và bài nháp cũ:** bắt buộc hoàn thiện CLO trước khi publish, theo quyết định phạm vi toàn hệ thống.

## 6. Trình tự implementation cho kỹ sư

1. **Xác minh nguồn học thuật.** Thu bản áp dụng của chương trình Toán và Khoa học tự nhiên, kiểm tra sửa đổi, ghi số trang/mục cho 16 chương trình. Mỗi CLO thật có hồ sơ nguồn ở mục 3; giáo viên xác nhận mapping. Chưa hoàn tất bước này thì chỉ có thể tạo draft nội bộ.
2. **Thêm migration Prisma không phá dữ liệu cũ.** Thêm framework/source, level, outcome set/version, CLO, source mapping, lesson mapping, blueprint, rubric criterion/version, criterion score, evidence và attainment; khóa ngoại/index/unique cần ngăn dùng sai phiên bản và đếm trùng.
3. **Thêm API quản lý CLO theo vai trò.** `CURRICULUM_DESIGNER` tạo/sửa draft, `TEACHER` được chỉ định review, `MANAGER` approve. Mỗi quyết định review/approve lưu người, thời điểm, phiên bản, ghi chú và trạng thái nguồn.
4. **Gắn với quy trình giáo trình.** Bước duyệt hiện có phải nhận đúng outcome-set version và kiểm tra coverage; trả danh sách CLO/bài học/đánh giá thiếu để sửa được.
5. **Gắn với assignment và chấm điểm.** Preview import chỉ tạo gợi ý/draft; publish bắt buộc blueprint hợp lệ và tạo snapshot; chấm điểm theo tiêu chí nhưng vẫn trả tổng điểm tương thích API cũ.
6. **Thêm tính toán và báo cáo.** Chỉ lấy điểm công bố, loại revision cũ, kiểm tra hai assignment độc lập và bài xác nhận; xử lý chấm lại/chuyển lớp theo phạm vi khóa học; lưu provenance của kết quả.
7. **Cutover sau khi dữ liệu sẵn sàng.** Nạp/duyệt 16 bộ CLO, cập nhật mọi draft cần phát hành, rồi bật kiểm tra bắt buộc toàn hệ thống. Nếu còn chương trình chưa duyệt, các assignment của chương trình đó phải chờ; không tạo CLO giả để vượt chặn.

Kiểm thử cần có: nguồn thiếu hoặc sai khối bị từ chối; giáo trình thiếu CLO bị trả về draft; assignment sai level/thiếu rubric không publish; rubric công khai không lộ đáp án; bài legacy vẫn chấm; hai lần đạt khác assignment mới tính `MET`; chấm lại/AI nháp không tạo kết quả giả; đổi phiên bản chuẩn không thay điểm lịch sử. Chạy `pnpm prisma:validate`, `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm test:e2e`, `pnpm build` trên database test sau mỗi nhóm migration/API hoàn thành.

## 7. Quy tắc chống thông tin không có căn cứ

- Mỗi CLO có link nguồn **trực tiếp**, bản/phiên bản, mục/trang, nội dung đối chiếu, người xác minh. Link tới trang chủ hoặc chỉ tới toàn bộ PDF là chưa đủ để duyệt một CLO.
- Nguồn chưa đọc được ghi `UNVERIFIED`; không điền số trang hoặc câu chữ bằng suy đoán. Cần giáo viên cung cấp/xác nhận bản áp dụng nếu đường dẫn công khai lỗi.
- Phân biệt rõ **yêu cầu trong nguồn**, **CLO trung tâm diễn giải**, **chính sách chấm nội bộ**; hiển thị ba phần này riêng trong giao diện review/audit.
- Không dùng Moodle, Canvas hoặc IELTS làm căn cứ nội dung cho Toán/KHTN. Không tuyên bố “đạt chuẩn CTGDPT” chỉ vì AI đánh dấu phù hợp.
- Nguồn có thể thay đổi; phiên bản đã dùng để đánh giá học sinh phải được giữ cùng lịch sử. Bản mới phải được đối chiếu và duyệt lại.
