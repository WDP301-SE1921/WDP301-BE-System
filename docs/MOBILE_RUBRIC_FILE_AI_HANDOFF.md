# Bàn giao mobile: nộp file/ảnh, rubric và kết quả chấm

Ngày 10/11/2026. Giao diện mobile do nhóm khác triển khai. Base API: `/api/v1`, Bearer access token. Envelope: `{ success: true, data: ... }`; lỗi: `{ success: false, error: { code, message, ... } }`.

## Role và quyền

- `PARENT` upload/nộp/xem bài của học sinh thuộc tài khoản mình. Không có login `STUDENT`.
- `TEACHER` soạn bài, gắn tệp, đọc/chấm AI, lưu/duyệt/công bố điểm trong lớp được phân công.
- Không thêm parent UI vào FE web để giả lập mobile. Có thể dùng Swagger trong lúc mobile chưa xong.

## API và thứ tự gọi

| Bước | Method / path | Body / lưu ý |
|---|---|---|
| Danh sách bài | `GET /academic/assignments?studentId={id}` | Chỉ bài được giao cho học sinh; dùng bộ lọc/phân trang hiện có. |
| Chi tiết | `GET /academic/assignments/{assignmentId}` | Có questions, recipients, files. Chọn recipient khớp enrollment của học sinh đang thao tác. Tệp teacherOnly bị lọc phía server. |
| Upload mỗi tệp | `POST /academic/files` | `multipart/form-data`, đúng một field `file`. PDF/JPG/PNG, >0 và ≤10 MB. Trả `{id,name,mimeType,size}`; giữ id, không giữ signed URL như định danh. |
| Nộp | `POST /academic/submissions` | JSON mẫu bên dưới. Tối đa 5 fileIds, không trùng. Chờ upload xong trước khi gọi. |
| Xem lần nộp/điểm | `GET /academic/assignments/{assignmentId}/submissions` | PARENT chỉ nhận bài thuộc tài khoản và điểm PUBLISHED. |
| Xem tệp | `GET /academic/files/{fileId}/preview` | `{url,expiresIn}`, link có hạn. Ảnh/PDF hỗ trợ inline; không dùng WebView cho URL không do API cấp. |
| Tải tệp | `GET /academic/files/{fileId}/download` | Xin URL mới khi cần tải. Server kiểm tra quyền trước khi ký URL. |

### Nộp bài chỉ có ảnh hoặc PDF

```json
{
  "recipientId": "recipient-cua-hoc-sinh",
  "answers": [
    { "questionId": "cau-1", "answer": "", "fileIds": ["file-anh-trang-1"] },
    { "questionId": "cau-2", "answer": "", "fileIds": ["file-pdf"] }
  ],
  "fileIds": ["file-anh-trang-1", "file-pdf"]
}
```

Phải có đúng một answer cho mỗi câu. Có thể nhập chữ cùng ảnh. Một file chứa nhiều câu được dùng ở nhiều `answers[].fileIds`; tổng fileIds vẫn không trùng. Không bắt buộc mapping theo câu: nếu bỏ `answers[].fileIds`, AI sẽ thử ghép tệp toàn bài và chuyển câu không chắc sang kiểm tra thủ công.

Trắc nghiệm thông thường gửi `answer` bằng **đầy đủ nội dung lựa chọn**, không gửi “A/B/C/D”. Nếu bài làm nằm trong file, cho phép chuỗi rỗng khi có tệp đính kèm; giáo viên cần đọc/chấm hoặc dùng vision AI trước khi xác nhận điểm.

### Hiển thị tệp đề

`assignment.files[]` gồm `fileId`, `teacherOnly`, `questionPosition`, `file: {name,mimeType,size}`. `questionPosition` tính từ 0; null nghĩa toàn bài. PARENT chỉ thấy tệp cho phép học sinh xem. Không tự gọi endpoint teacher để lấy đáp án/rubric nháp.

### Hiển thị điểm

`submission.grades[]` cho PARENT chỉ có bản công bố. Mỗi score có `questionId`, `score`, `feedback` và tùy bài có `criteria: [{criterionId,score,feedback}]`. `rubricSnapshot` của bản chấm cung cấp cấu trúc câu/tiêu chí để gắn tên và điểm tối đa theo id. Bài cũ có thể không có snapshot/criteria: fallback hiển thị điểm và nhận xét theo câu.

