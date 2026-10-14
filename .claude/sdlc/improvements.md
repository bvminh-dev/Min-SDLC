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

## 2026-10-07 | spec/lessons/2026-10-06-AUTH-code.md

Lượt `sdlc-improve-kit` trên bài học giai đoạn code của epic AUTH. Kiểm cứng mới viết thành assert thất bại trước (đã xác nhận chạy `*.test.mjs` mới với script HEAD thì đỏ), rồi sửa.

Cơ chế không làm vỡ dữ liệu cũ: các kiểm mới của `check-report` (L43 nhãn sai, L49 mốc thời gian cứng, và L53, L55 ở lượt USR) và `check-review` (L48) lấy `kit_version: 3` (template mới đặt sẵn) hoặc `--strict` làm mốc: LỖI với file `kit_version: 3`, chỉ cảnh báo `Lưu ý:` với file `kit_version: 2` hiện có (PRJ, AUTH, USR) và file không có trường. Không nâng `kit_version: 2` thành lỗi vì sẽ làm đỏ report/review đã có và hook Stop. `check-tests` (L45, L50) và `check-tech-design` (L44) theo mẫu L25/L30: cảnh báo, lỗi ở `--strict`. L43 chỉ bắt mục `[đã chọn]` còn CHỜ sdlc-impact/sdlc-foundation ("nên/cần/phải/chờ ... qua sdlc-impact", "nên ghi vào ADR", "review X cân nhắc lại", "chưa chạy sdlc-impact"), không bắt mục đã đồng bộ ("Đã đồng bộ spec qua sdlc-impact") vì report AUTH/PRJ/USR đã ghi lại như vậy. L49 chỉ xét literal ISO trong khoảng hai ngày quanh hôm nay (`fixed-clock:` miễn). L44 lấy "Mã chung" từ requirement nền, so `-`/`_` và tiền tố; spec hiện tại đã đồng bộ nên không có cảnh báo mới. L47: `mutate.mjs` đặt ở `.claude/skills/sdlc-review/scripts/` (đúng "Nơi sửa" của bài học, implement dùng chung qua SKILL); không sửa `apps/api/scripts/mutations-*.mjs` của dự án. L51 loại `spec`: chuyển nền, không sửa.

| Mã | File đã đổi | Ca hồi quy | Kết quả selftest |
|---|---|---|---|
| L43 | .claude/skills/sdlc-implement/scripts/check-report.mjs, .claude/skills/sdlc-implement/templates/report.md, .claude/skills/sdlc-implement/SKILL.md | .claude/skills/sdlc-implement/scripts/check-report.test.mjs | 19/19 qua |
| L44 | .claude/skills/sdlc-tech-design/scripts/check-tech-design.mjs, .claude/skills/sdlc-tech-design/SKILL.md | .claude/skills/sdlc-tech-design/scripts/check-tech-design.test.mjs | 19/19 qua |
| L45 | .claude/skills/sdlc-test-design/scripts/check-tests.mjs, .claude/skills/sdlc-test-design/templates/tc.md, .claude/skills/sdlc-test-design/SKILL.md | .claude/skills/sdlc-test-design/scripts/check-tests.test.mjs | 19/19 qua |
| L46 | .claude/skills/sdlc-implement/evals/traps.md | .claude/skills/sdlc-implement/evals/traps.md | 19/19 qua |
| L47 | .claude/skills/sdlc-review/scripts/mutate.mjs, .claude/skills/sdlc-review/SKILL.md, .claude/skills/sdlc-review/templates/review.md, .claude/skills/sdlc-review/evals/traps.md, .claude/skills/sdlc-implement/SKILL.md, .claude/skills/sdlc-implement/templates/report.md | .claude/skills/sdlc-review/scripts/mutate.test.mjs | 19/19 qua |
| L48 | .claude/skills/sdlc-review/scripts/check-review.mjs, .claude/skills/sdlc-review/templates/review.md, .claude/skills/sdlc-review/SKILL.md | .claude/skills/sdlc-review/scripts/check-review.test.mjs | 19/19 qua |
| L49 | .claude/skills/sdlc-implement/scripts/check-report.mjs, .claude/skills/sdlc-implement/templates/report.md, .claude/skills/sdlc-implement/SKILL.md | .claude/skills/sdlc-implement/scripts/check-report.test.mjs | 19/19 qua |
| L50 | .claude/skills/sdlc-test-design/scripts/check-tests.mjs, .claude/skills/sdlc-test-design/templates/tc.md, .claude/skills/sdlc-test-design/SKILL.md | .claude/skills/sdlc-test-design/scripts/check-tests.test.mjs | 19/19 qua |
| L51 | chuyển nền | - | 19/19 qua |

## 2026-10-07 | spec/lessons/2026-10-06-USR-code.md

