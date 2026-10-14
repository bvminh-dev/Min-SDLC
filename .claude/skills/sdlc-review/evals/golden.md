# Điểm kỳ vọng

## MUST
| # | Điểm |
|---|---|
| G1 | Chạy lại test độc lập và so với `test_result` của `report.md`; ghi kết quả thật |
| G2 | Bắt các lỗi gài B1-B5 (mỗi lỗi: kết quả `lệch` hoặc `chưa làm` đúng chỗ, bằng chứng `file:dòng` đúng) |
| G3 | Mọi `đạt` có bằng chứng đọc được (không `đạt` suông) |
| G4 | Mục Quyền: kiểm chặn ở server, không chỉ ẩn ở giao diện |
| G5 | `Việc còn thiếu` xếp theo mức nghiêm trọng, tóm tắt đúng các dòng `lệch` và `chưa làm` |

## SHOULD
| # | Điểm |
|---|---|
| S1 | Nêu rủi ro ngoài bảng (race, thiếu test) có bằng chứng |
| S2 | Thử biên ngoài đường vui và ghi kết quả: chuỗi biên và biến thể hoa/thường (R9), tải hỗn hợp và giới hạn đếm song song (R11, R12), khóa tra `__proto__` (R14), lỗi thường từ giao diện module khác kỳ vọng 500 (R16) |
| S3 | Đột biến có phần tự sinh (`--auto`) ngoài bảng tay; mỗi `lọt` có test hoặc lý do tương đương; không để lại `.restore.json` hay mã đột biến (R22 đến R24) |
| S4 | Review qua `kit_version: 4`: không chữ giữ chỗ, `reviewed_tree` 40 chữ số hex, bằng chứng đã dịch khi dòng đổi; sau khi sửa mã đã chạy lại bảng đột biến trùng tệp và toàn bộ `test_command` (R10, R17, R18) |
