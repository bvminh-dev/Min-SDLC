# Tác động của đợt đồng bộ nền 2026-10-13 (spec/architecture.md, SB-18, events.md, PRJ)

- **Thay đổi:** `spec/architecture.md`: ADR-007 (đủ biến cấu hình thật: chín biến `VNPAY_*`, `PAY_*`, `SES_ACCESS_KEY`, `SES_SECRET_KEY`, `SES_ENDPOINT`, `APP_BASE_URL` gốc URL, `DB_POOL_MAX` từ 2, `TRUST_PROXY_HOPS`, `REV_IMAGE_PROCESS_TIMEOUT_MS`, `USR_AVATAR_PROCESS_TIMEOUT_MS`, đơn vị phút của `RESERVATION_TTL`), ADR-010 (SES v2 `Simple` ký SigV4, không SDK), ADR-011 (consumer hai pha, `SKIP`, `subscribeRaw`, `idle()`, bác payload không phải đối tượng, `occurred_at` là `clock_timestamp()`), ADR-012 (hold-and-wait, `Gate` của CHK, giới hạn đã biết), ADR-013 (lịch job là chu kỳ từ lúc khởi động), ADR-014 (khóa bộ đếm gồm method, đường dẫn mẫu, độ dài cửa sổ; chủ thể mặc định; IPv4 ánh xạ IPv6), ADR-016 (thứ tự guard thật, `session_expired`), ADR-023 (một mã hai status, `extra` danh sách và đối tượng), bảng Giao diện module (tên lớp `*Api`, chữ ký, hành vi lỗi), Nhật ký thay đổi nền. `spec/security-baseline.md` SB-18 (dạng `user_id` trong log). `spec/domain/events.md` (quy tắc consumer). Mã đã cài: `rate-limit.ts` (khóa kèm cửa sổ), `client-ip.ts` (chuẩn hóa IP), `events.service.ts` (bác payload sai), PAY bỏ `normalizeIp` riêng.
- **Lý do:** bài học L70, L71, L72, L82, L84, L85, L103, L115, L129, L133 (loại `spec`) và các review PAY, CRT, CHK, NTF, REV, DSH, ORD, SHP: mã đã chạy và đã review khác nền ở các chỗ trên mà không bước nào thấy.
- **Người yêu cầu:** người dùng (giao việc đồng bộ phần nền cho agent nền; các agent sau lo spec từng epic); phân tích do Claude

Tài liệu bị đổi: spec/architecture.md

Hàng `phải dựng lại` và `cần xem lại` là việc cho agent của từng epic (không sửa trong đợt nền này). Hàng `không đổi` nói rõ vì sao không bị tác động.

