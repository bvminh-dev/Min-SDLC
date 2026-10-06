---
screen: cart-summary
epic: CRT
status: draft
covers: [CRT-REQ-20261006-103226486, CRT-REQ-20261006-103226511, CRT-REQ-20261006-103226537, CRT-REQ-20261006-103226562, CRT-REQ-20261006-103226588]
roles: [customer]
---
# Tóm tắt đơn trong giỏ: mã giảm giá, vận chuyển, tổng tiền, nút sang thanh toán

## Wireframe
Phương án đã chọn: **A** (khối cột phải cố định cạnh danh sách dòng của màn `cart`: tạm tính, ô mã giảm giá, chọn vận chuyển và thành phố, tổng cộng, nút Tiến hành thanh toán). **Đây là lựa chọn mặc định** (khuyến nghị theo `U3`), chưa có người dùng chọn.

| Phương án | Việc chính thấy ở đâu | Đổi gì | Đánh đổi |
|---|---|---|---|
| **A. Khối cố định bên phải, mã và vận chuyển ngay trong khối (khuyên dùng, đã chọn)** | Tạm tính, giảm, phí, tổng đọc từ trên xuống | Đổi mã hay phương thức thấy tổng đổi tại chỗ | Chiều cao khối tăng khi có lỗi mã; dưới `lg` xuống cuối trang |
| B. Chia bước: mã và vận chuyển ở trang riêng sau giỏ | Mỗi bước một trang | Giỏ gọn | Thêm một lần chuyển trang; trùng việc của CHK |
| C. Mã giảm giá trong hộp thoại | Nút Nhập mã mở hộp thoại | Khối gọn | Lỗi mã (cần đọc số tiền thiếu) hiện xa chỗ khách nhìn |

Lý do chọn A: khách cần so tổng với mã và phí cùng lúc (CRT-REQ-20261006-103226562 BR1); lỗi mã kèm số tiền thiếu (`shortfall`) phải nằm cạnh ô nhập (CRT-REQ-20261006-103226511 BR5).

```
┌ Tóm tắt đơn ───────────────────────────────┐
│ Tạm tính                          450.000 đ │
│ Mã giảm giá                                  │
│ [ SALE10                    ] [ Áp dụng ]    │   <- khi chưa có mã
│ ✓ SALE10  −45.000 đ                [ Gỡ ]    │   <- khi đã áp
│ ⚠ SALE10 không còn áp dụng: thiếu 50.000 đ   │   <- khi applied=false (mã giữ lại)
│ Vận chuyển                                    │
│ ( ) Giao tiêu chuẩn  30.000 đ                 │
│ ( ) Giao nhanh       50.000 đ                 │
│ Thành phố [ Hà Nội                       ]    │
│ Phí vận chuyển                     30.000 đ   │   <- hoặc "Miễn phí"; hoặc "Chưa chọn"
│ ─────────────────────────────────────────── │
│ Giảm giá                          −45.000 đ   │
│ Tổng cộng                         435.000 đ   │   <- thêm "Tạm tính, chưa gồm phí vận chuyển" khi chưa có phí
│ [ Tiến hành thanh toán ]                      │   <- khóa khi can_checkout = false, kèm lý do
└──────────────────────────────────────────────┘
```

