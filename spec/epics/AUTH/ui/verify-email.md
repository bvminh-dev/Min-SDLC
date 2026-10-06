---
screen: verify-email
epic: AUTH
status: draft
covers: [AUTH-REQ-20261006-095515665, AUTH-REQ-20261006-095515702]
roles: [guest, customer]
---
# Xác minh email

## Wireframe
Phương án đã chọn: **A** (một cột giữa màn, một trạng thái lớn ở giữa). **Mặc định** của skill, chưa có người chọn. Màn dùng cho hai việc: (1) trang đích của liên kết `/verify-email#token=...` (guest hoặc customer), (2) trang "chờ xác minh" của customer đã đăng nhập mà chưa xác minh (vào từ chip "Email chưa xác minh" ở menu tài khoản; đăng ký không tự đăng nhập nên không đáp thẳng ở đây), nơi gửi lại email. Phương án khác (một banner nhỏ trên mọi trang, không có màn riêng) bị loại làm màn chính vì link email cần một nơi đáp; banner nhắc xác minh trên các trang khác thuộc app shell, không thuộc epic này.

```
(đang xác minh)      (thành công)              (chờ xác minh, customer)
   [Logo]               [Logo]                    [Logo]
   Đang xác minh...     Đã xác minh email         Kiểm tra hộp thư của bạn
   ...                  [ Tiếp tục mua sắm ]      Chúng tôi đã gửi link tới u1@shop.vn
                                                  [ Gửi lại email xác minh ]
(link hết hạn)                                    Có thể gửi lại sau 60 giây
   Liên kết không còn hiệu lực
   [Gửi lại email xác minh] (đã đăng nhập) / [Đăng nhập] (guest)
```

## Trạng thái
| Trạng thái | Trông ra sao | Requirement |
|---|---|---|
| đang xác minh | Khi có token trong fragment: chữ "Đang xác minh..." và vòng chờ; token đã được xóa khỏi thanh địa chỉ | AUTH-REQ-20261006-095515665 |
| xác minh thành công | "Đã xác minh email" kèm nút "Tiếp tục mua sắm" (hoặc Đăng nhập nếu là guest) | AUTH-REQ-20261006-095515665 |
| liên kết không hợp lệ | Một nội dung cho token sai, đã dùng, quá hạn: "Liên kết không còn hiệu lực. Nếu bạn đã xác minh, hãy đăng nhập."; customer thấy nút Gửi lại, guest thấy nút Đăng nhập | AUTH-REQ-20261006-095515665 |
| chờ xác minh | Customer chưa xác minh vào màn không có token: hiện email của họ, nút "Gửi lại email xác minh" | AUTH-REQ-20261006-095515702 |
| đã gửi lại | Sau 202: "Đã gửi lại. Kiểm tra hộp thư của bạn."; nút khóa kèm đếm ngược 60 giây | AUTH-REQ-20261006-095515702 |
| bị giới hạn | 429: banner "Bạn gửi quá nhanh, thử lại sau N giây" (hoặc "quá 5 lần trong một giờ") | AUTH-REQ-20261006-095515702 |
| đã xác minh sẵn | 409 `already_verified`: "Email của bạn đã được xác minh." kèm nút Tiếp tục | AUTH-REQ-20261006-095515702 |
| hết phiên | 401 khi bấm Gửi lại: chuyển về đăng nhập (guest không có nút Gửi lại) | AUTH-REQ-20261006-095515702 |
| lỗi | Banner "Không thực hiện được. Thử lại." (lỗi mạng hoặc 5xx) kèm nút Thử lại | AUTH-REQ-20261006-095515665 |

## Phần tử
| testid | Phần tử | Role | Hành động | Requirement |
|---|---|---|---|---|
| auth-verify-email-verifying | Vùng đang xác minh | guest, customer | - | AUTH-REQ-20261006-095515665 |
| auth-verify-email-success | Vùng xác minh thành công | guest, customer | - | AUTH-REQ-20261006-095515665 |
| auth-verify-email-continue | Nút Tiếp tục mua sắm | guest, customer | Sang trang chủ | AUTH-REQ-20261006-095515665 |
| auth-verify-email-invalid-link | Vùng liên kết không hợp lệ | guest, customer | - | AUTH-REQ-20261006-095515665 |
| auth-verify-email-login-link | Nút Đăng nhập (guest) | guest | Sang đăng nhập | AUTH-REQ-20261006-095515665 |
| auth-verify-email-error | Banner lỗi chung | guest, customer | - | AUTH-REQ-20261006-095515665 |
| auth-verify-email-retry | Nút Thử lại xác minh | guest, customer | Gọi lại xác minh | AUTH-REQ-20261006-095515665 |
| auth-verify-email-pending | Vùng chờ xác minh kèm email | customer | - | AUTH-REQ-20261006-095515702 |
| auth-verify-email-resend | Nút Gửi lại email xác minh | customer | Gửi lại | AUTH-REQ-20261006-095515702 |
| auth-verify-email-resend-sent | Thông báo đã gửi lại kèm đếm ngược | customer | - | AUTH-REQ-20261006-095515702 |
| auth-verify-email-rate-limited | Banner bị giới hạn | customer | - | AUTH-REQ-20261006-095515702 |
| auth-verify-email-already-verified | Thông báo đã xác minh sẵn | customer | - | AUTH-REQ-20261006-095515702 |

## Ghi chú thiết kế (mặc định, chưa duyệt)
- Brief, audit và danh sách màn xem ở `register.md`.
- Trang xác minh gọi API bằng POST khi tải, không dùng GET, để bộ quét link của hộp thư không tiêu thụ token (BR1 của yêu cầu xác minh).
- **Lệch cần ghi:** staff và admin cũng là role hợp lệ của yêu cầu xác minh (bấm link), nhưng màn này chỉ liệt kê guest và customer vì staff/admin thường đã có email xác minh; nếu staff/admin bấm link thì thấy cùng trạng thái như customer. [OPEN] nếu cần thêm role vào màn.
- Banner nhắc "Email chưa xác minh" ở các trang khác (giỏ, thanh toán) là việc của app shell và CHK, không dựng ở đây.
- Không viết code giao diện; dựng thật là việc của `implement`.
