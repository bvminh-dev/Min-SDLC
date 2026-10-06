---
screen: order-list
epic: ORD
status: draft
covers: [ORD-REQ-20261006-100000001]
roles: [customer]
---
# Danh sách đơn hàng

## Wireframe
Phương án đã chọn: B (danh sách một cột có bộ lọc trạng thái). Lý do: ...

```
(wireframe ASCII hoặc mermaid của phương án đã chọn)
```

## Trạng thái
Mỗi dòng: một trạng thái giao diện, lấy từ Given/When/Then của requirement. Bắt buộc có `lỗi`.

| Trạng thái | Trông ra sao | Requirement |
|---|---|---|
| đang tải | Khung xám 5 dòng | ORD-REQ-20261006-100000001 |
| rỗng | "Chưa có đơn nào" kèm nút Mua sắm | ORD-REQ-20261006-100000001 |
| lỗi | Banner lỗi kèm nút Thử lại | ORD-REQ-20261006-100000001 |

## Phần tử
testid dạng `<epic>-<màn>-<phần-tử>` (chữ thường, nối bằng `-`), duy nhất trong cả `spec/`. Cột Role: các role thấy hoặc dùng được phần tử, cách nhau bởi dấu phẩy; phải nằm trong `roles` của màn **và** của requirement mà phần tử phục vụ (màn dùng chung nhiều role thì phần tử chỉ dành cho một role ghi đúng role đó, ví dụ nút Hủy chỉ admin). Cột Requirement phải nằm trong `covers`.

| testid | Phần tử | Role | Hành động | Requirement |
|---|---|---|---|---|
| ord-order-list-row | Dòng đơn | customer | Bấm để mở chi tiết | ORD-REQ-20261006-100000001 |
| ord-order-list-error | Banner lỗi | customer | - | ORD-REQ-20261006-100000001 |