Lượt `sdlc-improve-kit` trên bài học giai đoạn code của epic USR, cùng cơ chế `kit_version: 3` / `--strict` như mục trên. L53: `check-report` lấy mã đổi từ git (`git diff --name-only HEAD` hoặc `--base <ref>`, cộng tệp chưa theo dõi) và module của epic từ `spec/architecture.md`; cây sạch (đã commit) thì không thấy gì, nên chạy trước khi commit hoặc truyền `--base`; chỉ nhận bố cục `src/modules/<m>/` và `test/<m>/`. L55: hai `medianMs(` cách nhau tối đa 4 dòng không có `it(`/`test(` xen giữa. L56: `find-refs.mjs --phrase` và dòng `Cụm từ xuyên module: "<cụm>"` trong báo cáo tác động (chỉ khi có dòng đó mới kiểm, nên báo cáo hiện có không đổi). L57: chỉ cảnh báo (không lỗi cả với requirement `draft`) vì BR nói "chỉ X" có thể về hành động khác của cùng requirement; chỉ xét requirement có đúng một hàng ma trận (đã tách hàng thì thôi), admin bao staff. L58: bỏ `proxy` trơn khỏi mẫu hạ tầng vì "tin X-Forwarded-For từ proxy cấu hình" test được (PRJ T7, ORD T3, INV T16 là ví dụ báo nhầm). L52, L54: eval (R7, R8, M13) và SKILL test-design/review. L59 loại `spec`: chuyển nền (ADR-018), không sửa.

| Mã | File đã đổi | Ca hồi quy | Kết quả selftest |
|---|---|---|---|
| L52 | .claude/skills/sdlc-review/evals/traps.md, .claude/skills/sdlc-review/SKILL.md, .claude/skills/sdlc-test-design/SKILL.md, .claude/skills/sdlc-test-design/templates/tc.md | .claude/skills/sdlc-review/evals/traps.md | 19/19 qua |
| L53 | .claude/skills/sdlc-implement/scripts/check-report.mjs, .claude/skills/sdlc-implement/SKILL.md | .claude/skills/sdlc-implement/scripts/check-report.test.mjs | 19/19 qua |
| L54 | .claude/skills/sdlc-implement/evals/traps.md | .claude/skills/sdlc-implement/evals/traps.md | 19/19 qua |
| L55 | .claude/skills/sdlc-implement/scripts/check-report.mjs, .claude/skills/sdlc-implement/templates/report.md, .claude/skills/sdlc-implement/SKILL.md | .claude/skills/sdlc-implement/scripts/check-report.test.mjs | 19/19 qua |
| L56 | .claude/skills/sdlc-impact/scripts/find-refs.mjs, .claude/skills/sdlc-impact/scripts/check-impact.mjs, .claude/skills/sdlc-impact/SKILL.md, .claude/skills/sdlc-impact/templates/report.md, .claude/skills/sdlc-tech-design/SKILL.md | .claude/skills/sdlc-impact/scripts/check-impact.test.mjs | 19/19 qua |
| L57 | .claude/skills/sdlc-research/scripts/check-spec.mjs, .claude/skills/sdlc-research/SKILL.md | .claude/skills/sdlc-research/scripts/check-spec.test.mjs | 19/19 qua |
| L58 | .claude/skills/sdlc-tech-design/scripts/check-tech-design.mjs, .claude/skills/sdlc-tech-design/SKILL.md | .claude/skills/sdlc-tech-design/scripts/check-tech-design.test.mjs | 19/19 qua |
| L59 | chuyển nền | - | 19/19 qua |

## Lượt cải tiến 2026-10-13 (L60 đến L140)

Mười một file `*-code.md`, epic PRD đến DSH. Cơ chế chung của lượt này (các mục theo từng file bài học ở dưới):

