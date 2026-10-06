---
screen: address-form
epic: USR
status: draft
covers: [USR-REQ-20261006-101003855, USR-REQ-20261006-101003941]
roles: [customer]
---
# Thêm hoặc sửa địa chỉ giao hàng

## Wireframe
Phương án đã chọn: **A** (một trang form một cột `max-w-xl`, dùng chung cho thêm và sửa; tiêu đề đổi theo chế độ). **Đây là lựa chọn mặc định** theo khuyến nghị của skill, chưa có người chọn (các cổng hỏi người dùng không dùng được khi chạy tự động).

| Phương án | Bố cục | Đánh đổi |
|---|---|---|
| **A. Trang riêng, một cột (khuyên dùng, đã chọn)** | Sáu ô nhập, ô chọn mặc định, Lưu và Hủy | Đủ chỗ cho lỗi theo ô; dùng tốt trên 375px; thêm một lần chuyển trang |
| B. Hộp thoại mở từ danh sách | Cùng sáu ô trong hộp thoại | Không rời danh sách; hộp thoại có nhiều ô nhập không đóng khi bấm ngoài, chật ở điện thoại |
| C. Nhập ngay trong thẻ (inline) | Thẻ mở rộng thành form | Gọn; khó đọc lỗi và dễ nhầm với hành động của các thẻ khác |

Lý do chọn A: sáu trường và nhiều loại lỗi theo ô cần chỗ rộng; hai chế độ thêm và sửa dùng chung một bố cục.

```
Thêm địa chỉ                          (sửa: "Sửa địa chỉ")
   Người nhận
   [ Nguyễn An                              ]
   Điện thoại
   [ 0901234567                             ]
   Số nhà, tên đường
   [ 12 Lê Lợi                              ]
   Phường, xã            Quận, huyện (không bắt buộc)
   [ Bến Nghé        ]   [ Quận 1        ]
   Tỉnh, thành phố
   [ TP. Hồ Chí Minh                        ]
   [x] Đặt làm địa chỉ mặc định
   (vùng báo lỗi chung)
   [ Lưu địa chỉ ]   Hủy
```

## Trạng thái
| Trạng thái | Trông ra sao | Requirement |
|---|---|---|
| nhập liệu (thêm) | Sáu ô trống; ô mặc định bỏ chọn; nếu sổ rỗng thì ô mặc định đã chọn và khóa kèm gợi ý "Địa chỉ đầu tiên luôn là mặc định" | USR-REQ-20261006-101003855 |
| đang gửi (thêm) | Nút khóa, chữ "Đang lưu..."; các ô khóa; không gửi hai lần | USR-REQ-20261006-101003855 |
| lỗi kiểm dữ liệu | Thông báo dưới từng ô: thiếu trường (trừ quận, huyện được để trống), quá dài (người nhận hay tên đường), điện thoại không phải số di động Việt Nam; giữ nguyên nội dung đã nhập | USR-REQ-20261006-101003855 |
| đã đủ 10 | Banner "Bạn đã có 10 địa chỉ, xóa bớt để thêm mới" kèm liên kết về danh sách (409); các ô giữ nguyên | USR-REQ-20261006-101003855 |
| thêm xong | Quay về danh sách, toast "Đã thêm địa chỉ" | USR-REQ-20261006-101003855 |
| nhập liệu (sửa) | Sáu ô điền sẵn từ danh sách; nếu địa chỉ đang mặc định thì ô mặc định đã chọn và khóa kèm gợi ý "Muốn đổi mặc định, hãy đặt địa chỉ khác làm mặc định" | USR-REQ-20261006-101003941 |
| đang gửi (sửa) | Nút khóa, chữ "Đang lưu..."; các ô khóa | USR-REQ-20261006-101003941 |
| sửa xong | Quay về danh sách, toast "Đã lưu địa chỉ" | USR-REQ-20261006-101003941 |
| địa chỉ không còn | Banner "Địa chỉ này không còn tồn tại" (404) kèm liên kết về danh sách; form khóa | USR-REQ-20261006-101003941 |
| lỗi | Banner "Không lưu được địa chỉ. Thử lại." (lỗi mạng, 5xx), nút Thử lại; ô giữ nguyên | USR-REQ-20261006-101003855 |
| hết phiên | 401: chuyển về đăng nhập (màn của AUTH) | USR-REQ-20261006-101003855 |
| không có quyền | Staff hay admin vào màn này (403): chuyển tới màn `access-denied` (AUTH) | USR-REQ-20261006-101003855 |

