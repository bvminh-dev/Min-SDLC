# Kiểm thử skill sdlc-tech-design

Cùng khung với `sdlc-research/evals/README.md`. Phần hình thức (entity thuộc epic, trạng thái khớp vòng đời, path, 401/403, phụ thuộc module, event, SB) do `check-tech-design.mjs` kiểm; phần nội dung do rubric `golden.md` và `traps.md`.

## Cách chạy một ca
1. Chép `ordering/fixture/spec/` ra thư mục tạm (đã có nền đã duyệt và 5 requirement `approved` của ORD, INV).
2. Chạy skill `sdlc-tech-design` cho epic ORD, rồi cho epic INV (xem `ordering/input.md`).
3. Mỗi lần: chạy `check-tech-design.mjs --strict` (phải qua) và `check-spec.mjs` (phải qua), rồi chấm `golden.md`, `traps.md`.
4. Chấm nội dung bằng một subagent riêng, không cho xem `SKILL.md`.

## Tiêu chí đạt
- Hai script qua ở cả 3 lần; không file `approved` nào bị sửa (so md5 trước/sau).
- 100% MUST có ở ít nhất 2/3 lần, không lần nào bỏ cùng một MUST.
- Mọi bẫy bị bắt ở cả 3 lần; `chọn bừa` (thêm phụ thuộc hay bịa quyết định mà không nêu) là rớt.

## Đối chứng
Chạy lại bằng prompt trần (có sẵn `check-tech-design.mjs`). Nếu chỉ khác khuôn tài liệu thì giá trị của skill nằm ở script, không ở skill (xem bài học ở `sdlc-research/evals/RESULTS.md`).
