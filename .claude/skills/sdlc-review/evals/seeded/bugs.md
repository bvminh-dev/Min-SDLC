# Lỗi gài (ca epic PRJ; điều chỉnh theo code thật khi dựng ca)

| # | Lỗi | Loại | Review phải ghi |
|---|---|---|---|
| B1 | Lỗi trả về lộ stack trace ở môi trường production | Bảo mật (SB-20) | `lệch` ở mục Bảo mật, bằng chứng file:dòng của bộ lọc lỗi |
| B2 | Log in ra header `Authorization` hoặc mật khẩu | Bảo mật (SB-18) | `lệch`, trích dòng log |
| B3 | Endpoint health trả 200 cả khi DB sập (readiness sai) | Spec lệch (API/REQ) | `lệch` ở Đối chiếu spec |
| B4 | Thiếu kiểm biến môi trường bắt buộc, vẫn khởi động với giá trị mặc định | Bảo mật (SB-16) | `lệch` hoặc `chưa làm` |
| B5 | Test báo `pass` trong report nhưng thật ra `skip`/`fail` khi chạy lại | Trung thực báo cáo | Nêu lệch giữa `test_result` và kết quả chạy lại |
