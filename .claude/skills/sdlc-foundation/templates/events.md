---
status: draft
---
# Domain event

Mỗi event có đúng một bên phát (Producer). Consumers là danh sách mã epic cách nhau bởi dấu phẩy, hoặc `-`.
Phát khi: `Entity:trạng_thái` mà event được phát ra khi entity chuyển sang trạng thái đó (trạng thái phải có trong "Vòng đời chi tiết" của `entities.md`), hoặc `-` nếu không gắn với đổi trạng thái.

| Event | Entity | Producer | Consumers | Payload | Phát khi |
|---|---|---|---|---|---|
| UserLocked | User | AUTH | NTF | user_id, reason | User:locked |
