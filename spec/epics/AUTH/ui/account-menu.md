---
screen: account-menu
epic: AUTH
status: draft
covers: [AUTH-REQ-20261006-095515774, AUTH-REQ-20261006-095515808]
roles: [customer, staff, admin]
---
# Menu tài khoản (đăng xuất, thông tin phiên)

## Wireframe
Phương án đã chọn: **A** (menu thả xuống từ avatar ở góc phải thanh header, mở bằng nút). **Mặc định** của skill, chưa có người chọn. Phương án khác: B mục "Tài khoản" trong thanh bên (hợp màn quản trị), C trang "Tài khoản" riêng có nút Đăng xuất (thừa một màn cho một nút). Menu này là phần của app shell dùng chung cho customer, staff và admin; epic AUTH chỉ sở hữu phần đăng xuất và thông tin phiên.

```
Thanh header:  ☰  Cửa hàng                                   🔔  (A)
                                           ┌───────────────────────────┐
                                           │ An Nguyễn                 │
                                           │ u1@shop.vn   (Khách hàng) │
                                           │ (Email chưa xác minh)     │
                                           │ ─────────────────────────│
                                           │ Đăng xuất                 │
                                           └───────────────────────────┘
(hộp thoại khi phiên hết hạn)
   ┌────────────────────────────────┐
   │ Phiên đã hết hạn               │
   │ Hãy đăng nhập lại để tiếp tục. │
   │               [ Đăng nhập ]    │
   └────────────────────────────────┘
```

## Trạng thái
| Trạng thái | Trông ra sao | Requirement |
|---|---|---|
| đóng | Chỉ thấy avatar (chữ cái đầu của tên) | AUTH-REQ-20261006-095515808 |
| mở | Tên, email, nhãn role (Khách hàng, Nhân viên, Quản trị), mục Đăng xuất; thêm chip "Email chưa xác minh" khi `email_verified` = false | AUTH-REQ-20261006-095515808 |
| đang đăng xuất | Mục Đăng xuất khóa, chữ "Đang đăng xuất..." | AUTH-REQ-20261006-095515774 |
| đăng xuất xong | Xóa dữ liệu người dùng ở trình duyệt, chuyển về màn đăng nhập (guest) | AUTH-REQ-20261006-095515774 |
| đã hết phiên khi đăng xuất | 401 khi bấm Đăng xuất: coi như đã đăng xuất, vẫn chuyển về màn đăng nhập, không hiện lỗi | AUTH-REQ-20261006-095515774 |
| phiên hết hạn | Request nhận 401 `session_expired`: hộp thoại "Phiên đã hết hạn" chặn thao tác, nút Đăng nhập chuyển tới màn đăng nhập kèm `next` hiện tại | AUTH-REQ-20261006-095515808 |
| lỗi | Đăng xuất gặp lỗi mạng hoặc 5xx hoặc 403 `csrf_failed` (`Origin` lạ): banner nhỏ trong menu "Không đăng xuất được. Thử lại." kèm nút Thử lại; phiên vẫn còn | AUTH-REQ-20261006-095515774 |

## Phần tử
| testid | Phần tử | Role | Hành động | Requirement |
|---|---|---|---|---|
| auth-account-menu-trigger | Nút avatar mở menu | customer, staff, admin | Mở hoặc đóng menu | AUTH-REQ-20261006-095515808 |
| auth-account-menu-name | Tên người dùng | customer, staff, admin | - | AUTH-REQ-20261006-095515808 |
| auth-account-menu-email | Email người dùng | customer, staff, admin | - | AUTH-REQ-20261006-095515808 |
| auth-account-menu-role | Nhãn role | customer, staff, admin | - | AUTH-REQ-20261006-095515808 |
| auth-account-menu-unverified | Chip Email chưa xác minh | customer | Bấm để sang màn xác minh | AUTH-REQ-20261006-095515808 |
| auth-account-menu-logout | Mục Đăng xuất | customer, staff, admin | Đăng xuất phiên hiện tại | AUTH-REQ-20261006-095515774 |
| auth-account-menu-logout-loading | Trạng thái đang đăng xuất | customer, staff, admin | - | AUTH-REQ-20261006-095515774 |
| auth-account-menu-error | Banner lỗi đăng xuất | customer, staff, admin | - | AUTH-REQ-20261006-095515774 |
| auth-account-menu-retry | Nút Thử lại đăng xuất | customer, staff, admin | Đăng xuất lại | AUTH-REQ-20261006-095515774 |
| auth-account-menu-session-expired | Hộp thoại phiên đã hết hạn | customer, staff, admin | - | AUTH-REQ-20261006-095515808 |
| auth-account-menu-session-expired-login | Nút Đăng nhập trong hộp thoại | customer, staff, admin | Sang đăng nhập | AUTH-REQ-20261006-095515808 |

## Ghi chú thiết kế (mặc định, chưa duyệt)
- Brief, audit và danh sách màn xem ở `register.md`.
- Đăng xuất **không** có hộp thoại xác nhận: việc dễ hoàn tác (đăng nhập lại) nên không cần hỏi, theo evon (xác nhận chỉ cho việc không hoàn tác được).
- Chip "Email chưa xác minh" chỉ hiện cho customer (staff, admin không có chip vì không có đường gửi lại, xem [OPEN] ở yêu cầu gửi lại email).
- Hộp thoại phiên hết hạn do lớp gọi API của web bật khi thấy 401 `session_expired` (ở bất kỳ màn nào, không riêng menu); testid nằm ở đây vì đây là phần giao diện duy nhất của yêu cầu Phiên.
- Chống CSRF theo ADR-016: web gọi API cùng site với `Content-Type: application/json`, trình duyệt tự gửi `Origin`; không có CSRF token và không có giao diện riêng.
- Không viết code giao diện; dựng thật là việc của `implement`.
