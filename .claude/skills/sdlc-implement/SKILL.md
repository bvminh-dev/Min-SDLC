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
- **Không nói "pass" khi chưa chạy.** `test_command` và `test_result` trong báo cáo là lệnh đã chạy và dòng tóm tắt nó in ra, chép nguyên.

## Quy trình
0. **Nạp framework tham chiếu.** Đọc `.claude/sdlc/adapter/active.md` và dòng phase `implement` trong file mapping; đọc các file ở cột *Đọc* (`tasks-template.md`, `tasks.md`, `implement.md`) để lấy cách chia task theo phụ thuộc và thứ tự thực thi. Cột *Kit tự làm* là phần dưới đây (báo cáo lệch spec, truy vết).
1. **Đọc bối cảnh**: mọi tài liệu của epic (`requirements/`, `design/`, `ui/`, `tests/`), `spec/testids.md`, `spec/architecture.md`, `spec/constitution.md`. Thiếu loại tài liệu nào thì dừng và nói chạy skill nào trước.
2. **Lập kế hoạch task** (bảng đầu của `templates/report.md`): thứ tự DB, rồi API, rồi giao diện; mỗi task nêu tài liệu spec nó thực hiện (Nguồn) và task nó phụ thuộc. Task nhỏ, kiểm được độc lập.
3. **Làm từng task theo thứ tự**: viết test từ TC/E2E (testid dùng đúng `spec/testids.md`), chạy thấy fail, viết code, chạy thấy pass, cập nhật Trạng thái. Task bị chặn thì `blocked` kèm lý do, không bỏ qua.
4. **Chạy toàn bộ test** bằng lệnh theo ADR-002; chép lệnh và dòng tóm tắt vào `test_command`, `test_result`.
5. **Ghi báo cáo** `spec/epics/<EPIC>/report.md` theo `templates/report.md`: kế hoạch task, kết quả test (mỗi TC và E2E của epic một dòng, kèm file test), *Lệch spec*.
6. **Kiểm cứng** (sửa tới khi qua): `node .claude/skills/sdlc-implement/scripts/check-report.mjs spec/ . --epic <EPIC>` (đối số thứ hai là thư mục gốc mã; hook cũng tự chạy khi sửa `report.md`).
7. **Báo cáo ngắn**: task xong/blocked, test pass/fail/skip, danh sách *Lệch spec* cần người quyết (chuyển `sdlc-impact` nếu cần sửa spec).

## Script kiểm (`scripts/check-report.mjs`)
Báo cáo có `test_command`, `test_result`, bảng task (Nguồn có thật trong spec, Phụ thuộc là số task, Trạng thái hợp lệ), bảng kết quả test phủ **mọi** TC/E2E của epic, mỗi file test **tồn tại và chứa ID**, `skip` có lý do, có mục *Lệch spec*. Script **không chạy test** và không biết test có thật sự pass: đó là việc của người chạy lệnh và của `review`. Tự kiểm: `node .claude/skills/sdlc-implement/scripts/check-report.test.mjs`.

## Chưa làm
- Chưa chạy trên code thật; chưa có eval.
- Hook chưa tự chạy lệnh test (chưa có khung dự án để biết lệnh).
