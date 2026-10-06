---
screen: add-to-cart
epic: CRT
status: draft
covers: [CRT-REQ-20261006-103226376, CRT-REQ-20261006-103226486, CRT-REQ-20261006-103226588]
roles: [customer]
---
# Thêm vào giỏ (nút ở trang sản phẩm) và huy hiệu giỏ trên đầu trang

## Wireframe
Phương án đã chọn: **A** (khối nhỏ gắn vào trang chi tiết và thẻ sản phẩm: ô số lượng kiểu bước nhảy, nút Thêm vào giỏ, thông báo ngắn ngay dưới nút; huy hiệu giỏ cố định ở thanh đầu trang). **Đây là lựa chọn mặc định** (khuyến nghị theo `U3`), chưa có người dùng chọn (các cổng không hỏi được ở lần chạy này).

| Phương án | Việc chính thấy ở đâu | Đổi gì | Đánh đổi |
|---|---|---|---|
| **A. Khối nội tuyến: số lượng, nút, thông báo dưới nút (khuyên dùng, đã chọn)** | Ngay cạnh giá và tên | Khách không rời trang; thông báo lỗi nằm sát nút | Cần chỗ trống cạnh giá ở thẻ sản phẩm nhỏ |
| B. Nút một chạm không có ô số lượng (luôn thêm 1) | Chỉ có nút | Nhanh nhất ở danh sách | Muốn mua nhiều phải vào giỏ sửa; `quantity` mặc định 1 |
| C. Mở ngăn kéo giỏ nhỏ sau khi thêm | Ngăn kéo bên phải | Thấy ngay giỏ | Thêm một lớp phủ phải xử lý bàn phím và đóng mở |

Lý do chọn A: yêu cầu cho phép chọn số lượng (CRT-REQ-20261006-103226376 BR2) và lỗi tồn, giới hạn phải hiện ngay tại nơi khách bấm (BR4, BR5, BR6); không dựng lớp phủ để khỏi che trang sản phẩm.

```
Trang chi tiết sản phẩm (PRD):                                    Thanh đầu trang
┌────────────────────────────────────────┐                        ┌───────────────────────────┐
│ Áo thun cotton          150.000 đ      │                        │ ... 🔔  (🛒 3)  (T)       │ <- huy hiệu: tổng số lượng
│ Số lượng  [ - ]  [ 2 ]  [ + ]          │   <- 1 đến 99          └───────────────────────────┘
│ [ Thêm vào giỏ ]                       │
│ ✓ Đã thêm vào giỏ.  Xem giỏ            │   <- thành công, tự ẩn sau vài giây, giữ liên kết
│ ✗ Chỉ còn 3 sản phẩm.                  │   <- 409 insufficient-stock (không lộ số lớn hơn 99)
└────────────────────────────────────────┘
```

## Trạng thái
Khối này được PRD nhúng ở `product-detail` và `product-list` (PRD không có testid cho nó); tên màn ở đây dùng cho mọi nơi nhúng.

| Trạng thái | Trông ra sao | Requirement | testid |
|---|---|---|---|
| mặc định | Số lượng 1, nút Thêm vào giỏ bật | CRT-REQ-20261006-103226376 | crt-add-to-cart-submit |
| đang thêm | Nút khóa và có vòng xoay, ô số lượng khóa (chặn bấm hai lần vì thêm là phép cộng, BR10) | CRT-REQ-20261006-103226376 | crt-add-to-cart-submit |
| thành công | Dòng "Đã thêm vào giỏ" kèm liên kết Xem giỏ; huy hiệu đổi số theo `summary`; ô số lượng về 1 | CRT-REQ-20261006-103226376 | crt-add-to-cart-success |
| hết hàng hoặc vượt tồn | "Chỉ còn N sản phẩm" (N <= 99) khi 409 `insufficient-stock`; "Hết hàng" khi `available` = 0; giỏ không đổi | CRT-REQ-20261006-103226588 | crt-add-to-cart-error-stock |
| vượt giới hạn | "Mỗi sản phẩm tối đa 99" (409 `quantity-limit-exceeded`) hoặc "Giỏ đã đủ 50 sản phẩm" (409 `cart-line-limit-reached`) | CRT-REQ-20261006-103226376 | crt-add-to-cart-error-limit |
| không còn bán | "Sản phẩm không còn bán" (404 `product-unavailable`), nút khóa | CRT-REQ-20261006-103226376 | crt-add-to-cart-unavailable |
| số lượng sai | Báo "Chọn từ 1 đến 99" dưới ô số lượng (400), nút không gửi khi ô sai | CRT-REQ-20261006-103226376 | crt-add-to-cart-error-quantity |
| lỗi | Banner "Không thêm được vào giỏ." kèm nút Thử lại (503 hoặc lỗi mạng) | CRT-REQ-20261006-103226376 | crt-add-to-cart-error |
| hết phiên | "Phiên đã hết hạn" kèm liên kết Đăng nhập (401); quay lại đúng sản phẩm sau khi đăng nhập | CRT-REQ-20261006-103226376 | crt-add-to-cart-session-expired |
| huy hiệu có hàng | Biểu tượng giỏ kèm số tổng số lượng (`item_count`); 99 trở lên hiện "99+" | CRT-REQ-20261006-103226486 | crt-add-to-cart-badge-count |
| huy hiệu trống | Biểu tượng giỏ không số | CRT-REQ-20261006-103226486 | crt-add-to-cart-badge |
| huy hiệu lỗi | Biểu tượng giỏ không số, không báo lỗi to (lỗi nhẹ, không chặn việc khác) | CRT-REQ-20261006-103226486 | crt-add-to-cart-badge |