- `kit_version: 4` là mức mới. Mọi kiểm cứng mới của check-report (L60, L63, L86, L95, L98, L120, L135, L137, giá trị giữ chỗ), check-review (L65 dòng bằng chứng trống, L93) là LỖI với `kit_version: 4` hoặc `--strict`, chỉ là cảnh báo `Lưu ý:` với dữ liệu `kit_version: 3` (14 epic hiện có) để không làm đỏ hook Stop và spec/. Template report.md và review.md đặt sẵn `kit_version: 4`. check-tech-design (L66, L68, L106, L121) và check-tests (L61, L132) là cảnh báo; lỗi ở `--strict` (tech-design còn lỗi khi tài liệu ghi `kit_version: 4` ở frontmatter).
- Viết assert thất bại trước (mutate.test, check-report.test, check-review.test, check-tests.test, check-tech-design.test, selftest.test, clean-run.test), rồi sửa, rồi chạy lại.
- Ngoài bảng mã: `check-impact` (tên file không phải ID: lỗi kit gặp ở nhiều epic) nay chấp nhận báo cáo đặt tên theo chủ đề kèm dòng `Tài liệu bị đổi: <ID hoặc spec/đường-dẫn.md>`; làm theo yêu cầu của người dùng, không có mã L; ca hồi quy ở check-impact.test.mjs (sửa .claude/skills/sdlc-impact/scripts/check-impact.mjs, templates/report.md, SKILL.md).
- Lựa chọn khác với đề xuất gốc của bài học: (1) L93 yêu cầu "số pass và số fail" nhưng định dạng thật của jest chỉ in số fail khi có fail, nên chỉ đòi số pass; (2) L98 phủ tệp bằng `git diff --name-only HEAD` cộng `git ls-files -o` (không phải `ls-files -m`) vì tệp đã stage không nằm trong `-m`; (3) L65 chỉ so dòng cũ khi review không có `reviewed_tree` (cây sạch tại `reviewed_commit`), vì khi có `reviewed_tree` mã đã review không còn ở commit nào; (4) L108 và L136 dùng một tệp `<bảng>.restore.json` cạnh bảng thay vì thư mục; (5) L97: mỗi test con chạy với TMPDIR riêng và được dọn, test rò thì in số lượng và chỉ thoát 1 với `--strict-tmp` (17 test hiện có đều rò, sửa từng test là ngoài phạm vi nhỏ nhất); mutate.test.mjs tự xóa thư mục tạm; (6) L86 bỏ qua dự án có jest `globalTeardown` (apps/api có, nên không có cảnh báo mới).
- Loại `spec` (L70, L71, L72, L82, L84, L85, L103, L115, L129, L133): chuyển cho sdlc-impact/sdlc-foundation, không sửa ở đây. Phần script của L91 (`scripts/check-boundaries.mjs` ở gốc repo) nằm ngoài phạm vi .claude/: việc cho người.

## 2026-10-13 | spec/lessons/2026-10-07-PRD-code.md

Nhóm lỗi implement/review thấy mà tự báo cáo không thấy. L60 (dòng đệm), L63 (mã lỗi tự đặt) và L65 (dịch dòng bằng chứng) thành kiểm cứng; L61 thành cảnh báo ở `check-tests` (gộp thêm L123 phía test-design); L62 và L64 là bẫy eval cộng quy tắc ở SKILL (L62 gộp L90, L113, L126 thành một danh sách giá trị biên).

| Mã | File đã đổi | Ca hồi quy | Kết quả selftest |
|---|---|---|---|
| L60 | .claude/skills/sdlc-implement/scripts/check-report.mjs, .claude/skills/sdlc-implement/templates/report.md, .claude/skills/sdlc-implement/SKILL.md, .claude/skills/sdlc-implement/evals/traps.md | .claude/skills/sdlc-implement/scripts/check-report.test.mjs | 21/21 qua |
| L61 | .claude/skills/sdlc-test-design/scripts/check-tests.mjs, .claude/skills/sdlc-test-design/SKILL.md, .claude/skills/sdlc-test-design/evals/traps.md, .claude/skills/sdlc-implement/evals/traps.md | .claude/skills/sdlc-test-design/scripts/check-tests.test.mjs | 21/21 qua |
| L62 | .claude/skills/sdlc-review/SKILL.md, .claude/skills/sdlc-review/evals/traps.md, .claude/skills/sdlc-test-design/SKILL.md, .claude/skills/sdlc-test-design/evals/traps.md | .claude/skills/sdlc-review/evals/traps.md | 21/21 qua |
| L63 | .claude/skills/sdlc-implement/scripts/check-report.mjs, .claude/skills/sdlc-implement/templates/report.md, .claude/skills/sdlc-implement/SKILL.md, .claude/skills/sdlc-implement/evals/traps.md | .claude/skills/sdlc-implement/scripts/check-report.test.mjs | 21/21 qua |
| L64 | .claude/skills/sdlc-test-design/SKILL.md, .claude/skills/sdlc-test-design/evals/traps.md | .claude/skills/sdlc-test-design/evals/traps.md | 21/21 qua |
| L65 | .claude/skills/sdlc-review/scripts/check-review.mjs, .claude/skills/sdlc-review/templates/review.md, .claude/skills/sdlc-review/SKILL.md, .claude/skills/sdlc-review/evals/traps.md | .claude/skills/sdlc-review/scripts/check-review.test.mjs | 21/21 qua |

## 2026-10-13 | spec/lessons/2026-10-07-INV-code.md