Không hiển thị “chưa đạt/0 điểm” khi chưa có bản PUBLISHED. Không gọi `grade-ai` từ PARENT; teacher dùng web để kiểm tra trước khi công bố.

## UI mobile cần làm

1. Chọn học sinh → bài tập/kiểm tra → đọc đề và tệp.
2. Nhập câu trả lời; chọn nhiều ảnh/file hoặc chụp ảnh. Hiển thị tên, dung lượng, preview, tiến trình và lỗi riêng từng tệp.
3. Cho xóa/sắp xếp ảnh trước khi upload; giữ thứ tự upload/fileIds theo thứ tự người dùng chọn. Cho gắn tệp với câu nếu cần.
4. Chặn nút nộp khi còn upload hoặc có tệp bắt buộc chưa thành công. Tải lại riêng tệp lỗi, không tải lại toàn bộ tệp đã thành công.
5. Chỉ báo thành công sau khi API nộp trả thành công. Với mất mạng sau submit mà chưa rõ kết quả, đọc danh sách lần nộp trước khi thử lại để tránh tạo thêm lần nộp.
6. Trang kết quả đọc bản chấm đã công bố, gồm tiêu chí và nhận xét nếu có. Xin lại URL tệp khi hết hạn.

## Lỗi cần ánh xạ

| Code / trạng thái | Thông báo và hành động |
|---|---|
| `INVALID_FILE_SIZE`, HTTP 413 | Tệp phải lớn hơn 0 và tối đa 10 MB; chọn/tối ưu lại tệp. |
| `INVALID_FILE_TYPE` | Chỉ nhận PDF, JPG, PNG đúng định dạng thực tế. |
| `INVALID_FILES` | Tệp không tồn tại, trùng hoặc không thuộc người nộp; tải lại tệp đúng tài khoản. |
| `INVALID_FILE_QUESTION` | Mapping theo câu tham chiếu tệp không có trong fileIds toàn bài; sửa payload. |
| `INVALID_ANSWERS`, `INVALID_CHOICE` | Thiếu/trùng/sai câu hoặc lựa chọn; đối chiếu chi tiết bài. |
| `SUBMISSION_CLOSED` | Bài hết hạn/chưa mở hoặc ghi danh không còn hiệu lực. |
| `ATTEMPTS_EXHAUSTED` | Hết số lần nộp; giữ nội dung và thông báo phụ huynh liên hệ giáo viên. |
| 401 / 403 / 404 | Làm mới đăng nhập / không thuộc quyền / dữ liệu không còn tồn tại. Không đổi sang tài khoản khác để truy cập. |
| 5xx / mất mạng | Giữ nội dung trên máy; thử lại upload riêng tệp lỗi, kiểm tra lịch sử trước khi thử lại submit. |

Giới hạn AI đọc một lượt hiện là 5 tệp, tổng 30 MB và 10 trang/ảnh. Upload hợp lệ chưa đồng nghĩa mọi bài đều đọc tự động được; các bài vượt khả năng đọc vẫn được giáo viên chấm thủ công trên web.

## Hợp đồng API chấm ảnh/PDF phía BE

Luồng BE: upload tệp riêng tư → nộp bài → giáo viên tạo tác vụ → vision đọc từng ảnh/trang PDF → AI chấm bản đọc theo rubric/CLO → giáo viên kiểm tra, lưu và công bố. Hỗ trợ JPG/JPEG, PNG và PDF, gồm PDF scan; chưa hỗ trợ DOCX, XLSX, HEIC hoặc video cho **bài nộp**. Import đề DOCX là chức năng riêng.

1. `TEACHER` gọi `POST /academic/submissions/{submissionId}/grade-ai`, body `{}`. Response `data.id` là jobId. Gọi lại trong khi job đang chạy trả cùng job; gửi corrections khi đang chạy bị `AI_JOB_BUSY`.
2. Poll `GET /academic/grading-jobs/{jobId}` mỗi 2–3 giây; dừng khi `SUCCEEDED` hoặc `FAILED`. Chỉ giáo viên phụ trách được xem tác vụ; `PARENT` không gọi các API này.
3. `SUCCEEDED` có thể chứa câu chưa đọc được. Chỉ áp dụng `result.scores`; đối chiếu `manualReviewQuestionIds` và `readingError`. Không đổi câu cần kiểm tra thành 0 điểm.

Ví dụ response bên trong `data`:

