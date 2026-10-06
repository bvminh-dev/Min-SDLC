---
screen: forgot-password
epic: AUTH
status: draft
covers: [AUTH-REQ-20261006-095515843]
roles: [guest]
---
# Quên mật khẩu

## Wireframe
Phương án đã chọn: **A** (một cột giữa màn, một ô email). **Mặc định** của skill, chưa có người chọn. Phương án khác (hai cột có ảnh; hỏi thêm câu bí mật) bị loại: chỉ cần một ô; câu bí mật là bề mặt tấn công và ngoài phạm vi.

```
              [Logo cửa hàng]
              Quên mật khẩu
   Nhập email của bạn, chúng tôi sẽ gửi hướng dẫn đặt lại.
   Email
   [ u1@shop.vn                         ]
   (vùng báo lỗi)
   [       Gửi hướng dẫn đặt lại        ]
   Quay lại Đăng nhập
```

## Trạng thái
| Trạng thái | Trông ra sao | Requirement |
|---|---|---|
| nhập liệu | Một ô email, nút "Gửi hướng dẫn đặt lại" | AUTH-REQ-20261006-095515843 |
| đang gửi | Nút khóa, chữ "Đang gửi..." | AUTH-REQ-20261006-095515843 |
| đã gửi | Thay form bằng thông điệp chung: "Nếu email này có tài khoản, chúng tôi đã gửi hướng dẫn đặt lại mật khẩu." Cùng nội dung dù email có tồn tại, bị khóa hay vượt giới hạn theo email; kèm liên kết quay lại Đăng nhập | AUTH-REQ-20261006-095515843 |
| lỗi kiểm dữ liệu | Email trống hoặc sai định dạng: lỗi dưới ô; chỉ lỗi định dạng, không bao giờ nói email có hay không | AUTH-REQ-20261006-095515843 |
| bị giới hạn | Banner "Bạn thử quá nhiều lần, thử lại sau N phút" (429 theo IP) | AUTH-REQ-20261006-095515843 |
| lỗi | Banner "Không gửi được yêu cầu. Thử lại." (lỗi mạng hoặc 5xx), nút Thử lại | AUTH-REQ-20261006-095515843 |

## Phần tử
| testid | Phần tử | Role | Hành động | Requirement |
|---|---|---|---|---|
| auth-forgot-password-form | Biểu mẫu quên mật khẩu | guest | Gửi | AUTH-REQ-20261006-095515843 |
| auth-forgot-password-email | Ô email | guest | Nhập | AUTH-REQ-20261006-095515843 |
| auth-forgot-password-submit | Nút Gửi hướng dẫn đặt lại | guest | Gửi yêu cầu | AUTH-REQ-20261006-095515843 |
| auth-forgot-password-sent | Thông điệp chung sau khi gửi | guest | - | AUTH-REQ-20261006-095515843 |
| auth-forgot-password-field-error | Lỗi định dạng email | guest | - | AUTH-REQ-20261006-095515843 |
| auth-forgot-password-rate-limited | Banner bị giới hạn | guest | - | AUTH-REQ-20261006-095515843 |
| auth-forgot-password-error | Banner lỗi chung | guest | - | AUTH-REQ-20261006-095515843 |
| auth-forgot-password-retry | Nút Thử lại | guest | Gửi lại | AUTH-REQ-20261006-095515843 |
| auth-forgot-password-loading | Trạng thái đang gửi | guest | - | AUTH-REQ-20261006-095515843 |
| auth-forgot-password-login-link | Liên kết Quay lại Đăng nhập | guest | Sang đăng nhập | AUTH-REQ-20261006-095515843 |

## Ghi chú thiết kế (mặc định, chưa duyệt)
- Brief, audit và danh sách màn xem ở `register.md`.
- Thông điệp "đã gửi" phải **giống hệt** cho mọi trường hợp hợp lệ về định dạng (BR1): không đổi chữ, màu, thời gian chờ giả theo kết quả.
- Không có nút "Gửi lại" sau khi đã gửi (giới hạn theo email do server, người dùng quay lại form nếu cần); [OPEN] nếu muốn có đếm ngược gửi lại.
- Không viết code giao diện; dựng thật là việc của `implement`.
