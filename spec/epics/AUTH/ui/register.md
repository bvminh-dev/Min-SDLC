---
screen: register
epic: AUTH
status: draft
covers: [AUTH-REQ-20261006-095515620]
roles: [guest]
---
# Đăng ký tài khoản

## Wireframe
Phương án đã chọn: **A** (một cột giữa màn, khối `max-w-md` không viền, theo mẫu "Đăng nhập, đăng ký" của evon). **Đây là lựa chọn mặc định** theo khuyến nghị của skill, chưa có người chọn: các cổng "duyệt brief", "xác nhận danh sách màn" và "chọn wireframe" không hỏi được người dùng khi chạy tự động.

| Phương án | Bố cục | Đánh đổi |
|---|---|---|
| **A. Một cột giữa màn (khuyên dùng, đã chọn)** | Logo, tiêu đề, ba ô nhập, một nút chính, liên kết sang đăng nhập | Gọn, đọc tốt ở 375px; không có chỗ cho nội dung giới thiệu |
| B. Hai cột, form trái và ảnh sản phẩm phải | Form như A cạnh ảnh | Có hình ảnh cửa hàng; không có ảnh sản phẩm thật ở phase spec, nặng trên điện thoại |
| C. Hai bước (email rồi mật khẩu) | Bước 1 email, bước 2 mật khẩu và tên | Giảm cảm giác dài; thêm một lần bấm cho việc chỉ có ba ô |

Lý do chọn A: việc chính là tạo tài khoản nhanh để mua hàng; chỉ ba trường nên một màn một cột là đủ.

```
              [Logo cửa hàng]
              Tạo tài khoản

   Họ tên
   [ Nguyễn An                          ]
   Email
   [ new@shop.vn                        ]
   Mật khẩu                       (Hiện)
   [ ••••••••••••                       ]
   Từ 10 đến 128 ký tự
   (vùng báo lỗi chung)
   [         Tạo tài khoản              ]
   Đã có tài khoản? Đăng nhập
```

## Trạng thái
| Trạng thái | Trông ra sao | Requirement |
|---|---|---|
| nhập liệu | Ba ô trống, nút "Tạo tài khoản" bật; gợi ý "Từ 10 đến 128 ký tự" dưới ô mật khẩu | AUTH-REQ-20261006-095515620 |
| đang gửi | Nút khóa, chữ đổi thành "Đang tạo...", ba ô khóa; không gửi hai lần | AUTH-REQ-20261006-095515620 |
| lỗi kiểm dữ liệu | Thông báo lỗi dưới từng ô (email sai định dạng, mật khẩu quá ngắn hoặc quá dài, quá phổ biến, thiếu họ tên; không có lỗi "trùng email", SB-02); giữ nguyên nội dung đã nhập trừ mật khẩu | AUTH-REQ-20261006-095515620 |
| bị giới hạn | Banner "Bạn thử quá nhiều lần, thử lại sau N phút" (từ `Retry-After`), nút khóa tới hết giờ | AUTH-REQ-20261006-095515620 |
| lỗi | Banner lỗi "Không tạo được tài khoản. Thử lại." (lỗi mạng hoặc 5xx), nút Thử lại; ô giữ nguyên | AUTH-REQ-20261006-095515620 |
| thành công | Biểu mẫu thay bằng thông báo chung "Chúng tôi đã nhận đăng ký. Hãy kiểm tra email để xác minh rồi đăng nhập." kèm liên kết Đăng nhập; **chưa đăng nhập** (202 cho cả email mới lẫn email đã có, không phân biệt được, SB-02) | AUTH-REQ-20261006-095515620 |

## Phần tử
| testid | Phần tử | Role | Hành động | Requirement |
|---|---|---|---|---|
| auth-register-form | Biểu mẫu đăng ký | guest | Gửi | AUTH-REQ-20261006-095515620 |
| auth-register-full-name | Ô họ tên | guest | Nhập | AUTH-REQ-20261006-095515620 |
| auth-register-email | Ô email | guest | Nhập | AUTH-REQ-20261006-095515620 |
| auth-register-password | Ô mật khẩu (autocomplete new-password) | guest | Nhập | AUTH-REQ-20261006-095515620 |
| auth-register-password-toggle | Nút Hiện/Ẩn mật khẩu | guest | Đổi hiển thị | AUTH-REQ-20261006-095515620 |
| auth-register-submit | Nút Tạo tài khoản | guest | Gửi đăng ký | AUTH-REQ-20261006-095515620 |
| auth-register-field-error | Lỗi dưới từng ô (một vùng cho mỗi ô, có `data-field`) | guest | - | AUTH-REQ-20261006-095515620 |
| auth-register-success | Thông báo đã nhận đăng ký, kiểm tra email (thay biểu mẫu) | guest | - | AUTH-REQ-20261006-095515620 |
| auth-register-rate-limited | Banner bị giới hạn kèm số phút chờ | guest | - | AUTH-REQ-20261006-095515620 |
| auth-register-error | Banner lỗi chung | guest | - | AUTH-REQ-20261006-095515620 |
| auth-register-retry | Nút Thử lại | guest | Gửi lại | AUTH-REQ-20261006-095515620 |
| auth-register-loading | Trạng thái đang gửi | guest | - | AUTH-REQ-20261006-095515620 |
| auth-register-login-link | Liên kết Đăng nhập (dưới biểu mẫu và trong thông báo thành công) | guest | Sang màn đăng nhập | AUTH-REQ-20261006-095515620 |

## Ghi chú thiết kế (mặc định, chưa duyệt)
- **Báo trước theo skill evon:** màn đăng ký thuộc phía người mua của cửa hàng online, skill chưa được dạy loại này; vẫn làm theo mẫu "Đăng nhập, đăng ký" (A) nên kết quả có thể chưa đẹp bằng màn trong app.
- **Audit (câu 2 của evon):** chưa có codebase, nên không có token hay component có sẵn; stack web theo ADR-002 (Next.js), thư viện UI và CSS chưa có ADR. Mặc định theo evon: flat, Tailwind, `references/tokens.css`, tiếng Việt.
- **Brief (U1, nguồn: đọc spec):** cửa hàng online; người dùng guest chưa có tài khoản; việc chính: tạo tài khoản nhanh để mua hàng; nền tảng: điện thoại và máy tính.
- **Danh sách màn (U2, mặc định đã xác nhận thay người dùng):** `register` (guest, REG), `login` (guest, LOGIN), `forgot-password` (guest, FORGOT), `reset-password` (guest, RESET), `verify-email` (guest, customer, VER, RESEND), `account-menu` (customer, staff, admin, LOGOUT, SESSION), `access-denied` (customer, staff, admin, GUARD), `admin-user-list` (admin, USERADM, LOCK).
- Không có ô "Nhập lại mật khẩu" (đã có nút Hiện/Ẩn). Không có đăng nhập mạng xã hội (ngoài roadmap). Không bịa câu dẫn.
- Sau thành công ở lại màn đăng ký với thông báo chung rồi người dùng sang đăng nhập; không tự đăng nhập (SB-02, S-06). Bỏ trạng thái "email đã đăng ký" vì không được lộ email tồn tại.
- Không viết code giao diện; dựng thật là việc của `implement`.
