# Quy ước ID

Định dạng: `{EPIC}-{TYPE}-{YYYYMMDD}-{hhmmssSSS}`

Ví dụ: `CHK-REQ-20261005-143012123`

| Phần | Ý nghĩa |
|---|---|
| EPIC | Tiền tố epic 2-4 chữ in hoa (AUTH, USR, PRD, INV, CRT, PRM, CHK, ORD, PAY, SHP, NTF, REV, DSH) |
| TYPE | REQ, FLOW, TC (test case), API, DB, SEC, E2E |
| Ngày + giờ | Giờ-phút-giây-mili giây, **viết liền, không dùng dấu `:`** (dấu `:` không hợp lệ trong tên file Windows) |

## Vì sao theo thời gian
Nhiều người làm song song, nên không thể dùng số thứ tự toàn cục (hai người cùng lấy số 042). Thời gian đến mili giây gần như không trùng.

## Đánh đổi
- ID dài, khó nhớ. Trong tài liệu hãy kèm tiêu đề ngắn bên cạnh ID.
- Hai người vẫn có thể trùng nếu sinh cùng một mili giây. `new-id.mjs` kiểm tra thư mục `spec/` và sinh lại nếu trùng, nhưng không thấy được nhánh git của người khác. `check-spec.mjs` sẽ báo ID trùng khi merge.
- Luôn dùng script, không để model tự điền ID.
