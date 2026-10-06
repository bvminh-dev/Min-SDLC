# Kiểm thử skill sdlc-review

Cùng khung với `sdlc-research/evals/README.md`. Khuôn bảng, bằng chứng `file:dòng` có thật và phủ endpoint/quyền/SB do `check-review.mjs`; việc review có **tìm đúng lỗi** do rubric.

Ca cần code thật có **lỗi gài sẵn**: lấy nhánh code của epic đã qua `sdlc-implement` và chèn các lỗi trong `seeded/bugs.md` (sao lưu để hoàn tác). Review phải bắt được.

## Cách chạy một ca
1. Nhánh sạch chứa code epic PRJ đã triển khai; áp các lỗi gài.
2. Chạy `sdlc-review` cho epic. 3 lần. Mỗi lần: `check-review.mjs` qua; ghi lại lỗi gài nào bị bắt.
3. Chấm `golden.md`, `traps.md` bằng subagent độc lập không biết lỗi nào được gài.

## Tiêu chí đạt
`check-review` qua; bắt ≥ 4/5 lỗi gài ở ≥ 2/3 lần; không lần nào ghi `đạt` cho mục có lỗi gài. Đối chiếu bằng prompt trần.