L66 và L68 là kiểm mới của `check-tech-design` (cảnh báo; lỗi ở `--strict` hoặc khi tài liệu có `kit_version: 4`; L68 gộp 7 lần lặp thành một quy tắc: `<Tên>Service.<hàm>(` trùng tên hàm của bảng Giao diện module thì phải dùng lớp `<Tên>Api`). L67 là bẫy review. L69 là chế độ `--auto` của `mutate.mjs` (gộp L75, L79). L70, L71 là loại `spec`: chuyển cho sdlc-foundation (ADR-013 lịch job, events.md/ADR-012 payload).

| Mã | File đã đổi | Ca hồi quy | Kết quả selftest |
|---|---|---|---|
| L66 | .claude/skills/sdlc-tech-design/scripts/check-tech-design.mjs, .claude/skills/sdlc-tech-design/SKILL.md, .claude/skills/sdlc-tech-design/evals/traps.md | .claude/skills/sdlc-tech-design/scripts/check-tech-design.test.mjs | 21/21 qua |
| L67 | .claude/skills/sdlc-review/SKILL.md, .claude/skills/sdlc-review/evals/traps.md | .claude/skills/sdlc-review/evals/traps.md | 21/21 qua |
| L68 | .claude/skills/sdlc-tech-design/scripts/check-tech-design.mjs, .claude/skills/sdlc-tech-design/SKILL.md, .claude/skills/sdlc-tech-design/evals/traps.md | .claude/skills/sdlc-tech-design/scripts/check-tech-design.test.mjs | 21/21 qua |
| L69 | .claude/skills/sdlc-review/scripts/mutate.mjs, .claude/skills/sdlc-review/SKILL.md, .claude/skills/sdlc-review/evals/traps.md | .claude/skills/sdlc-review/scripts/mutate.test.mjs | 21/21 qua |
| L70 | chuyển nền | - | 21/21 qua |
| L71 | chuyển nền | - | 21/21 qua |

## 2026-10-13 | spec/lessons/2026-10-07-PRM-code.md

L72 là loại `spec` (ADR-014 đếm nguyên tử): chuyển cho sdlc-foundation. L73, L74 là bẫy review. L75 gộp vào L69 (toán tử `now()`, `IN`, `WHEN`, hằng số mặc định thuộc `--auto`). L76 và L77 là quy tắc ở SKILL test-design và research.

| Mã | File đã đổi | Ca hồi quy | Kết quả selftest |
|---|---|---|---|
| L72 | chuyển nền | - | 21/21 qua |
| L73 | .claude/skills/sdlc-review/SKILL.md, .claude/skills/sdlc-review/evals/traps.md | .claude/skills/sdlc-review/evals/traps.md | 21/21 qua |
| L74 | .claude/skills/sdlc-review/SKILL.md, .claude/skills/sdlc-review/evals/traps.md | .claude/skills/sdlc-review/evals/traps.md | 21/21 qua |
| L75 | .claude/skills/sdlc-review/scripts/mutate.mjs, .claude/skills/sdlc-review/SKILL.md, .claude/skills/sdlc-review/evals/traps.md | .claude/skills/sdlc-review/scripts/mutate.test.mjs | 21/21 qua |
| L76 | .claude/skills/sdlc-test-design/SKILL.md, .claude/skills/sdlc-test-design/evals/traps.md, .claude/skills/sdlc-test-design/templates/tc.md | .claude/skills/sdlc-test-design/evals/traps.md | 21/21 qua |
| L77 | .claude/skills/sdlc-research/SKILL.md, .claude/skills/sdlc-research/evals/checkout/traps.md | .claude/skills/sdlc-research/evals/checkout/traps.md | 21/21 qua |

## 2026-10-13 | spec/lessons/2026-10-07-ORD-code.md

L78, L80 là quy tắc test-design (bảng quy tắc phủ mọi ô; trần tài nguyên hai ca). L79 gộp vào L69 (toán tử xóa `ADD CONSTRAINT`, `if (...) bad(`, đổi biên thời gian; mặc định chạy cả thư mục test). L81 là bẫy review. L83 là quy tắc tech-design. L82, L84, L85 là loại `spec`: chuyển cho sdlc-foundation (ADR-016 thứ tự guard, ADR-014 khóa đếm, ADR-011 payload không phải đối tượng).

