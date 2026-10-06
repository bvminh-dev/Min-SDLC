---
id: ORD-DB-00000000-000000000
title: Lược đồ dữ liệu đơn hàng
epic: ORD
status: draft            # draft | approved | superseded
links: []                # ID requirement mà thiết kế này phục vụ
entities: [Order, OrderItem]   # entity của epic này (spec/domain/entities.md)
---

Bám ADR-003 (PostgreSQL, Prisma Migrate).

## Bảng
| Bảng | Entity | Khóa | Ràng buộc / chỉ mục |
|---|---|---|---|
| orders | Order | id | FK user_id; unique(code); index(user_id, created_at) |
| order_items | OrderItem | id | FK order_id ON DELETE CASCADE; quantity > 0 |

## Trạng thái hợp lệ
Phải khớp đúng tập trạng thái trong "Vòng đời chi tiết" của `entities.md`. Mỗi trạng thái một dòng; ghi cách ràng buộc (CHECK, enum) ở cột sau.

| Entity | Trạng thái | Ràng buộc |
|---|---|---|
| Order | pending | enum order_status |

## Giao dịch và khóa
(chỗ nào cần giao dịch, khóa dòng, idempotency; trỏ requirement tương ứng)

## Migration
(thứ tự, dữ liệu mồi, cách rollback)
