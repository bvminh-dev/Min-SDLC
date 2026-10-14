# Bẫy hồi quy (từ bài học code)

Mỗi hàng là một ca hồi quy từ `spec/lessons/`; không xóa hàng cũ. Ca `ordering/traps.md` (X1..) giữ nguyên.

| # | Bẫy | Đạt khi | Rớt khi |
|---|---|---|---|
| T1 | **Giá trị xấu cho chuỗi, độ dài và URL** (L62, L113, L126: `\ud800` làm API 500; emoji ở biên `char_length`; CHECK `^/[A-Za-z0-9/_-]*$` cho qua `//2130706433`) | Danh sách biên có `\ud800`, NUL, ký tự điều khiển, `ſ`, `ı`, Kelvin; ca emoji ở đúng biên N và N cộng 1; bộ URL xấu `//host` không chấm, `//2130706433`, `/\evil`, `/a:b` | Ca "từ chối URL ngoài" chỉ thử `//evil.test`; không có chuỗi Unicode lạ hay emoji |
| T2 | **Job nền không có TC** (L61, L123: job dọn ảnh xóa mọi mồ côi một lượt; `attempts` vượt CHECK trần 3 làm kẹt cả hàng đợi) | Mỗi mục "job" có TC nhắc job; "giới hạn lô", "hạn thời gian", "idempotent" nằm trong một Then; TC dựng dòng ở đúng trần rồi chạy job | Test của job gắn vào TC khác; chỉ kiểm bộ đếm ở đường thành công và thất bại |
| T3 | **Bước E2E đòi giá trị mà ui chặn** (L64: ô chọn cha loại trừ chính nó, E2E yêu cầu chọn đúng nó) | Bước ghi "gọi trực tiếp API" hoặc chuyển `sdlc-impact` đổi ui; mỗi testid thao tác được theo mô tả ui | E2E chọn giá trị mà ghi chú ui không cho chọn |
| T4 | **Ca `lỗi` đổi nhiều nhân tố cùng lúc** (L76: `user_id` ngẫu nhiên làm nhánh `released` không bao giờ chạm; ngưỡng cho phép gấp đôi chu kỳ vẫn xanh) | Mỗi ca `lỗi` đổi MỘT nhân tố, ghi ở When; ngưỡng không chùng hơn đại lượng nó bảo vệ | TC ghi nhiều điều kiện lỗi trong một ca; `timeoutMs < every + 55_000` |
| T5 | **Bảng quy tắc chỉ phủ vài ô** (L78: bảng chuyển trạng thái, `payment_status` theo event, CASE hủy; 7 đột biến lọt) | TC phủ MỌI ô; ô không hợp lệ kiểm "không đổi, không phát event, có log"; ô không ghi nêu TC khác phủ | Vài ca đại diện, không nói ô còn lại |
| T6 | **Trần tài nguyên chỉ thử vượt một đơn vị** (L80: `generate_series` 15 giây tới `statement_timeout`) | Hai ca: vượt một đơn vị bị từ chối; vượt gấp một triệu lần, từ chối dưới 2 giây và trước khi tốn tài nguyên | Chỉ ca vượt một đơn vị |
| T7 | **Cổng `version`/`last_activity_at` không có bảng theo thao tác ghi** (L110: bỏ `bump` ở xóa dòng lọt cả 111 đột biến) | Bảng test mỗi hàng một thao tác ghi, kể cả thao tác không đổi gì; hai cột "version đổi bao nhiêu", "last_activity_at đổi không" | Chỉ kiểm `version` ở vài thao tác |
| T8 | **Hạn mức theo lời gọi ngoài chỉ test tuần tự** (L125: hai `sendDue` song song cùng thấy 29 và gửi thành 31) | TC hai lượt chạy song song với lời gọi chậm, khẳng định tổng không vượt hạn mức | Chỉ test một lượt chạy |
| T9 | **Quy tắc "xét theo thứ tự" thiếu ca hai bước cùng đúng** (L132: mã trả `window_expired` thay `not_delivered`) | Bảng quyết định, mỗi cặp bước cùng đúng có TC; số TC không ít hơn số bước | Mỗi TC chỉ một điều kiện đúng; `check-tests` cảnh báo mà bỏ qua |
| T10 | **Số giây cứng và "bản giả" trong TC** (L138: mười ca `YẾU` vì chờ 5 giây thật, "PAY giả trả lời sau 6 giây") | Hạn ghi bằng tên biến cấu hình, mặc định kiểm ở một TC cấu hình; gài lỗi hay chậm bằng `jest.spyOn` trên lớp thật | TC ghi "sau 6 giây" hoặc "bản giả của giao diện đọc" |
| T11 | **Tham số thiếu thì nhận mặc định, chỉ có một tham số** (L139: URL chỉ có `to` làm ô Từ lệch khoảng máy chủ dùng) | TC giao diện riêng cho ca chỉ có `to` (hay một tham số): ô nhập khớp `from`, `to` của phản hồi; có dòng đột biến cho hàm giao diện sao luật mặc định | Chỉ test ca có đủ hai tham số |
| T12 | **Chữ ký ngoài chỉ kiểm bằng hàm ký của mã** (L99: 15 dòng `YẾU` ở PAY; hiểu sai tài liệu VNPay thì mọi test vẫn xanh) | Ít nhất một TC với vectơ HẰNG SỐ tính ngoài mã hoặc của nhà cung cấp | Mọi chữ ký của test đều đi qua hàm ký của mã |

## Chấm
`bắt` / `bỏ qua` / `chọn bừa`.
