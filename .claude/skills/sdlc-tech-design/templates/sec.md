---
id: ORD-SEC-00000000-000000000
title: Mô hình mối đe dọa đơn hàng
epic: ORD
status: draft            # draft | approved | superseded
links: []                # ID requirement mà phân tích này phục vụ
---

## Mối đe dọa
STRIDE: S giả mạo, T sửa dữ liệu, R chối bỏ, I lộ thông tin, D từ chối dịch vụ, E nâng quyền.
Cột SB: mã trong `spec/security-baseline.md`, cách nhau bởi dấu phẩy, hoặc `-` nếu là biện pháp mới (khi đó cần thêm vào baseline qua sdlc-foundation).
Cột Kiểm bằng phải chứa một từ: `test`, `hook`, `script`, `config`, `review`.

| Mã | STRIDE | Tài sản | Mối đe dọa | Biện pháp | SB | Kiểm bằng |
|---|---|---|---|---|---|---|
| T1 | E | Đơn của khách khác | Khách đổi order id để xem đơn người khác (IDOR) | Kiểm sở hữu ở server | SB-06 | test |

## Rủi ro còn lại
(điều chấp nhận, ai chịu trách nhiệm)