| ID bị ảnh hưởng | Loại | Mức | Lý do | Việc cần làm |
|---|---|---|---|---|
| spec/security-baseline.md | không đổi | - | Đã sửa cùng đợt: SB-18 chốt `user_id` nguyên văn; nhật ký thay đổi nền có dòng riêng | Đã sửa và duyệt lại |
| spec/domain/events.md | không đổi | - | Đã sửa cùng đợt: quy tắc consumer (payload là đối tượng, hai pha, ngoại lệ LowStockDetected) | Đã sửa và duyệt lại |
| PRJ-REQ-20261006-095422563 | không đổi | - | Đã sửa cùng đợt: BR12, BR13 (consumer hai pha), hai kịch bản mới (báo cáo riêng) | Đã sửa và duyệt lại |
| PRJ-REQ-20261006-095422650 | không đổi | - | Đã sửa cùng đợt: BR7 (khóa bộ đếm), BR9 (chuẩn hóa IP), hai kịch bản mới (báo cáo riêng) | Đã sửa và duyệt lại |
| PRJ-REQ-20261006-095422735 | không đổi | - | Đã sửa cùng đợt: BR3 trỏ về ADR-007 (báo cáo riêng); `DB_POOL_MAX` tối thiểu 2 đã có từ lượt SHP | Đã sửa và duyệt lại |
| PRJ-DB-20261006-095847232 | không đổi | - | Đã sửa cùng đợt: mục 2 (thứ tự bảng chỉ thêm), mục 3 (`clock_timestamp()`), mục 5 (hai pha, SKIP, bác payload) | Đã sửa và duyệt lại |
| PRJ-API-20261006-095847320 | không đổi | - | Đã sửa cùng đợt: thứ tự kiểm, khóa bộ đếm kèm cửa sổ, `subscribePrepared`, `subscribeRaw`, `SKIP`, `idle` | Đã sửa và duyệt lại |
| NTF-API-20261006-103815515 | phải dựng lại | MEDIUM | Mục Dịch vụ ngoài ghi "qua SDK" và chỉ ba biến; mã gọi SES v2 `Simple` ký SigV4 với sáu biến (ADR-010, ADR-007); log `user_id` theo SB-18 | Bỏ "qua SDK", ghi SES v2 `Simple`, liệt kê đủ sáu biến `SES_*`, `MAIL_FROM`, `APP_BASE_URL`; tham chiếu `AuthApi.getUserContact` |
| NTF-DB-20261006-103815422 | phải dựng lại | MEDIUM | Mục Giao dịch và khóa 1 và 2 không nêu consumer hai pha mà NTF dùng (ADR-011) | Nêu `prepare` ngoài giao dịch, `handle` trong giao dịch, `SKIP` không ghi ProcessedEvent |
| NTF-SEC-20261006-103815605 | cần xem lại | LOW | T15 và log `user_id` nguyên văn: khớp SB-18 mới; T3 nay có chỗ dựa ở ADR-010 | Viết "log theo SB-18", trỏ ADR-010 cho T3; kèm sửa biểu thức CHECK `link` (REV-NTF-04) |
| NTF-TC-20261006-104223630 | phải dựng lại | MEDIUM | TC mô tả header MIME thô, mã gửi SES v2 JSON (REV-NTF-08) | Kiểm trường JSON `Subject`, `ToAddresses`, `Body` thay cho header MIME |
| CRT-API-20261006-103824592 | không đổi | - | Đã sửa ở lượt CRT-CHK (2026-10-13): `CartApi`, hai status của `product-unavailable`, 429 mọi endpoint, ADR-016 | Đã sửa và duyệt lại (`crt-dong-bo-spec-20261013`) |
| CRT-REQ-20261006-103226562 | không đổi | - | Đã sửa ở lượt CRT-CHK: BR5, BR6 `CartApi` | Đã sửa và duyệt lại |
| CRT-DB-20261006-103824563 | không đổi | - | Đã sửa ở lượt CRT-CHK: `CartApi`, `lockForCheckout` giữ một kết nối và PRD, INV đọc bằng kết nối thứ hai (ADR-012) | Đã sửa và duyệt lại |
| CRT-SEC-20261006-103824617 | không đổi | - | Đã sửa ở lượt CRT-CHK: T14 "ghi theo SB-18", T7 "bỏ kết quả và trả 503" | Đã sửa và duyệt lại |
| CRT-TC-20261006-104453980 | không đổi | - | Đã sửa ở lượt CRT-CHK: `CartApi` | Đã sửa và duyệt lại |
| CHK-API-20261006-105800712 | không đổi | - | Đã sửa ở lượt CRT-CHK: `CartApi` hai hàng CRT (giữ `AddressService`), `Gate` và giới hạn (ADR-012) | Đã sửa và duyệt lại (`chk-dong-bo-spec-20261013`) |
| CHK-REQ-20261006-105050948 | không đổi | - | Đã sửa ở lượt CRT-CHK: BR3 `CartApi` | Đã sửa và duyệt lại |
| CHK-REQ-20261006-105051681 | không đổi | - | Đã sửa ở lượt CRT-CHK: BR2 `CartApi` | Đã sửa và duyệt lại |
| CHK-REQ-20261006-105051977 | không đổi | - | Đã sửa ở lượt CRT-CHK: BR1 `CartApi` | Đã sửa và duyệt lại |
| CHK-REQ-20261006-105052272 | không đổi | - | Đã sửa ở lượt CRT-CHK: BR1 `CartApi` | Đã sửa và duyệt lại |
| CHK-DB-20261006-105800565 | không đổi | - | Đã sửa ở lượt CRT-CHK: giới hạn của `Gate` và hạn 2 giây (ADR-012) | Đã sửa và duyệt lại |
| CHK-SEC-20261006-105800857 | không đổi | - | Đã sửa ở lượt CRT-CHK: T18 biện pháp `Gate` và giới hạn đã biết | Đã sửa và duyệt lại |
| DSH-API-20261006-105535010 | phải dựng lại | MEDIUM | Bảng phương thức khác bảng Giao diện module mới (DSH-REV-05): `PaymentApi.getRevenue({ from, to }, bucket?)`, `getTopProducts` khóa `quantity`, `getProductSalesTotals`, `UserApi.countCustomers(range)` | Cập nhật bảng phương thức theo hàng DSH của bảng Giao diện module |
| DSH-DB-20261006-105534913 | cần xem lại | LOW | Mô tả đọc qua giao diện nhắc tên hàm cũ | Đổi theo bảng Giao diện module mới |
| ORD-API-20261006-092703780 | phải dựng lại | MEDIUM | 16 phương thức (thêm `hasUndeliveredItems`, `getProductSalesTotals`, `payment_method` ở `listRecent`); thứ tự guard ghi sai (429, 401, Origin...) | Cập nhật mục Giao diện module; trỏ ADR-016 cho thứ tự guard và `session_expired` |
| ORD-SEC-20261006-092703802 | phải dựng lại | MEDIUM | T3 hứa bậc C "mỗi IP" cho route cần đăng nhập mà nền đếm theo người dùng (L84, ADR-014) | Ghi bậc C của route cần đăng nhập đếm theo người dùng |
| ORD-REQ-20261006-120227681 | cần xem lại | LOW | Giao diện đọc cho DSH, REV thêm hàm mới | Bổ sung `getProductSalesTotals`, `hasUndeliveredItems` |
| REV-API-20261006-103618306 | phải dựng lại | LOW | Mục gọi trực tiếp thêm `OrderApi.hasUndeliveredItems` (REV-REV-17) | Thêm phương thức thứ hai gọi ORD |
| REV-SEC-20261006-103618395 | cần xem lại | LOW | Chữ "CSRF token" trái ADR-016 (kiểm `Origin`) | Đổi chữ theo ADR-016 |
| USR-API-20261006-101342436 | phải dựng lại | MEDIUM | Mục "Cho module khác": `countCustomers(range_utc)` trả `{ total, locked, new_in_range }` qua `AuthApi.countCustomerStats`; khóa bộ đếm PUT và DELETE avatar nay tách nhau | Cập nhật hàm cho DSH và ghi khóa bộ đếm theo ADR-014 |
| AUTH-API-20261006-100006077 | cần xem lại | LOW | Thứ tự guard đã trỏ ADR-016; thêm `countCustomerStats` và hành vi lỗi `AuthApi` | Trỏ ADR-016, bổ sung hàm và hành vi lỗi |
| PAY-API-20261006-103701335 | phải dựng lại | MEDIUM | `PaymentApi.getRevenue({ from, to }, bucket?)`, `countFailedRefunds()`; chín biến `VNPAY_*`, `PAY_*`; `normalizeIp` dùng chung ở nền | Ghi chữ ký và biến theo ADR-007; bỏ nhắc `normalizeIp` riêng |
| PAY-REQ-20261006-103110946 | cần xem lại | MEDIUM | L103: BR6 "hỏi lại cổng" không nói cách hỏi và đường kết thúc có hạn (Refund `requested` kẹt khi cổng trả 94) | Người quyết cách hỏi (truy vấn hay gọi lại cùng mã), đường kết thúc có hạn, đưa vào danh sách kiểm sandbox thật |
| INV-API-20261006-101122767 | cần xem lại | LOW | L70: chữ "hằng đêm" khi `JobRunner` chỉ có chu kỳ; L71: `LowStockDetected` đọc PRD trong giao dịch | Ghi "mỗi 24 giờ kể từ lúc khởi động"; ghi ngoại lệ đã nêu ở ADR-011 |
| INV-DB-20261006-101122740 | cần xem lại | LOW | L70: mục job đối soát ghi "hằng đêm" | Ghi chu kỳ 24 giờ từ lúc khởi động |
| INV-SEC-20261006-101122793 | cần xem lại | LOW | L70, L71: mối đe dọa về job đối soát và hold-and-wait | Ghi lịch thật và ngoại lệ có chủ đích |
| SHP-API-20261006-101603042 | không đổi | - | Đã nêu `ShippingApi`, `findForPayment`, hold-and-wait và pool tối thiểu 2 ở lượt trước; ADR-011 chỉ thêm dạng hai pha (không bắt buộc chuyển) | - |
| PRD-API-20261006-095502803 | không đổi | - | Hành vi lỗi `CatalogApi` đã ở nền từ 2026-10-07; chỉ thêm tên lớp `CatalogApi.` vào các hàng gọi PRD | - |
| PRM-API-20261006-101036543 | không đổi | - | `take`, `refund` đã ở ADR-014 từ 2026-10-07; khóa bộ đếm kèm cửa sổ không đổi khóa `ctr:` của PRM | - |

## Chưa chắc / rủi ro
- Đổi tên bucket của `@RateLimit` làm bộ đếm cũ mồ côi khi triển khai: dòng quá một giờ bị job dọn xóa, trong một giờ đó mỗi bộ đếm bắt đầu lại từ 0 (cho qua thêm tối đa một cửa sổ), chấp nhận.
- `AddressService` của USR không theo quy ước `<Tên>Api`: giữ nguyên (đúng mã); người duyệt quyết có đổi thành `AddressApi` (đổi mã USR, CHK, bảng Giao diện module).
- URL sandbox VNPay là mặc định của `VNPAY_PAY_URL`, `VNPAY_API_URL` và mã không chặn dùng ở prod: việc người kiểm khi go-live.
- `Gate` của CHK chưa bao thao tác chọn, tạo, hủy phiên và sửa giỏ: ghi là giới hạn đã biết (ADR-012), đổi mã CHK nếu người duyệt cần chặt hơn.
- Chưa thử gọi SES thật, chưa thử cổng VNPay sandbox: việc người trước go-live.
