---
screen: checkout-blocked
epic: CHK
status: draft
covers: [CHK-REQ-20261006-105050948, CHK-REQ-20261006-105052414]
roles: [customer]
---
# Chưa vào được checkout: email chưa xác minh, giỏ trống, hàng ngừng bán, phiên hết hạn

## Wireframe
Phương án đã chọn: **A** (một thẻ trung tâm: nêu một lý do chính, một nút hành động chính, một lối thoát). **Đây là lựa chọn mặc định** (khuyến nghị theo `U3`), chưa có người dùng chọn.

| Phương án | Việc chính thấy ở đâu | Đổi gì | Đánh đổi |
|---|---|---|---|
| **A. Một thẻ trung tâm theo lý do (khuyên dùng, đã chọn)** | Lý do chặn và đúng một nút việc kế tiếp ở giữa | Khách biết ngay vì sao và làm gì tiếp; một màn cho mọi lý do | Mỗi lý do có nhãn riêng nên cần nhiều biến thể trong cùng thẻ |
| B. Banner phía trên giỏ hàng, không có màn riêng | Lý do hiện ngay ở giỏ | Ít chuyển trang | Giỏ phải dựng thêm mọi trạng thái của CHK; trùng việc với CRT |
| C. Hộp thoại chồng lên giỏ | Hộp thoại có lý do và nút | Giữ khách ở giỏ | Hộp thoại không phù hợp khi có danh sách hàng ngừng bán dài; khó truy cập bằng bàn phím |

Lý do chọn A: các chặn này đều là "chưa vào được" và đều có một việc kế tiếp rõ (xác minh email, quay lại giỏ, bắt đầu lại); gom ở một thẻ giữ checkout không phải gánh logic của giỏ (CHK-REQ-20261006-105050948).

```
┌ Chưa thể thanh toán ─────────────────────────────────────────────┐
│  (một trong các lý do, mỗi lý do một khối)                        │
│  ✉ Bạn cần xác minh email trước khi đặt hàng                      │
│      [ Gửi lại email xác minh ]   [ Về giỏ hàng ]                 │
│  🛒 Giỏ hàng đang trống                  [ Tiếp tục mua sắm ]      │
│  ⚠ Có sản phẩm không còn bán:                                      │
│      • Tất cổ cao                          [ Về giỏ hàng để xóa ]  │
│  ⏱ Phiên thanh toán đã hết hạn            [ Bắt đầu lại ]          │
│  ✓ Giỏ hàng này đã được đặt (đơn 7K3M9Q2XH4TB)  [ Xem đơn hàng ]  │
└──────────────────────────────────────────────────────────────────┘
```

## Trạng thái
| Trạng thái | Trông ra sao | Requirement | testid |
|---|---|---|---|
| đang tải | Khung chờ một thẻ trong lúc tạo phiên | CHK-REQ-20261006-105050948 | chk-checkout-blocked-loading |
| email chưa xác minh | Thông báo cần xác minh email kèm nút Gửi lại email xác minh và Về giỏ hàng (403 `email-not-verified`) | CHK-REQ-20261006-105050948 | chk-checkout-blocked-email-not-verified |
| giỏ trống | "Giỏ hàng đang trống" kèm nút Tiếp tục mua sắm (409 `cart-empty`) | CHK-REQ-20261006-105050948 | chk-checkout-blocked-cart-empty |
| có hàng ngừng bán | Danh sách sản phẩm không còn bán kèm nút Về giỏ hàng (409 `cart-has-unavailable-items`) | CHK-REQ-20261006-105050948 | chk-checkout-blocked-unavailable-items |
| giỏ đã được đặt | "Giỏ hàng này đã được đặt" kèm liên kết tới danh sách đơn (409 `cart-already-ordered`) | CHK-REQ-20261006-105050948 | chk-checkout-blocked-already-ordered |
| quá nhiều lần mở | "Bạn thao tác quá nhanh, thử lại sau N giây" (429) | CHK-REQ-20261006-105050948 | chk-checkout-blocked-rate-limited |
| phiên hết hạn | "Phiên thanh toán đã hết hạn, giỏ hàng của bạn vẫn còn" kèm nút Bắt đầu lại (409 `checkout-session-closed`, trạng thái `expired`) | CHK-REQ-20261006-105052414 | chk-checkout-blocked-session-expired |
| phiên đã đóng | "Phiên thanh toán này đã đóng" (trạng thái `cancelled`) kèm nút Bắt đầu lại | CHK-REQ-20261006-105052414 | chk-checkout-blocked-session-closed |
| lỗi | Banner "Chưa mở được phiên thanh toán" kèm Thử lại (503) | CHK-REQ-20261006-105050948 | chk-checkout-blocked-error |
| hết phiên đăng nhập | "Phiên đăng nhập đã hết hạn" kèm liên kết Đăng nhập (401) | CHK-REQ-20261006-105050948 | chk-checkout-blocked-login-expired |

