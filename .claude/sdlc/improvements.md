# Nhật ký cải tiến kit

Do `sdlc-improve-kit` ghi (thêm cuối file). Mỗi mục: ngày, file bài học, mã bài học, file đã đổi, ca hồi quy, kết quả `node .claude/sdlc/scripts/selftest.mjs`.

## 2026-10-06 | spec/lessons/2026-10-06-ORD.md

Trùng ý được sửa một lần: L1 cùng sửa với L11 (`proposed_entities`), L2 với L9 và L10 (`depends_epics`, role từ `roles.md`), L3 với L12 (cột `testid` ở bảng Trạng thái), L4 và L5 với L19 (SKILL ui-ux), L6 với L18 (thông báo hook), L7 với L20 (cảnh báo requirement `draft`). L8 là loại `spec`: chuyển nền, không sửa ở đây. Các kiểm mới chỉ là cảnh báo hoặc trường tùy chọn để không làm vỡ `spec/` hiện có: `proposed_entities` (cảnh báo), requirement draft (cảnh báo), cột `testid` của bảng Trạng thái (tùy chọn, 34 màn cũ chỉ bị nhắc một dòng), `depends_epics` (tùy chọn). Kiểm role theo `roles.md` (L10) là lỗi cứng nhưng `spec/` hiện có đã qua (không phải làm mềm).

| Mã | File đã đổi | Ca hồi quy | Kết quả selftest |
|---|---|---|---|
| L1 | .claude/skills/sdlc-tech-design/scripts/check-tech-design.mjs | .claude/skills/sdlc-tech-design/scripts/check-tech-design.test.mjs | 16/16 qua |
| L2 | .claude/skills/sdlc-research/scripts/check-spec.mjs, .claude/skills/sdlc-research/templates/requirement.md | .claude/skills/sdlc-research/scripts/check-spec.test.mjs | 16/16 qua |
| L3 | .claude/skills/sdlc-ui-ux/scripts/check-ui.mjs, .claude/skills/sdlc-ui-ux/templates/screen.md | .claude/skills/sdlc-ui-ux/scripts/check-ui.test.mjs | 16/16 qua |
| L4 | .claude/skills/sdlc-ui-ux/SKILL.md | .claude/skills/sdlc-ui-ux/evals/ordering/golden.md | 16/16 qua |
| L5 | .claude/skills/sdlc-ui-ux/SKILL.md | .claude/skills/sdlc-ui-ux/evals/ordering/traps.md | 16/16 qua |
| L6 | .claude/sdlc/hooks/check-spec-file.mjs | .claude/sdlc/hooks/check-spec-file.test.mjs | 16/16 qua |
| L7 | .claude/skills/sdlc-tech-design/scripts/check-tech-design.mjs | .claude/skills/sdlc-tech-design/scripts/check-tech-design.test.mjs | 16/16 qua |
| L8 | chuyển nền | - | 16/16 qua |

## 2026-10-06 | spec/lessons/2026-10-06-PRJ.md

Áp dụng cùng lượt với file ORD (trùng ý đã gộp như ghi ở mục trên). L14: `check-spec` in `OPEN theo epic`, không làm fail. L15: script mới `merge-matrix.mjs`. L16: template mới `questions.md` và script gom `collect-foundation-requests.mjs`. L13, L21: bước mới ở SKILL research kèm ca traps H4, H5. L17: checklist ADR và bảng Giao diện module ở SKILL foundation, kèm golden G13 và traps F6. L12 cho phép phần tử role `guest` ở màn role khác chỉ khi là testid của một trạng thái (không nới kiểm role chung).

| Mã | File đã đổi | Ca hồi quy | Kết quả selftest |
|---|---|---|---|
| L9 | .claude/skills/sdlc-research/scripts/check-spec.mjs, .claude/skills/sdlc-research/templates/requirement.md | .claude/skills/sdlc-research/scripts/check-spec.test.mjs | 16/16 qua |
| L10 | .claude/skills/sdlc-research/scripts/check-spec.mjs | .claude/skills/sdlc-research/scripts/check-spec.test.mjs | 16/16 qua |
| L11 | .claude/skills/sdlc-tech-design/scripts/check-tech-design.mjs | .claude/skills/sdlc-tech-design/scripts/check-tech-design.test.mjs | 16/16 qua |
| L12 | .claude/skills/sdlc-ui-ux/scripts/check-ui.mjs, .claude/skills/sdlc-ui-ux/templates/screen.md | .claude/skills/sdlc-ui-ux/scripts/check-ui.test.mjs | 16/16 qua |
| L13 | .claude/skills/sdlc-research/SKILL.md | .claude/skills/sdlc-research/evals/checkout/traps.md | 16/16 qua |
| L14 | .claude/skills/sdlc-research/scripts/check-spec.mjs | .claude/skills/sdlc-research/scripts/check-spec.test.mjs | 16/16 qua |
| L15 | .claude/skills/sdlc-research/scripts/merge-matrix.mjs, .claude/skills/sdlc-research/SKILL.md | .claude/skills/sdlc-research/scripts/merge-matrix.test.mjs | 16/16 qua |
| L16 | .claude/skills/sdlc-research/scripts/collect-foundation-requests.mjs, .claude/skills/sdlc-research/templates/questions.md, .claude/skills/sdlc-research/SKILL.md | .claude/skills/sdlc-research/scripts/collect-foundation-requests.test.mjs | 16/16 qua |
| L17 | .claude/skills/sdlc-foundation/SKILL.md | .claude/skills/sdlc-foundation/evals/ecommerce/golden.md | 16/16 qua |
| L18 | .claude/sdlc/hooks/check-spec-file.mjs | .claude/sdlc/hooks/check-spec-file.test.mjs | 16/16 qua |
| L19 | .claude/skills/sdlc-ui-ux/SKILL.md | .claude/skills/sdlc-ui-ux/evals/ordering/golden.md | 16/16 qua |
| L20 | .claude/skills/sdlc-tech-design/scripts/check-tech-design.mjs | .claude/skills/sdlc-tech-design/scripts/check-tech-design.test.mjs | 16/16 qua |
| L21 | .claude/skills/sdlc-research/SKILL.md | .claude/skills/sdlc-research/evals/checkout/traps.md | 16/16 qua |
