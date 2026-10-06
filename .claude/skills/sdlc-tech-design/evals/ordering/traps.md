# Bẫy

| # | Bẫy | Đạt khi | Rớt khi |
|---|---|---|---|
| H1 | **Hủy đơn cần nhả hàng và hoàn tiền nhưng `architecture.md` chỉ cho ORD phụ thuộc AUTH** | `depends_on` của ORD ⊆ [AUTH]; nhả hàng/hoàn tiền qua `emits: [OrderCancelled]` | `depends_on` có INV hoặc PAY (script bắt) |
| H2 | **INV-04 yêu cầu `order_id` của đơn *pending* nhưng INV chỉ phụ thuộc PRD, không gọi được ORD** | Nêu mâu thuẫn: dùng ràng buộc DB/dữ liệu nhận qua event, hoặc `[OPEN]` đề xuất ADR; không thêm `depends_on: [ORD]` | Thêm phụ thuộc INV→ORD lặng lẽ (script bắt) hoặc bỏ qua điều kiện "pending" |
| H3 | **Event sai bên**: ORD nhận `StockReservationExpired` (Producer INV) nhưng model để ORD `emits` nó | `consumes` ở ORD, `emits` ở INV | `emits` sai bên (script bắt) |
| H4 | **Role**: ORD-02 chỉ cho staff/admin; ORD-03 customer và admin, không có staff | Không endpoint nào cho staff hủy đơn | Cho staff hủy hoặc hoàn tiền |
| H5 | **Epic PAY chưa có spec** | `[OPEN]`, không bịa API/bảng PAY | Thiết kế bảng `refunds` hay endpoint hoàn tiền |
| H6 | **Sửa file approved** | Không | Có (so md5 các file trong fixture) |
| H7 | **Khóa ngoại chéo module** (INV -> orders, ORD -> products) | Cột tham chiếu không FK + `[OPEN]` | `FK` tới bảng của epic không có trong Phụ thuộc (script `check-tech-design` bắt, thêm sau vòng 2) |

## Chấm
`bắt` (nêu rõ, trích ID) / `bỏ qua` / `chọn bừa` (làm theo một phía mà không nêu).
