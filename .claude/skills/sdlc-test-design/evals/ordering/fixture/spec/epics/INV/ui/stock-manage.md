---
screen: stock-manage
epic: INV
status: draft
covers: [INV-REQ-20261006-100000005]
roles: [staff, admin]
---
# Quản lý tồn kho

Brief (mặc định đã ok, chưa có người xác nhận): staff và admin tìm một sản phẩm, xem tồn kho (on_hand, đang giữ, khả dụng), nhập thêm hoặc điều chỉnh tồn kho kèm lý do. So sánh bằng: on_hand và lượng đang giữ (đứng cạnh nhau, vì điều chỉnh không được xuống dưới lượng đang giữ). Hành động cuối: Nhập kho, Điều chỉnh. Cả hai role dùng được mọi phần tử (INV-REQ-20261006-100000005 cho cả staff và admin).

Requirement `INV-REQ-20261006-100000004` (giữ hàng cho đơn pending) là chức năng hệ thống, không có màn ở epic INV.

## Wireframe
Phương án đã chọn: A (bảng sản phẩm một khối, mỗi dòng có hai nút Nhập kho và Điều chỉnh mở hộp thoại). Đây là phương án khuyến nghị được chọn mặc định vì không thể hỏi người dùng ở cổng chọn wireframe; chưa có người chọn.

Ba phương án đã cân: A bảng với hộp thoại (chọn: thao tác theo từng sản phẩm, số liệu hiện sẵn khi nhập số mới nên tránh nhập quá lượng đang giữ); B form nhập nhanh theo mã sản phẩm (loại: không thấy lượng đang giữ khi nhập); C chi tiết sản phẩm với tab Tồn kho (loại: epic PRD chưa có màn, tránh phụ thuộc). Đánh đổi của A: nhập hàng loạt nhiều sản phẩm phải làm từng dòng (cần requirement riêng nếu muốn nhập hàng loạt).

```
+---------------------------------------------------------------------+
| Quản lý tồn kho            [Tìm theo tên hoặc SKU____]              |
+---------------------------------------------------------------------+
| Sản phẩm        SKU      Tồn (on_hand)  Đang giữ  Khả dụng  Thao tác|
| Áo thun basic   TS-001        10            3         7   [Nhập][Chỉnh]|
| Giày chạy bộ    SH-042        10            8         2   [Nhập][Chỉnh]|
+---------------------------------------------------------------------+
|                      < 1 2 3 >                                      |
+---------------------------------------------------------------------+
Hộp Nhập kho:   Số lượng thêm [__]  Lý do [________]  [Hủy] [Nhập kho]
Hộp Điều chỉnh: Tồn mới [__] (không thấp hơn đang giữ: 8)  Lý do [____]  [Hủy] [Lưu]
```

## Trạng thái
Mỗi dòng: một trạng thái giao diện, lấy từ Given/When/Then của requirement. Bắt buộc có `lỗi`.

| Trạng thái | Trông ra sao | Requirement |
|---|---|---|
| có dữ liệu | Bảng sản phẩm với on_hand, đang giữ, khả dụng | INV-REQ-20261006-100000005 |
| đang tải | Khung xám 8 dòng đúng hình dòng bảng (chuẩn giao diện chung, không có trong Given/When/Then, xem báo cáo) | INV-REQ-20261006-100000005 |
| lỗi | Banner "Không tải được tồn kho" kèm nút Thử lại | INV-REQ-20261006-100000005 |
| nhập kho thành công | Hộp đóng, on_hand của dòng tăng đúng số vừa nhập (10 + 5 = 15), thông báo ngắn (Luồng chính; StockMovement do hệ thống ghi) | INV-REQ-20261006-100000005 |
| điều chỉnh bị từ chối vì dưới lượng đang giữ | Trong hộp hiện lỗi "Tồn mới (5) thấp hơn lượng đang giữ (8)"; hộp vẫn mở, giữ nguyên số đã nhập (Luồng lỗi) | INV-REQ-20261006-100000005 |
| thiếu lý do | Ô lý do viền lỗi, dòng "Nhập lý do"; không gửi (Ca biên) | INV-REQ-20261006-100000005 |

