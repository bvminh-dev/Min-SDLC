---
epic: ORD
status: draft
kit_version: 4                 # bắt buộc giữ: bật kiểm cứng của check-report (clean_run, Kiểm đột biến, nhãn Lệch spec, YẾU, đường dẫn máy, nhãn đúng nội dung, mốc thời gian cứng, sửa nền không test, đo tuần tự; từ bản 4: dòng đệm, mã lỗi tự đặt, thư mục tạm không xóa, so thời gian không đếm, clean_run bằng script, biến cấu hình chưa thử, hẹn sửa lỗi mã, hành vi thêm ngoài spec, giá trị giữ chỗ)
clean_run: chưa                # pass | chưa. pass = đã chạy `node .claude/skills/sdlc-implement/scripts/clean-run.mjs` (git worktree, env -i, install/scan/boundaries/lint/typecheck/test/build) và ghi lệnh cùng mã thoát từng bước ở Lệch spec hoặc phụ lục. chưa thì Lệch spec phải có dòng "CI chưa chạy: <lý do>"
test_command: pnpm test        # lệnh đã chạy (theo ADR-002)
test_result: 12 pass, 0 fail   # dòng tóm tắt do lệnh in ra, chép nguyên
---
# Báo cáo triển khai: ORD

## Kế hoạch task
Thứ tự theo phụ thuộc: DB, rồi API, rồi giao diện. Cột Nguồn: ID tài liệu spec mà task thực hiện (DB, API, UI dùng ID màn hình `ui/<màn>`). Trạng thái: todo | doing | done | blocked.

| # | Task | Nguồn | Phụ thuộc | Trạng thái |
|---|---|---|---|---|
| 1 | Migration bảng orders | ORD-DB-... | - | done |
| 2 | Endpoint GET /api/v1/orders | ORD-API-... | 1 | done |

## Kết quả test
Mỗi test case và E2E của epic một dòng. Test code: đường dẫn file (tính từ gốc dự án) có chứa ID trong tên test hoặc comment. Kết quả: pass | fail | skip (skip bắt buộc ghi lý do ở Ghi chú). Ghi chú bắt đầu bằng `YẾU:` khi bằng chứng kém hơn Then của TC (fixture thay dữ liệu thật, không chạy trong container sạch, phiên bản công cụ khác TC...): mục Lệch spec phải nhắc ID đó kèm lý do và cách nâng bằng chứng. File test không được chứa đường dẫn máy dev (`/Users/`, `/home/<tên>`, `/opt/homebrew`, `.nvm/versions`, ổ đĩa Windows); ngoại lệ ghi `check-report:allow <lý do>` trên cùng dòng.

| ID | Loại | Test code | Kết quả | Ghi chú |
|---|---|---|---|---|
| ORD-TC-... | TC | apps/api/test/orders.spec.ts | pass | - |

## Kiểm đột biến
Khung dự án (không có lần test "fail đúng lý do") hoặc epic có TC `lỗi` kiểm mối đe dọa SEC: gài đột biến có chủ ý vào mã rồi chạy test; ít nhất 3 dòng, mỗi SB `Kiểm bằng: test` có ít nhất một đột biến. Dùng script chung `node .claude/skills/sdlc-review/scripts/mutate.mjs` (không viết script riêng); phủ cả phần nền sửa kèm. Test đỏ: ID có trong bảng Kết quả test (`-` chỉ khi Kết quả `lọt`). Kết quả bắt đầu bằng `bắt` hoặc `lọt` (lọt thì sửa test hoặc ghi vào Lệch spec).

| Chỗ phá | Test đỏ | Kết quả |
|---|---|---|
| bỏ lọc `user_id` ở SELECT | ORD-TC-... | bắt |

## Lệch spec
Chỗ code làm khác spec (và vì sao), hoặc `Không có`. Lệch cần sửa spec thì chạy `sdlc-impact`, không sửa spec trong lúc triển khai. Mỗi mục đánh số và bắt đầu bằng một nhãn: `[đã chọn]` (quyết định mặc định đã làm, nêu lý do và rủi ro), `[chưa làm]` (spec yêu cầu mà chưa làm; review phải có dòng `lệch` hoặc `chưa làm` tương ứng), `[cần quyết]` (cần người quyết; cũng dùng cho việc còn chờ `sdlc-impact`/`sdlc-foundation`, "nên ghi vào ADR"). Sửa mã module khác (nền) thì nêu ID TC/E2E kiểm từng chỗ sửa. "Nhiễu đo" của test đỏ phải kèm bản sửa hoặc đổi sang `[cần quyết]`. Mốc thời gian cứng trong test ghi `fixed-clock: <lý do>`. Hành vi thêm ngoài spec: mục mở đầu `Thêm ngoài spec` và dẫn tệp test thật chứa lại từ khóa hành vi (thuộc tính áp cho N route thì test duyệt cả danh sách route). Mã lỗi tự đặt (không có ở spec của epic): nêu mã ở một mục. Lỗi của chính mã đang làm thì sửa ngay, không ghi "nên sửa ở lượt review". Không sửa mã hay thêm dòng ghi chú để số dòng bằng chứng của review khác còn hợp lệ. Test tạo thư mục tạm (mkdtemp, tmpdir) phải xóa ở afterAll/finally, hoặc ghi `tmp-hygiene: <lý do>` trên dòng đó. Biến cấu hình mới (`cfg.*({ default })`) cần một test gán giá trị khác mặc định. Không để chữ giữ chỗ `TBD`, `TODO`, `0000000`.

1. [đã chọn] (ví dụ) Chọn phiên bản X vì Y; rủi ro Z.
