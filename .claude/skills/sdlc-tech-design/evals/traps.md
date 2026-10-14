# Bẫy hồi quy (từ bài học code)

Mỗi hàng là một ca hồi quy từ `spec/lessons/`; không xóa hàng cũ. Bẫy của ca `ordering` (H1..) ở `ordering/traps.md`.

| # | Bẫy | Đạt khi | Rớt khi |
|---|---|---|---|
| D1 | **Bảng chỉ-thêm sắp theo `created_at`** (L66: StockMovement ghi `now()` là giờ bắt đầu giao dịch, lịch sử hiện số dư ngược thứ tự thật) | Có cột `seq` hoặc ghi rõ `clock_timestamp()` làm giờ ghi; check cảnh báo, lỗi ở `--strict`/`kit_version: 4` | Chỉ mục và thứ tự đọc theo `created_at` mặc định `now()` |
| D2 | **Tên lớp tự đặt ở tài liệu API** (L68: `InventoryService.reserve` trong khi mã là `InventoryApi`) | Bảng Giao diện module ghi `InventoryApi.reserve`; tài liệu API gọi đúng tên lớp trong bảng | Tài liệu API gọi `<Tên>Service.<phương thức>` khác tên lớp của bảng |
| D3 | **Đối tượng truyền giữa module không có ánh xạ khóa** (L83: bản chụp có `district`, ORD đóng đối tượng nên từ chối mọi đơn) | Bảng gọi module của bên gọi ghi ánh xạ từng khóa và khóa bị bỏ; bên nhận ghi tập khóa đóng | Truyền nguyên bản chụp, không nêu khóa thừa hay thiếu |
| D4 | **Biến môi trường chỉ có ở tài liệu API** (L106: tám biến PAY không có ở ADR-007) | Mọi biến nêu ở API epic có trong bảng biến của `architecture.md`; thiếu thì chuyển `sdlc-impact` sửa ADR | Biến chỉ nằm ở tài liệu API |
| D5 | **Miền bên nhận nhỏ hơn số lớn nhất bên gọi** (L114: tạm tính 4,95 nghìn tỷ, SHP nhận tới 10 tỷ, `RangeError` thành 503) | Mục Giao tiếp giữa module có dòng so miền, nêu cắt, từ chối hay nâng trần khi lớn hơn | Không nêu hai trần |
| D6 | **Endpoint có giới hạn tần suất thiếu 429 ở cột Lỗi** (L121: CHK-API ba endpoint) | Cột Lỗi có 429, hoặc ghi "không giới hạn tần suất" kèm lý do; `check-tech-design` cảnh báo; TC bậc giới hạn có ca 429 | Cột Lỗi chỉ 401, 403, 404, 409, 503 |
| D7 | **Hạn mức theo lời gọi ngoài và đường dẫn nội bộ** (L125: hai job song song cùng thấy 29 và gửi thành 31; L126: CHECK cho qua `//intranet`) | Nêu việc đang bay được đếm thế nào (đặt chỗ trước khi gọi, dấu `sending`); đường dẫn nội bộ dùng `^/([A-Za-z0-9_-][A-Za-z0-9/_-]*)?$` | Spec hứa khóa bảo đảm mà `sent` chỉ ghi sau lời gọi; biểu thức `^/[A-Za-z0-9/_-]*$` |
| D8 | **Tiền đã vào cổng mà thông báo mất, ở trạng thái cuối** (L100: Payment `expired` bị đối soát bỏ qua, tiền đã thu không có đường phát hiện) | Bảng trạng thái nhân "tiền đã vào/ra, thông báo mất"; mỗi ô có đường phát hiện hoặc ở Rủi ro còn lại có người chấp nhận | Có ô trống mà BR bắt đối soát bỏ qua trạng thái đó |

## Chấm
`bắt` / `bỏ qua` / `chọn bừa`.
