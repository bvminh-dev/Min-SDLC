---
screen: order-manage
epic: ORD
status: draft
covers: [ORD-REQ-20261006-100000002, ORD-REQ-20261006-100000003]
roles: [staff, admin]
---
# Quản lý đơn hàng

Brief (mặc định đã ok, chưa có người xác nhận): staff và admin xem mọi đơn, lọc theo trạng thái và mã đơn, đánh dấu đơn đã giao cho vận chuyển; admin còn hủy được đơn chưa giao. Staff không thấy nút Hủy (quyền: staff không được hủy đơn hay hoàn tiền). So sánh bằng: trạng thái đơn và mã đơn. Hành động cuối: Đã giao cho vận chuyển. Quy ước loại sản phẩm: bảng đơn có lọc ở đầu trang, hành động ở cuối dòng (theo trí nhớ, cần kiểm).

## Wireframe
Phương án đã chọn: A (bảng đơn một khối, thanh lọc dính đầu bảng, hành động ở cột cuối mỗi dòng). Đây là phương án khuyến nghị được chọn mặc định vì không thể hỏi người dùng ở cổng chọn wireframe; chưa có người chọn.

Ba phương án đã cân: A bảng với lọc trên đầu (chọn: so sánh nhiều đơn theo trạng thái, hành động lặp lại nhiều lần mỗi ngày nên ở ngay dòng); B bảng kanban theo cột trạng thái (loại: cần kéo thả, dữ liệu đơn không có mốc để xếp cột; "cần dữ liệu X, logic do bạn nối"); C danh sách và panel chi tiết bên phải (loại: chi tiết đơn của quản lý chưa có yêu cầu riêng, tránh bịa). Đánh đổi của A: không xem được dòng hàng của đơn ngay trong màn này.

```
+---------------------------------------------------------------------+
| Quản lý đơn hàng                                                    |
| [Tìm theo mã đơn____]  [Trạng thái: Tất cả v]                       |
+---------------------------------------------------------------------+
| Mã        Ngày        Trạng thái         Tổng tiền   Hành động      |
| #ORD-1043 06/10/2026  [Đã thanh toán]  1.250.000 đ [Đã giao VC][Hủy*]|
| #ORD-1044 06/10/2026  [Chờ thanh toán]   390.000 đ                  |
+---------------------------------------------------------------------+
|                      < 1 2 3 >                                      |
+---------------------------------------------------------------------+
* Hủy chỉ admin thấy. Đã giao VC chỉ ở đơn paid hoặc confirmed.
```

## Trạng thái
Mỗi dòng: một trạng thái giao diện, lấy từ Given/When/Then của requirement. Bắt buộc có `lỗi`.

| Trạng thái | Trông ra sao | Requirement |
|---|---|---|
| có dữ liệu | Bảng mọi đơn, lọc được theo trạng thái và mã đơn (BR1) | ORD-REQ-20261006-100000002 |
| đang tải | Khung xám 8 dòng đúng hình dòng đơn (chuẩn giao diện chung, không có trong Given/When/Then, xem báo cáo) | ORD-REQ-20261006-100000002 |
| lỗi | Banner "Không tải được danh sách đơn" kèm nút Thử lại | ORD-REQ-20261006-100000002 |
| đánh dấu thành công | Dòng đổi sang badge Đã giao vận chuyển (shipped), nút Đã giao cho vận chuyển biến mất khỏi dòng; thông báo ngắn (Luồng chính; ghi audit do hệ thống) | ORD-REQ-20261006-100000002 |
| đánh dấu bị từ chối vì chưa thanh toán | Đơn pending: nút Đã giao cho vận chuyển không hiện; nếu vẫn gửi được (dữ liệu cũ) thì banner "Đơn chưa thanh toán hoặc chưa xác nhận, không thể giao" (Luồng lỗi) | ORD-REQ-20261006-100000002 |
| đánh dấu xung đột | Hai staff cùng đánh dấu: người đến sau thấy banner "Đơn đã được đánh dấu giao" và dòng cập nhật thành shipped (Ca biên) | ORD-REQ-20261006-100000002 |
| hủy xác nhận | Hộp "Hủy đơn này?" (chỉ admin); đơn đã thanh toán thì thêm dòng "Sẽ tạo yêu cầu hoàn tiền" (Ca biên của hủy; xử lý ở epic PAY, chưa có spec) | ORD-REQ-20261006-100000003 |
| hủy bị từ chối | Trong hộp xác nhận hiện banner lý do (ví dụ đơn đã shipped), hộp vẫn mở (Luồng lỗi) | ORD-REQ-20261006-100000003 |

