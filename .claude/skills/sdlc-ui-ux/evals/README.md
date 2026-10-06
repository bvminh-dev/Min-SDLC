# Kiểm thử skill sdlc-ui-ux

Cùng khung với `sdlc-research/evals/README.md`. Phần nối spec (covers, role, testid, trạng thái `lỗi`) do `check-ui.mjs`; phần giao diện (phương án wireframe, trạng thái hợp lý) do rubric.

## Cách chạy một ca
1. Chép `ordering/fixture/spec/` ra thư mục tạm.
2. Chạy skill `sdlc-ui-ux` cho epic ORD, rồi INV (xem `ordering/input.md`). Cổng hỏi người dùng không trả lời được trong lúc chạy tự động: skill phải **chọn phương án khuyến nghị và ghi rõ đã chọn gì**.
3. Mỗi lần: `check-ui.mjs spec/ --epic <EPIC>` phải qua; `testids.md` do script sinh; md5 các file fixture không đổi.
4. Chấm `golden.md` và `traps.md` bằng subagent riêng, không cho xem `SKILL.md`.

## Tiêu chí đạt
- Script qua ở cả 3 lần, không sửa file `approved`.
- 100% MUST ở ít nhất 2/3 lần; mọi bẫy bị bắt ở cả 3 lần.

## Đối chứng
Prompt trần (có `check-ui.mjs`, có submodule evon trong `references/`). Nếu kết quả không khác đáng kể thì giá trị nằm ở script.
