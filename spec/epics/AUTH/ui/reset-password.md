---
screen: reset-password
epic: AUTH
status: draft
covers: [AUTH-REQ-20261006-095515881]
roles: [guest]
---
# Đặt lại mật khẩu

## Wireframe
Phương án đã chọn: **A** (một cột giữa màn, hai ô mật khẩu mới có nút Hiện/Ẩn). **Mặc định** của skill, chưa có người chọn. Không có ô "Nhập lại mật khẩu" (đã có nút Hiện/Ẩn): bớt một ô, bớt một lỗi nhập.

Trang mở từ liên kết `/reset-password#token=...`: token ở fragment được đọc rồi xóa khỏi thanh địa chỉ, trang đặt `Referrer-Policy: no-referrer`.

```
              [Logo cửa hàng]
              Đặt lại mật khẩu
   Mật khẩu mới                   (Hiện)
   [ ••••••••••••                       ]
   Từ 10 đến 128 ký tự, không trùng email
   (vùng báo lỗi)
   [         Đặt mật khẩu mới           ]
```

## Trạng thái
| Trạng thái | Trông ra sao | Requirement |
|---|---|---|
| nhập liệu | Một ô mật khẩu mới, nút bật, gợi ý chính sách | AUTH-REQ-20261006-095515881 |
| đang gửi | Nút khóa, "Đang lưu..." | AUTH-REQ-20261006-095515881 |
| mật khẩu không hợp lệ | Lỗi dưới ô theo lý do (quá ngắn, quá dài, trùng email, quá phổ biến); token chưa bị dùng nên người dùng sửa và gửi lại ngay | AUTH-REQ-20261006-095515881 |
| thành công | Chuyển về màn đăng nhập kèm thông báo "Đã đổi mật khẩu. Hãy đăng nhập lại." (mọi phiên cũ đã bị thu hồi, không tự đăng nhập) | AUTH-REQ-20261006-095515881 |
| liên kết không hợp lệ | Không có token trong fragment, hoặc server trả 400 `invalid_or_expired_token`: "Liên kết không còn hiệu lực" kèm nút "Yêu cầu liên kết mới" (sang màn quên mật khẩu); một nội dung cho sai, đã dùng, quá hạn | AUTH-REQ-20261006-095515881 |
| bị giới hạn | Banner "Bạn thử quá nhiều lần, thử lại sau N phút" | AUTH-REQ-20261006-095515881 |
| lỗi | Banner "Không đặt lại được. Thử lại." (lỗi mạng hoặc 5xx) kèm nút Thử lại; token vẫn giữ trong bộ nhớ trang | AUTH-REQ-20261006-095515881 |

## Phần tử
| testid | Phần tử | Role | Hành động | Requirement |
|---|---|---|---|---|
| auth-reset-password-form | Biểu mẫu đặt lại | guest | Gửi | AUTH-REQ-20261006-095515881 |
| auth-reset-password-new-password | Ô mật khẩu mới (autocomplete new-password) | guest | Nhập | AUTH-REQ-20261006-095515881 |
| auth-reset-password-toggle | Nút Hiện/Ẩn | guest | Đổi hiển thị | AUTH-REQ-20261006-095515881 |
| auth-reset-password-submit | Nút Đặt mật khẩu mới | guest | Gửi | AUTH-REQ-20261006-095515881 |
| auth-reset-password-field-error | Lỗi chính sách mật khẩu | guest | - | AUTH-REQ-20261006-095515881 |
| auth-reset-password-invalid-link | Vùng "Liên kết không còn hiệu lực" | guest | - | AUTH-REQ-20261006-095515881 |
| auth-reset-password-request-new | Nút Yêu cầu liên kết mới | guest | Sang quên mật khẩu | AUTH-REQ-20261006-095515881 |
| auth-reset-password-rate-limited | Banner bị giới hạn | guest | - | AUTH-REQ-20261006-095515881 |
| auth-reset-password-error | Banner lỗi chung | guest | - | AUTH-REQ-20261006-095515881 |
| auth-reset-password-retry | Nút Thử lại | guest | Gửi lại | AUTH-REQ-20261006-095515881 |
| auth-reset-password-loading | Trạng thái đang gửi | guest | - | AUTH-REQ-20261006-095515881 |

## Ghi chú thiết kế (mặc định, chưa duyệt)
- Brief, audit và danh sách màn xem ở `register.md`.
- Thông báo "Đã đổi mật khẩu" hiện ở màn đăng nhập sau khi chuyển; để đơn giản dùng toast ở màn đăng nhập (không có testid riêng vì là phần của luồng chuyển, kiểm bằng việc có ở màn đăng nhập); [OPEN] nếu E2E cần testid cho toast thì thêm vào màn `login`.
- Token chỉ giữ trong bộ nhớ trang, không ghi `localStorage` hay cookie.
- Không viết code giao diện; dựng thật là việc của `implement`.