## Phần tử
testid dạng `<epic>-<màn>-<phần-tử>` (chữ thường, nối bằng `-`), duy nhất trong cả `spec/`. Nút Hủy chỉ admin (staff không được hủy đơn).

| testid | Phần tử | Role | Hành động | Requirement |
|---|---|---|---|---|
| ord-order-manage-title | Tiêu đề "Quản lý đơn hàng" | staff, admin | - | ORD-REQ-20261006-100000002 |
| ord-order-manage-search | Ô tìm theo mã đơn | staff, admin | Nhập mã đơn để lọc | ORD-REQ-20261006-100000002 |
| ord-order-manage-filter-status | Chọn lọc theo trạng thái | staff, admin | Chọn trạng thái để lọc | ORD-REQ-20261006-100000002 |
| ord-order-manage-table | Bảng đơn | staff, admin | - | ORD-REQ-20261006-100000002 |
| ord-order-manage-row | Dòng đơn | staff, admin | - | ORD-REQ-20261006-100000002 |
| ord-order-manage-status | Badge trạng thái đơn trong dòng | staff, admin | - | ORD-REQ-20261006-100000002 |
| ord-order-manage-pagination | Thanh phân trang | staff, admin | Bấm số trang, trước, sau | ORD-REQ-20261006-100000002 |
| ord-order-manage-ship | Nút Đã giao cho vận chuyển (chỉ đơn paid hoặc confirmed) | staff, admin | Bấm để đánh dấu đơn shipped | ORD-REQ-20261006-100000002 |
| ord-order-manage-ship-error | Banner lỗi khi đánh dấu bị từ chối hoặc xung đột | staff, admin | - | ORD-REQ-20261006-100000002 |
| ord-order-manage-ship-success | Thông báo đã đánh dấu thành công | staff, admin | - | ORD-REQ-20261006-100000002 |
| ord-order-manage-loading | Vùng khung chờ khi đang tải | staff, admin | - | ORD-REQ-20261006-100000002 |
| ord-order-manage-error | Banner lỗi tải danh sách | staff, admin | - | ORD-REQ-20261006-100000002 |
| ord-order-manage-retry | Nút Thử lại trong banner lỗi | staff, admin | Bấm để tải lại | ORD-REQ-20261006-100000002 |
| ord-order-manage-cancel | Nút Hủy đơn trong dòng (chỉ đơn pending, confirmed, paid) | admin | Bấm để mở hộp xác nhận hủy | ORD-REQ-20261006-100000003 |
| ord-order-manage-cancel-dialog | Hộp xác nhận hủy | admin | - | ORD-REQ-20261006-100000003 |
| ord-order-manage-cancel-refund-note | Dòng "Sẽ tạo yêu cầu hoàn tiền" (đơn đã thanh toán) | admin | - | ORD-REQ-20261006-100000003 |
| ord-order-manage-cancel-confirm | Nút Hủy đơn trong hộp | admin | Bấm để gửi yêu cầu hủy | ORD-REQ-20261006-100000003 |
| ord-order-manage-cancel-dismiss | Nút Không trong hộp | admin | Bấm để đóng hộp | ORD-REQ-20261006-100000003 |
| ord-order-manage-cancel-error | Banner lý do hủy bị từ chối | admin | - | ORD-REQ-20261006-100000003 |
