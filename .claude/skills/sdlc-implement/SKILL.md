---
name: sdlc-implement
description: Triển khai code cho một epic từ thiết kế kỹ thuật, màn hình và test case đã có: chia task theo phụ thuộc, viết test trước rồi code, chạy test, ghi báo cáo truy vết (task, test case, lệch spec) vào spec/epics/<EPIC>/report.md. Dùng sau sdlc-test-design của epic.
---

# sdlc-implement

Đầu vào: epic đã có requirement, thiết kế kỹ thuật (DB, API, SEC), màn hình (`ui/`, `spec/testids.md`) và test (TC, E2E), tất cả đã duyệt. Đầu ra theo `.claude/sdlc/contract.md`: **code** và `spec/epics/<EPIC>/report.md`.

Skill này **không quyết định lại** thiết kế. Code làm đúng spec; chỗ spec sai hay thiếu thì ghi vào *Lệch spec* và chạy `sdlc-impact`, không âm thầm làm khác.

## Quy tắc cứng
- **Không sửa `spec/`** (trừ `report.md` của epic). Spec đã duyệt do người sửa qua `sdlc-impact`.
- **Truy vết bằng ID**: mỗi test trong code mang ID test case (`ORD-TC-...`) hoặc E2E trong tên test hoặc comment. Hook/script kiểm.
- **Bám ADR**: stack, cấu trúc dự án, cách migration, định dạng lỗi, log theo `spec/architecture.md` (ADR-002, 003, 006, 008...). Chưa có khung dự án thì dựng đúng ADR-002 trước (task đầu tiên), không chọn khác.
- **Test trước, code sau** cho phần nghiệp vụ: viết test từ TC, thấy fail đúng lý do, rồi viết code cho qua.
- **Kiểm đột biến dùng script chung** `node .claude/skills/sdlc-review/scripts/mutate.mjs <mutations.json> --cwd .` (danh sách `{id, file, find, replace, equivalent?}` và lệnh test; tự khôi phục tệp; phân loại `bắt` / `lọt` / `hỏng biên dịch`; thoát 1 khi có `lọt` chưa ghi `equivalent`), không viết script riêng cho epic. Đột biến phải phủ cả phần nền sửa kèm (platform, module khác), không chỉ SB của epic.
- **Mã nền sửa kèm thì test nền đổi theo.** Sửa mã module khác (ví dụ `modules/platform/`) phải có test dưới `test/<module đó>/` đổi theo; mục *Lệch spec* ghi "sửa mã nền" nêu ID TC hay E2E cho từng chỗ sửa.
- **Không để trạng thái UI có thời hạn mà thiếu đường thoát, không đo thời gian tuần tự.** Test so thời gian hai nhánh phải đo xen kẽ (hoặc đếm số lần gọi hàm băm); mốc thời gian cứng trong test dùng đồng hồ giả cho mọi nguồn thời gian (`fixed-clock: <lý do>`); "nhiễu đo" của test đỏ phải kèm bản sửa hoặc việc cho người.
- **Nhãn *Lệch spec* đúng nội dung.** Mục còn chờ `sdlc-impact`/`sdlc-foundation` ("nên ghi vào ADR", "nên thêm TC qua sdlc-impact") là `[cần quyết]` (hoặc `[chưa làm]`), không phải `[đã chọn]`.
- **Khung dự án: thay test-first bằng đột biến.** Khung dự án (monorepo, platform) không có lần "fail đúng lý do": gài đột biến có chủ ý vào mã, chạy test, ghi bảng `## Kiểm đột biến` (mỗi SB `Kiểm bằng: test` có ít nhất một đột biến; đột biến lọt thì sửa test). Epic có TC `lỗi` kiểm mối đe dọa SEC cũng phải có bảng này.
- **Bằng chứng yếu thì nói thẳng.** Ghi chú của TC bắt đầu bằng `YẾU:` khi test kém hơn Then của TC (fixture thay dữ liệu thật, chưa chạy trong container sạch...), kèm lý do và cách nâng ở *Lệch spec*.
- **Chạy lại như CI.** `clean_run: pass` chỉ khi bốn lệnh chuẩn (lint, typecheck, test, build) đã chạy trong bản clone sạch (`git worktree`, `env -i`, chỉ biến và dịch vụ khai trong workflow); không thì `clean_run: chưa` và một dòng `CI chưa chạy: <lý do>`. Test không cứng đường dẫn máy dev (`/Users/`, `/opt/homebrew`, `.nvm/versions`...).
- **Cổng kiểm phải đỏ khi công cụ hỏng** (registry lỗi, kết quả rỗng) và bộ quét có ca dương tính cho từng mẫu; kiểm chung của repo (route audit, boundaries) chạy trên đối tượng thật (`AppModule`), không chỉ fixture.
- **Không nói "pass" khi chưa chạy.** `test_command` và `test_result` trong báo cáo là lệnh đã chạy và dòng tóm tắt nó in ra, chép nguyên.

