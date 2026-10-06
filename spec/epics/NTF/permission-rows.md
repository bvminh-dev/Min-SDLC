Dòng ma trận mới của epic NTF (đợt 3), đúng khuôn `spec/permissions-matrix.md` (cột: Hành động, Requirement, guest, customer, staff, admin, system). Dán vào bảng chính và thêm một dòng vào mục Thay đổi. Người duyệt gộp, epic không sửa ma trận chung.

| Hành động | Requirement | guest | customer | staff | admin | system |
|---|---|---|---|---|---|---|
| Nhận thông báo đơn quá hạn thanh toán (do event OrderExpired, không có endpoint; chỉ trong ứng dụng) | NTF-REQ-20261006-103208992 | - | own | - | - | Y |

| Ngày | Dòng | Từ | Thành | Lý do | Người duyệt |
|---|---|---|---|---|---|
| 2026-10-06 | 1 dòng NTF (thông báo đơn hết hạn) | (chưa có) | (dòng mới) | R-19: NTF nhận OrderExpired (nền đợt 3), BR8 của NTF-REQ-20261006-103208992; người nhận là chủ đơn, tác nhân `system` | chưa duyệt |
