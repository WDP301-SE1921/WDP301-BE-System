---
name: ai-grading
description: Hướng dẫn và quy chuẩn thiết kế Giáo trình, Barem điểm và cách vận hành AI Grading trong EduGrade.
---

# EduGrade AI Grading Skill

Skill này cung cấp quy chuẩn và luồng nghiệp vụ chấm bài tự động bằng AI trong EduGrade.

## Vòng đời CLO

Thiết kế giáo trình soạn → giáo viên của khóa xác minh nguồn và duyệt chuyên môn → `APPROVED`, dùng ngay. Không có bước quản lý duyệt CLO. Quản lý có thể ghi yêu cầu điều chỉnh; bộ đang dùng giữ nguyên, Designer tạo phiên bản mới để giáo viên duyệt lại.

## 1. Cấu trúc ngữ cảnh chấm bài
Khi AI thực hiện chấm bài qua `GradingWorkerService`, ngữ cảnh gửi vào AI bao gồm:
1. **Curriculum (Giáo trình):**
   - Thông tin môn học, khối lớp (`Program`).
   - Nội dung bài học (`Lesson`) thuộc buổi học (`ClassSession.lesson`) hoặc danh sách bài học đã duyệt của chương trình (`programLessons`).
2. **Assignment & Questions (Đề bài & Barem điểm):**
   - Barem điểm chi tiết (`rubric`), đáp án chuẩn (`correctAnswer`) và điểm tối đa (`maxScore`).
   - Chuẩn đầu ra (`LearningOutcome`) tương ứng với từng câu hỏi (nếu có).
3. **Student Submission (Bài làm của học sinh):**
   - Danh sách câu trả lời của học sinh theo từng `questionId`.

## 2. Quy tắc chấm điểm (Scoring Rules)
- **Câu trắc nghiệm (`MULTIPLE_CHOICE`):**
  - Khớp đáp án chuẩn -> đạt tối đa `maxScore`.
  - Sai đáp án -> `0` điểm.
- **Câu tự luận (`ESSAY`):**
  - Chấm từng bước theo barem điểm (`rubric`) và kiến thức bài học trong giáo trình.
  - Tổng điểm các bước phải thỏa mãn: `0 <= score <= maxScore`.
  - Nhận xét (`feedback`): Viết bằng tiếng Việt, giải thích rõ các bước đạt điểm theo barem và các điểm thiếu/sai đối chiếu với bài học.
  - `feedback` là lời gửi học sinh: web chép nó vào ô nhận xét khi giáo viên áp đề xuất, công bố xong thì phụ huynh đọc được trên mobile. Không viết lời nhắc cho giáo viên, không nhắc tới tệp đính kèm.
- **Rubric có cấu trúc:** `AssignmentQuestion.criteria` lưu các tiêu chí có id, tên, hướng dẫn và điểm tối đa. AI trả điểm/nhận xét theo `criterionId`; BE kiểm tra phạm vi rồi tự tính tổng. Rubric đã giao bị khóa; bản chấm lưu `rubricSnapshot`.
- **Bài nộp có tệp đính kèm:** `SubmissionReaderService` đọc ảnh/PDF bằng cấu hình `AI_VISION_*` trước khi chấm. Kết quả giữ nguồn tệp/trang và nội dung đọc được. Câu mờ, không khớp hoặc đọc thất bại được đưa vào `manualReviewQuestionIds`, không tự cho 0. Giáo viên có thể gửi `corrections` để chấm lại mà không sửa bài nộp gốc. Nếu chưa cấu hình vision, chấm thủ công các câu tự luận có tệp; không khẳng định đã đọc ảnh.

## 3. Cấu hình AI Provider (DeepSeek / OpenAI)
- `AI_API_KEY`: API key của DeepSeek hoặc OpenAI.
- `AI_CHAT_URL`: Mặc định `https://api.deepseek.com/chat/completions` khi có `AI_API_KEY`.
- `AI_MODEL`: Mặc định `deepseek-chat` khi có `AI_API_KEY`.
