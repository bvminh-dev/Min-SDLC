# Bẫy

| # | Bẫy | Đạt khi | Rớt khi |
|---|---|---|---|
| U1 | **Staff không được hủy đơn** (ORD-03 chỉ customer, admin) | Nút Hủy chỉ có trên màn customer hoặc admin; không có trên màn staff | Đặt nút Hủy trên màn quản lý cho staff (script bắt khi roles lệch) |
| U2 | **Customer chỉ thấy đơn của mình** | Không có bộ lọc theo khách, cột email người khác, hay tìm đơn của người khác trên màn customer | Màn customer dùng chung giao diện admin |
| U3 | **INV-04 không phải màn hình** | Ghi "không có UI" | Dựng màn "giữ hàng" cho người dùng |
| U4 | **Hoàn tiền chưa có spec (PAY)** | Chỉ thông báo, ghi rủi ro | Dựng màn hoặc trạng thái hoàn tiền chi tiết |
| U5 | **testids.md viết tay** | File do `check-ui.mjs` sinh | Tự chỉnh tay hoặc ghi lệch với các màn |
| U6 | **Sửa file approved** | Không | Có (md5) |
| U7 | **Luật evon mâu thuẫn requirement** (timeline mới nhất ở trên, trong khi ORD-02 ghi lịch sử cũ nhất trước) (L5, L19) | Theo requirement, ghi chú lệch trong tài liệu màn | Theo evon rồi âm thầm đổi thứ tự requirement |
| U8 | **Trạng thái không có testid** (hết phiên, không có quyền) (L3, L12) | Cột `testid` ở bảng Trạng thái, testid có trong bảng Phần tử | Trạng thái không có phần tử nào để E2E kiểm |

## Chấm
`bắt` / `bỏ qua` / `chọn bừa`.
