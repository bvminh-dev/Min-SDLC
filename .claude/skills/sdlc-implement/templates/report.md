---
epic: ORD
status: draft
kit_version: 2                 # bắt buộc giữ: bật kiểm cứng của check-report (clean_run, Kiểm đột biến, nhãn Lệch spec, YẾU, đường dẫn máy)
clean_run: chưa                # pass | chưa. pass = đã chạy bốn lệnh chuẩn (lint, typecheck, test, build) trong bản clone sạch (`git worktree`, `env -i`, chỉ biến và dịch vụ khai trong workflow CI). chưa thì Lệch spec phải có dòng "CI chưa chạy: <lý do>"
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
Khung dự án (không có lần test "fail đúng lý do") hoặc epic có TC `lỗi` kiểm mối đe dọa SEC: gài đột biến có chủ ý vào mã rồi chạy test; ít nhất 3 dòng, mỗi SB `Kiểm bằng: test` có ít nhất một đột biến. Test đỏ: ID có trong bảng Kết quả test (`-` chỉ khi Kết quả `lọt`). Kết quả bắt đầu bằng `bắt` hoặc `lọt` (lọt thì sửa test hoặc ghi vào Lệch spec).

| Chỗ phá | Test đỏ | Kết quả |
|---|---|---|
| bỏ lọc `user_id` ở SELECT | ORD-TC-... | bắt |

## Lệch spec
Chỗ code làm khác spec (và vì sao), hoặc `Không có`. Lệch cần sửa spec thì chạy `sdlc-impact`, không sửa spec trong lúc triển khai. Mỗi mục đánh số và bắt đầu bằng một nhãn: `[đã chọn]` (quyết định mặc định đã làm, nêu lý do và rủi ro), `[chưa làm]` (spec yêu cầu mà chưa làm; review phải có dòng `lệch` hoặc `chưa làm` tương ứng), `[cần quyết]` (cần người quyết).

1. [đã chọn] (ví dụ) Chọn phiên bản X vì Y; rủi ro Z.
