---
screen: checkout
epic: CHK
status: draft
covers: [CHK-REQ-20261006-105051095, CHK-REQ-20261006-105051242, CHK-REQ-20261006-105051386, CHK-REQ-20261006-105051536, CHK-REQ-20261006-105051681, CHK-REQ-20261006-105051825, CHK-REQ-20261006-105051977, CHK-REQ-20261006-105052127, CHK-REQ-20261006-105052272, CHK-REQ-20261006-105052414]
roles: [customer]
---
# Thanh toán: chọn địa chỉ, vận chuyển, thanh toán, mã giảm giá, xem lại đơn và đặt hàng

## Wireframe
Phương án đã chọn: **A** (một trang hai cột: bên trái bốn khối chọn xếp dọc, bên phải khối tóm tắt đơn cố định kèm nút Đặt hàng). **Đây là lựa chọn mặc định** (khuyến nghị theo `U3`), chưa có người dùng chọn.

| Phương án | Việc chính thấy ở đâu | Đổi gì | Đánh đổi |
|---|---|---|---|
| **A. Một trang hai cột: khối chọn bên trái, tóm tắt và nút Đặt hàng bên phải (khuyên dùng, đã chọn)** | Chọn gì cũng thấy tổng đổi ngay bên cạnh; mọi thứ cản trở đặt hàng nằm một chỗ | Tổng tiền, hàng, lỗi luôn trong tầm mắt; ít bước | Dưới `lg` xếp một cột, tóm tắt xuống cuối; trang dài khi có nhiều cảnh báo |
| B. Từng bước (địa chỉ, rồi vận chuyển, rồi thanh toán, rồi xem lại) | Mỗi bước một màn | Rõ quy trình, ít rối trên di động | Nhiều lần chuyển; giá đổi hay hết hàng phát hiện muộn ở bước cuối; nhiều trạng thái trung gian cần kiểm |
| C. Accordion trên một cột: mở từng khối, khối đã chọn thu gọn | Khối đang làm mở, còn lại thu gọn một dòng | Gọn trên di động | Lỗi ở khối thu gọn bị che; tóm tắt nằm cuối trang |

Lý do chọn A: khách phải so ba thứ cùng lúc (địa chỉ quyết định phí, phương thức thanh toán quyết định hậu quả giữ hàng, mã quyết định tổng) trước khi bấm một nút không hoàn tác (CHK-REQ-20261006-105051681, CHK-REQ-20261006-105052272). Lỗi giá đổi và hết hàng ở bước đặt phải hiện cạnh nút bấm.

```
Thanh header:  ☰  Giỏ hàng › Thanh toán                       Phiên còn 24:10   [ Quay lại giỏ hàng ]
┌ (banner khi có) ⚠ Giá đã đổi: tổng cũ 345.000 đ → mới 363.000 đ   [ Xác nhận và đặt hàng ] ──────┐
│ (banner khi có) ⚠ Tất cổ cao chỉ còn 2 (bạn chọn 3)                  [ Quay lại giỏ hàng ]      │
├──────────────────────────────────────────────────────┬──────────────────────────────────────────┤
│ 1. Địa chỉ giao hàng                                  │ Đơn của bạn                               │
│  (•) Nguyễn An · 0901111111                           │  Áo thun cotton  x2          300.000 đ    │
│      45 Nguyễn Huệ, Bến Nghé, Quận 1, Hồ Chí Minh     │  Tất cổ cao      x1           50.000 đ    │
│  ( ) Trần Bình · 0902222222   Đà Nẵng                  │   ⚠ Hết hàng / Chỉ còn N                   │
│  [ + Thêm địa chỉ mới ]  (mở màn địa chỉ của USR)     │ ──────────────────────────────────────── │
│  ⚠ Địa chỉ đã bị sửa / đã bị xóa, hãy chọn lại        │  Tạm tính                    350.000 đ    │
├──────────────────────────────────────────────────────┤  Giảm giá (SALE10)           −35.000 đ    │
│ 2. Vận chuyển                                          │  Phí vận chuyển               30.000 đ    │
│  (•) Giao tiêu chuẩn   30.000 đ   (hoặc Miễn phí)      │  ─────────────────────────────────────── │
│  ( ) Giao nhanh        50.000 đ                        │  Tổng cộng                   345.000 đ    │
│  Chưa có phương thức vận chuyển nào đang bật           │  Chưa gồm phí vận chuyển (khi chưa chọn)   │
├──────────────────────────────────────────────────────┤ ──────────────────────────────────────── │
│ 3. Thanh toán                                          │  Giao tới: Nguyễn An, 45 Nguyễn Huệ ...   │
│  (•) VNPay   Giữ hàng 15 phút, trả ngay online         │                                           │
│  ( ) COD     Xác nhận ngay, trả tiền khi nhận hàng     │  [ Đặt hàng ]  ← khóa kèm lý do ngắn      │
│  ⚠ Số tiền ngoài 5.000 đến 999.999.999 với VNPay        │  Còn thiếu: địa chỉ, thanh toán            │
├──────────────────────────────────────────────────────┤                                           │
│ 4. Mã giảm giá                                         │                                           │
│  [ SALE10              ] [ Áp dụng ]  /  ✓ SALE10 [Gỡ]│                                           │
│  ⚠ Mã không còn áp dụng: hết lượt                      │                                           │
└──────────────────────────────────────────────────────┴──────────────────────────────────────────┘
```

