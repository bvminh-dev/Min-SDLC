# Kiểm thử skill sdlc-foundation

Cứng (script): `check-foundation.mjs` (định dạng, tham chiếu chéo, vòng phụ thuộc module, ADR đủ mục, mỗi mục SB có cách kiểm).
Mềm (người hoặc subagent chấm): `ecommerce/golden.md` và `ecommerce/traps.md`.

## Chạy
1. Chép `ecommerce/fixture/spec/roadmap.md` vào `spec/` của một thư mục tạm.
2. Chạy skill. Chạy 3 lần nếu muốn đo độ ổn định.
3. `node .claude/skills/sdlc-foundation/scripts/check-foundation.mjs spec/` phải qua.
4. Chấm golden/traps bằng cách ĐỌC file, không chỉ grep.

## Tiêu chí đạt
- Script qua.
- Mọi MUST trong golden có.
- Mọi bẫy được xử lý (nêu rõ hoặc giải quyết bằng quyết định có ghi lý do), không âm thầm bỏ qua.
- Không có quyết định công nghệ nào ghi `accepted` khi chưa có người trả lời.
