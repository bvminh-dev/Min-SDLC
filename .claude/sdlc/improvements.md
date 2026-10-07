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

## 2026-10-06 | spec/lessons/2026-10-06-PRJ-code.md

Lượt `sdlc-improve-kit` thật đầu tiên trên bài học giai đoạn code (implement và review) của epic PRJ. Mọi kiểm cứng mới được viết thành assert thất bại trước, rồi mới sửa. Loại `spec` (L31, L32, L35, L37) chuyển cho sdlc-foundation/sdlc-impact (người dùng xử lý song song), không sửa ở đây; L31, L32 là sửa requirement qua sdlc-impact, L35, L37 là sửa ADR-002 và ADR-007 qua sdlc-foundation.

Cơ chế không làm vỡ dữ liệu cũ: `report.md` và `review.md` có `kit_version: 2` (template mới đặt sẵn) hoặc chạy `--strict` thì kiểm mới (L22 YẾU, L23 đường dẫn máy, L24 `clean_run`, L29 Kiểm đột biến, L38 nhãn Lệch spec, L27 Kết quả chạy lại, L28 `reviewed_tree`, khớp `[chưa làm]`) là LỖI; không có `kit_version` thì chỉ cảnh báo `Lưu ý:`. Cú pháp chỉ có ở file mới (dòng `YẾU:`, `clean_run: chưa`, hàng sai của bảng Kiểm đột biến, `reviewed_tree` khác hiện tại, nhãn `[chưa làm]` không khớp) luôn là lỗi hoặc cảnh báo đúng nghĩa. `check-tests` (L25 cảnh báo, lỗi ở `--strict`; L33 nhãn lặp là lỗi với TC `draft` và `--strict`, cảnh báo với TC `approved` như `PRJ-TC-20261006-120200101`), `check-tech-design` (L30 cảnh báo, lỗi ở `--strict`), `check-spec` (L36: lỗi với requirement `draft`, cảnh báo với `approved`, khác bản đề xuất vốn đòi lỗi ở `approved` vì sẽ làm đỏ requirement đã duyệt) cũng theo hướng đó. `check-foundation` (L34) và `check-lessons` (L41: trùng mã, dòng vượt file) là lỗi cứng vì `spec/` hiện có đã qua. `reviewed_tree` loại cả `spec/` lẫn `.claude/` khỏi băm (sửa kit không làm mã epic bị coi là đã đổi). Hook Stop (L40) chạy `check-report`/`check-review` cho mọi epic có file đó, chỉ chặn khi script thoát 1, không chạy test thật; `clean_run: chưa` hiện qua `systemMessage` của Stop. Trên spec hiện có: tất cả kiểm vẫn exit 0, chỉ thêm cảnh báo (PRJ report/review, RateLimit PRJ, TC 120200101, 6 mối đe dọa kiểm bằng script/hook, BR5 PRJ-REQ-563).

| Mã | File đã đổi | Ca hồi quy | Kết quả selftest |
|---|---|---|---|
| L22 | .claude/skills/sdlc-implement/scripts/check-report.mjs, .claude/skills/sdlc-implement/templates/report.md, .claude/skills/sdlc-implement/SKILL.md | .claude/skills/sdlc-implement/scripts/check-report.test.mjs | 18/18 qua |
| L23 | .claude/skills/sdlc-implement/scripts/check-report.mjs | .claude/skills/sdlc-implement/scripts/check-report.test.mjs | 18/18 qua |
| L24 | .claude/skills/sdlc-implement/scripts/check-report.mjs, .claude/skills/sdlc-implement/templates/report.md, .claude/sdlc/hooks/stop-check-spec.mjs, .claude/skills/sdlc-implement/SKILL.md | .claude/skills/sdlc-implement/scripts/check-report.test.mjs | 18/18 qua |
| L25 | .claude/skills/sdlc-test-design/scripts/check-tests.mjs, .claude/skills/sdlc-test-design/templates/tc.md, .claude/skills/sdlc-test-design/SKILL.md | .claude/skills/sdlc-test-design/scripts/check-tests.test.mjs | 18/18 qua |
| L26 | .claude/skills/sdlc-implement/evals/traps.md | .claude/skills/sdlc-implement/evals/traps.md | 18/18 qua |
| L27 | .claude/skills/sdlc-review/scripts/check-review.mjs, .claude/skills/sdlc-review/templates/review.md, .claude/skills/sdlc-review/SKILL.md | .claude/skills/sdlc-review/scripts/check-review.test.mjs | 18/18 qua |
| L28 | .claude/skills/sdlc-review/scripts/check-review.mjs, .claude/skills/sdlc-review/templates/review.md, .claude/skills/sdlc-review/SKILL.md | .claude/skills/sdlc-review/scripts/check-review.test.mjs | 18/18 qua |
| L29 | .claude/skills/sdlc-implement/scripts/check-report.mjs, .claude/skills/sdlc-implement/templates/report.md, .claude/skills/sdlc-implement/SKILL.md | .claude/skills/sdlc-implement/scripts/check-report.test.mjs | 18/18 qua |
| L30 | .claude/skills/sdlc-tech-design/scripts/check-tech-design.mjs, .claude/skills/sdlc-tech-design/SKILL.md | .claude/skills/sdlc-tech-design/scripts/check-tech-design.test.mjs | 18/18 qua |
| L31 | chuyển nền | - | 18/18 qua |
| L32 | chuyển nền | - | 18/18 qua |
| L33 | .claude/skills/sdlc-test-design/scripts/check-tests.mjs, .claude/skills/sdlc-test-design/templates/tc.md, .claude/skills/sdlc-test-design/SKILL.md | .claude/skills/sdlc-test-design/scripts/check-tests.test.mjs | 18/18 qua |
| L34 | .claude/skills/sdlc-foundation/scripts/check-foundation.mjs, .claude/skills/sdlc-foundation/templates/architecture.md, .claude/skills/sdlc-foundation/SKILL.md | .claude/skills/sdlc-foundation/scripts/check-foundation.test.mjs | 18/18 qua |
| L35 | chuyển nền | - | 18/18 qua |
| L36 | .claude/skills/sdlc-research/scripts/check-spec.mjs, .claude/skills/sdlc-research/SKILL.md | .claude/skills/sdlc-research/scripts/check-spec.test.mjs | 18/18 qua |
| L37 | chuyển nền | - | 18/18 qua |
| L38 | .claude/skills/sdlc-implement/scripts/check-report.mjs, .claude/skills/sdlc-review/scripts/check-review.mjs, .claude/skills/sdlc-implement/templates/report.md | .claude/skills/sdlc-implement/scripts/check-report.test.mjs | 18/18 qua |
| L39 | .claude/skills/sdlc-review/SKILL.md, .claude/skills/sdlc-review/evals/traps.md | .claude/skills/sdlc-review/evals/traps.md | 18/18 qua |
| L40 | .claude/sdlc/hooks/stop-check-spec.mjs | .claude/sdlc/hooks/stop-check-spec.test.mjs | 18/18 qua |
| L41 | .claude/skills/sdlc-retro/scripts/check-lessons.mjs, .claude/skills/sdlc-retro/SKILL.md | .claude/skills/sdlc-retro/scripts/check-lessons.test.mjs | 18/18 qua |
| L42 | .claude/skills/sdlc-retro/SKILL.md, .claude/skills/sdlc-retro/templates/lesson.md, .claude/skills/sdlc-retro/evals/traps.md | .claude/skills/sdlc-retro/evals/traps.md | 18/18 qua |
