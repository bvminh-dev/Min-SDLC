# Kiểm thử skill sdlc-discover

Cùng khung với `sdlc-research/evals/README.md`. Hình thức roadmap do `check-roadmap.mjs` và `check-foundation.mjs`; nội dung (epic đủ, mục con có nguồn, không bịa) do rubric.

## Cách chạy một ca
1. Thư mục tạm rỗng (chưa có `spec/`). Đưa cho skill đúng đoạn "Ý tưởng" trong `ecommerce/input.md`.
2. Không hỏi được người dùng: skill chọn khuyến nghị và ghi giả định.
3. Mỗi lần: `check-roadmap.mjs` và `check-foundation.mjs` (phần roadmap) phải qua; chấm `golden.md`, `traps.md` bằng subagent độc lập không xem `SKILL.md`.

## Tiêu chí đạt
`check-roadmap` qua ở cả 3 lần; 100% MUST ở ít nhất 2/3 lần; mọi bẫy bị bắt ở cả 3 lần. Đối chiếu bằng prompt trần.
