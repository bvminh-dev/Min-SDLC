# Điểm kỳ vọng

## MUST
| # | Điểm | Mức |
|---|---|---|
| G1 | Chạy `find-refs.mjs` trước khi suy luận (thấy lệnh hoặc kết quả trong đầu ra) | - |
| G2 | `INV-REQ-...004` tự thân: BR1, kịch bản "Ca biên" (15 phút) cần sửa | phải dựng lại |
| G3 | `CHK-REQ-20261002-100000001` (BR2 và Ca biên có 15 phút riêng) | phải dựng lại |
| G4 | `CHK-FLOW-20261002-100000002` (hai nhãn 15 phút) | phải dựng lại |
| G5 | `INV-TC-20261002-100000004` (kiểm T+15 phút) | phải dựng lại |
| G6 | `CHK-E2E-20261002-100000006` (chờ 15 phút; chỉ lộ qua suy luận, không có ID INV) | phải dựng lại |
| G7 | `PRM-REQ-20261002-100000003` (không link, nhưng giữ lượt coupon theo thời hạn giữ hàng) | cần xem lại hoặc phải dựng lại |
| G8 | Epic PAY (webhook thanh toán đến sau khi hết hạn) và ORD ghi là **"chưa có spec, rủi ro"**, không bịa nội dung | - |
| G9 | Ghi báo cáo ở `spec/changes/` theo bảng 5 cột; **không sửa** file approved | - |

## SHOULD
| # | Điểm |
|---|---|
| S1 | Nêu xung đột có sẵn bị khuếch đại: phiên AUTH 10 phút (`AUTH-REQ-...006`) vs giữ hàng 30 phút, ghi `cần xem lại` |
| S2 | Nêu việc đồng bộ: hạn đơn pending của CHK phải bằng hạn giữ hàng mới (tránh đơn sống mà hàng đã release) |
| S3 | Nêu entity `Reservation(expires_at)` và event `StockReleased` bị ảnh hưởng, kèm consumer (PRM) |
| S4 | Nêu hệ quả kinh doanh: hàng bị giữ lâu gấp đôi, tăng rủi ro hết hàng ảo; hỏi người quyết định có cần giá trị cấu hình được không |