## Trạng thái
| Trạng thái | Trông ra sao | Requirement | testid |
|---|---|---|---|
| đang tải | Khung chờ đúng hình các dòng của khối | CRT-REQ-20261006-103226486 | crt-cart-summary-loading |
| có dữ liệu | Tạm tính, giảm giá, phí, tổng đọc được; nút thanh toán bật khi `can_checkout` | CRT-REQ-20261006-103226562 | crt-cart-summary-total |
| lỗi | Banner trong khối "Không tính được tổng tiền." kèm Thử lại (503); nút thanh toán khóa | CRT-REQ-20261006-103226562 | crt-cart-summary-error |
| hết phiên | "Phiên đã hết hạn" kèm liên kết Đăng nhập (401) | CRT-REQ-20261006-103226562 | crt-cart-summary-session-expired |
| chưa có mã | Ô nhập mã và nút Áp dụng | CRT-REQ-20261006-103226511 | crt-cart-summary-coupon-input |
| đang áp mã | Nút Áp dụng khóa, vòng xoay; ô nhập khóa | CRT-REQ-20261006-103226511 | crt-cart-summary-coupon-apply |
| đã áp mã | Chip hiện mã (chữ hoa) và số tiền giảm, nút Gỡ | CRT-REQ-20261006-103226511 | crt-cart-summary-coupon-applied |
| mã không còn áp dụng | Dòng cảnh báo kèm lý do và số tiền thiếu (`min_order_not_met`), mã vẫn giữ, giảm giá 0 | CRT-REQ-20261006-103226511 | crt-cart-summary-coupon-invalid |
| mã bị từ chối | Lỗi dưới ô nhập theo mã lỗi: "Mã không đúng" (404), "Mã đã hết hạn", "Mã đã hết lượt", "Cần thêm N đ để dùng mã" (409), "Không có mức giảm", giỏ giữ mã cũ | CRT-REQ-20261006-103226511 | crt-cart-summary-coupon-error |
| thử mã quá nhiều | "Bạn thử quá nhiều lần, thử lại sau N giây" (429) và nút Áp dụng khóa tới hết thời gian | CRT-REQ-20261006-103226511 | crt-cart-summary-coupon-retry-after |
| chưa chọn vận chuyển | Danh sách phương thức, phí "Chưa chọn", tổng ghi "chưa gồm phí vận chuyển" | CRT-REQ-20261006-103226537 | crt-cart-summary-shipping-method |
| đã chọn vận chuyển | Phương thức đã chọn, thành phố, phí (hoặc "Miễn phí") | CRT-REQ-20261006-103226537 | crt-cart-summary-shipping-fee |
| miễn phí vận chuyển | Phí hiện "Miễn phí" kèm nhãn khi `free_shipping` | CRT-REQ-20261006-103226537 | crt-cart-summary-shipping-free |
| phương thức không dùng được | "Phương thức này không còn được dùng, hãy chọn lại" (409 hoặc `method_unavailable` khi xem), phí rỗng | CRT-REQ-20261006-103226537 | crt-cart-summary-shipping-error |
| tổng ước tính | Dòng ghi "Chưa gồm phí vận chuyển" dưới tổng khi chưa có phí | CRT-REQ-20261006-103226562 | crt-cart-summary-total-estimate |
| không thể thanh toán | Nút Tiến hành thanh toán khóa kèm lý do ngắn ("Giỏ trống", "Có sản phẩm hết hàng hoặc ngừng bán") | CRT-REQ-20261006-103226588 | crt-cart-summary-checkout-disabled-reason |