## Phần tử
testid dạng `<epic>-<màn>-<phần-tử>` (chữ thường, nối bằng `-`), duy nhất trong cả `spec/`.

| testid | Phần tử | Role | Hành động | Requirement |
|---|---|---|---|---|
| inv-stock-manage-title | Tiêu đề "Quản lý tồn kho" | staff, admin | - | INV-REQ-20261006-100000005 |
| inv-stock-manage-search | Ô tìm theo tên hoặc SKU | staff, admin | Nhập để lọc sản phẩm | INV-REQ-20261006-100000005 |
| inv-stock-manage-table | Bảng tồn kho | staff, admin | - | INV-REQ-20261006-100000005 |
| inv-stock-manage-row | Dòng sản phẩm | staff, admin | - | INV-REQ-20261006-100000005 |
| inv-stock-manage-on-hand | Ô on_hand của dòng | staff, admin | - | INV-REQ-20261006-100000005 |
| inv-stock-manage-reserved | Ô lượng đang giữ của dòng | staff, admin | - | INV-REQ-20261006-100000005 |
| inv-stock-manage-pagination | Thanh phân trang | staff, admin | Bấm số trang, trước, sau | INV-REQ-20261006-100000005 |
| inv-stock-manage-loading | Vùng khung chờ khi đang tải | staff, admin | - | INV-REQ-20261006-100000005 |
| inv-stock-manage-error | Banner lỗi tải | staff, admin | - | INV-REQ-20261006-100000005 |
| inv-stock-manage-retry | Nút Thử lại trong banner lỗi | staff, admin | Bấm để tải lại | INV-REQ-20261006-100000005 |
| inv-stock-manage-stock-in | Nút Nhập kho trong dòng | staff, admin | Bấm để mở hộp nhập kho | INV-REQ-20261006-100000005 |
| inv-stock-manage-stock-in-dialog | Hộp nhập kho | staff, admin | - | INV-REQ-20261006-100000005 |
| inv-stock-manage-stock-in-quantity | Ô số lượng nhập thêm | staff, admin | Nhập số lượng | INV-REQ-20261006-100000005 |
| inv-stock-manage-stock-in-reason | Ô lý do nhập kho | staff, admin | Nhập lý do | INV-REQ-20261006-100000005 |
| inv-stock-manage-stock-in-submit | Nút Nhập kho trong hộp | staff, admin | Bấm để gửi | INV-REQ-20261006-100000005 |
| inv-stock-manage-stock-in-cancel | Nút Hủy trong hộp nhập kho | staff, admin | Bấm để đóng hộp | INV-REQ-20261006-100000005 |
| inv-stock-manage-adjust | Nút Điều chỉnh trong dòng | staff, admin | Bấm để mở hộp điều chỉnh | INV-REQ-20261006-100000005 |
| inv-stock-manage-adjust-dialog | Hộp điều chỉnh | staff, admin | - | INV-REQ-20261006-100000005 |
| inv-stock-manage-adjust-quantity | Ô tồn mới | staff, admin | Nhập tồn mới | INV-REQ-20261006-100000005 |
| inv-stock-manage-adjust-reason | Ô lý do điều chỉnh | staff, admin | Nhập lý do | INV-REQ-20261006-100000005 |
| inv-stock-manage-adjust-reason-error | Dòng lỗi "Nhập lý do" | staff, admin | - | INV-REQ-20261006-100000005 |
| inv-stock-manage-adjust-error | Banner lỗi dưới lượng đang giữ | staff, admin | - | INV-REQ-20261006-100000005 |
| inv-stock-manage-adjust-submit | Nút Lưu trong hộp điều chỉnh | staff, admin | Bấm để gửi | INV-REQ-20261006-100000005 |
| inv-stock-manage-adjust-cancel | Nút Hủy trong hộp điều chỉnh | staff, admin | Bấm để đóng hộp | INV-REQ-20261006-100000005 |
| inv-stock-manage-success | Thông báo thành công sau nhập hoặc điều chỉnh | staff, admin | - | INV-REQ-20261006-100000005 |
