# Tác động của đợt sửa PAY 2026-10-13 (REV-PAY-01 HIGH, REV-PAY-04, 09, 10, 13, 14; bài học L100, L103, L61, L121)

- **Thay đổi:** (a) `PAY-REQ-20261006-103110513` kịch bản "IPN thất bại cũ gửi lại" `RspCode` 97 thành 02 (BR3, BR5), BR8 loại trừ lời gọi bị chặn ở lớp IP (BR10), thêm kịch bản IP ngoài danh sách; (b) REV-PAY-01: job đối soát lượt thử cả lượt `processing` của Payment đã đóng (`expired`, `cancelled`, `refunded`): cổng báo thành công thì lượt `succeeded` và Refund `late_payment` hoặc `duplicate_payment`, báo thất bại thì chỉ ghi lượt; hạn 7 ngày đóng lượt khi cổng không chốt được (`PAY-REQ-20261006-103110684` BR5, BR9 và ca biên; `PAY-TC-20261006-104539686`; `PAY-DB-20261006-103701241` mục 9; `PAY-SEC-20261006-103701420` T20 và Rủi ro còn lại); (c) `PAY-REQ-20261006-103110946` BR6 và `PAY-DB-20261006-103701241` mục 6, 14: hỏi lại bằng cùng mã yêu cầu, quá 1 giờ thì Refund `failed` (`gateway-no-answer`) kèm RefundFailed, không tự thử lại; (d) PAY-DB: cột `refunds.requested_at`, thu `DELETE` của `app_runtime` trên `payments`, `payment_attempts`, `refunds` (migration `20261013000100_payment_hardening`), `payment_webhook_logs.created_at` mặc định `clock_timestamp()`, mục 15 job dọn; PAY-SEC T23 (xóa dữ liệu tiền), T24 (hoàn tiền kẹt); (e) PAY-API: refunds và refunds retry luôn 202, mục "Cung cấp cho DSH" ghi `PaymentApi.getRevenue({ from, to }, bucket?)` và `PaymentApi.countFailedRefunds()` đúng mã, thêm 429 vào bảng lỗi (L121); (f) biến `VNPAY_*`, `PAY_*` chỉ trỏ ADR-007; (g) chín TC mới (đối soát Payment đã đóng hai hướng, lô, hạn thời gian, Refund kẹt, thu quyền DELETE, thứ tự nhật ký, job dọn, IP ngoài danh sách); (h) go-live: chưa thử VNPay sandbox, URL sandbox mặc định không bị chặn ở prod (ADR-007 không bắt buộc URL production nên không thêm kiểm ở cấu hình).
- **Lý do:** review PAY 2026-10-08 (REV-PAY-01 HIGH: tiền thu ở cổng mà IPN mất, khi Payment đã đóng, không còn đường phát hiện; REV-PAY-04, 09, 10, 13, 14) và bài học L100, L103, L61, L121; nền đã đồng bộ ở `spec/changes/nen-dong-bo-20261013.md` (không sửa lại).
- **Người yêu cầu:** người dùng (quyết định (a) đến (h) chốt khi giao việc; "chạy tiếp đi"); phân tích do Claude

Tài liệu bị đổi: PAY-REQ-20261006-103110684
Cụm từ xuyên module: "countFailedRefunds"

Hàng `phải dựng lại` ghi "Đã sửa và duyệt lại" là việc đã làm trong đợt này. Hàng DSH là việc cho agent DSH (không sửa ở đây).

