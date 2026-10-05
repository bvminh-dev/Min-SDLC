# Kết quả chạy eval (2026-10-05)

Ca: epic Checkout. Chạy 3 lần có skill, 2-3 lần prompt trần (prompt trần có `check-spec.mjs`). Chấm bằng grep trên file đầu ra, chưa có người hoặc subagent đọc chấm nội dung.

## Vòng 1: bẫy lộ (T1-T4), 3 skill vs 1 trần
Cả 4 lần nêu đủ 4 bẫy. Không phân biệt được.

## Vòng 2: thêm bẫy ẩn (H1-H3), 3 skill vs 2 trần
| | Skill (3 lần) | Trần (2 lần) |
|---|---|---|
| H1 vòng phụ thuộc reserve/create order | nêu 3/3, flow đặt tạo đơn trước | nêu 2/2 |
| H2 phiên 10 phút vs thanh toán | nêu 3/3 | nêu 2/2 |
| H3 staff đặt hộ vs ma trận | nêu 3/3, ma trận giữ nguyên | nêu 2/2, ma trận giữ nguyên |
| Sửa file approved | 0 | 0 |
| ID | do `new-id.mjs` sinh | tự đặt tuần tự theo mẫu fixture |

## Kết luận
- Với model hiện tại, **chỉ cần đọc spec là đủ để phát hiện xung đột**; skill chưa chứng minh được lợi thế ở khâu này.
- Khác biệt đo được hiện chỉ là hình thức: ID và định dạng `[OPEN]`/`questions.md`. Phần này có thể do script/hook bảo đảm.
- **Thiên lệch eval:** fixture chứa sẵn 7 requirement mẫu nên prompt trần "bắt chước" được định dạng. Chưa thử epic đầu tiên (không có mẫu).
- G2 (giá lệch) và G10 (thứ tự áp coupon, làm tròn) chưa phân biệt được; cần người hoặc subagent chấm nội dung.
