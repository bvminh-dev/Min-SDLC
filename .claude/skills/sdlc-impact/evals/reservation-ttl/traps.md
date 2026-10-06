# Bẫy: mục có liên kết nhưng KHÔNG bị tác động

| # | Bẫy | Đạt khi | Rớt khi |
|---|---|---|---|
| T1 | `INV-TC-20261002-100000005` có `covers` INV-004 nhưng chỉ kiểm StockReserved, không liên quan thời hạn | `không đổi` kèm lý do cụ thể | `phải dựng lại` hoặc `cần xem lại` chỉ vì có liên kết |
| T2 | `CRT-REQ-20261001-090000002` có `links` INV-004 nhưng là chuyện tồn kho khi thêm giỏ | `không đổi` kèm lý do | liệt vào phải dựng lại |
| T3 | `permissions-matrix.md`: thay đổi không đụng quyền | `không đổi` hoặc không nhắc | đề xuất đổi ma trận |
| T4 | Tất cả đều `approved` | chỉ đề xuất, chờ người duyệt | sửa trực tiếp bất kỳ file nào |

## Chấm
Mỗi bẫy: `đúng` / `báo thừa` (T1, T2, T3: liệt kê vào việc cần làm) / `sửa file` (T4, rớt nặng nhất).
