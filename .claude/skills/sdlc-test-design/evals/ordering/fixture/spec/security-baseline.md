---
status: draft
---
# Security baseline

Cột Kiểm bằng phải chứa ít nhất một từ: `test`, `hook`, `script`, `config`, `review`.
Cột Epic liên quan: mã epic cách nhau bởi dấu phẩy, hoặc `*` cho toàn hệ thống.
Chi tiết kỹ thuật (thuật toán băm, thời hạn cụ thể) lấy từ ADR-002, ADR-004, ADR-005 (đã accepted).

## Xác thực và phiên
| Mã | Yêu cầu | Kiểm bằng | Epic liên quan |
|---|---|---|---|
| SB-01 | Mật khẩu chỉ lưu dạng băm có salt bằng thuật toán chuyên dụng, không bao giờ lưu hoặc log bản rõ | test | AUTH |
| SB-02 | Giới hạn số lần đăng nhập sai và khóa tạm tài khoản (User:locked), thông báo lỗi không tiết lộ email có tồn tại | test | AUTH |
| SB-03 | Token đặt lại mật khẩu dùng một lần, có hạn, chỉ lưu dạng băm; đổi/đặt lại mật khẩu thu hồi mọi phiên | test | AUTH, USR |
| SB-04 | Phiên có hạn (30 phút không thao tác, tối đa 7 ngày), đăng xuất thu hồi phía server, cookie phiên đặt HttpOnly, Secure, SameSite | config | AUTH |
| SB-26 | Token xác minh email dùng một lần, có hạn, chỉ lưu dạng băm; tài khoản chưa xác minh email (email_verified_at rỗng) không đặt hàng được, kiểm ở server | test | AUTH, CHK |

## Phân quyền
| Mã | Yêu cầu | Kiểm bằng | Epic liên quan |
|---|---|---|---|
| SB-05 | Mọi endpoint mặc định từ chối; quyền kiểm ở server theo `permissions-matrix.md`, không tin role từ client | test | * |
| SB-06 | Khách chỉ truy cập được giỏ, địa chỉ, đơn, thanh toán, thông báo của chính mình (chống IDOR) | test | USR, CRT, ORD, PAY, NTF |
| SB-07 | Thao tác admin (sản phẩm, coupon, kiểm duyệt, dashboard, hoàn tiền, đổi role) yêu cầu role admin; thao tác kho và đơn cho phép thêm role staff; mọi thao tác này ghi audit | test | PRD, INV, PRM, REV, DSH, ORD, PAY |

## Bảo vệ dữ liệu
| Mã | Yêu cầu | Kiểm bằng | Epic liên quan |
|---|---|---|---|
| SB-08 | Dữ liệu cá nhân (email, điện thoại, địa chỉ) chỉ trả về cho chủ sở hữu và admin; không đưa vào log | review | AUTH, USR, ORD |
| SB-09 | Mọi kết nối dùng TLS; dữ liệu nhạy cảm lưu trong CSDL được mã hóa khi lưu theo cấu hình hạ tầng | config | * |
| SB-10 | Tệp tải lên (avatar, ảnh review) giới hạn loại và kích thước, kiểm nội dung, không thực thi được | test | USR, REV |

## Đầu vào và đầu ra
| Mã | Yêu cầu | Kiểm bằng | Epic liên quan |
|---|---|---|---|
| SB-11 | Mọi đầu vào được kiểm schema ở biên API; truy vấn CSDL dùng tham số hóa | test | * |
| SB-12 | Nội dung người dùng nhập (review, bình luận, tên) được escape khi hiển thị để chống XSS | test | REV, USR, PRD |
| SB-13 | Endpoint thay đổi trạng thái có chống CSRF khi dùng cookie phiên; áp CORS theo danh sách cho phép | config | * |
| SB-14 | Endpoint đăng nhập, quên mật khẩu, mã giảm giá có giới hạn tần suất | test | AUTH, PRM |

## Bí mật và cấu hình
| Mã | Yêu cầu | Kiểm bằng | Epic liên quan |
|---|---|---|---|
| SB-15 | Bí mật (khóa DB, khóa cổng thanh toán, khóa ký) không nằm trong repo; quét bí mật trước khi commit | hook | PRJ |
| SB-16 | Ứng dụng kiểm cấu hình khi khởi động và dừng nếu thiếu; không dùng bí mật mặc định ở production | test | PRJ |
| SB-17 | Phụ thuộc bên thứ ba được quét lỗ hổng định kỳ | script | PRJ |

## Log và audit
| Mã | Yêu cầu | Kiểm bằng | Epic liên quan |
|---|---|---|---|
| SB-18 | Log có cấu trúc kèm correlation id; che mật khẩu, token, số thẻ, thông tin cá nhân | test | PRJ |
| SB-19 | Ghi audit cho đăng nhập, đổi mật khẩu, đổi role, thao tác admin, hủy/hoàn tiền | review | AUTH, ORD, PAY, INV |
| SB-20 | Lỗi trả về client không lộ stack trace hoặc chi tiết nội bộ | test | PRJ |

## Thanh toán và dữ liệu tài chính
| Mã | Yêu cầu | Kiểm bằng | Epic liên quan |
|---|---|---|---|
| SB-21 | Không lưu số thẻ, CVV; dùng thanh toán hosted của cổng (ADR-005) | review | PAY |
| SB-22 | Webhook xác thực chữ ký và chống phát lại; xử lý idempotent theo mã tham chiếu của cổng | test | PAY |
| SB-23 | Số tiền thanh toán do server tính lại từ giá hiện hành, không tin số tiền/giá từ client | test | CHK, PAY, CRT |
| SB-24 | Chuyển trạng thái đơn/thanh toán chỉ theo vòng đời hợp lệ ở `entities.md`; hoàn tiền cần quyền riêng và audit | test | ORD, PAY |
| SB-25 | Giữ hàng và dùng coupon thực hiện nguyên tử (khóa dòng hoặc ràng buộc) để chống bán vượt và vượt lượt dùng | test | INV, PRM, CHK |
