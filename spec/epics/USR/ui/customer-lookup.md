---
screen: customer-lookup
epic: USR
status: draft
covers: [USR-REQ-20261006-101004117]
roles: [staff, admin]
---
# Tra cứu hồ sơ khách (staff và admin)

## Wireframe
Phương án đã chọn: **A** (ô tìm email chính xác ở đầu, kết quả là một thẻ chi tiết bên dưới; admin có thêm khối Địa chỉ). **Đây là lựa chọn mặc định** theo khuyến nghị của skill, chưa có người chọn (các cổng hỏi người dùng không dùng được khi chạy tự động).

| Phương án | Bố cục | Đánh đổi |
|---|---|---|
| **A. Ô tìm rồi một thẻ chi tiết (khuyên dùng, đã chọn)** | Nhập email đầy đủ, ra đúng một khách | Khớp luật "chỉ tra chính xác, không duyệt danh sách"; không lộ khách khác |
| B. Bảng danh sách khách có tìm theo tiền tố | Danh sách phân trang | Tiện duyệt; trái luật chỉ tra chính xác (danh sách đầy đủ chỉ admin có ở màn quản trị người dùng của AUTH) |
| C. Hai ô tìm (email và mã khách) | Hai cách nhập | Thêm đường vào bằng `id`; nền chỉ cho staff tra theo email (SB-08 a) nên ô thứ hai không dùng được cho staff |

Lý do chọn A: nhân viên đã biết email của khách (khách báo) và chỉ cần xác nhận hồ sơ; không có lý do để cho duyệt cả danh sách. Staff chỉ tra theo email; chỉ admin mở được thẻ bằng đường dẫn có `id` (staff mở đường dẫn đó nhận 403, chuyển tới `access-denied`).

```
Tra cứu khách
[ Nhập email đầy đủ của khách               ] [ Tra cứu ]
┌ Nguyễn An                              (Hoạt động) ───┐
│ Email        an***@shop.vn   (Đã xác minh)             │
│ Điện thoại   090****567                                │
│ Ngày tạo     06/10/2026                                │
│ (staff) Thông tin liên hệ đã được che theo chính sách. │
│ ── Chỉ admin ──                                        │
│ Ảnh đại diện  ╭───╮                                    │
│ Địa chỉ                                                │
│   Nguyễn An · 0901234567 · 12 Lê Lợi, Bến Nghé, Q.1 …  │
│   Trần Bình · 0987654321 · 45 Nguyễn Huệ ...           │
└────────────────────────────────────────────────────────┘
```
Với admin, email và điện thoại hiện đầy đủ (`an.nguyen@shop.vn`, `0901234567`).

## Trạng thái
| Trạng thái | Trông ra sao | Requirement |
|---|---|---|
| nhập liệu | Ô tìm trống kèm gợi ý "Nhập email đầy đủ, ví dụ an@shop.vn"; chưa có thẻ kết quả | USR-REQ-20261006-101004117 |
| đang tìm | Nút Tra cứu khóa, "Đang tìm..."; khung chờ cho thẻ kết quả | USR-REQ-20261006-101004117 |
| có kết quả (staff) | Thẻ: họ tên, email che, điện thoại che, nhãn xác minh, trạng thái (Hoạt động hoặc Đã khóa), ngày tạo; dòng chú thích "Thông tin liên hệ đã được che"; không có khối Địa chỉ và ảnh | USR-REQ-20261006-101004117 |
| có kết quả (admin) | Thẻ đủ: email và điện thoại đầy đủ, ảnh đại diện, khối Địa chỉ (đến 10 dòng); nhãn trạng thái đọc rõ không chỉ bằng màu | USR-REQ-20261006-101004117 |
| không tìm thấy | "Không có khách nào dùng email này." (404; cũng dành cho email của nhân viên, không phân biệt) | USR-REQ-20261006-101004117 |
| lỗi kiểm dữ liệu | Nhắc dưới ô tìm: "Nhập email đầy đủ" (400, email sai dạng hay trống); không gọi tìm | USR-REQ-20261006-101004117 |
| bị giới hạn | Banner "Bạn tra cứu quá nhanh, thử lại sau N giây" (429, từ `Retry-After`; bậc D của SB-14, 30 lần mỗi phút); nút khóa tới hết giờ | USR-REQ-20261006-101004117 |
| lỗi | Banner "Không tra cứu được" kèm nút Thử lại (lỗi mạng hay 5xx) | USR-REQ-20261006-101004117 |
| hết phiên | 401: chuyển về đăng nhập (màn của AUTH) | USR-REQ-20261006-101004117 |
| không có quyền | Customer vào màn này (403): chuyển tới màn `access-denied` (AUTH), không dựng ô tra cứu | USR-REQ-20261006-101004117 |

