---
screen: access-denied
epic: AUTH
status: draft
covers: [AUTH-REQ-20261006-095515918]
roles: [customer, staff, admin]
---
# Không có quyền truy cập

## Wireframe
Phương án đã chọn: **A** (một khối giữa vùng nội dung, trong khung app, có nút về trang chủ theo role). **Mặc định** của skill, chưa có người chọn. Phương án khác: B chuyển thẳng về trang chủ kèm toast (người dùng không hiểu vì sao bị đưa đi), C giả "không tìm thấy" (che sự tồn tại trang quản trị nhưng khó chẩn đoán cho nhân viên). Chọn A vì người đã đăng nhập cần biết đây là vấn đề quyền chứ không phải trang hỏng.

```
Thanh header:  ☰  Cửa hàng                                   🔔  (A)
┌──────────────────────────────────────────────────────────────┐
│                       (icon khóa)                            │
│               Bạn không có quyền xem trang này               │
│     Tài khoản của bạn (Khách hàng) không được phép vào đây.  │
│                   [ Về trang chủ ]                           │
└──────────────────────────────────────────────────────────────┘
```

## Trạng thái
| Trạng thái | Trông ra sao | Requirement |
|---|---|---|
| không có quyền | Khối giữa với tiêu đề, nhãn role hiện tại của người dùng và nút Về trang chủ; hiện khi trang hay API trả 403 `forbidden` | AUTH-REQ-20261006-095515918 |
| hết phiên | Phiên hết hạn (401) khi vào trang: không hiện màn này, chuyển tới đăng nhập (guest không bao giờ thấy màn này) | AUTH-REQ-20261006-095515918 |
| lỗi | Không xác định được role (không tải được thông tin phiên): banner "Không kiểm tra được quyền. Thử lại." kèm nút Thử lại | AUTH-REQ-20261006-095515918 |

## Phần tử
| testid | Phần tử | Role | Hành động | Requirement |
|---|---|---|---|---|
| auth-access-denied-container | Khối không có quyền | customer, staff, admin | - | AUTH-REQ-20261006-095515918 |
| auth-access-denied-message | Dòng giải thích kèm nhãn role hiện tại | customer, staff, admin | - | AUTH-REQ-20261006-095515918 |
| auth-access-denied-home | Nút Về trang chủ | customer, staff, admin | Sang trang chủ | AUTH-REQ-20261006-095515918 |
| auth-access-denied-error | Banner lỗi không kiểm tra được quyền | customer, staff, admin | - | AUTH-REQ-20261006-095515918 |
| auth-access-denied-retry | Nút Thử lại | customer, staff, admin | Tải lại thông tin phiên | AUTH-REQ-20261006-095515918 |

## Ghi chú thiết kế (mặc định, chưa duyệt)
- Brief, audit và danh sách màn xem ở `register.md`.
- Trạng thái "hết phiên" không có testid vì màn này không hiện cho phiên hết hạn (nằm ở `login`: testid `auth-login-login-required`, `auth-login-session-expired`).
- Ẩn mục menu hay nút ở giao diện chỉ là tiện, không thay kiểm quyền ở server (BR7); màn này dùng khi người dùng vào thẳng đường dẫn.
- Không viết code giao diện; dựng thật là việc của `implement`.
