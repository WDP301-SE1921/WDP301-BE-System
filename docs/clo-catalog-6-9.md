# Danh mục mục tiêu học tập lớp 6–9

Edition `ctst-2026-11-19` tạo **16 bộ mục tiêu nháp và 425 mục tiêu**, gồm Toán, Vật lý, Hóa học, Sinh học lớp 6–9. Mỗi mục sách liên kết một mục tiêu học tập có tên sách, nguồn điện tử và vị trí chương/bài/trang cụ thể.

[Dữ liệu chi tiết](textbook-curriculum-catalog.md) ghi toàn bộ mục tiêu theo từng chương trình; [hướng dẫn giáo trình](textbook-curriculum.md) mô tả nguồn và lệnh áp dụng.

Mục tiêu do trung tâm diễn đạt theo phạm vi sách Chân trời sáng tạo. Việc đối chiếu tên bài, chương và trang không thay thế giáo viên thẩm định cách diễn đạt, bài tập và mức yêu cầu. Bộ giữ `DRAFT`, nguồn giữ `CANDIDATE`, không tự điền người hay ngày xác minh. Giáo viên dùng luồng xác minh và duyệt hiện có trước khi đưa bộ mục tiêu vào đánh giá.

Seed demo mới dùng [seed-learning-outcomes.ts](../src/database/seeds/seed-learning-outcomes.ts). Với database có dữ liệu, `pnpm db:seed:curriculum --apply` tạo bộ nháp riêng gắn với giáo trình nháp Chân trời sáng tạo; bộ đã sửa, đã duyệt và các bài đánh giá cũ giữ nguyên. Chạy lại không tạo trùng hoặc ghi đè.

Các mục tiêu không phải câu trích nguyên văn hay chứng nhận đạt Chương trình giáo dục phổ thông của Bộ Giáo dục và Đào tạo. Bài tập kèm lời giải là nội dung biên soạn của trung tâm theo mục sách.