## Phần tử
| testid | Phần tử | Role | Hành động | Requirement |
|---|---|---|---|---|
| usr-customer-lookup-email | Ô nhập email cần tra cứu | staff, admin | Nhập | USR-REQ-20261006-101004117 |
| usr-customer-lookup-submit | Nút Tra cứu | staff, admin | Tìm | USR-REQ-20261006-101004117 |
| usr-customer-lookup-loading | Trạng thái đang tìm | staff, admin | - | USR-REQ-20261006-101004117 |
| usr-customer-lookup-result | Thẻ kết quả khách (có `data-id`) | staff, admin | - | USR-REQ-20261006-101004117 |
| usr-customer-lookup-name | Họ tên khách | staff, admin | - | USR-REQ-20261006-101004117 |
| usr-customer-lookup-result-email | Email khách (che với staff, đầy đủ với admin) | staff, admin | - | USR-REQ-20261006-101004117 |
| usr-customer-lookup-phone | Điện thoại khách (che với staff, đầy đủ với admin) | staff, admin | - | USR-REQ-20261006-101004117 |
| usr-customer-lookup-verified | Nhãn đã hoặc chưa xác minh email | staff, admin | - | USR-REQ-20261006-101004117 |
| usr-customer-lookup-status | Nhãn trạng thái Hoạt động hoặc Đã khóa | staff, admin | - | USR-REQ-20261006-101004117 |
| usr-customer-lookup-created | Ngày tạo tài khoản | staff, admin | - | USR-REQ-20261006-101004117 |
| usr-customer-lookup-masked-notice | Chú thích thông tin đã được che | staff | - | USR-REQ-20261006-101004117 |
| usr-customer-lookup-avatar | Ảnh đại diện khách | admin | - | USR-REQ-20261006-101004117 |
| usr-customer-lookup-addresses | Khối danh sách địa chỉ khách | admin | - | USR-REQ-20261006-101004117 |
| usr-customer-lookup-not-found | Thông báo không tìm thấy | staff, admin | - | USR-REQ-20261006-101004117 |
| usr-customer-lookup-field-error | Nhắc dưới ô tìm khi email sai dạng | staff, admin | - | USR-REQ-20261006-101004117 |
| usr-customer-lookup-rate-limited | Banner bị giới hạn kèm số giây chờ | staff, admin | - | USR-REQ-20261006-101004117 |
| usr-customer-lookup-error | Banner lỗi chung | staff, admin | - | USR-REQ-20261006-101004117 |
| usr-customer-lookup-retry | Nút Thử lại | staff, admin | Tìm lại | USR-REQ-20261006-101004117 |

## Ghi chú thiết kế (mặc định, chưa duyệt)
- **Báo trước theo skill evon:** màn quản trị nội bộ gần loại "danh sách, chi tiết bản ghi" mà skill đã dạy; vẫn làm đơn giản theo mẫu thẻ chi tiết (`components/description-list.md`).
- **Audit (câu 2 của evon):** chưa có codebase; Tailwind, flat, tiếng Việt theo mặc định.
- Che dữ liệu làm ở server (USR-REQ-20261006-101004117 BR3), giao diện chỉ hiển thị giá trị nhận được; staff không có khối Địa chỉ và ảnh nên không dựng khối khóa (khớp luật "không có quyền thì ẩn", không khung khóa).
- Ghi chú lệch: theo yêu cầu, không có danh sách hay tìm theo tiền tố ở màn này (khác màn quản trị người dùng của AUTH).
- Không có liên kết từ màn đơn hàng sang khách: ORD không trả người nhận hay `user_id` cho staff (SB-08 c, K-13), staff tra bằng email khách báo (USR-REQ-20261006-101004117 BR1).
- Mỗi lần tra cứu (kể cả không tìm thấy) được ghi audit; giao diện không hiện hay yêu cầu nhập lý do (chưa bắt buộc).
- Không viết code giao diện; dựng thật là việc của `implement`.