## Phần tử
| testid | Phần tử | Role | Hành động | Requirement |
|---|---|---|---|---|
| chk-checkout-blocked-loading | Khung chờ một thẻ | customer | - | CHK-REQ-20261006-105050948 |
| chk-checkout-blocked-email-not-verified | Khối email chưa xác minh | customer | - | CHK-REQ-20261006-105050948 |
| chk-checkout-blocked-resend-verification | Nút Gửi lại email xác minh (gọi endpoint của AUTH) | customer | Gửi lại email xác minh | CHK-REQ-20261006-105050948 |
| chk-checkout-blocked-cart-empty | Khối giỏ trống | customer | - | CHK-REQ-20261006-105050948 |
| chk-checkout-blocked-continue-shopping | Nút Tiếp tục mua sắm | customer | Mở trang sản phẩm | CHK-REQ-20261006-105050948 |
| chk-checkout-blocked-unavailable-items | Khối danh sách hàng ngừng bán | customer | - | CHK-REQ-20261006-105050948 |
| chk-checkout-blocked-unavailable-item | Một sản phẩm không còn bán | customer | - | CHK-REQ-20261006-105050948 |
| chk-checkout-blocked-back-to-cart | Nút Về giỏ hàng | customer | Mở giỏ hàng | CHK-REQ-20261006-105050948 |
| chk-checkout-blocked-already-ordered | Khối giỏ đã được đặt | customer | - | CHK-REQ-20261006-105050948 |
| chk-checkout-blocked-view-orders | Liên kết Xem đơn hàng | customer | Mở danh sách đơn | CHK-REQ-20261006-105050948 |
| chk-checkout-blocked-rate-limited | Thông báo thử lại sau N giây | customer | - | CHK-REQ-20261006-105050948 |
| chk-checkout-blocked-session-expired | Khối phiên hết hạn | customer | - | CHK-REQ-20261006-105052414 |
| chk-checkout-blocked-session-closed | Khối phiên đã đóng | customer | - | CHK-REQ-20261006-105052414 |
| chk-checkout-blocked-restart | Nút Bắt đầu lại (tạo phiên mới từ giỏ) | customer | Tạo phiên checkout mới | CHK-REQ-20261006-105052414 |
| chk-checkout-blocked-error | Banner lỗi | customer | - | CHK-REQ-20261006-105050948 |
| chk-checkout-blocked-retry | Nút Thử lại | customer | Tạo lại phiên | CHK-REQ-20261006-105050948 |
| chk-checkout-blocked-login-expired | Thông báo hết phiên đăng nhập kèm liên kết Đăng nhập | customer | Mở màn đăng nhập | CHK-REQ-20261006-105050948 |

## Ghi chú thiết kế (mặc định, chưa duyệt)
- **Báo trước theo skill evon:** skill chưa được dạy cho cửa hàng online phía người mua; màn theo mẫu trạng thái rỗng và lỗi trong app, kết quả có thể chưa đẹp bằng màn quản trị.
- **Audit (câu 2 của evon):** chưa có codebase hay `package.json`, mặc định flat và copy tiếng Việt; chỉ wireframe ASCII, không dựng HTML hay probe (việc của implement).
- Mỗi lần chỉ hiện **một** lý do (lý do đầu tiên theo thứ tự kiểm của server: email, giỏ trống, hàng ngừng bán). Nút Gửi lại email xác minh gọi endpoint của AUTH (AUTH-REQ-20261006-095515702); CHK không sở hữu việc gửi email.
- Khách là guest, staff hay admin không có màn này (guest bị chuyển tới đăng nhập, staff và admin nhận 403 do trang lỗi chung của web, chưa epic nào sở hữu, cùng [OPEN] của PRJ, INV, CRT); vì vậy không có testid cho các trường hợp đó (hạn chế của `check-ui`: phần tử chỉ khai role nằm trong requirement phủ).
- Phiên hết hạn **không** mất giỏ và không có hàng hay lượt mã nào đang bị giữ (CHK-REQ-20261006-105052414 BR9), nên thông báo nói rõ giỏ còn nguyên.
- Tên sản phẩm trong danh sách ngừng bán hiển thị dạng văn bản thường đã escape (SB-12).
- Không viết code giao diện; dựng thật là việc của `implement`.
