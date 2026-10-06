---
screen: change-password
epic: USR
status: draft
covers: [USR-REQ-20261006-101003591]
roles: [customer, staff, admin]
---
# Đổi mật khẩu

## Wireframe
Phương án đã chọn: **A** (một cột `max-w-md`: mật khẩu hiện tại, mật khẩu mới, nút). **Đây là lựa chọn mặc định** theo khuyến nghị của skill, chưa có người chọn (các cổng hỏi người dùng không dùng được khi chạy tự động).

| Phương án | Bố cục | Đánh đổi |
|---|---|---|
| **A. Một trang riêng, hai ô nhập (khuyên dùng, đã chọn)** | Hai ô, nút Hiện/Ẩn, nút Đổi mật khẩu | Đơn giản, rõ lỗi theo ô; đủ chỗ cho gợi ý chính sách |
| B. Hộp thoại mở từ màn hồ sơ | Hộp thoại có hai ô | Không rời màn hồ sơ; hộp thoại có ô nhập không đóng khi bấm ngoài, nhiều lỗi hiển thị chật |
| C. Từng bước (nhập cũ, rồi nhập mới) | Hai bước | Giảm tải nhận thức; thêm một lần bấm cho việc chỉ có hai ô |

Lý do chọn A: việc chính là đổi mật khẩu an toàn; cần chỗ nói rõ chính sách (10 đến 128 ký tự) và hệ quả (các thiết bị khác bị đăng xuất).

```
Đổi mật khẩu
   Mật khẩu hiện tại                      (Hiện)
   [ ••••••••••••                              ]
   Mật khẩu mới                           (Hiện)
   [ ••••••••••••                              ]
   Từ 10 đến 128 ký tự, khác mật khẩu hiện tại
   Các thiết bị khác sẽ bị đăng xuất sau khi đổi.
   (vùng báo lỗi chung)
   [         Đổi mật khẩu                      ]
   ‹ Quay lại hồ sơ
```

## Trạng thái
| Trạng thái | Trông ra sao | Requirement |
|---|---|---|
| nhập liệu | Hai ô trống; gợi ý chính sách dưới ô mới; nút bật | USR-REQ-20261006-101003591 |
| đang gửi | Nút khóa, chữ "Đang đổi..."; hai ô khóa; không gửi hai lần | USR-REQ-20261006-101003591 |
| lỗi kiểm dữ liệu | Lỗi dưới ô: mật khẩu mới quá ngắn, quá dài, trùng email, quá phổ biến, trùng mật khẩu hiện tại; ô mật khẩu được xóa trắng, không xóa ô còn lại | USR-REQ-20261006-101003591 |
| mật khẩu hiện tại sai | Lỗi dưới ô mật khẩu hiện tại: "Mật khẩu hiện tại không đúng"; không có gợi ý số lần còn lại | USR-REQ-20261006-101003591 |
| bị giới hạn | Banner "Bạn nhập sai quá nhiều lần, thử lại sau N phút" (từ `Retry-After`), nút khóa tới hết giờ | USR-REQ-20261006-101003591 |
| lỗi | Banner "Không đổi được mật khẩu. Thử lại." (lỗi mạng hay 5xx), nút Thử lại; ô giữ nguyên | USR-REQ-20261006-101003591 |
| thành công | Thông báo "Đã đổi mật khẩu. N thiết bị khác đã bị đăng xuất." (N từ `revoked_sessions`); người dùng vẫn đăng nhập (đã có phiên mới); hai ô xóa trắng | USR-REQ-20261006-101003591 |
| hết phiên | 401: chuyển về đăng nhập (màn của AUTH) | USR-REQ-20261006-101003591 |

## Phần tử
| testid | Phần tử | Role | Hành động | Requirement |
|---|---|---|---|---|
| usr-change-password-form | Biểu mẫu đổi mật khẩu | customer, staff, admin | Gửi | USR-REQ-20261006-101003591 |
| usr-change-password-current | Ô mật khẩu hiện tại (autocomplete current-password) | customer, staff, admin | Nhập | USR-REQ-20261006-101003591 |
| usr-change-password-new | Ô mật khẩu mới (autocomplete new-password) | customer, staff, admin | Nhập | USR-REQ-20261006-101003591 |
| usr-change-password-toggle | Nút Hiện/Ẩn mật khẩu (cho ô mới) | customer, staff, admin | Đổi hiển thị | USR-REQ-20261006-101003591 |
| usr-change-password-submit | Nút Đổi mật khẩu | customer, staff, admin | Gửi | USR-REQ-20261006-101003591 |
| usr-change-password-field-error | Lỗi dưới từng ô (có `data-field`) | customer, staff, admin | - | USR-REQ-20261006-101003591 |
| usr-change-password-rate-limited | Banner bị giới hạn kèm số phút chờ | customer, staff, admin | - | USR-REQ-20261006-101003591 |
| usr-change-password-error | Banner lỗi chung | customer, staff, admin | - | USR-REQ-20261006-101003591 |
| usr-change-password-retry | Nút Thử lại | customer, staff, admin | Gửi lại | USR-REQ-20261006-101003591 |
| usr-change-password-loading | Trạng thái đang gửi | customer, staff, admin | - | USR-REQ-20261006-101003591 |
| usr-change-password-success | Thông báo đổi thành công kèm số thiết bị bị đăng xuất | customer, staff, admin | - | USR-REQ-20261006-101003591 |
| usr-change-password-back | Liên kết Quay lại hồ sơ | customer, staff, admin | Sang màn hồ sơ | USR-REQ-20261006-101003591 |

## Ghi chú thiết kế (mặc định, chưa duyệt)
- **Báo trước theo skill evon:** phía người mua của cửa hàng online chưa được dạy; làm theo mẫu form của màn đăng nhập, đăng ký (AUTH) để đồng bộ.
- **Audit (câu 2 của evon):** như màn `profile`: chưa có codebase; Tailwind, flat, tiếng Việt theo mặc định.
- Không có ô "Nhập lại mật khẩu mới" (đã có nút Hiện/Ẩn), nhất quán với màn đăng ký. Không đo "độ mạnh" bằng thanh màu: chính sách là độ dài và danh sách phổ biến, không tính bằng màu.
- Ghi chú lệch: người dùng ở lại trạng thái đăng nhập sau khi đổi vì AUTH cấp phiên mới (USR-REQ-20261006-101003591 BR4); đây là hành vi theo requirement, không do luật giao diện.
- Không viết code giao diện; dựng thật là việc của `implement`.
