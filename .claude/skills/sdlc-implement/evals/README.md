# Kiểm thử skill sdlc-implement

Cùng khung với `sdlc-research/evals/README.md`. Truy vết (task, test case, file test chứa ID, mục Lệch spec) do `check-report.mjs`; code đúng spec và test thật sự pass do rubric và **chạy lại test**.

Khác các skill trước: ca này cần **code thật**, nên đầu vào là một epic đã approved đủ requirement, thiết kế, màn, test và khung dự án (ADR-002). Ca đầu: epic `PRJ` (nền kỹ thuật: ít phụ thuộc nhất), xem `prj/input.md`.

## Cách chạy một ca
1. Nhánh git sạch có khung dự án. Ghi md5 của `spec/` trước.
2. Chạy skill `sdlc-implement` cho epic trong `input.md`. Chạy 3 lần trên 3 nhánh riêng (kết quả code khác nhau).
3. Mỗi lần: `check-report.mjs` qua; **chạy lại lệnh test độc lập** (không tin `test_result` trong báo cáo) và so; `spec/` không đổi (trừ `report.md`).
4. Chấm `golden.md`, `traps.md` bằng subagent độc lập đọc diff, không xem `SKILL.md`.

## Tiêu chí đạt
`check-report` qua ở cả 3 lần; số pass thật khớp `test_result` ở cả 3 lần; MUST ≥ 2/3; mọi bẫy bị bắt. Đối chiếu bằng prompt trần (có `check-report.mjs`).
