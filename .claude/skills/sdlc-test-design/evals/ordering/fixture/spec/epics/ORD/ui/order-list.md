---
screen: order-list
epic: ORD
status: draft
covers: [ORD-REQ-20261006-100000001]
roles: [customer]
---
# Danh sách đơn của tôi

Brief (U1/U2, mặc định đã ok, chưa có người xác nhận): sản phẩm là cửa hàng online (ADR-002: Next.js + TypeScript), người dùng là customer đã đăng nhập, việc chính là xem lại đơn đã đặt và mở chi tiết. Đến để làm gì: tìm lại một đơn. So sánh bằng: mã đơn, ngày đặt, trạng thái, tổng tiền (đúng thứ tự nổi bật). Hành động cuối: mở chi tiết. Quy ước loại sản phẩm: danh sách một cột, mới nhất trước, trạng thái bằng badge (theo trí nhớ, cần kiểm). Chưa có codebase giao diện nên chưa chạy audit stack; mặc định phong cách flat, copy tiếng Việt.

## Wireframe
Phương án đã chọn: B (danh sách một cột, mỗi đơn một dòng, phân trang dưới). Đây là phương án khuyến nghị được chọn mặc định vì không thể hỏi người dùng ở cổng chọn wireframe; chưa có người chọn.

Ba phương án đã cân: A lưới card (loại: dữ liệu chỉ có tổng tiền và số dòng hàng, không có ảnh để làm card đáng giá); B danh sách một cột (chọn: việc chính là dò theo mã và trạng thái, 20 đơn mỗi trang đọc tốt nhất ở dạng dòng); C chia đôi danh sách và panel chi tiết (loại: chi tiết đơn có thể dài, và có trường hợp đường dẫn trực tiếp tới chi tiết). Đánh đổi của B: chi tiết nằm ở màn riêng (`order-detail`), thêm một lần bấm.

```
+--------------------------------------------------------------+
| Đơn của tôi                                                  |
+--------------------------------------------------------------+
| #ORD-1043   06/10/2026   [Đã thanh toán]      1.250.000 đ  > |
| #ORD-1031   02/10/2026   [Đã giao vận chuyển]   390.000 đ  > |
| #ORD-1002   28/09/2026   [Đã hủy]               120.000 đ  > |
+--------------------------------------------------------------+
|                  < 1 2 3 >   (20 đơn mỗi trang)              |
+--------------------------------------------------------------+
```

## Trạng thái
Mỗi dòng: một trạng thái giao diện, lấy từ Given/When/Then của requirement. Bắt buộc có `lỗi`.

| Trạng thái | Trông ra sao | Requirement |
|---|---|---|
| có dữ liệu | Các dòng đơn, mới nhất trước, mỗi trang tối đa 20 đơn, chỉ đơn của chính mình (BR1, Luồng chính) | ORD-REQ-20261006-100000001 |
| rỗng | "Bạn chưa có đơn nào" kèm nút Mua sắm quay lại cửa hàng (Ca biên) | ORD-REQ-20261006-100000001 |
| đang tải | Khung xám 5 dòng đúng hình dòng đơn (chuẩn giao diện chung, không có trong Given/When/Then, xem báo cáo) | ORD-REQ-20261006-100000001 |
| lỗi | Banner "Không tải được danh sách đơn" kèm nút Thử lại | ORD-REQ-20261006-100000001 |

## Phần tử
testid dạng `<epic>-<màn>-<phần-tử>` (chữ thường, nối bằng `-`), duy nhất trong cả `spec/`.

| testid | Phần tử | Role | Hành động | Requirement |
|---|---|---|---|---|
| ord-order-list-title | Tiêu đề "Đơn của tôi" | customer | - | ORD-REQ-20261006-100000001 |
| ord-order-list-table | Vùng danh sách đơn | customer | - | ORD-REQ-20261006-100000001 |
| ord-order-list-row | Dòng đơn (mã, ngày, tổng tiền) | customer | Bấm để mở chi tiết đơn | ORD-REQ-20261006-100000001 |
| ord-order-list-status | Badge trạng thái của đơn trong dòng | customer | - | ORD-REQ-20261006-100000001 |
| ord-order-list-pagination | Thanh phân trang | customer | Bấm số trang, trước, sau | ORD-REQ-20261006-100000001 |
| ord-order-list-loading | Vùng khung chờ khi đang tải | customer | - | ORD-REQ-20261006-100000001 |
| ord-order-list-empty | Vùng trạng thái rỗng | customer | - | ORD-REQ-20261006-100000001 |
| ord-order-list-empty-shop | Nút Mua sắm trong trạng thái rỗng | customer | Bấm để về trang mua sắm | ORD-REQ-20261006-100000001 |
| ord-order-list-error | Banner lỗi | customer | - | ORD-REQ-20261006-100000001 |
| ord-order-list-retry | Nút Thử lại trong banner lỗi | customer | Bấm để tải lại | ORD-REQ-20261006-100000001 |