## Trạng thái
Mỗi dòng: một trạng thái giao diện lấy từ Given/When/Then của requirement; cột testid trỏ tới phần tử đánh dấu trạng thái (phải có trong bảng Phần tử).

| Trạng thái | Trông ra sao | Requirement | testid |
|---|---|---|---|
| đang tải | Khung chờ đúng hình hai cột (bốn khối và tóm tắt) | CHK-REQ-20261006-105051681 | chk-checkout-loading |
| có dữ liệu, đủ điều kiện | Mọi khối có lựa chọn, tóm tắt đủ số, nút Đặt hàng bật | CHK-REQ-20261006-105051681 | chk-checkout-place-order |
| lỗi | Banner lỗi toàn trang "Không tải được thông tin thanh toán." kèm Thử lại (503); nút Đặt hàng khóa | CHK-REQ-20261006-105051681 | chk-checkout-error |
| hết phiên đăng nhập | "Phiên đăng nhập đã hết hạn" kèm liên kết Đăng nhập (401) | CHK-REQ-20261006-105051681 | chk-checkout-login-expired |
| chưa có địa chỉ | Khối địa chỉ rỗng "Bạn chưa có địa chỉ giao hàng" kèm nút Thêm địa chỉ; Đặt hàng khóa | CHK-REQ-20261006-105051095 | chk-checkout-address-empty |
| địa chỉ đã bị sửa | Cảnh báo "Địa chỉ đã được cập nhật" kèm nội dung mới, yêu cầu xác nhận (409 `address-changed`) | CHK-REQ-20261006-105051095 | chk-checkout-address-changed |
| địa chỉ đã bị xóa | Cảnh báo "Địa chỉ bạn chọn không còn" và bỏ lựa chọn (409 `address-unavailable`) | CHK-REQ-20261006-105051095 | chk-checkout-address-unavailable |
| chọn địa chỉ lỗi | Lỗi nhỏ trong khối địa chỉ khi địa chỉ không tìm thấy (404), giữ lựa chọn cũ | CHK-REQ-20261006-105051095 | chk-checkout-address-error |
| chưa chọn địa chỉ nên chưa có phí | Khối vận chuyển mờ kèm "Chọn địa chỉ để xem phí" (409 `address-required`) | CHK-REQ-20261006-105051242 | chk-checkout-shipping-needs-address |
| không có phương thức vận chuyển | "Chưa có phương thức vận chuyển", Đặt hàng khóa (409 `no-shipping-methods`) | CHK-REQ-20261006-105051242 | chk-checkout-shipping-empty |
| miễn phí vận chuyển | Phí hiện "Miễn phí" kèm nhãn khi `free_shipping` | CHK-REQ-20261006-105051242 | chk-checkout-shipping-free |
| phương thức vận chuyển không dùng được | "Phương thức này không còn được dùng, hãy chọn lại" (409), bỏ lựa chọn | CHK-REQ-20261006-105051242 | chk-checkout-shipping-unavailable |
| chọn vận chuyển lỗi | Lỗi dịch vụ vận chuyển "Không tính được phí, thử lại" (503) | CHK-REQ-20261006-105051242 | chk-checkout-shipping-error |
| đã chọn thanh toán | Hiện hậu quả: VNPay "giữ hàng 15 phút", COD "xác nhận ngay, không hạn chờ" | CHK-REQ-20261006-105051386 | chk-checkout-payment-note |
| số tiền ngoài khoảng VNPay | "VNPay chỉ nhận từ 5.000 đến 999.999.999 đ", gợi ý chọn COD (422) | CHK-REQ-20261006-105051386 | chk-checkout-payment-error-range |
| đơn 0 đồng | "Đơn 0 đồng chưa được hỗ trợ" (422), Đặt hàng khóa | CHK-REQ-20261006-105051386 | chk-checkout-payment-error-zero |
| quá nhiều đơn đang mở | "Bạn đang có quá nhiều đơn chưa hoàn tất" kèm số hiện có và liên kết tới danh sách đơn (409) | CHK-REQ-20261006-105051386 | chk-checkout-payment-error-open-orders |
| chưa có mã | Ô nhập mã và nút Áp dụng | CHK-REQ-20261006-105051536 | chk-checkout-coupon-input |
| đang áp mã | Nút Áp dụng khóa kèm vòng xoay, ô nhập khóa | CHK-REQ-20261006-105051536 | chk-checkout-coupon-apply |
| đã áp mã | Chip mã chữ hoa kèm số tiền giảm, nút Gỡ | CHK-REQ-20261006-105051536 | chk-checkout-coupon-applied |
| mã không còn áp dụng | Cảnh báo kèm lý do (hết hạn, hết lượt, đã dùng đủ số lượt mỗi người, thiếu N đ), mã giữ lại, giảm giá 0, Đặt hàng khóa tới khi gỡ mã | CHK-REQ-20261006-105051536 | chk-checkout-coupon-invalid |
| mã bị từ chối | Lỗi dưới ô nhập: "Mã không đúng" (404), "Mã đã hết hạn", "Mã đã hết lượt", "Cần thêm N đ để dùng mã" (409); giữ mã cũ | CHK-REQ-20261006-105051536 | chk-checkout-coupon-error |
| thử mã quá nhiều | "Thử lại sau N giây" (429), Áp dụng khóa tới hết thời gian | CHK-REQ-20261006-105051536 | chk-checkout-coupon-retry-after |
| tổng ước tính | Dòng "Chưa gồm phí vận chuyển" dưới tổng khi chưa chọn vận chuyển | CHK-REQ-20261006-105051681 | chk-checkout-summary-total-estimate |
| thiếu bước chọn | Nút Đặt hàng khóa kèm danh sách còn thiếu (địa chỉ, vận chuyển, thanh toán) từ `blockers` | CHK-REQ-20261006-105051681 | chk-checkout-blockers |
| giá đã đổi | Banner trên đầu: tổng cũ và tổng mới, các dòng đổi giá, nút "Xác nhận và đặt hàng" (409 `price-changed`) | CHK-REQ-20261006-105051825 | chk-checkout-price-changed |
| giỏ đã đổi | Banner "Giỏ hàng đã thay đổi ở nơi khác", tải lại tóm tắt, cần xem lại rồi đặt (409 `cart-changed`) | CHK-REQ-20261006-105051825 | chk-checkout-cart-changed |
| cảnh báo tồn (kiểm mềm) | Dòng hàng thiếu có nhãn "Hết hàng" hoặc "Chỉ còn N", không lộ tồn dòng đủ hàng | CHK-REQ-20261006-105051977 | chk-checkout-line-availability |
| có hàng ngừng bán | Banner "Có sản phẩm không còn bán, hãy xóa ở giỏ" kèm liên kết về giỏ (409) | CHK-REQ-20261006-105051977 | chk-checkout-unavailable-items |
| hết hàng khi đặt | Banner liệt kê từng mặt hàng thiếu (số cần và số còn), không có đơn nào được tạo, nút Quay lại giỏ hàng (409 `insufficient-stock`) | CHK-REQ-20261006-105052127 | chk-checkout-stock-error |
| đang đặt hàng | Nút Đặt hàng khóa kèm vòng xoay, mọi khối khóa chọn | CHK-REQ-20261006-105052272 | chk-checkout-placing |
| đặt hàng lỗi hệ thống | Banner "Chưa đặt được đơn, chưa có gì bị tính, hãy thử lại" (503); không có đơn nào tạo | CHK-REQ-20261006-105052272 | chk-checkout-place-error |
| phiên sắp hết hạn | Bộ đếm "Phiên còn mm:ss" ở đầu trang, dưới 5 phút đổi sang màu cảnh báo | CHK-REQ-20261006-105052414 | chk-checkout-session-timer |
| hủy phiên | Bấm Quay lại giỏ hàng: về trang giỏ, giỏ giữ nguyên | CHK-REQ-20261006-105052414 | chk-checkout-cancel |

