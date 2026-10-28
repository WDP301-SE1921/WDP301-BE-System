# HƯỚNG DẪN TRIỂN KHAI & TỔNG QUAN LUỒNG CHẤM BÀI BẰNG AI (AI GRADING SYSTEM)

> **Tài liệu tham chiếu**: Hệ thống EduGrade (Phân hệ Học vụ & Đánh giá Sư phạm)  
> **Cập nhật ngày**: 28/10/2026  
> **Nhánh phát triển**: `feature/intergare-ai`  
> **AI Engine hỗ trợ**: DeepSeek-Chat (`deepseek-chat`), OpenAI GPT-4o / GPT-4o-mini  

---

## I. TỔNG QUAN KIẾN TRÚC & QUY TRÌNH NGHIỆP VỤ

Luồng chấm bài tự động bằng AI trong EduGrade được thiết kế theo mô hình **Sư phạm hướng mục tiêu (Outcome-Based Education - OBE)**, kết hợp đa tầng dữ liệu:

```
[1. GIÁO TRÌNH & BÀI HỌC] ──┐
  (Curriculum & Lesson)     │
                            ▼
[2. CHUẨN ĐẦU RA (CLO)] ────┼──► [4. BÀI TẬP & BAREM] ──► [5. HỌC SINH NỘP BÀI]
  (OutcomeSet & Outcomes)   │      (Rubric, MaxScore)       (Answers, File/Images)
                            │                                         │
[3. AI GRADING WORKER] ─────┘                                         │
  (Prompt Engineering + Fallback) ◄───────────────────────────────────┘
               │
               ▼
   [6. GỢI Ý ĐIỂM & NHẬN XÉT] ──► [7. GIÁO VIÊN DUYỆT] ──► [8. CÔNG BỐ PHỤ HUYNH]
```

### 1. Luồng dữ liệu chi tiết qua 8 giai đoạn:
1. **Thiết kế Giáo trình & Soạn CLO**: Thiết kế viên (`curriculum_designer`) tạo giáo trình và bộ chuẩn đầu ra (CLO), gắn bài học tương ứng.
2. **Xác minh & Phê duyệt**: Giáo viên (`teacher`) của khóa học đối chiếu nguồn căn cứ của từng CLO để xác minh; Quản lý (`center_manager`) phê duyệt bộ CLO (`APPROVED`).
3. **Giao bài tập**: Giáo viên soạn bài tập (Trắc nghiệm hoặc Tự luận), chọn bộ CLO của khóa học, gắn từng câu hỏi với một CLO cụ thể và thiết lập Barem điểm chi tiết (`rubric`).
4. **Học sinh làm bài**: Học sinh gửi câu trả lời văn bản và có thể tải lên tệp/ảnh đính kèm (sơ đồ tư duy, bài giải viết tay, code, v.v.).
5. **Kích hoạt chấm AI**: Giáo viên mở bài nộp trong `GradingWorkspace` và bấm **"Gợi ý AI"** (`POST /academic/submissions/:id/grade-ai`).
6. **Xử lý nền (Grading Worker)**:
   - Hệ thống tổng hợp đầy đủ: Thông tin môn học, nội dung bài học, chuẩn đầu ra (CLO), barem điểm từng câu, câu trả lời của học sinh, và cờ trạng thái tệp đính kèm (`hasAttachments`).
   - Gửi yêu cầu chấm điểm đến DeepSeek/OpenAI với prompt sư phạm chuẩn tiếng Việt.
7. **Đề xuất gợi ý cho Giáo viên**: AI trả về điểm số từng câu kèm nhận xét phân tích sư phạm. Nếu bài làm có tệp đính kèm, AI sẽ chấm phần văn bản và nhắc giáo viên kiểm tra bổ sung tệp đính kèm.
8. **Giáo viên phê duyệt & Công bố**: Giáo viên bấm **"Dùng gợi ý cho câu tự luận"**, điều chỉnh điểm số (nếu cần), rồi bấm **"Lưu nháp"** hoặc **"Gửi điểm cho phụ huynh"** (`Draft -> Approved -> Published`).

---

## II. CÁC THAY ĐỔI MỚI VỀ LUỒNG NGHIỆP VỤ (CHANGELOG & UPDATES)