## Quy trình
0. **Nạp framework tham chiếu.** Đọc `.claude/sdlc/adapter/active.md` và dòng phase `implement` trong file mapping; đọc các file ở cột *Đọc* (`tasks-template.md`, `tasks.md`, `implement.md`) để lấy cách chia task theo phụ thuộc và thứ tự thực thi. Cột *Kit tự làm* là phần dưới đây (báo cáo lệch spec, truy vết).
1. **Đọc bối cảnh**: mọi tài liệu của epic (`requirements/`, `design/`, `ui/`, `tests/`), `spec/testids.md`, `spec/architecture.md`, `spec/constitution.md`. Thiếu loại tài liệu nào thì dừng và nói chạy skill nào trước.
2. **Lập kế hoạch task** (bảng đầu của `templates/report.md`): thứ tự DB, rồi API, rồi giao diện; mỗi task nêu tài liệu spec nó thực hiện (Nguồn) và task nó phụ thuộc. Task nhỏ, kiểm được độc lập.
3. **Làm từng task theo thứ tự**: viết test từ TC/E2E (testid dùng đúng `spec/testids.md`), chạy thấy fail, viết code, chạy thấy pass, cập nhật Trạng thái. Task bị chặn thì `blocked` kèm lý do, không bỏ qua.
4. **Chạy toàn bộ test** bằng lệnh theo ADR-002; chép lệnh và dòng tóm tắt vào `test_command`, `test_result`.
5. **Ghi báo cáo** `spec/epics/<EPIC>/report.md` theo `templates/report.md` (giữ `kit_version: 3`): kế hoạch task, kết quả test (mỗi TC và E2E của epic một dòng, kèm file test), *Kiểm đột biến*, *Lệch spec* (mỗi mục có nhãn `[đã chọn]`, `[chưa làm]` hoặc `[cần quyết]`).
6. **Kiểm cứng** (sửa tới khi qua): `node .claude/skills/sdlc-implement/scripts/check-report.mjs spec/ . --epic <EPIC>` (đối số thứ hai là thư mục gốc mã; hook cũng tự chạy khi sửa `report.md`).
7. **Báo cáo ngắn**: task xong/blocked, test pass/fail/skip, danh sách *Lệch spec* cần người quyết (chuyển `sdlc-impact` nếu cần sửa spec).

## Script kiểm (`scripts/check-report.mjs`)
Báo cáo có `test_command`, `test_result`, bảng task (Nguồn có thật trong spec, Phụ thuộc là số task, Trạng thái hợp lệ), bảng kết quả test phủ **mọi** TC/E2E của epic, mỗi file test **tồn tại và chứa ID**, `skip` có lý do, có mục *Lệch spec*. Với `kit_version: 3` (hoặc `--strict`; báo cáo `kit_version: 2` chỉ cảnh báo) còn là lỗi: mục `[đã chọn]` còn chờ sdlc-impact/sdlc-foundation (L43), mốc thời gian cứng quanh hôm nay trong test không có `fixed-clock:` (L49), sửa mã module khác (`src/modules/<m>/`, so với HEAD hoặc `--base <ref>`) mà không có test đổi theo ở `test/<m>/` và mục "sửa nền" không nêu ID TC/E2E (L53), hai `medianMs(` liền nhau trong một test và "nhiễu đo" không kèm bản sửa (L55). Với `kit_version: 2` (hoặc `--strict`) còn là lỗi: thiếu `clean_run` (`chưa` đòi dòng `CI chưa chạy:`), dòng `YẾU:` không được giải thích, file test chứa đường dẫn máy dev (`check-report:allow <lý do>` để miễn), thiếu bảng *Kiểm đột biến* (>= 3 dòng, Test đỏ là ID trong bảng kết quả) khi task 1 là khung dự án hoặc epic có TC `lỗi` kiểm SEC, mục *Lệch spec* thiếu nhãn. Báo cáo cũ không có `kit_version` chỉ bị cảnh báo. Đầu ra in số dòng `YẾU` và số mục *Lệch spec* theo nhãn để review đọc ngay. Script **không chạy test** và không biết test có thật sự pass: đó là việc của người chạy lệnh và của `review`. Tự kiểm: `node .claude/skills/sdlc-implement/scripts/check-report.test.mjs`.

## Chưa làm
- Eval: `evals/README.md`, ca `prj` (cần code thật); chưa chạy lần nào (chưa có RESULTS.md).
- Hook chưa tự chạy lệnh test (chưa có khung dự án để biết lệnh).
