---
screen: login
epic: AUTH
status: draft
covers: [AUTH-REQ-20261006-095515738, AUTH-REQ-20261006-095515918]
roles: [guest]
---
# Đăng nhập

## Wireframe
Phương án đã chọn: **A** (một cột giữa màn, cùng khuôn với màn đăng ký). **Đây là lựa chọn mặc định** của skill, chưa có người chọn (các cổng không hỏi được khi chạy tự động). Hai phương án còn lại (B hai cột có ảnh, C đăng nhập bằng một ô rồi mới hiện ô mật khẩu) bị loại vì lý do như màn đăng ký: ít việc, cần nhanh.

```
              [Logo cửa hàng]
              Đăng nhập
   (banner: "Phiên đã hết hạn, hãy đăng nhập lại" / "Hãy đăng nhập để tiếp tục")
   Email
   [ u1@shop.vn                         ]
   Mật khẩu                 Quên mật khẩu?
   [ ••••••••••••               (Hiện)  ]
   (vùng báo lỗi chung)
   [            Đăng nhập               ]
   Chưa có tài khoản? Đăng ký
```

## Trạng thái
| Trạng thái | Trông ra sao | Requirement |
|---|---|---|
| nhập liệu | Hai ô trống, nút Đăng nhập bật, liên kết "Quên mật khẩu?" cạnh nhãn mật khẩu | AUTH-REQ-20261006-095515738 |
| đang gửi | Nút khóa, chữ "Đang đăng nhập...", hai ô khóa | AUTH-REQ-20261006-095515738 |
| sai thông tin | Một dòng lỗi chung dưới ô mật khẩu: "Email hoặc mật khẩu không đúng, hoặc tài khoản đang bị khóa tạm thời." Cùng nội dung cho mọi nguyên nhân (kể cả khóa tạm); ô email giữ lại, mật khẩu xóa | AUTH-REQ-20261006-095515738 |
| lỗi kiểm dữ liệu | Thiếu email hoặc mật khẩu: lỗi "Nhập email" / "Nhập mật khẩu" dưới ô tương ứng | AUTH-REQ-20261006-095515738 |
| bị giới hạn | Banner "Bạn thử quá nhiều lần, thử lại sau N giây", nút khóa tới hết giờ | AUTH-REQ-20261006-095515738 |
| lỗi | Banner "Không đăng nhập được. Thử lại." (lỗi mạng hoặc 5xx) kèm nút Thử lại | AUTH-REQ-20261006-095515738 |
| hết phiên | Đến từ phiên hết hạn (401 `session_expired`): banner "Phiên đã hết hạn, hãy đăng nhập lại" trên form; trạng thái này nằm ở màn đăng nhập nhưng nguồn gốc là yêu cầu phiên (xem Ghi chú) | AUTH-REQ-20261006-095515738 |
| cần đăng nhập | Guest vào trang cần quyền: chuyển tới đây, banner "Hãy đăng nhập để tiếp tục"; sau đăng nhập về đúng trang cũ nếu `next` là đường dẫn nội bộ | AUTH-REQ-20261006-095515918 |
| thành công | Chuyển tới trang đích (`next` nội bộ hoặc trang chủ theo role); không hiện màn trung gian | AUTH-REQ-20261006-095515738 |

## Phần tử
| testid | Phần tử | Role | Hành động | Requirement |
|---|---|---|---|---|
| auth-login-form | Biểu mẫu đăng nhập | guest | Gửi | AUTH-REQ-20261006-095515738 |
| auth-login-email | Ô email (autocomplete username) | guest | Nhập | AUTH-REQ-20261006-095515738 |
| auth-login-password | Ô mật khẩu (autocomplete current-password) | guest | Nhập | AUTH-REQ-20261006-095515738 |
| auth-login-password-toggle | Nút Hiện/Ẩn mật khẩu | guest | Đổi hiển thị | AUTH-REQ-20261006-095515738 |
| auth-login-submit | Nút Đăng nhập | guest | Gửi đăng nhập | AUTH-REQ-20261006-095515738 |
| auth-login-forgot-link | Liên kết Quên mật khẩu | guest | Sang màn quên mật khẩu | AUTH-REQ-20261006-095515738 |
| auth-login-register-link | Liên kết Đăng ký | guest | Sang màn đăng ký | AUTH-REQ-20261006-095515738 |
| auth-login-credentials-error | Dòng lỗi chung sai thông tin | guest | - | AUTH-REQ-20261006-095515738 |
| auth-login-field-error | Lỗi thiếu email hoặc mật khẩu (`data-field`) | guest | - | AUTH-REQ-20261006-095515738 |
| auth-login-rate-limited | Banner bị giới hạn kèm số giây chờ | guest | - | AUTH-REQ-20261006-095515738 |
| auth-login-error | Banner lỗi chung | guest | - | AUTH-REQ-20261006-095515738 |
| auth-login-retry | Nút Thử lại | guest | Gửi lại | AUTH-REQ-20261006-095515738 |
| auth-login-loading | Trạng thái đang gửi | guest | - | AUTH-REQ-20261006-095515738 |
| auth-login-session-expired | Banner phiên hết hạn | guest | - | AUTH-REQ-20261006-095515738 |
| auth-login-login-required | Banner cần đăng nhập để tiếp tục | guest | - | AUTH-REQ-20261006-095515918 |

## Ghi chú thiết kế (mặc định, chưa duyệt)
- Hai khuôn đăng nhập và đăng ký dùng chung bố cục; brief, audit và danh sách màn xem ở `register.md`.
- **Lệch yêu cầu cần ghi:** trạng thái "hết phiên" thực chất do yêu cầu Phiên (AUTH-REQ-20261006-095515808, role customer, staff, admin), nhưng người thấy banner lúc này đã thành guest nên màn đăng nhập gán nó cho AUTH-REQ-20261006-095515738 (role guest); phần giao diện trong ứng dụng khi phiên hết hạn (hộp thoại) nằm ở `account-menu`.
- Thông điệp sai thông tin phải giữ **đúng một chuỗi** cho mọi nguyên nhân (không phân biệt khóa tạm, email lạ, mật khẩu sai) theo SB-02 và BR2 của yêu cầu đăng nhập; không dùng màu hay biểu tượng khác nhau.
- `next` chỉ là đường dẫn tương đối nội bộ (BR9); giá trị khác bị bỏ về trang mặc định.
- Không có "Ghi nhớ đăng nhập" (phiên là cookie phiên theo ADR-004) và không có đăng nhập mạng xã hội.
- Không viết code giao diện; dựng thật là việc của `implement`.
