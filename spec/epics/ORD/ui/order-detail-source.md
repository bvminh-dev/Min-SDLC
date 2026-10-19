---
screen: order-detail-source
epic: ORD
status: approved
covers: [ORD-REQ-20261006-092320768]
roles: [staff, sale, admin]
---
# Chi tiết đơn: khối nguồn, người tạo, ghi chú, khách của đơn hộ và giá vốn

Màn này BỔ SUNG cho `order-detail` (đã duyệt, customer, staff, admin): một khối "Thông tin bán hàng" thêm vào trang chi tiết và cột Ghi chú, Giá vốn ở bảng sản phẩm. Khi dựng, hai tài liệu là MỘT trang chi tiết; `order-detail` không được sửa ở đợt này nên phần mới đứng riêng ở đây. Customer KHÔNG thấy khối này (nguồn, người tạo, ghi chú là thông tin nội bộ của cửa hàng, ORD-REQ-20261006-092320768 BR10), nên không có role customer ở màn này.

## Wireframe
Phương án đã chọn: **A** (khối nhỏ "Thông tin bán hàng" ở cột phải, dưới khối Thanh toán; ghi chú dòng ngay dưới tên mặt hàng; giá vốn là cột phụ của admin). **Mặc định** của skill, tự chọn theo hướng dẫn "không dừng chờ".

| Phương án | Việc chính thấy ở đâu | Đổi gì | Đánh đổi |
|---|---|---|---|
| **A. Khối trong cột phải (đã chọn)** | Nguồn, người tạo, ghi chú đơn cùng một khối | Không đổi bố cục `order-detail` | Thêm một khối; ghi chú dòng nằm cạnh mặt hàng, đúng chỗ kho đọc |
| B. Tab "Bán hàng" riêng | Một tab | Trang gọn | Kho phải bấm thêm một lần mới thấy ghi chú "size M" |
| C. Gộp vào đầu trang | Nguồn và người tạo cạnh mã đơn | Thấy ngay | Đầu trang chật; ghi chú dài làm lệch bố cục |

```
┌ Sản phẩm ────────────────────────────────────────────────────────────────────────┐
│ Áo thun cổ tròn   100.000 đ × 2     200.000 đ                  Giá vốn 60.000 đ  │  <- Giá vốn chỉ admin
│   Ghi chú: size M, màu đen                                                       │  <- staff, sale, admin
│ Quần jean         250.000 đ × 1     250.000 đ                  Giá vốn —         │
└──────────────────────────────────────────────────────────────────────────────────┘
┌ Thông tin bán hàng ───────────────────────────────┐
│ Nguồn: Facebook          Người tạo: Trần Thu      │  <- Nguồn "Website", người tạo — với đơn khách tự đặt
│ Khách: Trần Thị Mai · 0912345678                  │  <- sale (đơn của mình) và admin; staff không thấy
│ Ghi chú đơn: Khách muốn giao sau 18h              │
└───────────────────────────────────────────────────┘
Staff: thấy Nguồn, Người tạo, Ghi chú đơn, Ghi chú dòng; dòng Khách hiện "ẩn theo chính sách dữ liệu".
Ghi chú luôn hiện dạng chữ (đã escape), xuống dòng được giữ.
```