| Mã | File đã đổi | Ca hồi quy | Kết quả selftest |
|---|---|---|---|
| L78 | .claude/skills/sdlc-test-design/SKILL.md, .claude/skills/sdlc-test-design/evals/traps.md | .claude/skills/sdlc-test-design/evals/traps.md | 21/21 qua |
| L79 | .claude/skills/sdlc-review/scripts/mutate.mjs, .claude/skills/sdlc-review/SKILL.md, .claude/skills/sdlc-review/evals/traps.md | .claude/skills/sdlc-review/scripts/mutate.test.mjs | 21/21 qua |
| L80 | .claude/skills/sdlc-test-design/SKILL.md, .claude/skills/sdlc-test-design/evals/traps.md | .claude/skills/sdlc-test-design/evals/traps.md | 21/21 qua |
| L81 | .claude/skills/sdlc-review/SKILL.md, .claude/skills/sdlc-review/evals/traps.md | .claude/skills/sdlc-review/evals/traps.md | 21/21 qua |
| L82 | chuyển nền | - | 21/21 qua |
| L83 | .claude/skills/sdlc-tech-design/SKILL.md, .claude/skills/sdlc-tech-design/evals/traps.md | .claude/skills/sdlc-tech-design/evals/traps.md | 21/21 qua |
| L84 | chuyển nền | - | 21/21 qua |
| L85 | chuyển nền | - | 21/21 qua |

## 2026-10-13 | spec/lessons/2026-10-07-SHP-code.md

L86 là kiểm của `check-report` (thư mục tạm không xóa; bỏ qua khi jest có `globalTeardown`; ngoại lệ `tmp-hygiene:`). L87 gộp với L117 (hold-and-wait). L88 gộp với L91 (cổng quét ba kiểu đầu vào, kiểm tên hàm `XxxApi` ngoài bảng): phần sửa `scripts/check-boundaries.mjs` ở gốc repo nằm ngoài phạm vi lượt này, việc cho người; kit chỉ ghi bẫy review R15. L89, L96 là bẫy implement. L90 gộp vào L62. L92, L94 là bẫy review (L94 gộp L140). L93 là kiểm của `check-review`. L95 là kiểm của `check-report` (họ L55). L97 là `selftest.mjs` (mỗi test con chạy với TMPDIR riêng và được dọn).

| Mã | File đã đổi | Ca hồi quy | Kết quả selftest |
|---|---|---|---|
| L86 | .claude/skills/sdlc-implement/scripts/check-report.mjs, .claude/skills/sdlc-implement/templates/report.md, .claude/skills/sdlc-implement/SKILL.md, .claude/skills/sdlc-implement/evals/traps.md | .claude/skills/sdlc-implement/scripts/check-report.test.mjs | 21/21 qua |
| L87 | .claude/skills/sdlc-implement/SKILL.md, .claude/skills/sdlc-implement/evals/traps.md | .claude/skills/sdlc-implement/evals/traps.md | 21/21 qua |
| L88 | .claude/skills/sdlc-review/SKILL.md, .claude/skills/sdlc-review/evals/traps.md | .claude/skills/sdlc-review/evals/traps.md | 21/21 qua |
| L89 | .claude/skills/sdlc-implement/SKILL.md, .claude/skills/sdlc-implement/evals/traps.md | .claude/skills/sdlc-implement/evals/traps.md | 21/21 qua |
| L90 | .claude/skills/sdlc-review/SKILL.md, .claude/skills/sdlc-review/evals/traps.md | .claude/skills/sdlc-review/evals/traps.md | 21/21 qua |
| L91 | .claude/skills/sdlc-review/SKILL.md, .claude/skills/sdlc-review/evals/traps.md | .claude/skills/sdlc-review/evals/traps.md | 21/21 qua |
| L92 | .claude/skills/sdlc-review/SKILL.md, .claude/skills/sdlc-review/evals/traps.md | .claude/skills/sdlc-review/evals/traps.md | 21/21 qua |
| L93 | .claude/skills/sdlc-review/scripts/check-review.mjs, .claude/skills/sdlc-review/templates/review.md, .claude/skills/sdlc-review/SKILL.md, .claude/skills/sdlc-review/evals/traps.md | .claude/skills/sdlc-review/scripts/check-review.test.mjs | 21/21 qua |
| L94 | .claude/skills/sdlc-review/SKILL.md, .claude/skills/sdlc-review/evals/traps.md | .claude/skills/sdlc-review/evals/traps.md | 21/21 qua |
| L95 | .claude/skills/sdlc-implement/scripts/check-report.mjs, .claude/skills/sdlc-implement/templates/report.md, .claude/skills/sdlc-implement/SKILL.md, .claude/skills/sdlc-implement/evals/traps.md | .claude/skills/sdlc-implement/scripts/check-report.test.mjs | 21/21 qua |
| L96 | .claude/skills/sdlc-implement/SKILL.md, .claude/skills/sdlc-implement/evals/traps.md | .claude/skills/sdlc-implement/evals/traps.md | 21/21 qua |
| L97 | .claude/sdlc/scripts/selftest.mjs, .claude/skills/sdlc-review/scripts/mutate.test.mjs | .claude/sdlc/scripts/selftest.test.mjs | 21/21 qua |

## 2026-10-13 | spec/lessons/2026-10-08-PAY-code.md

