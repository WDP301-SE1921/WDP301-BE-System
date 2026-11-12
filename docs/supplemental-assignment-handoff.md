# Giao bài bổ sung cho học sinh vào lớp sau

## Quy tắc

- Giáo viên phụ trách lớp chọn học sinh chưa nhận bài và đặt hạn riêng.
- Áp dụng cho `PUBLISHED` và `CLOSED`, bao gồm bài quá hạn chung. Chặn `DRAFT` và bài đã công bố đáp án.
- Học sinh phải được liên kết, có ghi danh `ACTIVE`, còn thời hạn và đang ở lớp theo placement hiện tại. Không bắt buộc có mặt trong buổi học cũ của bài.
- Không tự giao khi ghi danh. Không nhân bản đề, rubric, tệp hay điểm.
- Hạn riêng độc lập với hạn chung. Đóng/mở lại đợt chung không thay đổi hạn riêng.
- Chưa hỗ trợ sửa hoặc hủy hạn riêng trong phiên bản này. Muốn công bố đáp án phải đợi hết tất cả hạn bổ sung, kể cả khi học sinh đã nộp.

## API

Prefix thực tế: `/api/v1/academic`. Các kết quả bên dưới nằm trong `data` của response envelope hiện tại.

### 1. Lấy danh sách có thể giao

`GET /assignments/:id/eligible-recipients?page=1&limit=50&search=An`

Chỉ giáo viên có quyền với lớp. Phân trang luôn trả metadata, không cần `paginated=true`; `limit` mặc định 50, tối đa 100. Chỉ trả một hồ sơ ghi danh cho mỗi học sinh. Đã nhận qua hồ sơ ghi danh khác cũng không xuất hiện.

```json
{
  "assignmentId": "assignment-id",
  "status": "CLOSED",
  "canAssignSupplemental": true,
  "blockReason": null,
  "items": [
    { "enrollmentId": "enrollment-id", "studentId": "student-id", "fullName": "Nguyễn An" }
  ],
  "page": 1,
  "limit": 50,
  "total": 1
}
```

Bài nháp hoặc đã công bố đáp án trả danh sách rỗng, `canAssignSupplemental=false` và `blockReason` tương ứng `ASSIGNMENT_NOT_PUBLISHED` / `ANSWERS_ALREADY_VISIBLE`.

### 2. Giao bổ sung

`POST /assignments/:id/recipients`

```json
{
  "enrollmentIds": ["enrollment-id"],
  "dueAt": "2026-11-17T23:59:00+07:00"
}
```

- 1–100 ID khác nhau, không rỗng. `dueAt` bắt buộc là ISO có múi giờ và nằm trong tương lai.
- Kiểm tra lại người nhận lúc lưu. Một người không hợp lệ làm cả yêu cầu thất bại.
- Người đã nhận được bỏ qua, hạn cũ giữ nguyên. Không dùng API này để gia hạn người đã nhận.
- Hai yêu cầu đồng thời được tuần tự hóa theo bài. Gửi lại không tạo người nhận hoặc thông báo trùng.

```json
{
  "assignmentId": "assignment-id",
  "addedRecipients": [
    {
      "id": "recipient-id",
      "enrollmentId": "enrollment-id",
      "assignedAt": "2026-11-14T03:00:00.000Z",
      "dueAtOverride": "2026-11-17T16:59:00.000Z"
    }
  ],
  "skippedEnrollmentIds": []
}
```

Lỗi: `400` khi payload sai; `403 FORBIDDEN`; `409 ASSIGNMENT_NOT_PUBLISHED`, `ANSWERS_ALREADY_VISIBLE`, `INVALID_RECIPIENTS`, `INVALID_SUBMISSION_WINDOW`.

### 3. Danh sách và chi tiết bài

`GET /assignments` và `GET /assignments/:id` bổ sung trên từng phần tử `recipients`:

| Trường                  | Ý nghĩa                                                                                                                |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `assignedAt`            | Ngày giao; có thể null với dữ liệu lịch sử                                                                             |
| `dueAtOverride`         | Hạn bổ sung; null với đợt chung                                                                                        |
| `effectiveDueAt`        | Hạn thực tế cần hiển thị                                                                                               |
| `isSupplemental`        | Có được giao theo hạn riêng hay không                                                                                  |
| `canSubmit`             | Còn cửa sổ nộp, còn lượt và ghi danh còn hiệu lực                                                                      |
| `submissionBlockReason` | null hoặc `SUBMISSION_CLOSED`, `DEADLINE_PASSED`, `ENROLLMENT_CLOSED`, `ATTEMPTS_EXHAUSTED`, `ANSWERS_ALREADY_VISIBLE` |