## Trạng thái
| Trạng thái | Trông ra sao | Requirement | testid |
|---|---|---|---|
| có dữ liệu | Khối Thông tin bán hàng có Nguồn, Người tạo, Ghi chú đơn; ghi chú dòng dưới mặt hàng khi có | ORD-REQ-20261006-092320768 | ord-order-detail-source-block |
| đơn khách tự đặt | Nguồn "Website", Người tạo "—", không có Ghi chú, không có Khách | ORD-REQ-20261006-092320768 | ord-order-detail-source-block |
| không có ghi chú | Dòng Ghi chú đơn hiện "—"; không có dòng ghi chú dưới mặt hàng | ORD-REQ-20261006-092320768 | ord-order-detail-source-note |
| staff không thấy khách | Dòng Khách thay bằng "Thông tin khách được ẩn theo chính sách dữ liệu" | ORD-REQ-20261006-092320768 | ord-order-detail-source-customer-hidden |
| giá vốn chỉ admin | Cột Giá vốn chỉ hiện với admin; giá vốn rỗng hiện "—"; sale và staff không có phần tử này trong trang | ORD-REQ-20261006-092320768 | ord-order-detail-source-cost |
| ghi chú có HTML | Ghi chú hiện đúng chuỗi gốc dưới dạng chữ, không chạy script | ORD-REQ-20261006-092320768 | ord-order-detail-source-note |
| đang tải | Khung chờ trong khối (khi cả trang đang tải thì theo `order-detail`) | ORD-REQ-20261006-092320768 | ord-order-detail-source-loading |
| lỗi | Khối báo "Không tải được thông tin bán hàng." kèm Thử lại; phần còn lại của trang vẫn hiện | ORD-REQ-20261006-092320768 | ord-order-detail-source-error |
| không tìm thấy | Sale mở đơn của sale khác (404): dùng khối "Không tìm thấy đơn hàng" của `order-detail`, giống đơn không tồn tại | ORD-REQ-20261006-092320768 | - |

## Phần tử
| testid | Phần tử | Role | Hành động | Requirement |
|---|---|---|---|---|
| ord-order-detail-source-block | Khối Thông tin bán hàng | staff, sale, admin | - | ORD-REQ-20261006-092320768 |
| ord-order-detail-source-name | Tên nguồn đơn | staff, sale, admin | - | ORD-REQ-20261006-092320768 |
| ord-order-detail-source-creator | Tên người tạo đơn (hoặc —) | staff, sale, admin | - | ORD-REQ-20261006-092320768 |
| ord-order-detail-source-customer | Họ tên và điện thoại khách của đơn hộ | sale, admin | - | ORD-REQ-20261006-092320768 |
| ord-order-detail-source-customer-hidden | Dòng "ẩn theo chính sách dữ liệu" thay khối khách | staff | - | ORD-REQ-20261006-092320768 |
| ord-order-detail-source-note | Ghi chú đơn (văn bản thuần, đã escape) | staff, sale, admin | - | ORD-REQ-20261006-092320768 |
| ord-order-detail-source-item-note | Ghi chú của một dòng hàng (dưới tên mặt hàng, chỉ khi có) | staff, sale, admin | - | ORD-REQ-20261006-092320768 |
| ord-order-detail-source-cost | Giá vốn lúc bán của một dòng hàng (cột phụ) | admin | - | ORD-REQ-20261006-092320768 |
| ord-order-detail-source-loading | Khung chờ của khối | staff, sale, admin | - | ORD-REQ-20261006-092320768 |
| ord-order-detail-source-error | Banner lỗi của khối | staff, sale, admin | - | ORD-REQ-20261006-092320768 |
| ord-order-detail-source-retry | Nút Thử lại của khối | staff, sale, admin | Tải lại | ORD-REQ-20261006-092320768 |

## Ghi chú thiết kế (mặc định, chưa duyệt)
- Quy tắc hiển thị theo role lấy từ ORD-REQ-20261006-092320768 BR10: nguồn, người tạo, ghi chú cho staff, sale (đơn của mình), admin; khách chỉ sale và admin; giá vốn chỉ admin. Server loại khóa theo role; giao diện không ẩn rồi hiện lại dữ liệu mà server đã trả (không có giá vốn trong phản hồi của sale).
- Ghi chú là văn bản thuần, luôn escape (SB-12, SB-45), giữ xuống dòng bằng kiểu hiển thị chứ không bằng HTML; không rút gọn ghi chú của dòng hàng vì kho cần đọc đủ.
- Customer có đơn hộ gắn tài khoản không thấy khối này (BR10); màn của customer là `order-detail`.
- Không có nút sửa nguồn, người tạo hay ghi chú ở v1 (ORD-REQ-20261015-092748715 BR7).
- Không viết code giao diện ở phase này.
