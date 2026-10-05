---
status: draft
---
# Entity

Cột Quan hệ: danh sách cách nhau bởi `;`, mỗi mục dạng `<1|N>-<1|N> <Entity>` (bội số từ entity này sang entity kia).
Cột Vòng đời: **đường chính** của các trạng thái nối bằng `->`, hoặc `-` nếu không có. Nhánh lỗi, hủy, hết hạn nằm ở bảng "Vòng đời chi tiết" bên dưới.

| Entity | Epic | Khóa | Thuộc tính chính | Quan hệ | Vòng đời |
|---|---|---|---|---|---|
| User | AUTH | id | email, password_hash, role | 1-N Address | active -> locked |
| Address | USR | id | user_id, ward, district, city | N-1 User | - |

## Vòng đời chi tiết

Bảng chuyển trạng thái **đầy đủ**, gồm cả nhánh lỗi, hủy, hết hạn. Mọi trạng thái trong cột Vòng đời ở bảng trên phải có ở đây,
và mọi entity có vòng đời phải có dòng ở đây. Event ở `events.md` tham chiếu trạng thái trong bảng này (cột "Phát khi").

| Entity | Từ | Sang | Điều kiện |
|---|---|---|---|
| User | active | locked | ... |
