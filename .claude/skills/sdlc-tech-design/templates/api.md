---
id: ORD-API-00000000-000000000
title: API đơn hàng
epic: ORD
status: draft            # draft | approved | superseded
links: []                # ID requirement mà các endpoint phục vụ
depends_on: []           # module (mã epic) mà API này gọi trực tiếp; phải nằm trong cột Phụ thuộc ở architecture.md
emits: []                # domain event do epic này phát (Producer ở events.md)
consumes: []             # domain event mà epic này nhận (Consumers ở events.md)
---

Bám ADR-006: REST JSON `/api/v1`, lỗi `application/problem+json` kèm `trace_id`, phân trang `page`/`limit`.

## Endpoint
Cột Role: role được gọi, cách nhau bởi dấu phẩy (`own` ghi trong Ghi chú). Role khác `guest` bắt buộc có 401 và 403 ở cột Lỗi (mặc định từ chối, SB-05).

| Method | Path | Role | Requirement | Lỗi | Ghi chú |
|---|---|---|---|---|---|
| GET | /api/v1/orders | customer | ORD-REQ-... | 401, 403 | chỉ đơn của chính mình (own) |

## Hợp đồng dữ liệu
(request, response, ví dụ lỗi cho từng endpoint)

## Giao tiếp giữa module
(lời gọi trực tiếp và event, kèm vì sao; phải khớp `depends_on`, `emits`, `consumes`)
