# Câu hỏi còn mở của epic SAL (sdlc-research, sdlc-tech-design, sdlc-ui-ux, sdlc-test-design)

Chạy tự động nên không hỏi trực tiếp (người dùng đã nói "chạy làm hết đi để done", 2026-10-15). Mọi mặc định dưới đây theo nền đã duyệt ngày 2026-10-15 (`spec/changes/ban-ho-sale-nguon-don-20261015.md`: ADR-024, ADR-025, ADR-026, SB-06, SB-07, SB-08, SB-42 đến SB-45, role `sale`). Phạm vi: SAL làm bốn mục con của roadmap (tạo đơn hộ, chọn nguồn đơn kèm ghi chú đơn và dòng hàng, tra khách có sẵn, Đơn của tôi) qua sáu requirement (xem `requirements/`). Danh mục nguồn đơn do admin quản lý thuộc ORD; SAL chỉ dùng `GET /order-sources`.

## A. Cần người quyết ở phạm vi SAL (mặc định đã áp)
1. [RESOLVED] **Ghi nhận tiền thu của `cash` và `bank_transfer`**: quyết định mặc định (2026-10-15): SAL chỉ ghi `payment_method` làm nhãn cách khách trả, không tạo Payment, không đổi `payment_status`; PAY xử lý OrderCreated của đơn hộ như đơn COD (thu khi giao). Rủi ro: tiền đã thu trước khi giao vẫn hiện "chưa thu" trong báo cáo tiền. Người quyết: khi duyệt PAY.
2. [RESOLVED] **Đơn hộ cho khách đã có tài khoản**: gắn `user_id` chỉ khi sale chọn khách từ kết quả tra (SAL-REQ-20261015-092710847 BR4 b); không tự gắn theo điện thoại hay email trùng. Khách thấy đơn, nhận thông báo; đánh giá chỉ khi `delivered` (SB-36).
3. [RESOLVED] **Khách chưa có tài khoản**: `user_id` rỗng, bản chụp `customer_snapshot` (họ tên, điện thoại) và `shipping_address` (sáu khóa như CHK); NTF bỏ qua, REV không có đánh giá (ADR-026).
4. [RESOLVED] **Sale thấy địa chỉ giao của đơn mình tạo**: SB-08 (e) liệt kê họ tên và điện thoại, SB-08 (d) cho thấy địa chỉ ở vận đơn của đơn đó; quyết định mặc định: hiện địa chỉ ở chi tiết đơn (SAL-REQ-20261015-092711321 BR3). Đề nghị thêm "địa chỉ giao" vào SB-08 (e) (xem Nền cần sửa).
5. [RESOLVED] **Nguồn hệ thống `website` cho đơn hộ**: không loại riêng; nhận mọi nguồn đang bật.
6. [RESOLVED] **Sale hủy hoặc sửa đơn hộ**: v1 chỉ đọc (SAL-REQ-20261015-092711321 BR6); admin hủy và sửa nguồn, người tạo ở ORD có audit (SB-45).
7. [RESOLVED] **Số điện thoại không duy nhất**: tra khách trả tối đa 5 khách (SAL-REQ-20261015-092710942 BR2), bản che, khớp chính xác.
8. [RESOLVED] **Phí vận chuyển cho sale**: SAL có endpoint báo phí riêng (`GET /sales/shipping-options`) vì `POST /shipping/quote` của SHP chỉ cho customer; tạo đơn tính lại bằng `ShippingApi.quote` (SB-23).
9. [RESOLVED] **Chọn sản phẩm**: màn dùng `GET /products/search` và `GET /inventory/availability` công khai có sẵn (không có `cost_price`, không có số tồn chính xác); SAL không thêm endpoint tìm hàng.
10. [RESOLVED] **Giới hạn**: 50 dòng và số lượng 1 đến 100000 mỗi dòng (khớp `InventoryApi.reserve`), tổng hàng tối đa 10.000.000.000 (miền của `ShippingApi.quote`), 10 đơn mỗi phút mỗi người (bậc B); `discount` = 0 (chưa có coupon cho đơn hộ).
11. [RESOLVED] **Không có biến môi trường mới**: các giới hạn là hằng số của mã trích từ nền; không đổi ADR-007.

12. [RESOLVED] **Audit tạo đơn hộ**: chốt của lead (2026-10-15): ORD ghi `order.created_ho` trong `OrderApi.createHo`; SAL không ghi dòng audit tạo đơn. Tra khách do USR ghi.
13. [RESOLVED] **PAY, SB-08(e), tên hàm**: chốt của lead: PAY xử lý OrderCreated của đơn hộ `cod`, `cash`, `bank_transfer` như COD; SB-08(e) thêm "địa chỉ giao" cho sale với đơn mình tạo; `CatalogApi.getForSale` (PRD) và `AuthApi.findCustomersByPhone` giữ nguyên.

## Đề nghị về test case INV
- INV-TC của `reserve` (các TC phủ INV-REQ-20261006-101122538) hiện viết bên gọi là CHK và chưa có trong sổ change-control; đề nghị lead khai rồi thêm một TC "SAL gọi `reserve` với `expires_at` rỗng như COD" (kind chính). SAL-TC (đơn hộ giữ hàng, hết hàng) đã phủ phía SAL.

## Nền cần sửa
Chỗ nền thiếu (không sửa trong epic này, việc của lead qua sdlc-impact hoặc sdlc-foundation).

- spec/architecture.md; Bảng Giao diện module thiếu các hàng SAL gọi PRD `CatalogApi.getForSale`, INV `InventoryApi.reserve`, SHP `ShippingApi.listActiveMethods` và `ShippingApi.quote`, ORD `OrderApi.createHo`, `listSources`, `listForSale`, `getForSale`, USR `UserApi.lookupForSale`, `UserApi.isCustomer` (chữ ký ở SAL-API); cao; SAL
- spec/security-baseline.md; SB-08 (e) thêm "địa chỉ giao" vào dữ liệu sale được xem trên đơn do mình tạo (hiện chỉ họ tên và điện thoại); trung bình; SAL
- spec/domain/entities.md; User.phone cần chỉ mục và `AuthApi.findCustomersByPhone(phone, limit)` (khớp chính xác, role customer, số điện thoại không duy nhất) cho tra khách của sale; trung bình; SAL
- spec/domain/events.md; Ghi rõ PAY xử lý OrderCreated của đơn hộ `cash`, `bank_transfer` như đơn COD (không tạo đường VNPay, thu khi giao) và NTF, REV bỏ qua đơn `user_id` rỗng; trung bình; SAL
- spec/epics/PRD/design; Thêm `CatalogApi.getForSale(product_ids)` trả `{ product_id, name, sku, price, cost_price, sellable }` (chỉ SAL gọi, `cost_price` không ra khỏi SAL, SB-42); cao; SAL
- spec/epics/ORD/design; ORD-API cần `OrderApi.createHo` (tập khóa SAL-API), `listForSale`, `getForSale` (404 chung theo SB-44) và lỗi `source_unavailable`; cao; SAL
