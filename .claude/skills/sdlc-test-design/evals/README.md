# Kiểm thử skill sdlc-test-design

Cùng khung với `sdlc-research/evals/README.md`. Phủ và tham chiếu (requirement × mục kịch bản, mối đe dọa SEC, testid theo role) do `check-tests.mjs`; chất lượng test (assert cụ thể, dữ liệu mồi, giá trị biên) do rubric.

## Cách chạy một ca
1. Chép `ordering/fixture/spec/` ra thư mục tạm (nền, 5 requirement, thiết kế kỹ thuật và màn hình của ORD, INV đã có; chưa có test).
2. Chạy skill `sdlc-test-design` cho ORD rồi INV (xem `ordering/input.md`).
3. Mỗi lần: `check-tests.mjs spec/ --strict` phải qua, `check-spec.mjs` qua, md5 các file fixture không đổi.
4. Chấm `golden.md` và `traps.md` bằng subagent độc lập, không cho xem `SKILL.md`.

## Tiêu chí đạt
- Hai script qua ở cả 3 lần. 100% MUST ở ít nhất 2/3 lần. Mọi bẫy bị bắt ở cả 3 lần.

## Đối chiếu
Prompt trần có sẵn `check-tests.mjs`. Nếu chỉ khác khuôn tài liệu thì giá trị nằm ở script.

Fixture ghép từ đầu ra thật của `sdlc-tech-design` (lần 1) và `sdlc-ui-ux` (lần 1) trên ca `ordering`, nên có thể còn `[OPEN]` ở phần thiết kế.
