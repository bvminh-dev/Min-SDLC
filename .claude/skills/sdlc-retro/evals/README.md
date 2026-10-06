# Kiểm thử skill sdlc-retro

Cùng khung với `sdlc-research/evals/README.md`. Khuôn bảng, bằng chứng và nơi sửa có thật do `check-lessons.mjs`; bài học có **đáng giá và có bằng chứng** do rubric.

## Cách chạy một ca
1. Dữ liệu thật của một epic đã qua review: `report.md`, `review.md`, `spec/changes/*`, các `[OPEN]` còn lại, và thư mục kit hiện tại. Ca đầu: epic `PRJ` sau `sdlc-implement` và `sdlc-review` (hoặc epic ORD đã có bài học L1-L8 làm đối chiếu).
2. Chạy `sdlc-retro` 3 lần. Mỗi lần: `check-lessons.mjs` qua.
3. Chấm `golden.md`, `traps.md` bằng subagent độc lập, đối chiếu bài học với dữ liệu gốc.

## Tiêu chí đạt
`check-lessons` qua; MUST ≥ 2/3; mọi bẫy bị bắt; không có bài học nào không có bằng chứng. Đối chiếu bằng prompt trần.
