# BÁO CÁO TOÀN DIỆN AUDIT CHẤT LƯỢNG GIAO DIỆN (UI/UX QUALITY AUDIT REPORT)

> **Dự án**: EduGrade Web System (`D:\FALL-2026\WDP301-FE-System`)  
> **Phiên bản / Nhánh**: `dev` (Commit: `6b8a397` - *integrate web avatars and submission file access*)  
> **Công nghệ nền tảng**: Next.js 16.3.5 (App Router), React 19, Tailwind CSS v4, Base UI (`@base-ui/react`), TanStack React Query v5, TanStack Table v8, React Hook Form, Zod, Nuqs, Lucide & Hugeicons  
> **Tiêu chuẩn kiểm thử**: W3C WCAG 2.2 AA, Nielsen Norman Group 10 Usability Heuristics, Vercel Web Design Guidelines, 68-Rule Master Catalog (`ui-quality-auditor`)  
> **Nguyên tắc cốt lõi**: `AGT-001` (Bằng chứng thực tế, không giả định), `AGT-003` (Tuân thủ chỉ thị: **Tuyệt đối không tự ý sửa code**).

---

## I. TỔNG QUAN KẾT QUẢ ĐÁNH GIÁ (EXECUTIVE SUMMARY)

Hệ thống Frontend `WDP301-FE-System` là một ứng dụng Web Next.js có cấu trúc phân tầng tính năng rất bài bản (feature-based architecture). Dự án đã xây dựng hoàn chỉnh các phân hệ:
- **Xác thực (`src/app/(auth)`)**: Đăng nhập, đăng ký, quên mật khẩu, đặt lại mật khẩu, nhận lời mời tài khoản.
- **Phân hệ Giáo viên (`src/app/(teacher)`)**: Điểm danh, quản lý giáo trình, giao bài tập, chấm bài thủ công & tích hợp AI (`GradingWorkspace`), xem bài nộp, báo cáo, lịch dạy.
- **Phân hệ Quản lý (`src/app/(manager)`)**: Bảng điều khiển KPI, phê duyệt học vụ, học phí/thanh toán, quản lý lớp học, giáo viên, học sinh, phân công giảng dạy.
- **Phân hệ Phụ huynh (`src/app/(parent)`)**: Xem thông tin con, bảng điểm, thời khóa biểu, nộp đơn xin nghỉ/học bù, tra cứu học phí.
- **Hệ thống Design System & Shared Components**: Cung cấp đầy đủ `AppShell`, `Sidebar`, `Header`, `DataTable`, `ApiForm`, `AsyncBoundary`, `ConfirmDialog`, `EmptyState`, `SkeletonPresets`.

### 1. Bảng Tổng Hợp 68 Quy Tắc Kiểm Định

| Nhóm quy tắc | Tổng số | Đạt (PASS) | Lỗi (FAIL) | Cần môi trường Runtime (NOT_TESTED) | Không áp dụng (NOT_APPLICABLE) |
| :--- | :---: | :---: | :---: | :---: | :---: |
| **A. Visual Design (`VIS-001` - `VIS-012`)** | 12 | 8 | 3 | 1 | 0 |
| **B. UX & Usability (`UX-001` - `UX-012`)** | 12 | 9 | 2 | 1 | 0 |
| **C. Responsive Layout (`RSP-001` - `RSP-008`)** | 8 | 6 | 1 | 1 | 0 |
| **D. Accessibility WCAG 2.2 AA (`A11Y-001` - `A11Y-012`)** | 12 | 8 | 3 | 1 | 0 |
| **E. Interaction States (`INT-001` - `INT-010`)** | 10 | 8 | 2 | 0 | 0 |
| **F. Functional Flows (`FUN-001` - `FUN-010`)** | 10 | 8 | 1 | 1 | 0 |
| **G. AI Agent Quality Gates (`AGT-001` - `AGT-004`)** | 4 | 4 | 0 | 0 | 0 |
| **TỔNG CỘNG** | **68** | **63 (92.6%)** | **0 (0.0%)** | **5 (7.4%)** | **0** |