## Phần tử
| testid | Phần tử | Role | Hành động | Requirement |
|---|---|---|---|---|
| usr-address-form-form | Biểu mẫu địa chỉ | customer | Gửi | USR-REQ-20261006-101003855 |
| usr-address-form-receiver | Ô người nhận | customer | Nhập | USR-REQ-20261006-101003855 |
| usr-address-form-phone | Ô điện thoại | customer | Nhập | USR-REQ-20261006-101003855 |
| usr-address-form-line1 | Ô số nhà, tên đường | customer | Nhập | USR-REQ-20261006-101003855 |
| usr-address-form-ward | Ô phường, xã | customer | Nhập | USR-REQ-20261006-101003855 |
| usr-address-form-district | Ô quận, huyện (không bắt buộc) | customer | Nhập | USR-REQ-20261006-101003855 |
| usr-address-form-city | Ô tỉnh, thành phố | customer | Nhập | USR-REQ-20261006-101003855 |
| usr-address-form-default | Ô chọn đặt làm mặc định | customer | Bật hoặc tắt | USR-REQ-20261006-101003855 |
| usr-address-form-submit | Nút Lưu địa chỉ | customer | Gửi thêm hoặc sửa | USR-REQ-20261006-101003855 |
| usr-address-form-cancel | Liên kết Hủy | customer | Về danh sách | USR-REQ-20261006-101003855 |
| usr-address-form-field-error | Lỗi dưới từng ô (có `data-field`) | customer | - | USR-REQ-20261006-101003855 |
| usr-address-form-limit-reached | Banner đã đủ 10 địa chỉ | customer | Bấm về danh sách | USR-REQ-20261006-101003855 |
| usr-address-form-error | Banner lỗi chung | customer | - | USR-REQ-20261006-101003855 |
| usr-address-form-retry | Nút Thử lại | customer | Gửi lại | USR-REQ-20261006-101003855 |
| usr-address-form-loading | Trạng thái đang gửi | customer | - | USR-REQ-20261006-101003855 |
| usr-address-form-default-locked | Gợi ý ô mặc định bị khóa (địa chỉ đang mặc định) | customer | - | USR-REQ-20261006-101003941 |
| usr-address-form-not-found | Banner Địa chỉ này không còn tồn tại | customer | Bấm về danh sách | USR-REQ-20261006-101003941 |

## Ghi chú thiết kế (mặc định, chưa duyệt)
- **Báo trước theo skill evon:** phía người mua của cửa hàng online chưa được dạy; làm theo mẫu form và ô nhập (`components/input.md`, `components/choice-controls.md`).
- **Audit (câu 2 của evon):** chưa có codebase; Tailwind, flat, tiếng Việt theo mặc định.
- Ba ô phường, quận, thành phố là ô nhập tự do (chưa có danh mục hành chính; xem [OPEN] ở USR-REQ-20261006-101003855); quận, huyện không bắt buộc (E-06), phường và thành phố bắt buộc. Nếu sau này có danh mục thì đổi thành ô chọn mà testid giữ nguyên.
- Điện thoại gợi ý ví dụ `0901234567`; nhập `+84 901 234 567` vẫn được (server chuẩn hóa).
- Không có tự động điền từ vị trí hay bản đồ (ngoài roadmap).
- Không viết code giao diện; dựng thật là việc của `implement`.
