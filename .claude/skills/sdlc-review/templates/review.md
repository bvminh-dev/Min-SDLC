---
epic: ORD
status: draft
reviewed_commit: abc1234     # git rev-parse --short HEAD của mã đã review
---
# Review: ORD

Kết quả: `đạt` | `lệch` | `chưa làm` | `không áp dụng`. Bằng chứng: `đường/dẫn/file:dòng`, cách nhau bởi dấu phẩy (bắt buộc với `đạt` và `lệch`; đường dẫn tính từ gốc dự án). `lệch` và `chưa làm` phải có Việc cần làm.

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

## Việc còn thiếu
(tóm tắt các dòng `lệch` và `chưa làm`, xếp theo mức nghiêm trọng)
