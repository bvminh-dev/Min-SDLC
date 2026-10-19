Dòng ma trận mới của epic ORD (đợt 3 và đợt bán hộ 2026-10-15), đúng khuôn `spec/permissions-matrix.md` (cột: Hành động, Requirement, guest, customer, staff, sale, admin, system). Dán vào bảng chính và thêm dòng vào mục Thay đổi. Người duyệt gộp, epic không sửa ma trận chung. Các dòng cũ của ORD ở ma trận chính giữ nguyên (cột `sale` đã là `-`); quyền mới của `sale` đi bằng dòng mới có "Hành động" khác để không trùng khóa gộp.

| Hành động | Requirement | guest | customer | staff | sale | admin | system |
|---|---|---|---|---|---|---|---|
| Khóa hủy đơn khi SHP bắt đầu bàn giao (giao diện nội bộ cho SHP, không có endpoint) | ORD-REQ-20261006-150000100 | - | - | - | - | - | Y |
| Sale xem danh sách đơn do mình tạo (lọc trạng thái, nguồn, tìm theo mã đơn; chỉ đơn có `created_by` là mình) | ORD-REQ-20261006-092320743 | - | - | - | own | - | - |
| Lọc danh sách mọi đơn theo nguồn đơn và theo người tạo (`source`, `created_by`) | ORD-REQ-20261006-092320743 | - | - | Y | - | Y | - |
| Sale xem chi tiết đơn do mình tạo (kèm khách, địa chỉ giao; không có giá vốn) | ORD-REQ-20261006-092320768 | - | - | - | own | - | - |
| Xem nguồn đơn, người tạo, ghi chú đơn và ghi chú dòng hàng ở chi tiết đơn (customer không thấy) | ORD-REQ-20261006-092320768 | - | - | Y | own | Y | - |
| Xem bản chụp khách (họ tên, điện thoại) của đơn hộ ở chi tiết đơn (staff không thấy) | ORD-REQ-20261006-092320768 | - | - | - | own | Y | - |
| Xem giá vốn lúc bán (`cost_snapshot`) của dòng hàng ở chi tiết đơn | ORD-REQ-20261006-092320768 | - | - | - | - | Y | - |
| Sale xem lịch sử trạng thái của đơn do mình tạo | ORD-REQ-20261006-092320812 | - | - | - | own | - | - |
| Sale xem trạng thái của đơn do mình tạo | ORD-REQ-20261006-092320790 | - | - | - | own | - | - |
| Đọc đơn theo mã đơn `HDyymmdd-NNNNN` hoặc mã cũ 12 ký tự, kiểm chủ đơn ở mọi đường (chi tiết, lịch sử, tìm); đơn người khác và không tồn tại cùng 404 | ORD-REQ-20261015-092748640 | - | own | Y | own | Y | Y |
| Cấp mã đơn tuần tự theo ngày khi tạo đơn (giao diện nội bộ, không có endpoint) | ORD-REQ-20261015-092748640 | - | - | - | - | - | Y |
| Xem danh mục nguồn đơn đang bật (chọn nguồn khi tạo đơn hộ, lọc đơn) | ORD-REQ-20261015-092748678 | - | - | Y | Y | Y | - |
| Xem danh mục nguồn đơn gồm cả nguồn đã tắt (`include_inactive`) | ORD-REQ-20261015-092748678 | - | - | Y | - | Y | - |
| Thêm, sửa tên và thứ tự, tắt và bật nguồn đơn | ORD-REQ-20261015-092748678 | - | - | - | - | Y | - |
| Giao diện nội bộ cho SAL: tạo đơn hộ (`createHo`) và đọc danh sách nguồn đơn (`listSources`), không có endpoint | ORD-REQ-20261015-092748715 | - | - | - | - | - | Y |
| Giao diện đọc nội bộ cho SHP (khối khách của danh sách vận đơn) và DSH (báo cáo theo nguồn, theo sale), không có endpoint | ORD-REQ-20261015-092748751 | - | - | - | - | - | Y |

| Ngày | Dòng | Từ | Thành | Lý do | Người duyệt |
|---|---|---|---|---|---|
| 2026-10-06 | 1 dòng ORD (khóa hủy đơn khi bàn giao) | (chưa có) | (dòng mới) | R-04: cơ chế đóng cửa sổ giữa SHP bàn giao và ORD nhận ShipmentShipped; chỉ role `system` (SHP) | chưa duyệt |
| 2026-10-15 | 15 dòng ORD (quyền `sale own` ở danh sách, chi tiết, trạng thái; lọc theo nguồn và người tạo; nguồn, người tạo, ghi chú, khách, giá vốn ở chi tiết; mã đơn kiểm chủ đơn; danh mục nguồn đơn; giao diện nội bộ cho SAL, SHP, DSH) | (chưa có) | (dòng mới) | Bán hàng hộ (spec/changes/ban-ho-sale-nguon-don-20261015.md): sale chỉ thấy đơn `created_by` là mình, giá vốn chỉ admin (SB-42), staff không thấy khách (SB-08 c), ghi chú và nguồn chỉ nhân viên | chưa duyệt |