L98 là script mới `clean-run.mjs` (kèm kiểm của `check-report`: `clean_run: pass` phải ghi lệnh script và mã thoát từng bước). L99 đến L102, L104, L105, L107 là bẫy implement (L104, L105, L107 gộp một hàng họ chập chờn theo tải; L102 gộp vào nhóm job nền với L61, L124). L100 là bẫy review cộng mục kiểm tech-design. L106 là kiểm của `check-tech-design`. L103 là loại `spec`: chuyển cho sdlc-impact (PAY-REQ BR6 cách hỏi lại cổng).

| Mã | File đã đổi | Ca hồi quy | Kết quả selftest |
|---|---|---|---|
| L98 | .claude/skills/sdlc-implement/scripts/check-report.mjs, .claude/skills/sdlc-implement/templates/report.md, .claude/skills/sdlc-implement/SKILL.md, .claude/skills/sdlc-implement/evals/traps.md, .claude/skills/sdlc-implement/scripts/clean-run.mjs | .claude/skills/sdlc-implement/scripts/clean-run.test.mjs | 21/21 qua |
| L99 | .claude/skills/sdlc-implement/SKILL.md, .claude/skills/sdlc-implement/evals/traps.md, .claude/skills/sdlc-test-design/SKILL.md, .claude/skills/sdlc-test-design/evals/traps.md | .claude/skills/sdlc-implement/evals/traps.md | 21/21 qua |
| L100 | .claude/skills/sdlc-review/SKILL.md, .claude/skills/sdlc-review/evals/traps.md, .claude/skills/sdlc-tech-design/SKILL.md, .claude/skills/sdlc-tech-design/evals/traps.md | .claude/skills/sdlc-review/evals/traps.md | 21/21 qua |
| L101 | .claude/skills/sdlc-implement/SKILL.md, .claude/skills/sdlc-implement/evals/traps.md | .claude/skills/sdlc-implement/evals/traps.md | 21/21 qua |
| L102 | .claude/skills/sdlc-implement/SKILL.md, .claude/skills/sdlc-implement/evals/traps.md | .claude/skills/sdlc-implement/evals/traps.md | 21/21 qua |
| L103 | chuyển nền | - | 21/21 qua |
| L104 | .claude/skills/sdlc-implement/SKILL.md, .claude/skills/sdlc-implement/evals/traps.md | .claude/skills/sdlc-implement/evals/traps.md | 21/21 qua |
| L105 | .claude/skills/sdlc-implement/SKILL.md, .claude/skills/sdlc-implement/evals/traps.md | .claude/skills/sdlc-implement/evals/traps.md | 21/21 qua |
| L106 | .claude/skills/sdlc-tech-design/scripts/check-tech-design.mjs, .claude/skills/sdlc-tech-design/SKILL.md, .claude/skills/sdlc-tech-design/evals/traps.md | .claude/skills/sdlc-tech-design/scripts/check-tech-design.test.mjs | 21/21 qua |
| L107 | .claude/skills/sdlc-implement/SKILL.md, .claude/skills/sdlc-implement/evals/traps.md | .claude/skills/sdlc-implement/evals/traps.md | 21/21 qua |

## 2026-10-13 | spec/lessons/2026-10-09-CRT-code.md

L108 gộp với L136 (một tệp sao lưu `<bảng>.restore.json`). L109, L118, L128 cùng lượt sửa `mutate.mjs` (retest, tiến độ, `--only`, `--skip-baseline`, nhóm tiến trình, `quá hạn`). L110 đến L113 là bẫy implement (L110 kèm quy tắc test-design). L114 là quy tắc tech-design (không có script: bài học chỉ cho phép script khi làm được). L116 là bẫy review. L115 là loại `spec`: chuyển cho sdlc-foundation (SB-18, user_id trong log).

