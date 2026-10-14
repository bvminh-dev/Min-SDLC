---
epic: ORD
status: draft
kit_version: 4               # bắt buộc giữ: bật kiểm cứng của check-review (Kết quả chạy lại, reviewed_tree, khớp [chưa làm], Kết quả sau sửa; từ bản 4: không còn giá trị giữ chỗ TBD/TODO/0000000, ô Kết quả thật có số pass, bằng chứng không trỏ dòng trống hay chỉ `}`)
reviewed_commit: abc1234     # git rev-parse --short HEAD của mã đã review
reviewed_tree: <40 chữ số hex>  # khi mã bẩn hoặc chưa commit (bắt buộc đúng 40 chữ số hex, không dùng giá trị giữ chỗ): node .claude/skills/sdlc-review/scripts/check-review.mjs --tree <gốc mã>; xóa dòng này nếu mã sạch
---
# Review: ORD

Kết quả: `đạt` | `lệch` | `chưa làm` | `không áp dụng`. Bằng chứng: `đường/dẫn/file:dòng`, cách nhau bởi dấu phẩy (bắt buộc với `đạt` và `lệch`; đường dẫn tính từ gốc dự án). `lệch` và `chưa làm` phải có Việc cần làm.

## Kết quả chạy lại
Reviewer tự chạy lại, không tin `report.md`: phải có dòng chứa `test_command` của report (kết quả kiểu `Tests: N passed` để script so với `test_result`). Cột So với report.md: `khớp` chỉ khi số pass giống; lệch thì ghi `lệch: <vì sao>`. Thêm dòng cho lint, typecheck, build, đột biến đã thử bằng `scripts/mutate.mjs` (mỗi SB `Kiểm bằng: test`, mỗi chỗ nền sửa kèm; dán bảng nó in) và các cổng kiểm đã tái hiện bằng tay.

| Lệnh | Kết quả thật | So với report.md |
|---|---|---|
| `pnpm test` | Tests: 12 passed, 12 total | khớp |

## Đối chiếu spec
Mỗi endpoint trong tài liệu API của epic một dòng (Nguồn là ID tài liệu API, Mục ghi `METHOD path`), cộng các quy tắc nghiệp vụ đáng kiểm.

| Mục | Nguồn | Kết quả | Bằng chứng | Việc cần làm |
|---|---|---|---|---|
| GET /api/v1/orders | ORD-API-... | đạt | apps/api/src/orders/orders.controller.ts:21 | - |

## Quyền
Mỗi hành động của epic trong `spec/permissions-matrix.md` một dòng: code có chặn đúng role không (kể cả mặc định từ chối).

| Hành động | Nguồn | Kết quả | Bằng chứng | Việc cần làm |
|---|---|---|---|---|
| Hủy đơn | ORD-REQ-... | đạt | apps/api/src/orders/orders.guard.ts:10 | - |

## Bảo mật
Mỗi yêu cầu `SB-nn` của `spec/security-baseline.md` có epic liên quan là epic này (hoặc `*`) một dòng.

| Mục | Nguồn | Kết quả | Bằng chứng | Việc cần làm |
|---|---|---|---|---|
| SB-06 chống IDOR | SB-06 | đạt | apps/api/src/orders/orders.service.ts:44 | - |

## Kết quả sau sửa
Tùy chọn: chỉ khi reviewer được giao sửa mã hoặc test. Bắt buộc khi có dòng nào ở ba bảng trên có Việc cần làm bắt đầu bằng "Đã sửa". Đã sửa ở: `file:dòng` có thật (số dòng ứng với mã sau sửa, nên `reviewed_tree` tính sau sửa). Chứng minh: test nào đỏ khi bỏ bản sửa.

| Phát hiện (mức) | Đã sửa ở | Chứng minh |
|---|---|---|
| MEDIUM: nút khóa mãi sau 429 | apps/web/app/login/page.tsx:27 | E2E ORD-E2E-... đỏ khi bỏ bản sửa |

## Việc còn thiếu
(tóm tắt các dòng `lệch` và `chưa làm`, xếp theo mức nghiêm trọng)
