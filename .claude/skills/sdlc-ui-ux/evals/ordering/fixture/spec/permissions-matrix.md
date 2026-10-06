# Ma trận role / permission

`Y` được phép, `-` không, `own` chỉ với dữ liệu của chính mình.

| Hành động | Requirement | guest | customer | staff | admin |
|---|---|---|---|---|---|
| Xem đơn của tôi | ORD-REQ-20261006-100000001 | - | own | - | - |
| Quản lý đơn | ORD-REQ-20261006-100000002 | - | - | Y | Y |
| Hủy đơn | ORD-REQ-20261006-100000003 | - | own | - | Y |
| Giữ hàng cho đơn | INV-REQ-20261006-100000004 | - | Y | - | - |
| Nhập kho và điều chỉnh | INV-REQ-20261006-100000005 | - | - | Y | Y |

## Thay đổi
| Ngày | Dòng | Từ | Thành | Lý do | Người duyệt |
|---|---|---|---|---|---|
