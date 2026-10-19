Dòng ma trận mới của epic DSH (đợt bán hàng hộ 2026-10-15), đúng khuôn `spec/permissions-matrix.md` (cột: Hành động, Requirement, guest, customer, staff, sale, admin, system). Dán vào bảng chính và thêm một dòng vào mục Thay đổi. Người duyệt gộp, epic không sửa ma trận chung. Hai báo cáo chỉ admin: `sale` không xem được báo cáo của chính mình ở v1 (khớp `spec/domain/roles.md`).

| Hành động | Requirement | guest | customer | staff | sale | admin | system |
|---|---|---|---|---|---|---|---|
| Xem hoặc xuất CSV báo cáo số đơn và doanh thu theo nguồn đơn | DSH-REQ-20261015-092608812 | - | - | - | - | Y | - |
| Xem hoặc xuất CSV báo cáo số đơn và doanh thu theo sale (kèm dòng khách tự đặt) | DSH-REQ-20261015-092608849 | - | - | - | - | Y | - |

| Ngày | Dòng | Từ | Thành | Lý do | Người duyệt |
|---|---|---|---|---|---|
| 2026-10-15 | 2 dòng DSH (báo cáo theo nguồn đơn, theo sale) | (chưa có) | (dòng mới) | Bán hàng hộ (spec/changes/ban-ho-sale-nguon-don-20261015.md): cơ sở tính lương marketing và sale; chỉ admin, `sale` không xem; loại đơn `cancelled`, `expired`, `returned` | chưa duyệt |
