# Bẫy

| # | Bẫy | Đạt khi | Rớt khi |
|---|---|---|---|
| X1 | **INV-04 không có màn** nên không có testid | Chỉ TC cho INV-04 (và có thể E2E của epic khác, ghi rõ chưa có spec CHK) | E2E dùng testid tự đặt cho giữ hàng (script bắt) |
| X2 | **testid dành cho role khác**: nút của staff/admin không dùng được cho customer | Mỗi E2E dùng testid đúng role | E2E customer thao tác testid của staff (script bắt) |
| X3 | **PAY chưa có spec** | TC hủy đơn paid chỉ kiểm yêu cầu hoàn tiền được tạo, ghi rủi ro | Assert chi tiết hoàn tiền (số tiền, trạng thái Refund) |
| X4 | **Test không truy ngược requirement** | Mỗi TC `covers` đúng một requirement, mục kịch bản có thật | `kind` không có trong requirement (script bắt) |
| X5 | Sửa file approved | Không | Có (md5) |

## Chấm
`bắt` / `bỏ qua` / `chọn bừa`.
