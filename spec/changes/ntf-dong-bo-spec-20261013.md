# Tác động của đợt đồng bộ spec NTF 2026-10-13 (review NTF: REV-NTF-04, 05, 06, 07, 08, 09, 10, 11, 15; bài học L61, L121, L126, L129)

- **Thay đổi:** (a) NTF-DB: consumer hai pha (`prepare` ngoài giao dịch, `handle` trong giao dịch, `SKIP` không ghi `processed_events`) ở Giao dịch và khóa 1 và 2; hai trigger vòng đời `notifications_guard` và `email_deliveries_guard` ở Trạng thái hợp lệ và Migration; CHECK `notifications.link` đổi biểu thức thành `^/([A-Za-z0-9_-][A-Za-z0-9/_-]*)?$` (không cho `//` đầu); migration bỏ CHECK cũ có bước thu hẹp kèm `-- contract-step`. (b) NTF-SEC: T15 cùng biểu thức, T3 trỏ ADR-010 (SES v2 `Simple` là trường JSON riêng, không MIME), T7 "log theo SB-18". (c) NTF-API: bỏ "qua SDK", ghi SES v2 `Simple` ký SigV4, liệt kê đủ sáu biến SES và APP (trỏ ADR-007), tên `AuthApi.` và hành vi lỗi, consumer hai pha. (d) NTF-TC ...630 kiểm trường JSON `Subject`, `ToAddresses`, `Body`; ...060 thêm `//intranet`, `//2130706433`, `///` và biểu thức mới; ...157 bỏ ngưỡng 30% thay bằng "cùng dãy câu SQL". (e) ui/notification-list: bố cục dưới `sm` là nhóm ba nút, không dropdown. Mã: migration mới `20261013000300_notification_link_hardening` (migration cũ không sửa), `db.spec.ts`, `consume.spec.ts`, `read.spec.ts`, `ses.spec.ts`, bảng đột biến `mutations-ntf.json`; hook web chung `useQueryGo` (mọi trang danh sách, kể cả `/notifications`).
- **Lý do:** review NTF (REV-NTF-04 LOW, 05 MEDIUM, 06 MEDIUM, 07 MEDIUM, 08 MEDIUM, 09 MEDIUM, 10 LOW, 11 LOW, 15 LOW) và bài học L126, L129 (loại `spec`); nền đã đồng bộ ở `spec/changes/nen-dong-bo-20261013.md` (ADR-007, 010, 011, SB-18, bảng Giao diện module), không sửa lại ở đây.
- **Người yêu cầu:** người dùng ("chạy tiếp đi"; các quyết định (1) đến (5) chốt khi giao việc); phân tích do Claude

Tài liệu bị đổi: NTF-DB-20261006-103815422

Hàng ghi "Đã sửa và duyệt lại" là việc đã làm trong đợt này (sửa bằng Edit: hạ `draft`, sửa, duyệt lại một lần).

