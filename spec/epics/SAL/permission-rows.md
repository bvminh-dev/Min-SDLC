Dòng ma trận mới của epic SAL (Bán hàng hộ), đúng khuôn `spec/permissions-matrix.md` (cột: Hành động, Requirement, guest, customer, staff, sale, admin, system). Dán vào bảng chính và thêm một dòng vào mục Thay đổi. Người duyệt gộp, epic không sửa ma trận chung.

| Hành động | Requirement | guest | customer | staff | sale | admin | system |
|---|---|---|---|---|---|---|---|
| Tạo đơn hộ cho khách (sale, admin; staff không đặt hộ) | SAL-REQ-20261015-092710847 | - | - | - | Y | Y | - |
| Tra khách có sẵn theo điện thoại hoặc email (bản che) khi lập đơn hộ | SAL-REQ-20261015-092710942 | - | - | - | Y | Y | - |
| Gợi ý khách có sẵn khi gõ dở email hoặc điện thoại (bản che) khi lập đơn hộ | SAL-REQ-20261015-092710942 | - | - | - | Y | Y | - |
| Xem phương thức vận chuyển và phí khi lập đơn hộ | SAL-REQ-20261015-092711037 | - | - | - | Y | Y | - |
| Đơn hộ bị từ chối: hết hàng, nguồn đã tắt, sản phẩm không còn bán (kết quả của lệnh tạo đơn hộ, không có endpoint riêng) | SAL-REQ-20261015-092711128 | - | - | - | Y | Y | - |
| Xem danh sách đơn hộ (Đơn của tôi: sale chỉ đơn mình tạo, admin mọi đơn hộ) | SAL-REQ-20261015-092711222 | - | - | - | own | Y | - |
| Xem chi tiết đơn hộ (sale chỉ đơn mình tạo, admin mọi đơn hộ) | SAL-REQ-20261015-092711321 | - | - | - | own | Y | - |

| Ngày | Dòng | Từ | Thành | Lý do | Người duyệt |
|---|---|---|---|---|---|
| 2026-10-15 | 6 dòng SAL (tạo đơn hộ, tra khách, phí vận chuyển, đơn hộ bị từ chối, danh sách và chi tiết đơn hộ) | (chưa có) | (dòng mới) | Epic SAL (ADR-026, SB-45): sale và admin tạo đơn hộ; sale `own` theo `created_by`; staff, customer không đặt hộ | chưa duyệt |
