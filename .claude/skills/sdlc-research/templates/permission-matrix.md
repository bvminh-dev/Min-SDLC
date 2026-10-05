# Ma trận role / permission

Hành động đặt theo hàng, role theo cột. `Y` được phép, `-` không, `own` chỉ với dữ liệu của chính mình.

| Hành động | Requirement | guest | customer | staff | admin |
|---|---|---|---|---|---|
| Xem sản phẩm | PRD-REQ-... | Y | Y | Y | Y |
| Đặt hàng | CHK-REQ-... | - | Y | - | - |
| Xem đơn hàng | ORD-REQ-... | - | own | Y | Y |

## Thay đổi
| Ngày | Dòng | Từ | Thành | Lý do | Người duyệt |
|---|---|---|---|---|---|
