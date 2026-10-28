---
name: ai-grading
description: Hướng dẫn và quy chuẩn thiết kế Giáo trình, Barem điểm và cách vận hành AI Grading trong EduGrade.
---

# EduGrade AI Grading Skill

Skill này cung cấp quy chuẩn và luồng nghiệp vụ chấm bài tự động bằng AI trong EduGrade.

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

## 3. Cấu hình AI Provider (DeepSeek / OpenAI)
- `AI_API_KEY`: API key của DeepSeek hoặc OpenAI.
- `AI_CHAT_URL`: Mặc định `https://api.deepseek.com/chat/completions` khi có `AI_API_KEY`.
- `AI_MODEL`: Mặc định `deepseek-chat` khi có `AI_API_KEY`.