| Mã | File đã đổi | Ca hồi quy | Kết quả selftest |
|---|---|---|---|
| L108 | .claude/skills/sdlc-review/scripts/mutate.mjs, .claude/skills/sdlc-review/SKILL.md, .claude/skills/sdlc-review/evals/traps.md | .claude/skills/sdlc-review/scripts/mutate.test.mjs | 21/21 qua |
| L109 | .claude/skills/sdlc-review/scripts/mutate.mjs, .claude/skills/sdlc-review/SKILL.md, .claude/skills/sdlc-review/evals/traps.md | .claude/skills/sdlc-review/scripts/mutate.test.mjs | 21/21 qua |
| L110 | .claude/skills/sdlc-implement/SKILL.md, .claude/skills/sdlc-implement/evals/traps.md, .claude/skills/sdlc-test-design/SKILL.md, .claude/skills/sdlc-test-design/evals/traps.md | .claude/skills/sdlc-implement/evals/traps.md | 21/21 qua |
| L111 | .claude/skills/sdlc-implement/SKILL.md, .claude/skills/sdlc-implement/evals/traps.md | .claude/skills/sdlc-implement/evals/traps.md | 21/21 qua |
| L112 | .claude/skills/sdlc-implement/SKILL.md, .claude/skills/sdlc-implement/evals/traps.md | .claude/skills/sdlc-implement/evals/traps.md | 21/21 qua |
| L113 | .claude/skills/sdlc-implement/SKILL.md, .claude/skills/sdlc-implement/evals/traps.md, .claude/skills/sdlc-test-design/SKILL.md, .claude/skills/sdlc-test-design/evals/traps.md | .claude/skills/sdlc-implement/evals/traps.md | 21/21 qua |
| L114 | .claude/skills/sdlc-tech-design/SKILL.md, .claude/skills/sdlc-tech-design/evals/traps.md | .claude/skills/sdlc-tech-design/evals/traps.md | 21/21 qua |
| L115 | chuyển nền | - | 21/21 qua |
| L116 | .claude/skills/sdlc-review/SKILL.md, .claude/skills/sdlc-review/evals/traps.md | .claude/skills/sdlc-review/evals/traps.md | 21/21 qua |

## 2026-10-13 | spec/lessons/2026-10-09-CHK-code.md

L117 gộp với L87. L118 gộp vào lượt sửa `mutate.mjs` của L108. L119 là bẫy implement. L120 là kiểm của `check-report` (cảnh báo; lỗi ở `kit_version: 4`). L121 là kiểm của `check-tech-design`. L122 là bẫy review (gộp L127 phần job).

| Mã | File đã đổi | Ca hồi quy | Kết quả selftest |
|---|---|---|---|
| L117 | .claude/skills/sdlc-implement/SKILL.md, .claude/skills/sdlc-implement/evals/traps.md | .claude/skills/sdlc-implement/evals/traps.md | 21/21 qua |
| L118 | .claude/skills/sdlc-review/scripts/mutate.mjs, .claude/skills/sdlc-review/SKILL.md, .claude/skills/sdlc-review/evals/traps.md | .claude/skills/sdlc-review/scripts/mutate.test.mjs | 21/21 qua |
| L119 | .claude/skills/sdlc-implement/SKILL.md, .claude/skills/sdlc-implement/evals/traps.md | .claude/skills/sdlc-implement/evals/traps.md | 21/21 qua |
| L120 | .claude/skills/sdlc-implement/scripts/check-report.mjs, .claude/skills/sdlc-implement/templates/report.md, .claude/skills/sdlc-implement/SKILL.md, .claude/skills/sdlc-implement/evals/traps.md | .claude/skills/sdlc-implement/scripts/check-report.test.mjs | 21/21 qua |
| L121 | .claude/skills/sdlc-tech-design/scripts/check-tech-design.mjs, .claude/skills/sdlc-tech-design/SKILL.md, .claude/skills/sdlc-tech-design/evals/traps.md | .claude/skills/sdlc-tech-design/scripts/check-tech-design.test.mjs | 21/21 qua |
| L122 | .claude/skills/sdlc-review/SKILL.md, .claude/skills/sdlc-review/evals/traps.md | .claude/skills/sdlc-review/evals/traps.md | 21/21 qua |

## 2026-10-13 | spec/lessons/2026-10-09-NTF-code.md

L123, L124 là bẫy implement (nhóm job nền cùng L61, L102). L125, L126 là quy tắc tech-design và test-design. L127 là bẫy implement và review (gộp L112 phía implement). L128 gộp vào lượt sửa `mutate.mjs`. L129 là loại `spec`: chuyển cho sdlc-foundation và sdlc-impact (consumer hai pha ở ADR-011).

| Mã | File đã đổi | Ca hồi quy | Kết quả selftest |
|---|---|---|---|
| L123 | .claude/skills/sdlc-implement/SKILL.md, .claude/skills/sdlc-implement/evals/traps.md, .claude/skills/sdlc-test-design/SKILL.md, .claude/skills/sdlc-test-design/evals/traps.md | .claude/skills/sdlc-implement/evals/traps.md | 21/21 qua |
| L124 | .claude/skills/sdlc-implement/SKILL.md, .claude/skills/sdlc-implement/evals/traps.md | .claude/skills/sdlc-implement/evals/traps.md | 21/21 qua |
| L125 | .claude/skills/sdlc-tech-design/SKILL.md, .claude/skills/sdlc-tech-design/evals/traps.md, .claude/skills/sdlc-test-design/SKILL.md, .claude/skills/sdlc-test-design/evals/traps.md | .claude/skills/sdlc-test-design/evals/traps.md | 21/21 qua |
| L126 | .claude/skills/sdlc-tech-design/SKILL.md, .claude/skills/sdlc-tech-design/evals/traps.md, .claude/skills/sdlc-test-design/SKILL.md, .claude/skills/sdlc-test-design/evals/traps.md | .claude/skills/sdlc-tech-design/evals/traps.md | 21/21 qua |
| L127 | .claude/skills/sdlc-implement/SKILL.md, .claude/skills/sdlc-implement/evals/traps.md, .claude/skills/sdlc-review/SKILL.md, .claude/skills/sdlc-review/evals/traps.md | .claude/skills/sdlc-review/evals/traps.md | 21/21 qua |
| L128 | .claude/skills/sdlc-review/scripts/mutate.mjs, .claude/skills/sdlc-review/SKILL.md, .claude/skills/sdlc-review/evals/traps.md | .claude/skills/sdlc-review/scripts/mutate.test.mjs | 21/21 qua |
| L129 | chuyển nền | - | 21/21 qua |