| ID bị ảnh hưởng | Loại | Mức | Lý do | Việc cần làm |
|---|---|---|---|---|
| NTF-DB-20261006-103815422 | phải dựng lại | MEDIUM | Giao dịch và khóa 1 và 2 không nêu consumer hai pha mà mã dùng (ADR-011); hai trigger vòng đời không có ở Trạng thái hợp lệ và Migration; biểu thức CHECK `link` cho qua `//intranet` (REV-NTF-04) | Đã sửa và duyệt lại: Giao dịch và khóa 1, 2; Trạng thái hợp lệ; Migration 3 (hai trigger), 4 (đổi CHECK); cột `link` |
| NTF-SEC-20261006-103815605 | phải dựng lại | LOW | T15 còn biểu thức cũ; T3 chưa nêu cách gọi SES (ADR-010) nên không giải thích vì sao không chèn được header; T7 chưa trỏ SB-18 | Đã sửa và duyệt lại: T15, T3, T7 |
| NTF-API-20261006-103815515 | phải dựng lại | MEDIUM | Mục Dịch vụ ngoài ghi "qua SDK" và ba biến, mã gọi SES v2 `Simple` ký SigV4 với sáu biến (REV-NTF-06, 08); giao diện AUTH thiếu tên lớp (REV-NTF-10) | Đã sửa và duyệt lại: Dịch vụ ngoài, Gọi trực tiếp, Nhận. Bảng lỗi đã có 429 ở cả bốn endpoint (L121), không đổi |
| NTF-TC-20261006-104223630 | phải dựng lại | MEDIUM | TC mô tả header MIME thô, mã gửi SES v2 JSON (REV-NTF-08) | Đã sửa và duyệt lại; test `ses.spec.ts` (ca mới qua `SesTransport` thật tới SES giả) và `email.spec.ts` |
| NTF-TC-20261006-104223060 | phải dựng lại | LOW | Thiếu giá trị `//intranet` và chữ biểu thức cũ (REV-NTF-04) | Đã sửa và duyệt lại; test `db.spec.ts`, `consume.spec.ts`, `web.spec.ts` |
| NTF-TC-20261006-104302157 | phải dựng lại | LOW | Ngưỡng 30% trung vị đo chập chờn và không tái hiện được (REV-NTF-11) | Đã sửa và duyệt lại: "cùng dãy câu SQL"; test `read.spec.ts` ghi dãy câu SQL của ba nhánh 404 |
| spec/epics/NTF/ui/notification-list.md | phải dựng lại | LOW | Bố cục dưới `sm` ghi dropdown, mã dùng nhóm ba nút (REV-NTF-15) | Đã sửa và duyệt lại: wireframe ghi chú và dòng testid `ntf-notification-list-status-filter` |
| NTF-REQ-20261006-103208460 | không đổi | - | BR2 (chống trùng `ProcessedEvent` cùng giao dịch) và BR6 (liên kết chọn từ mẫu cố định) vẫn đúng; ADR-011 ghi dạng hai pha ở nền, requirement không nêu cách cài | - |
| NTF-E2E-20261006-104226475 | không đổi | - | Dùng testid `ntf-notification-list-status-filter` như nhóm nút (đã đúng với mã); bố cục dưới `sm` không đổi testid hay bước | - |
| NTF-TC-20261006-104223696 | không đổi | - | TC của job gửi email (hai job song song chỉ gửi một lần) cùng các TC hạn mức, thuê dòng, thử lại đã phủ job nền theo L61 (`check-tests --strict` không còn báo thiếu job của NTF); không đổi hành vi | - |
| NTF-TC-20261006-104222533 | không đổi | - | TC consumer: bước `ProcessedEvent` cùng giao dịch vẫn đúng với dạng hai pha (`handle` nhận `processed_events` do platform chèn trước) | - |

## Chưa chắc / rủi ro
- Chưa thử gọi SES thật: chữ ký SigV4 chỉ kiểm bằng bộ giả lập tự dựng và hai vectơ do AWS công bố; việc người trước go-live (sandbox SES).
- Chuông thông báo (`NotificationBell`) hiện chữ "Chuông", wireframe vẽ biểu tượng (REV-NTF-15 phần hai): chưa có quyết định, không đổi spec; người duyệt quyết giữ chữ hay dựng biểu tượng.
- E2E hay đột biến cho hết phiên 401 của chuông và trang `/notifications` (REV-NTF-14) vẫn chưa làm; bounce, complaint và tùy chọn nhận email vẫn là việc trước production (NTF-SEC Rủi ro còn lại).
- Migration đổi CHECK `link` dùng `-- contract-step` để qua `check-migration-compat` (bỏ CHECK cũ); bản ứng dụng cũ chỉ ghi liên kết `/orders...` nên không lỗi, nhưng nếu triển khai cuộn hai bước thì tách thành hai migration.