## Phần tử
| testid | Phần tử | Role | Hành động | Requirement |
|---|---|---|---|---|
| crt-cart-summary-loading | Khung chờ | customer | - | CRT-REQ-20261006-103226486 |
| crt-cart-summary-error | Banner lỗi tính tổng | customer | - | CRT-REQ-20261006-103226562 |
| crt-cart-summary-retry | Nút Thử lại | customer | Tải lại giỏ | CRT-REQ-20261006-103226562 |
| crt-cart-summary-session-expired | Thông báo hết phiên kèm liên kết Đăng nhập | customer | Mở màn đăng nhập | CRT-REQ-20261006-103226562 |
| crt-cart-summary-subtotal | Dòng tạm tính hàng hóa | customer | - | CRT-REQ-20261006-103226486 |
| crt-cart-summary-coupon-input | Ô nhập mã giảm giá (1 đến 50 ký tự) | customer | Nhập mã | CRT-REQ-20261006-103226511 |
| crt-cart-summary-coupon-apply | Nút Áp dụng | customer | Gửi áp mã | CRT-REQ-20261006-103226511 |
| crt-cart-summary-coupon-applied | Chip mã đã áp kèm số tiền giảm | customer | - | CRT-REQ-20261006-103226511 |
| crt-cart-summary-coupon-remove | Nút Gỡ mã | customer | Gỡ mã khỏi giỏ | CRT-REQ-20261006-103226511 |
| crt-cart-summary-coupon-invalid | Cảnh báo mã không còn áp dụng | customer | - | CRT-REQ-20261006-103226511 |
| crt-cart-summary-coupon-error | Lỗi dưới ô nhập khi mã bị từ chối | customer | - | CRT-REQ-20261006-103226511 |
| crt-cart-summary-coupon-retry-after | Thông báo thử lại sau N giây | customer | - | CRT-REQ-20261006-103226511 |
| crt-cart-summary-discount | Dòng giảm giá | customer | - | CRT-REQ-20261006-103226562 |
| crt-cart-summary-shipping-method | Nhóm chọn phương thức vận chuyển | customer | Chọn một phương thức | CRT-REQ-20261006-103226537 |
| crt-cart-summary-shipping-city | Ô nhập thành phố (1 đến 50 ký tự) | customer | Nhập hoặc chọn thành phố | CRT-REQ-20261006-103226537 |
| crt-cart-summary-shipping-fee | Dòng phí vận chuyển | customer | - | CRT-REQ-20261006-103226537 |
| crt-cart-summary-shipping-free | Nhãn Miễn phí vận chuyển | customer | - | CRT-REQ-20261006-103226537 |
| crt-cart-summary-shipping-error | Lỗi phương thức không dùng được hoặc chọn bị từ chối | customer | - | CRT-REQ-20261006-103226537 |
| crt-cart-summary-total | Dòng tổng cộng | customer | - | CRT-REQ-20261006-103226562 |
| crt-cart-summary-total-estimate | Ghi chú tổng chưa gồm phí vận chuyển | customer | - | CRT-REQ-20261006-103226562 |
| crt-cart-summary-checkout-link | Nút Tiến hành thanh toán (sang CHK) | customer | Mở màn checkout | CRT-REQ-20261006-103226562 |
| crt-cart-summary-checkout-disabled-reason | Lý do nút thanh toán bị khóa | customer | - | CRT-REQ-20261006-103226588 |

## Ghi chú thiết kế (mặc định, chưa duyệt)
- **Báo trước theo skill evon:** cửa hàng online phía người mua (giỏ, tóm tắt đơn) chưa được dạy; phần chọn phương thức theo mẫu nhóm lựa chọn trong form, phần tổng theo mẫu danh sách mô tả.
- Màn là một khối của trang giỏ, tách tài liệu vì phủ requirement khác (mã, vận chuyển, tổng). Mọi số tiền đến từ phản hồi giỏ của máy chủ; giao diện **không tự cộng trừ** tổng (SB-23, CRT-REQ-20261006-103226562 BR3).
- Danh sách phương thức lấy từ SHP (SHP-REQ-20261006-101103782) và danh sách địa chỉ để điền thành phố lấy từ USR ở giao diện; CRT chỉ nhận `method_id` và `city`. `city` ở giỏ chỉ để ước tính phí, tên gần đúng (CRT-REQ-20261006-103226537 BR5); khối ghi rõ "Phí có thể đổi theo địa chỉ giao hàng thật ở bước thanh toán".
- Chọn phương thức hay đổi thành phố gửi ngay khi đủ cả hai, không có nút Lưu riêng. Mã giảm giá chỉ gửi khi bấm Áp dụng hoặc Enter, không gửi khi gõ (tránh đếm lượt sai, CRT-SEC T5).
- Nút Tiến hành thanh toán chỉ dẫn sang CHK; CHK kiểm lại giá, tồn, mã, phí và quyền đặt hàng (email đã xác minh, SB-26). Màn này không dựng lỗi của CHK.
- Tên phương thức, mã, thành phố đều hiển thị dạng văn bản thường đã escape (SB-12). Mã hiển thị chữ hoa theo giá trị PRM trả về.
- Không viết code giao diện; dựng thật là việc của `implement`.