## Phần tử
| testid | Phần tử | Role | Hành động | Requirement |
|---|---|---|---|---|
| chk-checkout-loading | Khung chờ hai cột | customer | - | CHK-REQ-20261006-105051681 |
| chk-checkout-error | Banner lỗi toàn trang | customer | - | CHK-REQ-20261006-105051681 |
| chk-checkout-retry | Nút Thử lại toàn trang | customer | Tải lại bản xem lại | CHK-REQ-20261006-105051681 |
| chk-checkout-login-expired | Thông báo hết phiên đăng nhập kèm liên kết Đăng nhập | customer | Mở màn đăng nhập | CHK-REQ-20261006-105051681 |
| chk-checkout-session-timer | Bộ đếm thời gian còn lại của phiên checkout | customer | - | CHK-REQ-20261006-105052414 |
| chk-checkout-cancel | Nút Quay lại giỏ hàng (hủy phiên) | customer | Hủy phiên và về giỏ | CHK-REQ-20261006-105052414 |
| chk-checkout-address-section | Khối địa chỉ giao hàng | customer | - | CHK-REQ-20261006-105051095 |
| chk-checkout-address-option | Một địa chỉ trong danh sách (nút radio) | customer | Chọn địa chỉ | CHK-REQ-20261006-105051095 |
| chk-checkout-address-add | Nút Thêm địa chỉ mới (mở màn của USR) | customer | Mở màn thêm địa chỉ | CHK-REQ-20261006-105051095 |
| chk-checkout-address-empty | Trạng thái chưa có địa chỉ | customer | - | CHK-REQ-20261006-105051095 |
| chk-checkout-address-changed | Cảnh báo địa chỉ đã bị sửa kèm nội dung mới | customer | - | CHK-REQ-20261006-105051095 |
| chk-checkout-address-confirm | Nút Dùng địa chỉ đã cập nhật | customer | Xác nhận địa chỉ mới | CHK-REQ-20261006-105051095 |
| chk-checkout-address-unavailable | Cảnh báo địa chỉ đã bị xóa | customer | - | CHK-REQ-20261006-105051095 |
| chk-checkout-address-error | Lỗi chọn địa chỉ (404) | customer | - | CHK-REQ-20261006-105051095 |
| chk-checkout-shipping-section | Khối phương thức vận chuyển | customer | - | CHK-REQ-20261006-105051242 |
| chk-checkout-shipping-option | Một phương thức kèm phí (nút radio) | customer | Chọn phương thức | CHK-REQ-20261006-105051242 |
| chk-checkout-shipping-needs-address | Gợi ý chọn địa chỉ trước | customer | - | CHK-REQ-20261006-105051242 |
| chk-checkout-shipping-empty | Trạng thái không có phương thức vận chuyển | customer | - | CHK-REQ-20261006-105051242 |
| chk-checkout-shipping-free | Nhãn Miễn phí vận chuyển | customer | - | CHK-REQ-20261006-105051242 |
| chk-checkout-shipping-unavailable | Cảnh báo phương thức không còn dùng được | customer | - | CHK-REQ-20261006-105051242 |
| chk-checkout-shipping-error | Lỗi tính phí (503) | customer | - | CHK-REQ-20261006-105051242 |
| chk-checkout-payment-section | Khối phương thức thanh toán | customer | - | CHK-REQ-20261006-105051386 |
| chk-checkout-payment-vnpay | Lựa chọn VNPay (nút radio) | customer | Chọn VNPay | CHK-REQ-20261006-105051386 |
| chk-checkout-payment-cod | Lựa chọn COD (nút radio) | customer | Chọn COD | CHK-REQ-20261006-105051386 |
| chk-checkout-payment-note | Ghi chú hậu quả của phương thức đã chọn | customer | - | CHK-REQ-20261006-105051386 |
| chk-checkout-payment-error-range | Lỗi số tiền ngoài khoảng VNPay | customer | - | CHK-REQ-20261006-105051386 |
| chk-checkout-payment-error-zero | Lỗi đơn 0 đồng | customer | - | CHK-REQ-20261006-105051386 |
| chk-checkout-payment-error-open-orders | Lỗi quá nhiều đơn đang mở kèm liên kết tới danh sách đơn | customer | Mở danh sách đơn | CHK-REQ-20261006-105051386 |
| chk-checkout-coupon-input | Ô nhập mã giảm giá (1 đến 50 ký tự) | customer | Nhập mã | CHK-REQ-20261006-105051536 |
| chk-checkout-coupon-apply | Nút Áp dụng | customer | Gửi áp mã | CHK-REQ-20261006-105051536 |
| chk-checkout-coupon-applied | Chip mã đã áp kèm số tiền giảm | customer | - | CHK-REQ-20261006-105051536 |
| chk-checkout-coupon-remove | Nút Gỡ mã | customer | Gỡ mã khỏi phiên | CHK-REQ-20261006-105051536 |
| chk-checkout-coupon-invalid | Cảnh báo mã không còn áp dụng | customer | - | CHK-REQ-20261006-105051536 |
| chk-checkout-coupon-error | Lỗi dưới ô nhập khi mã bị từ chối | customer | - | CHK-REQ-20261006-105051536 |
| chk-checkout-coupon-retry-after | Thông báo thử lại sau N giây | customer | - | CHK-REQ-20261006-105051536 |
| chk-checkout-summary | Khối tóm tắt đơn bên phải | customer | - | CHK-REQ-20261006-105051681 |
| chk-checkout-line | Một dòng hàng (tên, số lượng, giá hiện hành, thành tiền) | customer | - | CHK-REQ-20261006-105051681 |
| chk-checkout-line-availability | Nhãn tình trạng hàng của dòng (Hết hàng, Chỉ còn N) | customer | - | CHK-REQ-20261006-105051977 |
| chk-checkout-summary-subtotal | Dòng tạm tính | customer | - | CHK-REQ-20261006-105051681 |
| chk-checkout-summary-discount | Dòng giảm giá | customer | - | CHK-REQ-20261006-105051681 |
| chk-checkout-summary-shipping-fee | Dòng phí vận chuyển (hoặc Miễn phí, hoặc Chưa chọn) | customer | - | CHK-REQ-20261006-105051681 |
| chk-checkout-summary-total | Dòng tổng cộng (số do máy chủ tính) | customer | - | CHK-REQ-20261006-105051681 |
| chk-checkout-summary-total-estimate | Ghi chú tổng chưa gồm phí vận chuyển | customer | - | CHK-REQ-20261006-105051681 |
| chk-checkout-summary-address | Dòng nơi nhận hàng trong tóm tắt | customer | - | CHK-REQ-20261006-105051681 |
| chk-checkout-blockers | Danh sách điều còn thiếu hoặc cản trở đặt hàng | customer | - | CHK-REQ-20261006-105051681 |
| chk-checkout-price-changed | Banner giá đã đổi kèm tổng cũ và tổng mới | customer | - | CHK-REQ-20261006-105051825 |
| chk-checkout-price-changed-confirm | Nút Xác nhận và đặt hàng với giá mới | customer | Đặt lại với số mới | CHK-REQ-20261006-105051825 |
| chk-checkout-cart-changed | Banner giỏ đã đổi ở nơi khác | customer | - | CHK-REQ-20261006-105051825 |
| chk-checkout-cart-changed-reload | Nút Tải lại tóm tắt | customer | Tải lại bản xem lại | CHK-REQ-20261006-105051825 |
| chk-checkout-unavailable-items | Banner có hàng ngừng bán kèm liên kết về giỏ | customer | Mở giỏ hàng | CHK-REQ-20261006-105051977 |
| chk-checkout-stock-error | Banner hết hàng khi đặt, liệt kê mặt hàng thiếu | customer | - | CHK-REQ-20261006-105052127 |
| chk-checkout-stock-error-item | Một mặt hàng thiếu (số cần, số còn) | customer | - | CHK-REQ-20261006-105052127 |
| chk-checkout-stock-error-back | Nút Quay lại giỏ hàng để chỉnh số lượng | customer | Mở giỏ hàng | CHK-REQ-20261006-105052127 |
| chk-checkout-place-order | Nút Đặt hàng | customer | Gửi đặt hàng kèm tổng và phiên bản giỏ đang xem | CHK-REQ-20261006-105052272 |
| chk-checkout-placing | Trạng thái đang đặt hàng (vòng xoay) | customer | - | CHK-REQ-20261006-105052272 |
| chk-checkout-place-error | Banner đặt hàng lỗi hệ thống (503) | customer | - | CHK-REQ-20261006-105052272 |