`dueAt` cấp bài vẫn là hạn chung. Không dùng nó thay `effectiveDueAt` trên màn hình học sinh.

Chi tiết dành cho giáo viên có thêm `canAssignSupplemental`, `activeSupplementalRecipientCount`, `canPublishAnswers`.

Bộ lọc ngày của danh sách phụ huynh dùng hạn thực tế của đúng con được chọn; danh sách bài của giáo viên tiếp tục lọc hạn chung. Trang điểm của back office bổ sung `effectiveDueAt`, `isSupplemental`, `assignedAt`, `dueAtOverride` và lọc theo hạn thực tế.

### 4. Nộp bài, đóng bài và công bố đáp án

- API nộp hiện tại `POST /submissions` giữ nguyên. Vai trò nộp vẫn là `PARENT`, thay mặt con theo quyền hiện tại. Không thêm vai trò học sinh mới.
- Người nhận đợt chung chỉ nộp khi bài `PUBLISHED` và còn hạn chung. Người nhận bổ sung nộp được cả khi bài `CLOSED`, đến hết hạn riêng. Cả hai vẫn bị kiểm tra quyền, hạn ghi danh và `maxAttempts`.
- `POST /assignments/:id/close` thêm `activeSupplementalRecipientCount` vào kết quả. Đợt bổ sung tiếp tục mở đến hạn riêng.
- Công bố đáp án khi còn hạn riêng trả `409 SUPPLEMENTAL_WINDOW_OPEN`, với `details.latestSupplementalDueAt`. Backend vẫn chặn dù giao diện đã kiểm tra.
- Đề, barem, upload ảnh/PDF, chấm AI, duyệt và công bố điểm sử dụng luồng cũ.

## Tích hợp giao diện

### Web giáo viên

1. Thêm nút **Giao bổ sung** trong chi tiết bài, theo `canAssignSupplemental`.
2. Mở hộp chọn có tìm kiếm/phân trang từ API eligibility; gửi `enrollmentId`, không gửi `studentId`.
3. Bắt buộc giáo viên chọn hạn tương lai. Hiển thị giờ Việt Nam, gửi ISO có timezone.
4. Sau khi lưu, hiển thị số đã thêm và số bỏ qua; tải lại chi tiết và danh sách eligibility.
5. Bảng người nhận hiển thị nhãn **Giao bổ sung** và `effectiveDueAt`.
6. Nếu trạng thái chung `CLOSED` nhưng còn người nhận bổ sung, hiển thị **Đợt chung đã đóng — còn học sinh được nộp bổ sung**.
7. Khóa nút công bố đáp án theo `canPublishAnswers`; thông báo thời điểm cần đợi khi nhận `SUPPLEMENTAL_WINDOW_OPEN`.

### Mobile/phụ huynh

- Tải danh sách theo đúng con; chỉ dùng phần tử `recipients` của con đó.
- Hiển thị `effectiveDueAt`; nút nộp dùng `canSubmit`. Không khóa chỉ vì bài có trạng thái `CLOSED`.
- Dùng `submissionBlockReason` để giải thích khi không thể nộp và tải lại dữ liệu sau khi nộp.
- Thông báo `ASSIGNMENT_PUBLISHED` với đích `ASSIGNMENT` được tái sử dụng, chỉ gửi gia đình người vừa nhận. Dùng điều hướng bài tập hiện tại.

## Triển khai và tương thích

1. Sao lưu theo quy trình môi trường; chạy `pnpm prisma:migrate:deploy` để thêm ba cột nullable. Migration không giao bù hoặc đổi dữ liệu cũ.
2. Sinh Prisma Client trong bước build bằng `pnpm prisma:generate`, kiểm tra kiểu và build backend.
3. Triển khai backend, sau đó tích hợp web/mobile. Ứng dụng cũ vẫn gọi được API cũ nhưng cần cập nhật UI để nộp bài bổ sung khi trạng thái chung `CLOSED`.
4. Kiểm tra trên staging: giao bài đã đóng cho học sinh mới, nhận thông báo, nộp đúng hạn riêng, xác nhận học sinh cũ bị chặn và công bố đáp án bị chặn trước hạn bổ sung.

Không cần cấu hình AI mới hoặc tác vụ nền để hết hạn. Backend kiểm tra thời gian tại mỗi lần nộp.
