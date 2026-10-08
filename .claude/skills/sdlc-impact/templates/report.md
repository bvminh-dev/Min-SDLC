# Tác động của thay đổi <ID>

- **Thay đổi:** <đổi gì ở ID nào>
- **Lý do:** <vì sao đổi>
- **Người yêu cầu:** <ai quyết định đổi>

Quy tắc xuyên module (thứ tự kiểm, mã lỗi, giới hạn) bị chép lại ở epic khác: thêm dòng `Cụm từ xuyên module: "<cụm từ>"` (tìm bằng `find-refs.mjs spec/ --phrase`); `check-impact` đòi mọi tài liệu nhắc cụm đó có dòng trong bảng.

Tên file là ID của tài liệu bị đổi: `spec/changes/<ID>.md`.

| ID bị ảnh hưởng | Loại | Mức | Lý do | Việc cần làm |
|---|---|---|---|---|
| CHK-REQ-... | phải dựng lại | HIGH | BR2 ghi cứng giá trị cũ | Sửa BR2 và kịch bản Luồng chính, Ca biên |
| INV-TC-... | không đổi | - | Chỉ kiểm tồn kho giảm, không phụ thuộc giá trị đổi | - |
| spec/domain/entities.md | cần xem lại | LOW | Thuộc tính liên quan, có thể cần ghi chú | Người xác nhận |

Loại: `phải dựng lại` | `cần xem lại` | `không đổi`. Mức: `CRITICAL` | `HIGH` | `MEDIUM` | `LOW` | `-`.
Mọi tài liệu có `links` hoặc `covers` tới ID đều phải có dòng (kể cả `không đổi` kèm lý do): `check-impact.mjs` kiểm.

## Chưa chắc / rủi ro
- Epic chưa có spec bị chạm: ghi "chưa có spec, rủi ro", không đoán.
