# Đồng bộ spec CHK với mã đã chạy và review (REV-CHK-50 đến 55, bài học L68, L117, L121)

- **Thay đổi:** `CartService` thành `CartApi` (CHK-API hai hàng CRT, CHK-REQ ...105050948 BR3, ...105051681 BR2, ...105051977 BR1, ...105052272 BR1), bỏ chữ "không phải `*Service`" ở CHK-API (giữ `AddressService` của USR); `checkout-session-closed` mang `session_status` (không `status`: trùng khóa HTTP của problem+json); GET xem lại: 200 chỉ có trạng thái cho phiên đã đóng hay vừa quá hạn, 409 khi giỏ hiện hành khác giỏ phiên, và 429 ở GET xem lại, DELETE gỡ mã, DELETE hủy phiên (L121); `Gate` ⌊`DB_POOL_MAX` / 2⌋ và giới hạn đã biết (REV-CHK-50) ở CHK-SEC T18, CHK-DB và CHK-API; `district` là khóa thứ sáu của `shipping_address` của đơn (CHK-API, CHK-DB, CHK-REQ ...105052272 BR1, ...105051095 BR4, ORD-API, ORD-DB: xem `ord-district-20261013`); 409 `cart-limit-exceeded` của CRT đi qua CHK (CHK-API, CHK-REQ ...105052272).
- **Lý do:** review CHK (REV-CHK-50 `Gate`, REV-CHK-52 tên lớp, REV-CHK-53 `session_status`, REV-CHK-54 GET 409 và 429, REV-CHK-55 `district`), bài học L121; nền đã đồng bộ (ADR-012, ADR-016, bảng Giao diện module); mã CHK đúng, spec lệch, trừ `district` (người quyết giữ quận, huyện trên đơn nên mã đổi theo spec).
- **Người yêu cầu:** người dùng ("chạy tiếp đi"; quyết định giữ `district`, chấp nhận giới hạn của `Gate`); phân tích do Claude

Tài liệu bị đổi: CHK-API-20261006-105800712

| ID bị ảnh hưởng | Loại | Mức | Lý do | Việc cần làm |
|---|---|---|---|---|
| CHK-REQ-20261006-105050948 | không đổi | - | Đã sửa: BR3 `CartApi` | Đã sửa và duyệt lại |
| CHK-REQ-20261006-105051095 | không đổi | - | Đã sửa: BR4 `district` là khóa thứ sáu của đơn | Đã sửa và duyệt lại |
| CHK-REQ-20261006-105051681 | không đổi | - | Đã sửa: BR2 `CartApi`, BR9 (200 phiên quá hạn, 409 giỏ khác, 429 bậc C), kịch bản 429 | Đã sửa và duyệt lại |
| CHK-REQ-20261006-105051977 | không đổi | - | Đã sửa: BR1 `CartApi` | Đã sửa và duyệt lại |
| CHK-REQ-20261006-105052272 | không đổi | - | Đã sửa: BR1 `CartApi` và sáu khóa, BR2 `session_status`, hai kịch bản mới (`district`, `cart-limit-exceeded`) | Đã sửa và duyệt lại |
| CHK-REQ-20261006-105052414 | không đổi | - | Đã sửa: BR5 (409 kể cả GET, 429 hủy phiên), BR6 và ba kịch bản `session_status`, kịch bản 429 | Đã sửa và duyệt lại |
| CHK-DB-20261006-105800565 | không đổi | - | Đã sửa: bảng `checkout_sessions` sáu khóa, Giao dịch và khóa ý 3 ghi `Gate` và giới hạn đã biết | Đã sửa và duyệt lại |
| CHK-SEC-20261006-105800857 | không đổi | - | Đã sửa: T18 biện pháp `Gate` và giới hạn đã biết | Đã sửa và duyệt lại |
| CHK-TC-20261006-110703759 | không đổi | - | Đã sửa: `session_status` = `expired` | Đã sửa và duyệt lại |
| CHK-TC-20261006-110703826 | không đổi | - | Đã sửa: `session_status` = `expired` | Đã sửa và duyệt lại |
| CHK-TC-20261006-110703893 | không đổi | - | Đã sửa: `session_status` = `cancelled` | Đã sửa và duyệt lại |
| CHK-TC-20261006-110703860 | không đổi | - | `status` ở đây là trường của thân 200 của GET (phiên đã đóng), không phải lỗi: giữ nguyên | - |
| CHK-REQ-20261006-105051536 | cần xem lại | LOW | DELETE gỡ mã chung bộ đếm chọn 60 lần mỗi phút (429), nay ghi ở CHK-API và CHK-TC-20261013-210241326 nhưng requirement không có BR hay kịch bản 429 (requirement ngoài danh sách tệp được ủy quyền) | Thêm một câu BR và một kịch bản 429 vào requirement khi có lượt sửa kế tiếp |
| CHK-REQ-20261006-105051242 | không đổi | - | CHK cắt `subtotal` về 10.000.000.000 khi hỏi phí SHP (report CHK mục 13) nên bước chọn vận chuyển không 503 với giỏ vượt trần; chỉ đặt hàng trả 409 `cart-limit-exceeded` (báo cáo `crt-tran-tam-tinh-20261013`) | - |
| CHK-TC-20261013-210240854 | không đổi | - | TC mới: `district` ở đơn (chuỗi và null), sáu khóa | Đã duyệt; test `apps/api/test/checkout/sync.spec.ts` |
| CHK-TC-20261013-210241009 | không đổi | - | TC mới: xem lại 429 | Đã duyệt; cùng test |
| CHK-TC-20261013-210241168 | không đổi | - | TC mới: hủy phiên 429 | Đã duyệt; cùng test |
| CHK-TC-20261013-210241326 | không đổi | - | TC mới: gỡ mã 429 | Đã duyệt; cùng test |
| CHK-TC-20261013-210241484 | không đổi | - | TC mới: giỏ vượt trần thì đặt hàng 409 `cart-limit-exceeded` và hoàn tác sạch | Đã duyệt; cùng test |
| CHK-TC-20261013-211638651 | không đổi | - | TC mới (L61): job hết hạn phiên và xóa bản chụp có hạn thời gian, tín hiệu hủy, giới hạn lô | Đã duyệt; cùng test |
| ORD-API-20261006-092703780 | không đổi | - | Đã sửa hàng CHK: sáu khóa `shipping_address`; xem `ord-district-20261013` | Đã sửa và duyệt lại |
| CRT-API-20261006-103824592 | không đổi | - | Đã sửa cùng đợt (báo cáo `crt-dong-bo-spec-20261013`) | Đã sửa và duyệt lại |

## Chưa chắc / rủi ro
- `Gate` không bao thao tác chọn, tạo, hủy phiên và sửa giỏ của cùng khách: khi pool chỉ 2 kết nối, đặt hàng có thể 503 sau khoảng 2,6 giây (hoàn tác sạch). Chấp nhận, ghi ở CHK-SEC T18 và CHK-DB; muốn chặt hơn thì đổi mã CHK.
- Giỏ vượt trần: màn xem lại và bước chọn của CHK vẫn hoạt động (CHK cắt `subtotal` về 10.000.000.000 khi hỏi phí SHP); chỉ đặt hàng bị 409 `cart-limit-exceeded`. Hai cách xử lý trần (cắt ở CHK, chặn ở CRT) cùng tồn tại; người duyệt quyết có thống nhất một cách không.