## Phần tử
| testid | Phần tử | Role | Hành động | Requirement |
|---|---|---|---|---|
| crt-add-to-cart-quantity | Ô số lượng (số nguyên 1 đến 99) | customer | Nhập số lượng | CRT-REQ-20261006-103226376 |
| crt-add-to-cart-quantity-decrease | Nút giảm số lượng | customer | Giảm 1, không dưới 1 | CRT-REQ-20261006-103226376 |
| crt-add-to-cart-quantity-increase | Nút tăng số lượng | customer | Tăng 1, không quá 99 | CRT-REQ-20261006-103226376 |
| crt-add-to-cart-submit | Nút Thêm vào giỏ | customer | Gửi thêm vào giỏ | CRT-REQ-20261006-103226376 |
| crt-add-to-cart-success | Dòng thông báo đã thêm | customer | - | CRT-REQ-20261006-103226376 |
| crt-add-to-cart-view-cart | Liên kết Xem giỏ trong thông báo | customer | Mở màn giỏ | CRT-REQ-20261006-103226376 |
| crt-add-to-cart-error-stock | Vùng lỗi thiếu hàng (kèm số còn lại) | customer | - | CRT-REQ-20261006-103226588 |
| crt-add-to-cart-error-limit | Vùng lỗi vượt 99 hoặc đủ 50 dòng | customer | - | CRT-REQ-20261006-103226376 |
| crt-add-to-cart-error-quantity | Lỗi số lượng ngoài 1 đến 99 | customer | - | CRT-REQ-20261006-103226376 |
| crt-add-to-cart-unavailable | Vùng "sản phẩm không còn bán" | customer | - | CRT-REQ-20261006-103226376 |
| crt-add-to-cart-error | Banner lỗi chung | customer | - | CRT-REQ-20261006-103226376 |
| crt-add-to-cart-retry | Nút Thử lại | customer | Gửi lại yêu cầu thêm | CRT-REQ-20261006-103226376 |
| crt-add-to-cart-session-expired | Thông báo hết phiên kèm liên kết Đăng nhập | customer | Mở màn đăng nhập | CRT-REQ-20261006-103226376 |
| crt-add-to-cart-badge | Biểu tượng giỏ ở đầu trang | customer | Bấm để mở màn giỏ | CRT-REQ-20261006-103226486 |
| crt-add-to-cart-badge-count | Số tổng số lượng trên biểu tượng giỏ | customer | - | CRT-REQ-20261006-103226486 |

## Ghi chú thiết kế (mặc định, chưa duyệt)
- **Báo trước theo skill evon:** cửa hàng online phía người mua (trang sản phẩm, giỏ hàng) chưa được dạy; phần này theo mẫu form nhỏ và thông báo nội tuyến, kết quả có thể chưa đẹp bằng màn trong app.
- Khối này **nhúng vào màn của PRD** (`product-detail`, `product-list`); PRD ghi "Thêm vào giỏ thuộc CRT, chưa vẽ ở PRD" nên testid nằm ở CRT. PRD cần đặt khối ở chỗ trống trong wireframe của họ (việc của `sdlc-impact` khi duyệt, xem questions.md "Nền cần sửa").
- Khách chưa đăng nhập (guest) vẫn thấy nút ở trang sản phẩm; bấm vào thì nhận 401 và được đưa tới đăng nhập kèm quay lại đúng trang. Role `guest` không nằm trong requirement thêm vào giỏ nên **không có testid cho guest** (xem questions.md câu 1); hành vi này kiểm bằng test case của requirement, không bằng E2E có testid.
- Số `available` ở thông báo thiếu hàng bị chặn trên 99, không lộ tồn thật (CRT-SEC T8). Thông báo thành công ngắn, có `aria-live` lịch sự; lỗi dùng `role=alert`.
- Staff và admin (403) không có giỏ: khối không hiện cho họ ở trang sản phẩm (ẩn theo role, việc thật nằm ở server).
- Không viết code giao diện; dựng thật là việc của `implement`.