## Ghi chú thiết kế (mặc định, chưa duyệt)
- **Báo trước theo skill evon:** skill giao diện chưa được dạy cho cửa hàng online phía người mua (thanh toán); trang theo mẫu form nhiều khối cộng danh sách mô tả, kết quả có thể chưa đẹp bằng màn trong app.
- **Audit (câu 2 của evon):** chưa có codebase hay `package.json` (cùng ghi chú của ORD và CRT), nên không có token, component hay phong cách có sẵn; stack web theo ADR-002 (Next.js), thư viện UI chưa có ADR; mặc định flat (hướng A) và copy tiếng Việt theo spec. Chỉ wireframe ASCII, không dựng HTML, không chạy probe (việc của implement).
- Mọi số tiền (tạm tính, giảm, phí, tổng, `expected_grand_total`) đến từ phản hồi máy chủ; giao diện **không tự cộng trừ** (SB-23, CHK-REQ-20261006-105051681 BR2). Nút Đặt hàng gửi kèm `expected_grand_total` và `cart_version` của bản đang hiển thị để máy chủ so sánh (CHK-REQ-20261006-105051825 BR2).
- Mỗi lần khách chủ động bấm Đặt hàng, giao diện sinh một `Idempotency-Key` mới gửi ở header (ADR-017, CHK-REQ-20261006-105052272 BR13) và giữ nguyên khóa đó khi tự gửi lại do mạng lỗi; sau 409 `price-changed` hay `cart-changed`, lần bấm xác nhận kế tiếp dùng khóa mới. Phản hồi `replayed` = true hiện như kết quả bình thường.
- Khi bấm Đặt hàng nút khóa và mọi khối khóa chọn tới khi có kết quả (idempotent ở server, nhưng giao diện vẫn chặn bấm đôi). Lỗi 409 và 422 của bước đặt cho biết rõ **chưa có đơn nào được tạo** (giao dịch hoàn tác, CHK-REQ-20261006-105052127 BR4) để khách không lo bị tính tiền hai lần.
- Địa chỉ đổi hay bị xóa, phương thức vận chuyển bị tắt, giá đổi: không tự đặt tiếp, luôn cần khách xác nhận (CHK-REQ-20261006-105051095 BR5, BR6; CHK-REQ-20261006-105051825 BR4).
- Mã giảm giá chỉ gửi khi bấm Áp dụng hoặc Enter, không gửi khi gõ (không tốn lượt dò mã). Mã không còn hợp lệ khóa nút Đặt hàng tới khi khách gỡ mã (CHK-REQ-20261006-105051536 BR6).
- Số tồn chính xác không hiển thị: nhãn "Chỉ còn N" chỉ có khi thiếu và N nhỏ hơn số cần (CRT questions câu 4).
- Thêm hoặc sửa địa chỉ mở màn của USR (không nhúng form địa chỉ ở đây); quay lại checkout giữ phiên. Danh sách phương thức vận chuyển và phí là dữ liệu của CHK `shipping-options`.
- Bước ở cổng thanh toán VNPay và kết quả thanh toán thuộc màn `order-payment` của PAY; màn này chỉ dẫn khách sang đó sau khi đặt đơn VNPay thành công (xem màn `checkout-complete`).
- Tên, địa chỉ, mã, tên phương thức hiển thị dạng văn bản thường đã escape (SB-12); dữ liệu cá nhân không vào log hay URL (SB-08).
- Hết phiên đăng nhập (401) khác hết phiên checkout (409 `checkout-session-closed`): hết phiên checkout chuyển sang màn `checkout-blocked`.
- Khác luật evon: bộ đếm phiên và các banner ưu tiên nằm trên cùng thay vì trong khối, vì chúng cản trở hành động chính (không mâu thuẫn requirement).
- Không viết code giao diện; dựng thật là việc của `implement`.
