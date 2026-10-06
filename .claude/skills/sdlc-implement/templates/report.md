---
epic: ORD
status: draft
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
Mỗi test case và E2E của epic một dòng. Test code: đường dẫn file (tính từ gốc dự án) có chứa ID trong tên test hoặc comment. Kết quả: pass | fail | skip (skip bắt buộc ghi lý do ở Ghi chú).

| ID | Loại | Test code | Kết quả | Ghi chú |
|---|---|---|---|---|
| ORD-TC-... | TC | apps/api/test/orders.spec.ts | pass | - |

## Lệch spec
Chỗ code làm khác spec (và vì sao), hoặc `Không có`. Lệch cần sửa spec thì chạy `sdlc-impact`, không sửa spec trong lúc triển khai.
