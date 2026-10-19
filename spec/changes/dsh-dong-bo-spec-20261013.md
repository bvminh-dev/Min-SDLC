# Đồng bộ spec DSH với mã đã chạy và review (DSH-REV-05 đến 10, bài học L137, L138, L139)

- **Thay đổi:** (a) DSH-API: bảng "Giao tiếp giữa module" ghi tên lớp và chữ ký thật (`PaymentApi.getRevenue({ from, to }, bucket?)` bucket `hour`, `day`, `month` theo UTC, `OrderApi.getTopProducts` khóa `quantity`/`amount`, `OrderApi.getProductSalesTotals`, `CatalogApi.getSummaries`, `UserApi.countCustomers` gọi `AuthApi.countCustomerStats`, `countFailedRefunds`); `Cache-Control: private, no-store` ở mọi phản hồi 200; `errors[]` của 400 có `code` và `reason` cùng danh sách khóa; 503 nêu hạn nguồn và trần 6 lời gọi; đường dẫn trang web và ca URL chỉ có `from` hoặc `to` (`appliedRange`); (b) DSH-DB: hạn 5 giây KHÔNG hủy được truy vấn nguồn, cô lập bằng trần 6 lời gọi đang chạy mỗi nguồn (chấp nhận, ghi rủi ro báo cáo dài); giới hạn tần suất dùng `take` nguyên tử thay `check` rồi `hit` (lượt 429 vẫn tăng bộ đếm); audit gộp theo phút trong bộ nhớ từng instance; tên lớp ở bảng truy vấn đề nghị; (c) DSH-REQ-20261006-105126549 BR5: chấp nhận cô lập thay hủy thật (không `AbortSignal` ở v1); DSH-REQ-20261006-105126458 BR5, BR6: `name` là tên hiện tại ở PRD, sản phẩm không còn ở PRD thì tên rỗng; DSH-REQ-20261006-105126368 BR4: giá trị đơn trung bình theo `paid_at`; DSH-REQ-20261006-105125714 BR5: cận dưới 1970-01-01 (400 `too_early`); (d) mười TC hạn nguồn: số giây cứng thành tên biến `DASHBOARD_SOURCE_TIMEOUT_MS`, bỏ chữ "bản giả" (nêu `jest.spyOn` trên lớp thật); (e) bốn file ui/*.md ghi đường dẫn `/admin/dashboard`, `/admin/reports/revenue`, `/admin/reports/orders`, `/admin/reports/products`; (f) ORD-API: `getProductSalesTotals` và `payment_method` ở `listRecent`; USR-API: `countCustomers(range)` trả `{ total, locked, new_in_range }`; AUTH-API: `countCustomerStats`; (g) ba TC mới (URL chỉ có `to`, `Cache-Control` chín endpoint, XSS tên sản phẩm), đã có test thật mang ID.
- **Lý do:** review DSH (DSH-REV-05 giao diện đọc, DSH-REV-06 hạn nguồn, DSH-REV-07 nguồn `name`, DSH-REV-08 BR4, DSH-REV-09 `take`, DSH-REV-10 cận dưới ngày) và bài học L137 (hành vi thêm ngoài spec không có TC), L138 (số giây cứng, chữ "bản giả" trong TC), L139 (ca tham số thiếu mặc định); mã DSH đúng, spec lệch. Nền đã đồng bộ ở `spec/changes/nen-dong-bo-20261013.md` (bảng Giao diện module) và PAY-API đã sửa ở `spec/changes/pay-reviews-20261013.md`.
- **Người yêu cầu:** người dùng ("chạy tiếp đi"); quyết định (1) đến (8) chốt khi giao việc; phân tích do Claude

Tài liệu bị đổi: DSH-API-20261006-105535010
Cụm từ xuyên module: "countCustomerStats"
Cụm từ xuyên module: "getProductSalesTotals"
Cụm từ xuyên module: "DASHBOARD_SOURCE_TIMEOUT_MS"

Hàng ghi "Đã sửa và duyệt lại" là việc đã làm trong đợt này; hàng `cần xem lại` và `phải dựng lại` còn lại là file ngoài danh sách được ủy quyền, việc cho người duyệt.

| ID bị ảnh hưởng | Loại | Mức | Lý do | Việc cần làm |
|---|---|---|---|---|
| DSH-API-20261006-105535010 | phải dựng lại | MEDIUM | Bảng phương thức khác chữ ký thật (DSH-REV-05); thiếu `Cache-Control` (L137), `code` ở `errors[]`, đường dẫn web, ca tham số thiếu (L139) | Đã sửa và duyệt lại |
| DSH-DB-20261006-105534913 | phải dựng lại | MEDIUM | Hạn 5 giây ghi "hủy truy vấn" mà mã không hủy được (DSH-REV-06); `check`+`hit` thay bằng `take` (DSH-REV-09); audit mỗi instance | Đã sửa và duyệt lại |
| DSH-REQ-20261006-105126549 | phải dựng lại | MEDIUM | BR5 hứa hạn 5 giây mà không nói truy vấn quá hạn vẫn chạy (DSH-REV-06) | Đã sửa và duyệt lại: ghi chấp nhận cô lập bằng trần, không `AbortSignal` ở v1 |
| DSH-REQ-20261006-105126458 | phải dựng lại | LOW | BR5 (`name_snapshot`) mâu thuẫn BR6 (không ghép PRD), mã lấy tên hiện tại ở PRD (DSH-REV-07) | Đã sửa và duyệt lại: BR5, BR6, kịch bản đổi tên |
| DSH-REQ-20261006-105126368 | cần xem lại | LOW | BR4 nói "đơn trong khoảng" mà mã tính theo `paid_at` (DSH-REV-08) | Đã sửa và duyệt lại: BR4 theo `paid_at` |
| DSH-REQ-20261006-105125714 | cần xem lại | LOW | BR5 thiếu cận dưới ngày (DSH-REV-10) | Đã sửa và duyệt lại: cận dưới 1970-01-01, 400 `too_early` |
| DSH-TC-20261006-110330139 | phải dựng lại | LOW | Ghi "PAY giả trả lời sau 6 giây", "bản giả", hạn 5 giây đo bằng đồng hồ giả (L138) | Đã sửa và duyệt lại: tên biến `DASHBOARD_SOURCE_TIMEOUT_MS`, `jest.spyOn` trên lớp thật |
| DSH-TC-20261006-110330370 | phải dựng lại | LOW | Như trên (L138) | Đã sửa và duyệt lại |
| DSH-TC-20261006-110330567 | phải dựng lại | LOW | Như trên (L138) | Đã sửa và duyệt lại |
| DSH-TC-20261006-110330762 | phải dựng lại | LOW | Như trên (L138) | Đã sửa và duyệt lại |
| DSH-TC-20261006-110330953 | phải dựng lại | LOW | Như trên (L138) | Đã sửa và duyệt lại |
| DSH-TC-20261006-110331131 | phải dựng lại | LOW | Như trên (L138) | Đã sửa và duyệt lại |
| DSH-TC-20261006-110331467 | phải dựng lại | LOW | Như trên (L138) | Đã sửa và duyệt lại |
| DSH-TC-20261006-110331700 | phải dựng lại | LOW | Như trên (L138) | Đã sửa và duyệt lại |
| DSH-TC-20261006-110331973 | phải dựng lại | LOW | Như trên (L138) | Đã sửa và duyệt lại |
| DSH-TC-20261006-110332216 | phải dựng lại | LOW | Như trên (L138) | Đã sửa và duyệt lại |
| DSH-TC-20261013-232147091 | phải dựng lại | LOW | TC mới: URL chỉ có `to` hoặc `from` (L139); test hàm thuần có sẵn | Đã tạo và duyệt; test `web.spec.ts` mang ID |
| DSH-TC-20261013-232147375 | phải dựng lại | MEDIUM | TC mới: `Cache-Control` ở cả chín endpoint (L137, DSH-REV-01) | Đã tạo và duyệt; test `review.spec.ts` mang ID |
| DSH-TC-20261013-232147647 | phải dựng lại | MEDIUM | TC mới: XSS tên sản phẩm (SB-12, DSH-REV-02) | Đã tạo và duyệt; E2E `dsh.e2e.spec.ts` mang ID |
| AUTH-TC-20261013-232524562 | phải dựng lại | LOW | TC mới (dọn nợ kiểm toàn spec): nhắc `countCustomerStats`, hàm AUTH cho USR và DSH chưa có TC nhắc tên | Đã tạo và duyệt; test `apps/api/test/auth/dsh.spec.ts` mang ID |
| AUTH-TC-20261013-232524831 | phải dựng lại | LOW | TC mới cho job `auth.cleanup` (AUTH-DB mục 11) thiếu TC | Đã tạo và duyệt; test mới `apps/api/test/auth/cleanup.spec.ts` |
| ORD-TC-20261013-232524288 | phải dựng lại | LOW | TC mới (dọn nợ kiểm toàn spec): nhắc `getProductSalesTotals`, hàm ORD cho DSH chưa có TC nhắc tên | Đã tạo và duyệt; test `apps/api/test/order/dsh.spec.ts` mang ID |
| DSH-TC-20261006-110332066 | cần xem lại | LOW | Given ghi tên theo "đơn muộn hơn" (hàm ý `name_snapshot`), BR5 mới nói tên hiện tại ở PRD (test thật đã dựng tên ở PRD) | Người duyệt hoặc ủy quyền sửa Given: "tên hiện tại ở PRD là Áo A mới" (file ngoài danh sách được ủy quyền) |
| DSH-TC-20261006-110331757 | không đổi | - | Kiểm giá trị đơn trung bình chỉ tính `succeeded`, vẫn đúng khi BR4 nói rõ theo `paid_at` | - |
| DSH-TC-20261006-110331813 | không đổi | - | Kiểm làm tròn xuống 200.001 chia 2, không phụ thuộc mốc ngày | - |
| DSH-TC-20261006-120001007 | không đổi | - | Cả bốn đơn cùng có `paid_at` trong khoảng, kết quả như cũ theo `paid_at` | - |
| DSH-TC-20261006-110330022 | không đổi | - | Khoảng mặc định 30 ngày khi không có tham số; ca chỉ một tham số nay ở TC mới | - |
| DSH-TC-20261006-110332155 | không đổi | - | Kiểm đệm 45 giây của `DASHBOARD_CACHE_TTL_SECONDS`, không liên quan hạn nguồn | - |
| DSH-E2E-20261006-110408086 | cần xem lại | LOW | Bước ghi "PAY giả không trả lời (quá 5 giây)": cùng L138, E2E chạy trên PAY thật nên "giả" và số giây cứng không đúng | Người duyệt hoặc ủy quyền đổi chữ theo tên biến `DASHBOARD_SOURCE_TIMEOUT_MS` (file ngoài danh sách được ủy quyền) |
| spec/architecture.md | không đổi | - | Đã đồng bộ ở `nen-dong-bo-20261013`: các hàng DSH tới ORD, PAY, PRD, INV, USR và hàng USR tới AUTH khớp chữ ký thật | - |
| ORD-API-20261006-092703780 | phải dựng lại | MEDIUM | Hàng DSH thiếu `getProductSalesTotals` và `payment_method` ở `listRecent` (DSH-REV-05) | Đã sửa và duyệt lại |
| USR-API-20261006-101342436 | phải dựng lại | MEDIUM | Mục "Cho module khác" và danh sách phương thức ghi `countCustomers()` không tham số (DSH-REV-05) | Đã sửa và duyệt lại: `countCustomers(range)` trả `{ total, locked, new_in_range }`, gọi `AuthApi.countCustomerStats` |
| AUTH-API-20261006-100006077 | phải dựng lại | LOW | Ghi `countCustomers(): number`; mã cung cấp `countCustomerStats(range)` cho USR | Đã sửa và duyệt lại |
| PAY-API-20261006-103701335 | không đổi | - | Dòng "Cung cấp cho DSH" đã sửa ở đợt PAY (`pay-reviews-20261013`): `getRevenue({ from, to }, bucket?)`, `countFailedRefunds()` | - |
| AUTH-TC-20261006-180338166 | không đổi | - | Bước gọi `countCustomers()` không tham số vẫn đúng (hàm còn trong mã); ca `countCustomerStats` nay ở TC mới AUTH-TC-20261013-232524562 | - |
| AUTH-DB-20261006-100006037 | không đổi | - | Mục giao diện nội bộ không nhắc `countCustomers`; không bị tác động | - |
| ORD-REQ-20261006-120227681 | cần xem lại | LOW | BR6 liệt kê hàm cho DSH nhưng không nêu `getProductSalesTotals` (không đổi nghiệp vụ ORD) | Người duyệt thêm hàm vào BR6 khi có ủy quyền (file ngoài danh sách) |
| ORD-TC-20261006-120228155 | không đổi | - | TC `getTopProducts` giữ nguyên; ca `getProductSalesTotals` nay ở TC mới ORD-TC-20261013-232524288 | - |
| DSH-TC-20261015-093256308 | không đổi | - | Tài liệu mới hoặc sửa của đợt bán hàng hộ 2026-10-15 (spec/changes/ban-ho-sale-nguon-don-20261015.md) nhắc cùng cụm từ hay liên kết tới ID này; hành vi đã duyệt ở báo cáo này không đổi | - |
| DSH-TC-20261015-093300733 | không đổi | - | Tài liệu mới hoặc sửa của đợt bán hàng hộ 2026-10-15 (spec/changes/ban-ho-sale-nguon-don-20261015.md) nhắc cùng cụm từ hay liên kết tới ID này; hành vi đã duyệt ở báo cáo này không đổi | - |
| DSH-TC-20261015-093334858 | không đổi | - | Tài liệu mới hoặc sửa của đợt bán hàng hộ 2026-10-15 (spec/changes/ban-ho-sale-nguon-don-20261015.md) nhắc cùng cụm từ hay liên kết tới ID này; hành vi đã duyệt ở báo cáo này không đổi | - |

## Chưa chắc / rủi ro
- Hạn 5 giây không hủy được truy vấn nguồn: lời gọi quá hạn chạy tới `DB_STATEMENT_TIMEOUT_MS` của platform (15 giây) và chiếm một trong 6 chỗ của nguồn; báo cáo 366 ngày còn chạy nốt các đoạn sau khi đã trả 503. Chấp nhận ở v1; sửa gốc cần `AbortSignal` hay `statement_timeout` theo lời gọi ở giao diện đọc của ORD, PAY, PRD, INV, USR (backlog, đổi mã nhiều module).
- Khoảng 90 TC khác của DSH và một E2E vẫn ghi "bản giả của giao diện đọc" ở mục Dữ liệu (cùng khuôn mười TC đã sửa); ngoài danh sách được ủy quyền, chưa sửa.
- `[RESOLVED]` ở các REQ khác của DSH nhắc "chữ ký chốt ở tech-design của module chủ" (REQ 811, 901, 995, 089, 180, 271): đúng về ý, chữ ký thật nay ở DSH-API; không đổi nghiệp vụ, chưa sửa vì ngoài danh sách được ủy quyền.
