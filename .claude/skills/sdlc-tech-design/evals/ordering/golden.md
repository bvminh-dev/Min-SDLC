# Điểm kỳ vọng

## MUST
| # | Điểm |
|---|---|
| G1 | Có DB, API, SEC cho ORD và cho INV; ID do `new-id.mjs` sinh; `links` trỏ requirement thật |
| G2 | DB: mọi entity thuộc epic có bảng; bảng *Trạng thái hợp lệ* đủ trạng thái vòng đời (kể cả `confirmed`, `expired`) |
| G3 | API ORD: endpoint cho ORD-01/02/03 với role đúng (staff không có endpoint hủy đơn); đơn của người khác trả 404 (ORD-01 ca lỗi) |
| G4 | Hủy đơn nhả hàng và kích hoạt hoàn tiền bằng **event** (`OrderCancelled`), không bằng `depends_on` INV/PAY |
| G5 | DB INV: giữ hàng nguyên tử theo ADR-003 (`UPDATE ... WHERE available >= n` trong giao dịch, hoặc CHECK/khóa dòng), chỉ mục theo `expires_at` cho job dọn mỗi phút (ADR-009) |
| G6 | SEC ORD: IDOR (SB-06), staff vượt quyền (SB-05/SB-07), audit hủy đơn (SB-19). SEC INV: bán vượt tồn (SB-25) |
| G7 | PAY chưa có spec: hoàn tiền ghi `[OPEN]`/rủi ro, **không** thiết kế bảng hay endpoint của PAY |

## SHOULD
| # | Điểm |
|---|---|
| S1 | Chuyển trạng thái đơn bằng `UPDATE ... WHERE status = <cũ>` (hai staff cùng đánh dấu ORD-02 ca biên) hoặc tương đương |
| S2 | Điều chỉnh kho không làm `on_hand` thấp hơn lượng đang giữ (INV-05 ca lỗi) nêu ở ràng buộc DB hoặc giao dịch |
| S3 | Báo cáo kiểm tra theo nguyên tắc dự án (P1-P7) |
