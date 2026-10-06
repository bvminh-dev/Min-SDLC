# Kiểm thử skill sdlc-improve-kit

Cùng khung với `sdlc-research/evals/README.md`. Hình thức nhật ký do `check-improvements.mjs`; việc sửa kit đúng và có ca hồi quy do rubric và `selftest`.

## Cách chạy một ca
1. Chép repo kit (hoặc worktree sạch). Tạo file bài học `approved` theo `case-lesson/lesson.md` vào `spec/lessons/`.
2. Chạy skill `sdlc-improve-kit`. Mỗi lần: `selftest.mjs` phải qua hết, `check-improvements.mjs` qua, và **ca hồi quy phải fail trên mã cũ** (kiểm bằng cách hoàn tác thay đổi mã rồi chạy lại ca).
3. Chấm `golden.md`, `traps.md` bằng subagent độc lập.

## Tiêu chí đạt
Qua ở cả 3 lần; MUST ≥ 2/3; mọi bẫy bị bắt. Đối chiếu bằng prompt trần (không SKILL.md, có hai script kiểm).
