Dòng ma trận mới của epic REV (đợt 3), đúng khuôn `spec/permissions-matrix.md` (cột: Hành động, Requirement, guest, customer, staff, admin, system). Dán vào bảng chính và thêm một dòng vào mục Thay đổi.

| Hành động | Requirement | guest | customer | staff | admin | system |
|---|---|---|---|---|---|---|
| Bỏ ẩn đánh giá (hidden về published) | REV-REQ-20261006-103135835 | - | - | - | Y | - |
| Dọn ảnh mồ côi và ảnh của đánh giá đã xóa (job nền `rev.sweep-orphan-images`, không có endpoint) | REV-REQ-20261006-103135207 | - | - | - | - | Y |

| Ngày | Dòng | Từ | Thành | Lý do | Người duyệt |
|---|---|---|---|---|---|
| 2026-10-06 | 2 dòng REV (bỏ ẩn, job dọn ảnh) | (chưa có) | (dòng mới) | Endpoint `POST /api/v1/admin/reviews/{id}/unhide` (E-22) và job dọn ảnh của REV (ADR-013, ADR-018) chưa có dòng ma trận; staff không có quyền kiểm duyệt (R-02, R-03) | chưa duyệt |
