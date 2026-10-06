---
framework: spec-kit
mapping: mapping.spec-kit.md
root: .claude/sdlc/framework/spec-kit
pinned_tag: v1.1.0
pinned_commit: f1d3a4f8
ui_reference: .claude/skills/sdlc-ui-ux/references/evon-ui-ux
ui_reference_tag: v0.3.18
---

# Framework đang dùng làm reference

`ui_reference` là tham chiếu **phụ**, ngoài framework SDLC: luật thiết kế giao diện (submodule evondevKit) cho skill `sdlc-ui-ux`. `check-adapter.mjs` kiểm nó đứng đúng tag như framework chính.

Các skill `sdlc-*` đọc file này đầu tiên để biết framework nào đang active, rồi đọc file `mapping` để biết phase của mình tương ứng với tài liệu nào trong framework.

## Đổi framework
1. Thêm submodule mới vào `.claude/sdlc/framework/<tên>` (ghim tag).
2. Viết `mapping.<tên>.md` theo cùng khuôn với `mapping.spec-kit.md`.
3. Sửa `framework`, `mapping`, `root`, `pinned_*` ở trên.
4. Chạy `node .claude/sdlc/scripts/check-adapter.mjs` và các ca trong `evals/`.

Không sửa skill, không sửa `contract.md`.

## Update cùng framework
```
git -C .claude/sdlc/framework/spec-kit fetch --tags
git -C .claude/sdlc/framework/spec-kit checkout <tag-mới>
```
Cập nhật `pinned_tag`/`pinned_commit` ở trên, chạy `check-adapter.mjs`, sửa mapping nếu có đường dẫn gãy, chạy lại evals, rồi mới commit.
