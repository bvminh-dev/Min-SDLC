Dòng ma trận mới của epic PRD (đợt bán hàng hộ 2026-10-15), đúng khuôn `spec/permissions-matrix.md` (cột: Hành động, Requirement, guest, customer, staff, sale, admin, system). Dán vào bảng chính và thêm các dòng vào mục Thay đổi. Người duyệt gộp, epic không sửa ma trận chung.

Lưu ý cho người gộp: `merge-matrix.mjs` khóa theo (Hành động, Requirement) nên không đổi được dòng cũ. Dòng cũ của PRD-REQ-20261006-095502655 (staff Y, sale `-`) và PRD-REQ-20261006-095502676 (sale `-`) cần sửa tay cho sale thành `Y` (xem bảng Thay đổi); các dòng mới dưới đây đã ghi đúng quyền của sale và là bản đúng khi mâu thuẫn.

| Hành động | Requirement | guest | customer | staff | sale | admin | system |
|---|---|---|---|---|---|---|---|
| Xem sản phẩm ở trang quản trị không kèm giá vốn (staff, sale, admin; chỉ đọc) | PRD-REQ-20261006-095502655 | - | - | Y | Y | Y | - |
| Xem giá vốn (`cost_price`) ở danh sách và chi tiết sản phẩm quản trị | PRD-REQ-20261006-095502655 | - | - | - | - | Y | - |
| Ghi giá vốn (`cost_price`) khi tạo và sửa sản phẩm | PRD-REQ-20261006-095502571 | - | - | - | - | Y | - |
| Xem chi tiết sản phẩm đang bán, không kèm giá vốn (mọi role kể cả sale) | PRD-REQ-20261006-095502676 | Y | Y | Y | Y | Y | - |
| Import sản phẩm từ tệp .xlsx hoặc .csv (xem trước `dry_run` và xác nhận) | PRD-REQ-20261015-092431191 | - | - | - | - | Y | - |
| Tải tệp mẫu import sản phẩm | PRD-REQ-20261015-092431230 | - | - | - | - | Y | - |

| Ngày | Dòng | Từ | Thành | Lý do | Người duyệt |
|---|---|---|---|---|---|
| 2026-10-15 | 6 dòng PRD (xem sản phẩm quản trị không giá vốn, xem và ghi giá vốn, xem chi tiết công khai cho sale, import, tải mẫu) | (chưa có) | (dòng mới) | Role `sale` mới và giá vốn chỉ admin (SB-42), import sản phẩm admin (SB-43, ADR-025): spec/changes/ban-ho-sale-nguon-don-20261015.md | chưa duyệt |
| 2026-10-15 | dòng "Xem danh sách và chi tiết sản phẩm ở trang quản trị (mọi trạng thái)" của PRD-REQ-20261006-095502655 | sale `-` | sale `Y` (không kèm giá vốn) | roles.md: sale xem sản phẩm chỉ đọc; PRD-REQ-20261006-095502655 nay có `roles: [staff, sale, admin]` | chưa duyệt |
| 2026-10-15 | dòng "Xem chi tiết sản phẩm đang bán" của PRD-REQ-20261006-095502676 | sale `-` | sale `Y` | Endpoint công khai mở cho mọi role; `roles` của requirement thêm `sale` | chưa duyệt |
