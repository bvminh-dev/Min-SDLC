Dòng ma trận mới của epic AUTH (đợt bán hộ 2026-10-15), đúng khuôn `spec/permissions-matrix.md` (cột: Hành động, Requirement, guest, customer, staff, sale, admin, system). Dòng cũ giữ nguyên (cột `sale` là `-`); quyền của `sale` đi bằng dòng mới có "Hành động" khác để không trùng khóa gộp của merge-matrix.

| Hành động | Requirement | guest | customer | staff | sale | admin | system |
|---|---|---|---|---|---|---|---|
| Sale đăng xuất (phiên hiện tại) | AUTH-REQ-20261006-095515774 | - | - | - | own | - | - |
| Sale xem thông tin và hạn của phiên hiện tại | AUTH-REQ-20261006-095515808 | - | - | - | own | - | - |
| Gán role `sale` và đổi qua lại giữa bốn role (customer, staff, sale, admin) | AUTH-REQ-20261006-095515956 | - | - | - | - | Y | - |
| Kiểm quyền endpoint có role `sale` (mặc định từ chối, kiểm lệch ma trận có cột sale) | AUTH-REQ-20261006-095515918 | Y | Y | Y | Y | Y | - |

| Ngày | Dòng | Từ | Thành | Lý do | Người duyệt |
|---|---|---|---|---|---|
| 2026-10-15 | 4 dòng AUTH (sale đăng xuất, xem phiên, gán role sale, kiểm quyền có sale) | (chưa có) | (dòng mới) | Role `sale` mới (spec/changes/ban-ho-sale-nguon-don-20261015.md): dùng chung đăng xuất và phiên như mọi role đăng nhập; chỉ admin gán role | chưa duyệt |
