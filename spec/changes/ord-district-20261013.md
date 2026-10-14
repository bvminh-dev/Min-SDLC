# Tác động của `district` là khóa thứ sáu của `shipping_address` (REV-CHK-55)

- **Thay đổi:** `Order.shipping_address` đóng với đúng sáu khóa `receiver`, `phone`, `line1`, `ward`, `district`, `city` (trước đó năm khóa, không quận, huyện). `district` là chuỗi hoặc `null` (USR cho phép rỗng, E-06), khóa luôn có mặt ở đơn mới; đơn cũ chỉ có năm khóa, đọc coi `district` là không có. Mã: `OrderApi.createPending` (`create.service.ts`) kiểm sáu khóa; CHK truyền `district` (`place.service.ts`); màn chi tiết đơn của khách hiện quận, huyện khi có (`apps/web/app/orders/[code]/page.tsx`, `lib/order.ts`). Bản chụp là JSONB nên KHÔNG có migration; không thêm CHECK khóa vì CHECK làm bản ứng dụng cũ INSERT lỗi và đơn cũ không có `district` (thu hẹp là bước hai theo `check-migration-compat`, chưa làm).
- **Lý do:** REV-CHK-55 (khách mất quận, huyện trên đơn); người dùng quyết giữ quận, huyện.
- **Người yêu cầu:** người dùng ("chạy tiếp đi"); phân tích do Claude

Tài liệu bị đổi: ORD-DB-20261006-092703753

| ID bị ảnh hưởng | Loại | Mức | Lý do | Việc cần làm |
|---|---|---|---|---|
| ORD-API-20261006-092703780 | không đổi | - | Đã sửa: hàng CHK của mục Giao diện module (sáu khóa, `district` chuỗi hoặc null, đơn cũ) | Đã sửa và duyệt lại |
| spec/architecture.md | không đổi | - | Đã sửa: đoạn Hành vi lỗi của giao diện ORD (sáu khóa) và nhật ký thay đổi nền | Đã sửa và duyệt lại |
| CHK-API-20261006-105800712 | không đổi | - | Đã sửa: hàng ORD `createPending` (sáu khóa) | Đã sửa và duyệt lại |
| CHK-DB-20261006-105800565 | không đổi | - | Đã sửa: ghi chú `address_snapshot` (chép sáu khóa) | Đã sửa và duyệt lại |
| CHK-REQ-20261006-105052272 | không đổi | - | Đã sửa: BR1 sáu khóa và kịch bản `district` | Đã sửa và duyệt lại |
| CHK-REQ-20261006-105051095 | không đổi | - | Đã sửa: BR4 sáu khóa | Đã sửa và duyệt lại |
| ORD-TC-20261013-211722071 | không đổi | - | TC mới: `createPending` nhận `district` chuỗi hoặc null, bác thiếu, rỗng, không phải chuỗi, khóa lạ | Đã duyệt; test `apps/api/test/order/create.spec.ts` |
| ORD-TC-20261006-120227769 | phải dựng lại | LOW | Then viết "`shipping_address` có đúng năm khóa `receiver`, `phone`, `line1`, `ward`, `city`": nay sáu khóa (tài liệu ngoài danh sách tệp được ủy quyền; test thật đã khẳng định sáu khóa) | Đổi Then thành sáu khóa có `district` |
| ORD-TC-20261006-111225380 | phải dựng lại | LOW | Given viết `shipping_address` "đúng năm khóa" ở đầu vào `createPending`: nay sáu khóa (test dùng đầu vào sáu khóa) | Đổi Given thành sáu khóa có `district` |
| ORD-TC-20261007-182432982 | phải dựng lại | MEDIUM | Tên, bước When ca (a) "thừa khóa `district`" và Then "đúng năm khóa" trái hành vi mới: thiếu `district` mới bị bác, `district` thừa không còn là ca lỗi; ghi chú nói CHK bỏ `district` | Viết lại ca (a) thành "thiếu khóa `district`" và Then sáu khóa; xóa câu "CHK bỏ `district`" (ORD-TC-20261013-211722071 đã phủ phần mới) |
| ORD-TC-20261006-111224930 | cần xem lại | LOW | Then viết "`shipping_address` ... (đúng năm khóa, không có `district`)" cho đơn mồi cũ năm khóa của chi tiết đơn: vẫn đúng với đơn cũ, sai với đơn mới | Ghi rõ "đơn cũ năm khóa" hoặc thêm ca đơn mới sáu khóa |
| ORD-TC-20261006-120228061 | cần xem lại | LOW | Then viết "trả đúng năm khóa" ở `getRecipient` (bản chụp lúc đặt): `getRecipient` vẫn trả năm khóa (không `district`) nên vẫn đúng; nhắc để người duyệt quyết có thêm `district` vào vận đơn | Người duyệt quyết: thêm `district` vào `getRecipient` và vận đơn của SHP (đổi bảng Giao diện module, ORD-API, SHP-API) hoặc giữ |
| SHP-TC-20261006-102133988 | không đổi | - | Recipient của vận đơn vẫn gồm năm khóa, không `district` (`getRecipient` không đổi) | - |

## Chưa chắc / rủi ro
- Vận đơn và màn bàn giao của SHP vẫn chỉ có `line1`, `ward`, `city` (`OrderApi.getRecipient` giữ năm khóa): quận, huyện có trên đơn và màn chi tiết đơn của khách nhưng chưa tới vận đơn; người duyệt quyết.
- Đơn tạo trước 2026-10-13 không có `district`: giao diện hiện địa chỉ bỏ phần quận, huyện (đã xử lý); không cần di trú.