| ID bị ảnh hưởng | Loại | Mức | Lý do | Việc cần làm |
|---|---|---|---|---|
| PAY-REQ-20261006-103110684 | phải dựng lại | HIGH | BR5 và ca biên "bỏ qua Payment đã đóng" làm tiền thu mà IPN mất không còn đường phát hiện (REV-PAY-01) | Đã sửa và duyệt lại: BR5, BR9, bốn ca biên mới |
| PAY-REQ-20261006-103110513 | phải dựng lại | LOW | Kịch bản cuối ghi 97 trái BR3, BR5; BR8 mâu thuẫn BR10 (REV-PAY-10) | Đã sửa và duyệt lại: kịch bản cuối 02, BR8 loại trừ lớp IP, thêm kịch bản IP |
| PAY-REQ-20261006-103110946 | phải dựng lại | MEDIUM | BR6 "hỏi lại cổng" không nêu cách hỏi và đường kết thúc có hạn (L103, REV-PAY-04) | Đã sửa và duyệt lại: BR6, ca biên, mục Xung đột |
| PAY-DB-20261006-103701241 | phải dựng lại | HIGH | Mục 9 lọc Payment đang mở; mục 6 không có đường kết thúc Refund kẹt; ba bảng tiền còn `DELETE` của `app_runtime` (REV-PAY-13) | Đã sửa và duyệt lại: mục 6, 9, 14, 15, `requested_at`, quyền, migration 7 |
| PAY-SEC-20261006-103701420 | phải dựng lại | HIGH | T20 chưa phủ Payment đã đóng; thiếu T23, T24; rủi ro còn lại và go-live VNPay | Đã sửa và duyệt lại: T20, T23, T24, Rủi ro còn lại |
| PAY-API-20261006-103701335 | phải dựng lại | MEDIUM | Refund luôn 202 (REV-PAY-09); chữ ký `PaymentApi` (REV-PAY-14); thiếu 429 ở bảng lỗi (L121); biến trỏ ADR-007 | Đã sửa và duyệt lại |
| PAY-TC-20261006-104539686 | phải dựng lại | HIGH | TC chỉ kiểm ngưỡng 2 phút, test cũ khóa hành vi bỏ qua Payment đã đóng | Đã sửa và duyệt lại: thêm bước Payment đã đóng |
| PAY-TC-20261006-104539164 | không đổi | - | Đã ghi RspCode 02 cho IPN thất bại cũ gửi lại, khớp BR3, BR5 | - |
| PAY-FLOW-20261006-103111299 | cần xem lại | LOW | Nhánh "Giữ requested, job đối soát 5 phút chốt" chưa nêu kết thúc sau 1 giờ; không thuộc danh sách file đã được ủy quyền sửa | Người duyệt thêm nhánh `failed` (`gateway-no-answer`) khi cập nhật sơ đồ |
| PAY-REQ-20261006-103110771 | không đổi | - | Thử lại thanh toán của khách; đối soát Payment đã đóng không đổi điều kiện thử lại | - |
| PAY-E2E-20261006-104612157 | không đổi | - | Luồng E2E thanh toán thất bại của khách; UI và API không đổi | - |
| PAY-E2E-20261006-104612213 | không đổi | - | Luồng E2E hết lượt; UI và API không đổi | - |
| PAY-TC-20261006-104539555 | không đổi | - | Thất bại do IPN (mã 24); đối soát Payment đã đóng không đổi đường này | - |
| PAY-TC-20261006-104539587 | không đổi | - | Lượt cuối thất bại do IPN; không đổi | - |
| PAY-TC-20261006-104539621 | không đổi | - | Đối soát lượt của Payment `processing` (không đổi) | - |
| PAY-TC-20261006-104539653 | không đổi | - | Cổng lỗi thì thử lại lượt sau với Payment còn mở (không đổi) | - |
| PAY-TC-20261006-104539718 | không đổi | - | Đối soát lượt của Payment `succeeded` (duplicate_payment) vẫn đúng | - |
| PAY-TC-20261006-130000400 | không đổi | - | Ánh xạ mã cổng sang `reason`; không đổi | - |
| PAY-TC-20261006-150000200 | không đổi | - | Thử lại thanh toán; không đổi | - |
| PAY-TC-20261013-193715406 | không đổi | - | TC mới cùng đợt (đối soát Payment đã đóng, cổng báo thành công) | - |
| PAY-TC-20261013-193715507 | không đổi | - | TC mới cùng đợt (cổng báo thất bại) | - |
| PAY-TC-20261013-193715606 | không đổi | - | TC mới cùng đợt (giới hạn lô) | - |
| PAY-TC-20261013-193715697 | không đổi | - | TC mới cùng đợt (hạn 7 ngày, đóng lượt khi không chắc) | - |
| PAY-TC-20261013-193715799 | không đổi | - | TC mới cùng đợt (Refund kẹt `requested`; nhắc `countFailedRefunds` vì số đếm gồm Refund kẹt) | - |
| NTF-REQ-20261006-103208992 | không đổi | - | NTF chỉ nhận PaymentFailed của lượt IPN hay đối soát Payment đang mở; Payment đã đóng không phát PaymentFailed | - |
| ORD-REQ-20261006-092320790 | không đổi | - | ORD chỉ hủy đơn khi PaymentFailed `is_final`; đối soát Payment đã đóng không phát event | - |
| spec/architecture.md | không đổi | - | Bảng Giao diện module và ADR-007 đã đồng bộ ở đợt nền; PAY-API nay trỏ ADR-007 | - |
| DSH-API-20261006-105535010 | cần xem lại | MEDIUM | Mục PAY phải ghi `PaymentApi.getRevenue({ from, to }, bucket?)` và `PaymentApi.countFailedRefunds()` (số đếm nay gồm Refund `failed` `gateway-no-answer`) | Agent DSH sửa theo PAY-API mục "Cung cấp cho DSH" |
| DSH-DB-20261006-105534913 | cần xem lại | LOW | Mô tả đọc qua giao diện nhắc tên hàm cũ | Agent DSH sửa theo PAY-API mục "Cung cấp cho DSH" |
| DSH-REQ-20261006-105125714 | cần xem lại | LOW | Nhắc `countFailedRefunds`; số đếm gồm Refund kẹt đã chuyển `failed` | Agent DSH xác nhận câu chữ |

## Chưa chắc / rủi ro
- Hỏi lại Refund bằng cùng mã yêu cầu và mã 94 chưa thử với sandbox VNPay thật; Refund kẹt chuyển `failed` có thể bị admin thử lại khi cổng đã hoàn (hoàn hai lần): quy trình đối chiếu ở cổng là việc người.
- Lượt của Payment đã đóng mà cổng không trả lời 7 ngày bị đóng kèm log `error`; v1 không có thao tác hoàn thủ công cho Payment không `succeeded`, người vận hành hoàn ngoài hệ thống.
- URL sandbox VNPay là mặc định của `VNPAY_PAY_URL`, `VNPAY_API_URL` và mã không chặn dùng ở prod (ADR-007 không bắt buộc URL production): việc người go-live; muốn chặn thì đổi ADR-007 qua `sdlc-foundation`.
- Chưa thử VNPay sandbox thật (15 dòng YẾU của report PAY mục 12); `vnp_IpAddr` là hằng `127.0.0.1` (REV-PAY-11).
