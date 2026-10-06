# Ma trận role / permission

Hành động đặt theo hàng, role theo cột. `Y` được phép, `-` không, `own` chỉ với dữ liệu của chính mình.
Role lấy từ `spec/domain/roles.md`. Tác nhân hệ thống (event từ module khác) không phải role nên không có cột; việc chuyển trạng thái đơn do event nằm ở ORD-REQ-20261006-092320790.
Hiện chỉ có các dòng của epic ORD; epic khác thêm dòng khi chạy sdlc-research của epic đó.

| Hành động | Requirement | guest | customer | staff | admin |
|---|---|---|---|---|---|
| Xem danh sách đơn của mình (lọc theo trạng thái) | ORD-REQ-20261006-092320716 | - | own | - | - |
| Xem danh sách mọi đơn, lọc trạng thái, tìm theo mã đơn | ORD-REQ-20261006-092320743 | - | - | Y | Y |
| Xem chi tiết đơn | ORD-REQ-20261006-092320768 | - | own | Y | Y |
| Xem trạng thái đơn | ORD-REQ-20261006-092320790 | - | own | Y | Y |
| Xem lịch sử trạng thái đơn | ORD-REQ-20261006-092320812 | - | own | Y | Y |
| Hủy đơn (trước khi giao) | ORD-REQ-20261006-092320834 | - | own | - | Y |

## Thay đổi
| Ngày | Dòng | Từ | Thành | Lý do | Người duyệt |
|---|---|---|---|---|---|
| 2026-10-06 | Toàn bộ 6 dòng ORD | (chưa có) | (dòng mới) | Tạo ma trận lần đầu cho epic ORD; chưa có dòng cũ bị đổi quyền | chưa duyệt |