```json
{
  "id": "job-1",
  "submissionId": "submission-1",
  "status": "SUCCEEDED",
  "error": null,
  "errorCode": null,
  "result": {
    "scores": [{
      "questionId": "q1", "score": 3, "feedback": "Đúng kết quả, còn thiếu bước giải.",
      "criteria": [
        {"criterionId": "method", "score": 2, "feedback": "Thiếu một bước biến đổi."},
        {"criterionId": "result", "score": 1, "feedback": "Nghiệm đúng."}
      ]
    }],
    "manualReviewQuestionIds": [],
    "readings": [{
      "questionId": "q1", "answer": "2x = 8; x = 4", "readable": true,
      "sources": [{"fileId": "photo-1", "page": 1}], "reason": ""
    }],
    "readingError": null,
    "corrections": [],
    "correctedById": null
  }
}
```

Khi đọc sai, giáo viên mở tệp gốc rồi gửi lại `POST .../grade-ai`:

```json
{"corrections":[{"questionId":"q1","answer":"2x + 3 = 11; 2x = 8; x = 4"}]}
```

Corrections là bản đọc giáo viên đã kiểm tra, không sửa bài nộp gốc. Các corrections từ lần thành công trước được giữ khi gửi bổ sung câu khác. Tác vụ AI chỉ tạo gợi ý, không tự tạo bản điểm hay công bố. Lưu bằng `POST /academic/submissions/{id}/grades` với `scores`, `feedback` và `expectedRevision` theo hợp đồng chấm hiện có; server tự tính tổng điểm, sau đó duyệt/công bố qua `POST /academic/grades/{id}/approve` và `/publish`.

Mã `result.readingError` thường gặp: `AI_VISION_UNAVAILABLE`, `AI_FILE_UNAVAILABLE`, `AI_PDF_UNREADABLE`, `AI_PAGE_LIMIT`, `AI_FILE_LIMIT`, `AI_READING_INVALID`; provider có thể trả các mã bên dưới. Tác vụ vẫn có thể `SUCCEEDED` với danh sách cần chấm tay khi bước đọc thất bại.

Mã `data.errorCode` khi `FAILED`: `AI_PROVIDER_TIMEOUT`, `AI_PROVIDER_RATE_LIMITED`, `AI_PROVIDER_REJECTED`, `AI_PROVIDER_UNAVAILABLE`, `AI_RESPONSE_INVALID`, lỗi kiểm tra điểm/rubric hoặc `AI_GRADING_FAILED`. Tác vụ treo quá 10 phút được đánh dấu `AI_JOB_INTERRUPTED` ở lần worker chạy tiếp. Job cũ chưa lưu mã có thể trả `errorCode: null`. Khi đã đọc được nhưng bước chấm thất bại, `result.readings` vẫn được giữ. Cho phép giáo viên thử lại hoặc chấm thủ công; không tự lặp vô hạn.

## Thử thật provider bằng một tệp local

Cấu hình riêng AI chấm chữ (`AI_CHAT_URL`, `AI_API_KEY`, `AI_MODEL`) và AI đọc ảnh (`AI_VISION_CHAT_URL`, `AI_VISION_API_KEY`, `AI_VISION_MODEL`). Provider vision cần hỗ trợ Chat Completions với `image_url` dạng data URL và `response_format: json_object`. BE không suy đoán khả năng vision từ khóa DeepSeek chấm chữ.

Viết tay lời giải câu **“Giải 2x + 3 = 11, trình bày các bước”**, chụp JPG/PNG hoặc xuất PDF, rồi chạy từ repo BE:

```powershell
pnpm test:ai:file "D:\demo\bai-lam.jpg"
```

Script gọi **provider thật**, in bản đọc kèm nguồn và điểm theo rubric 3 điểm phương pháp + 1 điểm kết luận; không upload vào kho, không ghi database và không công bố điểm. Đối chiếu với bài gốc và điểm chuẩn của giáo viên. Nội dung tệp được gửi tới provider đã cấu hình; dùng bài demo. Nếu thiếu vision, script dừng trước khi gọi provider. Không tắt kiểm tra TLS; nếu máy dùng CA nội bộ, cấu hình CA cho Node.

Kiểm thử tự động (`academic-ai.spec.ts`, `ai-file-pipeline.spec.ts`) kiểm tra payload đa phương thức, provider riêng cho hai bước, nguồn tệp/trang, tổng điểm từ tiêu chí và xử lý lỗi; provider trong các kiểm thử này được giả lập. `submission-reader.spec.ts` render PDF hai trang thật trước khi kiểm tra payload vision.