## 2026-10-13 | spec/lessons/2026-10-10-REV-code.md

L130, L131, L134 là bẫy implement. L132 là kiểm của `check-tests` (cảnh báo) cộng quy tắc research và test-design. L135 là kiểm của `check-report` (cụm "nên sửa ở lượt review"). L136 gộp với L108. L133 là loại `spec`: chuyển cho sdlc-foundation (ADR-014 khóa bộ đếm gồm cửa sổ).

| Mã | File đã đổi | Ca hồi quy | Kết quả selftest |
|---|---|---|---|
| L130 | .claude/skills/sdlc-implement/SKILL.md, .claude/skills/sdlc-implement/evals/traps.md | .claude/skills/sdlc-implement/evals/traps.md | 21/21 qua |
| L131 | .claude/skills/sdlc-implement/SKILL.md, .claude/skills/sdlc-implement/evals/traps.md | .claude/skills/sdlc-implement/evals/traps.md | 21/21 qua |
| L132 | .claude/skills/sdlc-test-design/scripts/check-tests.mjs, .claude/skills/sdlc-test-design/SKILL.md, .claude/skills/sdlc-test-design/evals/traps.md, .claude/skills/sdlc-research/SKILL.md, .claude/skills/sdlc-research/evals/checkout/traps.md | .claude/skills/sdlc-test-design/scripts/check-tests.test.mjs | 21/21 qua |
| L133 | chuyển nền | - | 21/21 qua |
| L134 | .claude/skills/sdlc-implement/SKILL.md, .claude/skills/sdlc-implement/evals/traps.md | .claude/skills/sdlc-implement/evals/traps.md | 21/21 qua |
| L135 | .claude/skills/sdlc-implement/scripts/check-report.mjs, .claude/skills/sdlc-implement/templates/report.md, .claude/skills/sdlc-implement/SKILL.md, .claude/skills/sdlc-implement/evals/traps.md | .claude/skills/sdlc-implement/scripts/check-report.test.mjs | 21/21 qua |
| L136 | .claude/skills/sdlc-review/scripts/mutate.mjs, .claude/skills/sdlc-review/SKILL.md, .claude/skills/sdlc-review/evals/traps.md | .claude/skills/sdlc-review/scripts/mutate.test.mjs | 21/21 qua |

## 2026-10-13 | spec/lessons/2026-10-10-DSH-code.md

L137 là kiểm của `check-report` (hành vi thêm ngoài spec phải dẫn test thật chứa lại từ khóa). L138, L139 là quy tắc test-design (tên biến cấu hình thay số giây cứng, không "bản giả"; ca chỉ có một tham số). L140 gộp vào L94 (tệp thăm dò của reviewer).

| Mã | File đã đổi | Ca hồi quy | Kết quả selftest |
|---|---|---|---|
| L137 | .claude/skills/sdlc-implement/scripts/check-report.mjs, .claude/skills/sdlc-implement/templates/report.md, .claude/skills/sdlc-implement/SKILL.md, .claude/skills/sdlc-implement/evals/traps.md | .claude/skills/sdlc-implement/scripts/check-report.test.mjs | 21/21 qua |
| L138 | .claude/skills/sdlc-test-design/SKILL.md, .claude/skills/sdlc-test-design/evals/traps.md, .claude/skills/sdlc-test-design/templates/tc.md | .claude/skills/sdlc-test-design/evals/traps.md | 21/21 qua |
| L139 | .claude/skills/sdlc-test-design/SKILL.md, .claude/skills/sdlc-test-design/evals/traps.md | .claude/skills/sdlc-test-design/evals/traps.md | 21/21 qua |
| L140 | .claude/skills/sdlc-review/SKILL.md, .claude/skills/sdlc-review/evals/traps.md | .claude/skills/sdlc-review/evals/traps.md | 21/21 qua |

