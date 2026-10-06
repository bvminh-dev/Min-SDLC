# Kết quả chạy eval sdlc-test-design (2026-10-06)

Ca `ordering` (ORD, INV). 3 lần có skill (tt1-3) + 2 lần prompt trần (ttb1-2), **chấm bởi subagent độc lập** (`/tmp/eval2/grade-tt.md`, không lưu trong repo). Hai lần trần đều đọc `templates/tc.md` và `e2e.md` của skill để biết khuôn, nên đối chứng này **bớt "trần"** hơn mong muốn.

## Kiểm cứng
`check-tests.mjs --strict` và `check-spec.mjs` qua ở cả 5 lần; không lần nào sửa file ngoài `tests/` (md5).

| | tt1 | tt2 | tt3 | trần 1 | trần 2 |
|---|---|---|---|---|---|
| TC / E2E (ORD, INV) | 31 / 7 | 45 / 14 | 37 / 10 | 46 / 13 | 43 / 17 |

## Golden / bẫy
- G1-G4, S1-S2, X1-X5: **đạt ở cả 5 lần**. G1, G2 do script; G3 (E2E nhiều màn, testid đúng role) cả 5; G4 (assert cụ thể): tranh món cuối (khả dụng 1, hai đơn cùng cần 1), đơn người khác trả 404 giống đơn không tồn tại, điều chỉnh dưới lượng đang giữ bị 409. Không lần nào assert hành vi PAY chưa có spec; không lần nào dùng testid tự đặt cho giữ hàng.
- **Khác biệt**: mốc hết hạn 15 phút (trần dùng 14:59/15:01, skill dùng 14:59/15:00, điểm chưa chốt); G5 (nêu mâu thuẫn role `customer` của INV-04) có ở tt1 và cả hai trần trong tài liệu; S3 (testid còn thiếu) chỉ trần 1 ghi vào tài liệu; E2E liên epic chỉ trần 2. Phần lớn "chỉ có ở báo cáo cuối" không đối chiếu được vì chấm trên file.
- **TC sai/yếu**: tt3 assert "giữ tối đa 16 phút", mâu thuẫn BR2 "tối đa 15 phút" mà không đánh dấu lệch spec (lỗi lệch spec rõ nhất, script không bắt được); tt1 một E2E bấm hủy đơn `shipped` trái `testids.md`; trần 1 có 2 TC gắn tạm vào requirement không có kịch bản tương ứng (có ghi chú).

## Kết luận
- Skill và prompt trần cho kết quả ngang nhau (giống research, impact, tech-design): phần đảm bảo nằm ở `check-tests.mjs`; model viết test tốt nếu được bảo đọc spec.
- Giá trị đo được của skill nằm ở khuôn và bước checklist; với trần đã đọc khuôn thì không khác biệt đáng kể.
- Lỗi lọt qua script: assert lệch số liệu với requirement (16 vs 15 phút). Khó kiểm bằng script (số nằm trong văn xuôi); ứng viên cho `retro`.
- Hạn chế: chấm trên file nên bỏ sót phần báo cáo cuối; 5 lần; một ca; fixture ghép từ đầu ra của hai skill khác nên còn `[OPEN]`.
