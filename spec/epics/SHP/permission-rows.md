Dòng ma trận mới của epic SHP (đợt bán hàng hộ 2026-10-15), đúng khuôn `spec/permissions-matrix.md` (cột: Hành động, Requirement, guest, customer, staff, sale, admin, system). Dòng cũ "Xem danh sách vận đơn (lọc theo trạng thái, mã đơn, mã vận đơn)" giữ nguyên cho staff và admin; dòng dưới đây thêm quyền cho `sale` theo phạm vi riêng (chỉ danh sách, chỉ vận đơn của đơn do mình tạo). Dán vào bảng chính và thêm một dòng vào mục Thay đổi. Người duyệt gộp, epic không sửa ma trận chung.

| Hành động | Requirement | guest | customer | staff | sale | admin | system |
|---|---|---|---|---|---|---|---|
| Sale xem danh sách vận đơn (lọc theo trạng thái, mã đơn, mã vận đơn) | SHP-REQ-20261006-101103927 | - | - | - | own | - | - |

| Ngày | Dòng | Từ | Thành | Lý do | Người duyệt |
|---|---|---|---|---|---|
| 2026-10-15 | 1 dòng SHP (sale xem danh sách vận đơn của đơn mình) | (chưa có) | (dòng mới: sale `own`) | SB-08 (d): sale chỉ thấy vận đơn của đơn có `created_by` là mình; sale không có chi tiết, lịch sử, thao tác ghi (spec/changes/ban-ho-sale-nguon-don-20261015.md) | chưa duyệt |