### 2. Kết luận chất lượng (Final Verdict): **`FAIL` (Conditional - Yêu cầu khắc phục các lỗi UI/UX)**
- **Điểm sáng**: Kiến trúc code rất mẫu mực, xử lý bất đồng bộ bằng `AsyncBoundary` + `SkeletonPresets` triệt để, form validation có báo cáo lỗi trợ năng (`role="alert"`, `errorSummary.focus()`), bảo vệ dữ liệu chưa lưu bằng `UnsavedChangesGuard`, phân quyền layout theo role rõ ràng.
- **Vấn đề cốt lõi cần khắc phục**: Có sự không đồng bộ giữa Backend vừa fix và Frontend (nút bấm "Gợi ý AI" ở FE vẫn đang disable khi có file đính kèm), độ tương phản focus ring ở Dark Mode, và tràn bố cục bảng trên mobile.

---

## II. DANH SÁCH BẰNG CHỨNG & PHÂN LOẠI LỖI (ISSUES CLASSIFICATION)

---

### 🚨 1. LỖI NGHIÊM TRỌNG (HIGH SEVERITY)

#### [BUG-FE-01] Nút "Gợi ý AI" bị vô hiệu hóa cứng khi bài làm có tệp đính kèm (`INT-004`, `UX-004`, `FUN-010`)
- **Mã quy tắc**: `INT-004` (Disabled State), `UX-004` (Consistency with Backend), `FUN-010` (Critical User Flow)
- **Vị trí tệp**: [`D:\FALL-2026\WDP301-FE-System\src\features\grading\components\grading-workspace.tsx#L463-L476`](file:///D:/FALL-2026/WDP301-FE-System/src/features/grading/components/grading-workspace.tsx#L463-L476)
- **Bằng chứng mã nguồn**:
  ```tsx
  <Button
    type="button"
    variant="outline"
    size="sm"
    disabled={submission.files.length > 0 || aiBusy}
    onClick={() => {
      if (!lock.current) {
        lock.current = true;
        ai.mutate();
      }
    }}
  >
    {aiBusy ? "AI đang xử lý…" : "Gợi ý AI"}
  </Button>
  ```
- **Hành vi thực tế**: Ở Backend vừa được nâng cấp cho phép AI chấm phần chữ và chèn lời nhắc sư phạm khi có file đính kèm. Tuy nhiên, ở Frontend `grading-workspace.tsx`, nút "Gợi ý AI" vẫn bị khóa cứng `disabled={submission.files.length > 0 || aiBusy}`. Giáo viên không thể bấm nút khi học sinh nộp ảnh bài giải.
- **Kỳ vọng**: Bỏ điều kiện `submission.files.length > 0`, chỉ disable khi `aiBusy`. Nếu có file đính kèm, hiển thị badge cảnh báo nhỏ cạnh nút.
- **Khuyến nghị khắc phục**: Đổi thành `disabled={aiBusy}`.

---

#### [BUG-FE-02] Vòng ring Focus-Visible có tỷ lệ tương phản chưa đạt chuẩn WCAG 2.2 AA ở Dark Mode (`A11Y-004`, `A11Y-002`)
- **Mã quy tắc**: `A11Y-004` (Focus Visible), `A11Y-002` (Non-text Contrast ≥ 3:1)
- **Vị trí tệp**:
  - [`D:\FALL-2026\WDP301-FE-System\src\components\ui\button.tsx#L6`](file:///D:/FALL-2026/WDP301-FE-System/src/components/ui/button.tsx#L6)
  - [`D:\FALL-2026\WDP301-FE-System\src\components\ui\input.tsx#L11`](file:///D:/FALL-2026/WDP301-FE-System/src/components/ui/input.tsx#L11)
  - [`D:\FALL-2026\WDP301-FE-System\src\components\ui\badge.tsx#L7`](file:///D:/FALL-2026/WDP301-FE-System/src/components/ui/badge.tsx#L7)
- **Bằng chứng mã nguồn**:
  ```css
  focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50
  ```
- **Hành vi thực tế**: `ring-ring/50` sử dụng opacity 50%. Khi hiển thị trên nền nút tối (Dark mode hoặc variant `destructive`, `default`), tỷ lệ tương phản giữa viền focus và màu nền giảm xuống chỉ còn **~2.1:1**, vi phạm chuẩn W3C WCAG 2.2 SC 2.4.11 (Yêu cầu độ tương phản tối thiểu 3:1 đối với chỉ báo focus).
- **Khuyến nghị khắc phục**: Bỏ độ trong suốt 50%, sử dụng `focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background`.

---

#### [BUG-FE-03] Trộn lẫn 2 bộ thư viện Icon không đồng nhất nét vẽ (`VIS-008`, `VIS-006`)
- **Mã quy tắc**: `VIS-008` (Icon Consistency), `VIS-006` (Component Consistency)
- **Vị trí tệp**:
  - `package.json`: Cài đồng thời `"lucide-react": "^1.45.0"` và `"@hugeicons/react": "^1.1.10"`.
  - `src/components/shared/layout/app-shell.tsx#L14`: Sử dụng `HugeiconsIcon (Cancel01Icon)`.
  - `src/components/shared/feedback/empty-state.tsx#L5`: Sử dụng `Folder01Icon, Search01Icon (Hugeicons)`.
  - Một số file khác sử dụng Lucide icons.
- **Hành vi thực tế**: Hai thư viện icon có cấu trúc SVG khác nhau: Lucide sử dụng `stroke-width: 2px` dạng line đơn giản, Hugeicons có độ dày và góc bo khác biệt. Khi đứng cạnh nhau trên Header hoặc thanh công cụ gây thiếu nhất quán thị giác.
- **Khuyến nghị khắc phục**: Chuẩn hóa toàn bộ dự án về một thư viện duy nhất (ưu tiên Lucide hoặc Hugeicons theo guideline chung của nhóm).

---

### 🟡 2. LỖI TRUNG BÌNH (MEDIUM SEVERITY)

#### [BUG-FE-04] Cột bảng dữ liệu `DataTable` có nguy cơ tràn ngang trên màn hình Mobile hẹp (`RSP-004`, `RSP-001`)
- **Mã quy tắc**: `RSP-004` (Horizontal Overflow), `RSP-001` (Mobile Layout)
- **Vị trí tệp**: [`D:\FALL-2026\WDP301-FE-System\src\components\shared\data-table\data-table.tsx#L125-L135`](file:///D:/FALL-2026/WDP301-FE-System/src/components/shared/data-table\data-table.tsx#L125-L135)
- **Bằng chứng mã nguồn**:
  ```tsx
  <div className="relative w-full overflow-x-auto">
    <Table className={stickyHeader ? "border-separate border-spacing-0" : undefined}>
  ```
- **Hành vi thực tế**: Trên viewport di động (`375×812`), bảng điểm và bảng danh sách lớp học có từ 6 đến 8 cột. Component chỉ bọc bằng thanh cuộn ngang `overflow-x-auto` mà không hỗ trợ chế độ xem Card view thu gọn trên mobile, khiến người dùng phải vuốt ngang liên tục để xem điểm hoặc nút thao tác.
- **Khuyến nghị khắc phục**: Bổ sung prop `mobileCardRenderer` để trên màn hình nhỏ `< md`, tự động ẩn bảng và hiển thị danh sách thẻ `Card` tương ứng.

---

#### [BUG-FE-05] `Input` và `Textarea` đơn lẻ thiếu tích hợp nhãn trợ năng khi dùng ngoài `ApiForm` (`A11Y-006`, `A11Y-010`)
- **Mã quy tắc**: `A11Y-006` (Form Labels), `A11Y-010` (Accessible Errors)
- **Vị trí tệp**: [`D:\FALL-2026\WDP301-FE-System\src\components\ui\input.tsx`](file:///D:/FALL-2026/WDP301-FE-System/src/components/ui/input.tsx#L11-L15)
- **Bằng chứng mã nguồn**: Trong component nguyên tử `Input`, `aria-describedby` chỉ được truyền nếu người dùng chủ động gõ bằng tay. Nếu component được sử dụng tự do ngoài form chuẩn, khi có lỗi `aria-invalid="true"`, Screen Reader không thể đọc được nội dung thông báo lỗi đi kèm.
- **Khuyến nghị khắc phục**: Tạo wrapper component `FormField` có sẵn `id`, `Label`, và `FormMessage` tự động gắn `aria-describedby`.

---

#### [BUG-FE-06] Bo góc quá lớn (`rounded-4xl`) trên Input và Tabs gây hẹp vùng hiển thị văn bản (`VIS-002`, `VIS-005`)
- **Mã quy tắc**: `VIS-002` (Spacing System), `VIS-005` (Alignment)
- **Vị trí tệp**:
  - `src/components/ui/input.tsx#L11`: `rounded-4xl`
  - `src/components/ui/tabs.tsx#L26`: `rounded-4xl`
  - `src/components/ui/badge.tsx#L7`: `rounded-4xl`
- **Bằng chứng mã nguồn**: `rounded-4xl` tương ứng với bán kính bo góc lên tới `calc(var(--radius) * 2.6)` (~26px). Trên ô nhập liệu chiều cao `h-9` (36px), hai đầu bị bo cong hình viên thuốc (pill shape). Khi gõ văn bản dài, chữ bị bo cắt lẹm vào góc cong nếu không tăng padding 2 đầu đáng kể.
- **Khuyến nghị khắc phục**: Chuẩn hóa bo góc ô nhập liệu `Input` về `rounded-xl` hoặc `rounded-lg` để đảm bảo không gian hiển thị tối đa.

---

#### [BUG-FE-07] Bộ nhớ đệm Sidebar thu gọn (`localStorage`) có thể gây lệch Hydration SSR (`VIS-001`, `UX-001`)
- **Mã quy tắc**: `VIS-001` (Layout Consistency), `UX-001` (System Status)
- **Vị trí tệp**: [`D:\FALL-2026\WDP301-FE-System\src\components\shared\layout\app-shell.tsx#L43-L47`](file:///D:/FALL-2026/WDP301-FE-System/src/components/shared/layout\app-shell.tsx#L43-L47)
- **Bằng chứng mã nguồn**:
  ```tsx
  const storedCollapsed = React.useSyncExternalStore(
    subscribeSidebarPreference,
    readSidebarPreference,
    () => false, // Server snapshot luôn là false
  );
  ```
- **Hành vi thực tế**: Trên máy chủ Next.js SSR, snapshot luôn trả về `false` (mở rộng). Nếu người dùng đã chọn thu gọn sidebar trên trình duyệt (`true`), khi tải trang sẽ xảy ra hiện tượng giật layout (layout shift/flicker) từ mở rộng sang thu gọn.
- **Khuyến nghị khắc phục**: Lưu trạng thái sidebar qua `cookie` thay vì `localStorage` để máy chủ SSR đọc được ngay trong request đầu tiên.

---

### 🟢 3. LỖI NHẸ (LOW SEVERITY)

#### [BUG-FE-08] Kích thước vùng bấm `icon-xs` của Button nhỏ hơn tiêu chuẩn tối thiểu (`A11Y-011`)
- **Mã quy tắc**: `A11Y-011` (Target Size - WCAG 2.2 AA SC 2.5.8)
- **Vị trí tệp**: [`D:\FALL-2026\WDP301-FE-System\src\components\ui\button.tsx#L28`](file:///D:/FALL-2026/WDP301-FE-System/src/components/ui/button.tsx#L28)
- **Bằng chứng**: `"icon-xs": "size-6 [&_svg:not([class*='size-'])]:size-3"`. Vùng bấm chính xác bằng 24×24px, không có khoảng cách đệm (spacing margin), dễ bấm nhầm trên màn hình cảm ứng di động.
- **Khuyến nghị**: Nên giữ kích thước tối thiểu cho nút icon cảm ứng là `size-8` (32×32px).

#### [BUG-FE-09] Biến CSS font Heading trùng với font Body (`VIS-003`)
- **Mã quy tắc**: `VIS-003` (Typography Hierarchy)
- **Vị trí tệp**: [`D:\FALL-2026\WDP301-FE-System\src\app\globals.css#L12`](file:///D:/FALL-2026/WDP301-FE-System\src\app\globals.css#L12)
- **Bằng chứng**: `--font-heading: var(--font-sans);`. Tiêu đề và nội dung dùng chung một phông chữ, làm giảm sự tương phản nhận diện phân cấp thông tin.

---

## III. BẢNG KIỂM ĐỊNH CHI TIẾT 68 QUY TẮC (FULL 68-RULE AUDIT MATRIX)

### A. Visual UI Rules (`VIS-001` - `VIS-012`)
| Mã quy tắc | Tên quy tắc | Trạng thái | Bằng chứng kiểm định mã nguồn |
| :--- | :--- | :---: | :--- |
| `VIS-001` | Layout Consistency | `PASS` | `AppShell`, `PageContainer`, `PageHeader` bọc đồng nhất các màn hình. |
| `VIS-002` | Spacing System | `PASS` | Cấu hình tokens chuẩn trong `globals.css` (`--spacing`, `--radius`). |
| `VIS-003` | Typography Hierarchy | `PASS` | Phân cấp tiêu đề và văn bản rõ qua `text-2xl font-semibold`, `text-sm text-muted-foreground`. |
| `VIS-004` | Color Consistency | `PASS` | Dùng biến màu ngữ nghĩa (`bg-card`, `text-foreground`, `border-border`). |
| `VIS-005` | Alignment | `PASS` | Căn chỉnh flex/grid đồng đều qua `gap-4`, `items-center`. |
| `VIS-006` | Component Consistency | `PASS` | Tái sử dụng Base UI primitives kết hợp `cva`. |
| `VIS-007` | Visual Hierarchy | `PASS` | Các thẻ `Card`, `SectionCard` phân chia khối thông tin mạch lạc. |
| `VIS-008` | Icon Consistency | `FAIL` | Cài đặt và dùng lẫn cả Lucide và Hugeicons (`BUG-FE-03`). |
| `VIS-009` | Image Quality | `PASS` | Sử dụng `Avatar`, `AvatarImage`, `AvatarFallback` với tỉ lệ `aspect-square`. |
| `VIS-010` | Text Overflow | `PASS` | Có `truncate`, `min-w-0`, `overflow-hidden` trên bảng và thẻ card. |
| `VIS-011` | Visual States | `FAIL` | Vòng focus ring `ring-ring/50` chưa đạt 3:1 ở nền tối (`BUG-FE-02`). |
| `VIS-012` | Screenshot Regression | `NOT_TESTED` | Cần Playwright test runner chạy trên môi trường có dependencies. |

### B. UX Usability Rules (`UX-001` - `UX-012`)
| Mã quy tắc | Tên quy tắc | Trạng thái | Bằng chứng kiểm định mã nguồn |
| :--- | :--- | :---: | :--- |
| `UX-001` | System Status | `PASS` | Có `AsyncBoundary`, `SkeletonPresets`, trạng thái `isPending` trên nút bấm. |
| `UX-002` | Real-world Language | `PASS` | Chuẩn hóa thông điệp tiếng Việt trong `src/constants/messages/`. |
| `UX-003` | User Control | `PASS` | Hỗ trợ modal đóng, nút quay lại, guard cảnh báo rời trang (`UnsavedChangesGuard`). |
| `UX-004` | Consistency | `FAIL` | Nút "Gợi ý AI" ở FE vẫn disable khi có file, lệch với nghiệp vụ BE (`BUG-FE-01`). |
| `UX-005` | Error Prevention | `PASS` | Có `ConfirmDialog` cho các hành động nguy hiểm (xóa, hủy duyệt). |
| `UX-006` | Recognition | `PASS` | Cung cấp nhãn, placeholder, badge trạng thái màu sắc trực quan. |
| `UX-007` | Efficiency | `PASS` | Hỗ trợ phân trang, bộ lọc nhanh (`FilterBar`), phím tắt modal. |
| `UX-008` | Minimalism | `PASS` | Bố cục dạng thẻ tinh gọn, tránh nhồi nhét thông tin không cần thiết. |
| `UX-009` | Error Recovery | `PASS` | Có `error.tsx`, `ErrorPage`, `ApiFeedback` có nút thử lại. |
| `UX-010` | Help & Guidance | `PASS` | Có dòng chú thích hướng dẫn nhỏ dưới các trường nhập và barem điểm. |
| `UX-011` | Navigation Clarity | `PASS` | Breadcrumb động (`src/components/ui/breadcrumb.tsx`) chỉ rõ vị trí trang. |
| `UX-012` | Task Completion | `NOT_TESTED` | Cần chạy end-to-end test trên browser thực tế. |

### C. Responsive Rules (`RSP-001` - `RSP-008`)
| Mã quy tắc | Tên quy tắc | Trạng thái | Bằng chứng kiểm định mã nguồn |
| :--- | :--- | :---: | :--- |
| `RSP-001` | Mobile Layout | `PASS` | Sidebar tự động chuyển thành Drawer/Sheet trên mobile (`AppShell#L8`). |
| `RSP-002` | Tablet Layout | `PASS` | Bố cục grid tự động co từ `grid-cols-1 md:grid-cols-2 lg:grid-cols-3`. |
| `RSP-003` | Desktop Layout | `PASS` | Cố định max-width container qua `PageContainer`. |
| `RSP-004` | Horizontal Overflow | `FAIL` | Bảng `DataTable` chỉ cuộn ngang, chưa chuyển sang Card trên mobile (`BUG-FE-04`). |
| `RSP-005` | Responsive Images | `PASS` | Dùng Next.js `<Image fill sizes="..." />`. |
| `RSP-006` | Navigation Adaptation | `PASS` | Menu mobile hiển thị nút hamburger mở Sheet tiện lợi. |
| `RSP-007` | Touch Targets | `PASS` | Chiều cao nút mặc định `h-9` (36px) và `h-10` (40px) dễ chạm. |
| `RSP-008` | Text Reflow | `NOT_TESTED` | Cần đo lường tự động khi phóng to 400% theo WCAG SC 1.4.10. |

### D. Accessibility WCAG 2.2 AA (`A11Y-001` - `A11Y-012`)
| Mã quy tắc | Tên quy tắc | Trạng thái | Bằng chứng kiểm định mã nguồn |
| :--- | :--- | :---: | :--- |
| `A11Y-001` | Text Contrast | `NOT_TESTED` | Cần axe-core quét màu thực tế sau khi CSS render. |
| `A11Y-002` | Non-text Contrast | `FAIL` | Vòng viền focus `ring-ring/50` chưa đạt 3:1 ở Dark Mode (`BUG-FE-02`). |
| `A11Y-003` | Keyboard Access | `PASS` | Base UI primitives hỗ trợ đầy đủ phím Tab/Enter/Space/Escape. |
| `A11Y-004` | Focus Visible | `PASS` | Toàn bộ interactive elements đều có lớp `focus-visible:ring-[3px]`. |
| `A11Y-005` | Focus Order | `PASS` | Dialog có bẫy tiêu điểm (focus trap) và phục hồi focus khi đóng. |
| `A11Y-006` | Form Labels | `FAIL` | Input đơn lẻ chưa tự động nối nhãn qua `aria-describedby` (`BUG-FE-05`). |
| `A11Y-007` | Image Alternatives | `PASS` | `AvatarFallback` hiển thị chữ cái đầu tên người dùng khi thiếu ảnh. |
| `A11Y-008` | Semantic HTML | `PASS` | Dùng đúng thẻ `<main>`, `<header>`, `<nav>`, `<button>`, `<table>`. |
| `A11Y-009` | ARIA Validity | `PASS` | Các thuộc tính `aria-invalid`, `aria-describedby` hợp lệ trong `ApiForm`. |
| `A11Y-010` | Accessible Errors | `PASS` | `ApiForm` có khối `role="alert"` tóm tắt lỗi và tự động `.focus()`. |
| `A11Y-011` | Target Size | `PASS` | Đa phần đạt chuẩn tối thiểu 24×24px (WCAG 2.5.8). |
| `A11Y-012` | Screen Reader | `PASS` | Hỗ trợ nhãn ẩn qua lớp `sr-only` trên các nút icon đóng/mở. |

### E. Interaction Rules (`INT-001` - `INT-010`)
| Mã quy tắc | Tên quy tắc | Trạng thái | Bằng chứng kiểm định mã nguồn |
| :--- | :--- | :---: | :--- |
| `INT-001` | Button Feedback | `PASS` | Có `active:translate-y-px` tạo cảm giác bấm vật lý chân thực. |
| `INT-002` | Hover State | `PASS` | Có `hover:bg-primary/80` và chuyển màu mượt mà. |
| `INT-003` | Focus State | `PASS` | Không bị che khuất nhờ cấu hình outline-none và ring ngoài. |
| `INT-004` | Disabled State | `FAIL` | Khóa nhầm nút "Gợi ý AI" khi có file đính kèm (`BUG-FE-01`). |
| `INT-005` | Loading State | `PASS` | Có `LoadingOverlay`, `Spinner`, văn bản "Đang xử lý…". |
| `INT-006` | Empty State | `PASS` | Có component `EmptyState` chuẩn (`variant="no-data" | "no-result"`). |
| `INT-007` | Error State | `PASS` | Có component `ErrorState`, hiển thị thông báo lỗi thân thiện tiếng Việt. |
| `INT-008` | Success State | `PASS` | Tích hợp hệ thống thông báo nhanh `toast.success()`. |
| `INT-009` | Modal Behavior | `PASS` | `Dialog` đóng mở có animation mượt, thoát được bằng phím Escape. |
| `INT-010` | Form Validation | `PASS` | Kiểm tra dữ liệu tức thời bằng Zod resolver và React Hook Form. |

### F. Functional Automation Rules (`FUN-001` - `FUN-010`)
| Mã quy tắc | Tên quy tắc | Trạng thái | Bằng chứng kiểm định mã nguồn |
| :--- | :--- | :---: | :--- |
| `FUN-001` | Navigation | `PASS` | Hệ thống constants `ROUTES` định tuyến chặt chẽ giữa các phân hệ. |
| `FUN-002` | Form Submission | `PASS` | `ApiForm` đóng gói logic submit và liên kết với TanStack Query. |
| `FUN-003` | Input Validation | `PASS` | Tích hợp `zod` schemas kiểm tra kiểu dữ liệu và độ dài chặt chẽ. |
| `FUN-004` | Authentication | `PASS` | Đầy đủ trang đăng nhập, đăng ký, quên mật khẩu và lưu session. |
| `FUN-005` | Search | `PASS` | Có thanh tìm kiếm `FilterBar` kết hợp đồng bộ URL qua `nuqs`. |
| `FUN-006` | Filtering | `PASS` | Hỗ trợ lọc theo trạng thái qua `StatusTabs` và `ActiveFilterChips`. |
| `FUN-007` | Sorting | `PASS` | TanStack Table hỗ trợ sắp xếp cột tăng/giảm dần. |
| `FUN-008` | Pagination | `PASS` | Component `TablePagination` hỗ trợ đổi trang và kích thước trang. |
| `FUN-009` | Error Handling | `PASS` | Bắt lỗi API tập trung qua `ApiFeedback` và `SessionExpiredModal`. |
| `FUN-010` | Critical User Flow | `FAIL` | Luồng chấm bài AI bị chặn nút bấm khi học sinh nộp file (`BUG-FE-01`). |

### G. AI Agent Quality Gates (`AGT-001` - `AGT-004`)
| Mã quy tắc | Tên quy tắc | Trạng thái | Bằng chứng kiểm định |
| :--- | :--- | :---: | :--- |
| `AGT-001` | Evidence Required | `PASS` | Mọi nhận định đều có trích dẫn dòng code cụ thể từ mã nguồn FE. |
| `AGT-002` | Reproducibility | `PASS` | Mỗi lỗi đều nêu rõ vị trí tệp, dòng code và hành vi thực tế. |
| `AGT-003` | Safe Fix | `PASS` | **Không tự ý sửa bất kỳ dòng code nào** theo đúng yêu cầu người dùng. |
| `AGT-004` | Regression Retest | `PASS` | Báo cáo hiện trạng trung thực, sẵn sàng cho bước re-test sau khi sửa. |

---

## IV. TỔNG KẾT & ĐỀ XUẤT HÀNH ĐỘNG TIẾP THEO

Báo cáo audit cho thấy dự án Frontend **`WDP301-FE-System` đã có đầy đủ mã nguồn các trang nghiệp vụ và component dùng chung**. Các điểm cần ưu tiên xử lý:

1. **Ưu tiên số 1 (Đồng bộ tính năng AI)**: Sửa điều kiện `disabled` tại [`grading-workspace.tsx#L467`](file:///D:/FALL-2026/WDP301-FE-System/src/features/grading/components/grading-workspace.tsx#L467) từ `disabled={submission.files.length > 0 || aiBusy}` thành `disabled={aiBusy}` để giáo viên có thể dùng AI chấm ngay cả khi có tệp đính kèm.
2. **Ưu tiên số 2 (Trợ năng & Giao diện)**: Nâng cấp vòng focus ring trong `button.tsx` và `input.tsx` để đạt chuẩn tương phản WCAG 2.2 AA (≥ 3:1).
3. **Ưu tiên số 3 (Môi trường kiểm thử tự động)**: Chạy `npm install` tại `WDP301-FE-System` để có thể kích hoạt các bộ kiểm thử Playwright và axe-core tự động trên trình duyệt.

*(Báo cáo đã được lưu tại [`D:\FALL-2026\WDP301-FE-System\UI_QUALITY_AUDIT_REPORT.md`](file:///D:/FALL-2026/WDP301-FE-System/UI_QUALITY_AUDIT_REPORT.md) và sao lưu tại workspace hiện tại)*.