### 1. Hỗ trợ chấm AI khi bài nộp có tệp đính kèm (`hasAttachments`)
- **Trước đây**: Khi học sinh đính kèm tệp (`submission.files.length > 0`), Backend chặn cứng với mã lỗi HTTP 409 `AI_ATTACHMENTS_UNSUPPORTED`, và Frontend vô hiệu hóa nút bấm.
- **Hiện tại**:
  - Gỡ bỏ hoàn toàn chặn cứng tại `grading-worker.service.ts`.
  - Bổ sung trường `hasAttachments: boolean` trong ngữ cảnh chấm bài của `ai-grading-skill.ts`.
  - Prompt AI được bổ sung chỉ dẫn:
    > *"Bài nộp của học sinh có tệp đính kèm (ảnh bài làm, tài liệu). AI hãy chấm phần câu trả lời văn bản hiện có theo đúng barem, đồng thời trong feedback hãy ghi rõ lưu ý nhắc giáo viên kiểm tra tệp đính kèm của học sinh để đánh giá trọn vẹn."*
  - Frontend mở khóa nút bấm **"Gợi ý AI"** ngay cả khi có tệp đính kèm.

### 2. Bổ sung trọn bộ CRUD cho Chuẩn Đầu Ra (CLO)
Backend và Frontend hiện đã hỗ trợ đầy đủ vòng đời của bộ CLO:
- `GET /academic/outcome-sets/:id`: Lấy chi tiết một bộ CLO.
- `PATCH /academic/outcome-sets/:id`: Sửa thông tin cấp độ (`level`) của bộ CLO nháp.
- `DELETE /academic/outcome-sets/:id`: Xóa bộ CLO nháp chưa được duyệt.
- `DELETE /academic/outcome-sets/:id/outcomes/:outcomeId`: Xóa một mục CLO cụ thể khỏi bộ nháp.

### 3. Cơ chế Fallback an toàn (Safe Fallback Engine)
Nếu hệ thống gặp sự cố mạng, timeout (>30s) hoặc chưa cấu hình `AI_API_KEY`, `ai-grading-skill.ts` sẽ tự động chuyển sang bộ chấm suy luận nội bộ:
- **Câu trắc nghiệm (`MULTIPLE_CHOICE`)**: Khớp đáp án chuẩn $\rightarrow$ đạt điểm tối đa `maxScore`; sai $\rightarrow$ `0` điểm.
- **Câu tự luận (`ESSAY`)**: Chấm theo tỷ lệ hoàn thành nội dung và từ khóa trong barem, trả về nhận xét sư phạm tiếng Việt chuẩn mực.

---

## III. HƯỚNG DẪN TÍCH HỢP API CHO FRONTEND

### 1. Kích hoạt Job chấm bài AI
- **Endpoint**: `POST /api/v1/academic/submissions/:submissionId/grade-ai`
- **Quyền hạn**: Giáo viên được phân công lớp học (`TEACHER`)
- **Response**:
  ```json
  {
    "id": "job_cuid...",
    "submissionId": "sub_cuid...",
    "status": "QUEUED",
    "createdAt": "2026-10-28T14:30:00.000Z"
  }
  ```

### 2. Theo dõi tiến trình Job chấm AI (Polling)
- **Endpoint**: `GET /api/v1/academic/grading-jobs/:jobId`
- **Status chu kỳ**: `QUEUED` $\rightarrow$ `PROCESSING` $\rightarrow$ `SUCCEEDED` (hoặc `FAILED`)
- **Response khi thành công (`SUCCEEDED`)**:
  ```json
  {
    "id": "job_cuid...",
    "submissionId": "sub_cuid...",
    "status": "SUCCEEDED",
    "result": {
      "scores": [
        {
          "questionId": "q_1",
          "score": 10,
          "feedback": "Học sinh chọn đáp án chính xác A."
        },
        {
          "questionId": "q_2",
          "score": 8.5,
          "feedback": "Bài làm giải đúng các bước phương trình theo barem CLO1. Lưu ý: Bài có tệp đính kèm, giáo viên vui lòng kiểm tra thêm ảnh giải chi tiết."
        }
      ]
    },
    "error": null
  }
  ```

### 3. Lưu điểm & Công bố kết quả
- **Lưu nháp điểm**:
  `POST /api/v1/academic/submissions/:submissionId/grades`
  Body: `{ scores: [...], feedback: "..." }`
- **Duyệt điểm**:
  `POST /api/v1/academic/grades/:gradeId/approve`
- **Công bố cho phụ huynh**:
  `POST /api/v1/academic/grades/:gradeId/publish`

---

## IV. CẤU HÌNH MÔI TRƯỜNG & KIỂM THỬ

### 1. Cấu hình file `.env` (Backend)
```env
AI_API_KEY="sk-your-deepseek-or-openai-key"
AI_CHAT_URL="https://api.deepseek.com/chat/completions"
AI_MODEL="deepseek-chat"
```

### 2. Chạy kịch bản mô phỏng kiểm thử toàn diện
Để kiểm tra trọn vẹn luồng từ đầu đến cuối trên cơ sở dữ liệu thật với AI live:
```powershell
npx ts-node scripts/full-academic-flow-simulation.ts
```
