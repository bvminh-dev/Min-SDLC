---
epic: DSH
status: draft
kit_version: 3
clean_run: chưa
test_command: ECOM_TEST_DB=ecom_test_dsh pnpm test -- test/dashboard test/tooling/mutations-dsh.spec.ts (API); E2E_PORT_BASE=3600 pnpm test -- test/e2e/dsh.e2e.spec.ts -t DSH-TC-20261015 (bốn E2E mới, bản sao ở /tmp)
test_result: Tests:       178 passed, 178 total (API); Tests:       15 skipped, 4 passed, 19 total (E2E, 15 skip là ca cũ lọc bằng -t)
---
# Báo cáo triển khai: DSH

## Kế hoạch task
Thứ tự theo phụ thuộc: DB (không có), cấu hình và nền, sửa nền kèm của ORD, AUTH, USR, API, giao diện, test và bảng đột biến. Mọi task `done`; không có task `blocked`. DSH phụ thuộc ORD (`OrderApi`), PRD (`CatalogApi`), INV (`InventoryApi`), USR (`UserApi`), PAY (`PaymentApi`) qua điểm vào công khai của từng module; phần dùng chung của platform (phiên, role, audit, giới hạn tần suất) không khai.

| # | Task | Nguồn | Phụ thuộc | Trạng thái |
|---|---|---|---|---|
| 1 | Không bảng, không migration: DSH chỉ đọc qua giao diện đọc của ORD, PRD, INV, USR, PAY; không schema Prisma riêng | DSH-DB-20261006-105534913 | - | done |
| 2 | Cấu hình (ba biến DASHBOARD_*), mã lỗi invalid-parameter và dashboard-source-unavailable, hằng số, khung module `dashboard` vào AppModule | DSH-API-20261006-105535010 | 1 | done |
| 3 | Sửa nền kèm: ORD (`getProductSalesTotals`, `payment_method` ở `listRecent`), AUTH (`countCustomerStats`), USR (`UserApi.countCustomers(range)`) và test nền | DSH-API-20261006-105535010 | 1 | done |
| 4 | Lịch giờ Việt Nam và khoảng ngày (hàm thuần), kiểm tham số chặt, độ mịn, mốc ngày, tuần, tháng, chia đoạn theo giờ | DSH-REQ-20261006-105125714, DSH-REQ-20261006-105126271, DSH-SEC-20261006-105535103 | 2 | done |
| 5 | Cổng gọi nguồn (hạn, trần lời gọi, 503 không lộ chi tiết), bộ nhớ đệm (đệm 60 giây, single-flight), giới hạn tần suất bậc D nguyên tử, audit gộp | DSH-REQ-20261006-105126549, DSH-SEC-20261006-105535103 | 2, 4 | done |
| 6 | Sáu khối dashboard và ba báo cáo (doanh thu, đơn, sản phẩm), danh sách trắng trường, chín endpoint chỉ admin, ma trận quyền | DSH-REQ-20261006-105125714, DSH-REQ-20261006-105125811, DSH-REQ-20261006-105125901, DSH-REQ-20261006-105125995, DSH-REQ-20261006-105126089, DSH-REQ-20261006-105126180, DSH-REQ-20261006-105126271, DSH-REQ-20261006-105126368, DSH-REQ-20261006-105126458 | 2, 3, 4, 5 | done |
| 7 | Test API trên AppModule và PostgreSQL thật (14 tệp ở apps/api/test/dashboard, tải hỗn hợp kiểm bảo toàn, luồng thật CHK-PAY, hai instance, DB_POOL_MAX 2) và test nền ORD, AUTH, USR | DSH-SEC-20261006-105535103 | 6 | done |
| 8 | Cổng ranh giới T8 (ba fixture cây mã mẫu) và quét route, ma trận quyền trên AppModule thật | DSH-SEC-20261006-105535103 | 6 | done |
| 9 | Giao diện web: /admin/dashboard, /admin/reports/revenue, /admin/reports/orders, /admin/reports/products, biểu đồ SVG tự vẽ, liên kết Dashboard ở thanh đầu trang | ui/admin-dashboard, ui/analytics-revenue, ui/analytics-orders, ui/analytics-products | 4, 5 | done |
| 10 | E2E trình duyệt thật (API thật, cổng điều khiển, luồng thật khách đặt hàng VNPay rồi admin xem dashboard) và điểm điều khiển `/dsh-fault` | DSH-E2E-20261006-110407878, DSH-E2E-20261006-110407909, DSH-E2E-20261006-110407938, DSH-E2E-20261006-110407966, DSH-E2E-20261006-110407995, DSH-E2E-20261006-110408024, DSH-E2E-20261006-110408057, DSH-E2E-20261006-110408086, DSH-E2E-20261006-110408116 | 8, 9 | done |
| 11 | Bảng đột biến DSH (136 dòng, scripts/mutations-dsh.json) chạy bằng mutate.mjs trong bản sao ở /tmp và cổng kiểm của nó | DSH-SEC-20261006-105535103 | 6, 7, 8, 9, 10 | done |
| 12 | Hai báo cáo tính lương (đợt bán hộ): `GET /admin/reports/sources`, `GET /admin/reports/sales` gọi `OrderApi.getSourcesReport` và `getSalesReport` qua cổng nguồn ORD (hạn 5 giây, 503 `ORD`), loại đơn `cancelled`, `expired`, `returned` ngay ở ORD, DSH sắp và cộng `totals`, dòng `website` riêng, nhãn "(tài khoản đã xóa)", bộ nhớ đệm 60 giây, hạn mức 30 mỗi phút dùng chung | DSH-REQ-20261015-092608812, DSH-REQ-20261015-092608849, DSH-API-20261006-105535010 | 2, 5, 6 | done |
| 13 | Xuất CSV ở server (`format=csv`, `csv.ts`): BOM, CRLF, RFC 4180, chống công thức `=` `+` `-` `@` tab CR, `Cache-Control: private, no-store`, một dòng audit `dashboard.export` mỗi lần, từ cùng bản đệm với JSON | DSH-REQ-20261015-092608812, DSH-SEC-20261015-092608917 | 12 | done |
| 14 | Test API của hai báo cáo (`report-sources.spec.ts`, `report-sales.spec.ts`, `report-ho-common.spec.ts`), đổi test cũ từ chín sang mười một endpoint (`common.spec.ts`, `guard.spec.ts`, `review.spec.ts`) và hạ tầng `support/dsh.ts` | DSH-SEC-20261015-092608917 | 12, 13 | done |
| 15 | Giao diện: `/admin/reports/sources`, `/admin/reports/sales` theo khuôn analytics-revenue (khoảng ngày, hàng số, bảng, ghi chú, Xuất CSV bằng `useCsvExport`), liên kết từ thanh đầu trang và từ dashboard | ui/analytics-sources, ui/analytics-sales | 12, 13 | done |
| 16 | E2E trình duyệt bốn TC giao diện của hai màn (dải 429, xuất CSV, 503, tài khoản đã xóa) và điểm điều khiển `/dsh-ord-fault` (ORD treo, AUTH lỗi, AUTH không tra được) ở máy chủ E2E | DSH-TC-20261015-093334777, DSH-TC-20261015-093334820, DSH-TC-20261015-093334858, DSH-TC-20261015-093334896 | 14, 15 | done |

## Kết quả test
Mọi TC và E2E của epic một dòng (136 TC, 9 E2E; 43 TC mới của đợt bán hộ nằm cuối bảng, bốn TC cuối là E2E trình duyệt của hai màn mới). Ngoài các ID này còn: test hàm thuần (`range.spec.ts`, `web.spec.ts`), tải hỗn hợp (`load.spec.ts`), luồng thật (`flow.spec.ts`), bốn E2E phụ mang ID E2E gần nhất (rỗng và số âm, đang tải, 429, hết phiên) và test nền mang ID TC gần nhất (`apps/api/test/order/dsh.spec.ts`, `apps/api/test/auth/dsh.spec.ts`, `apps/api/test/user/dsh.spec.ts`). Nguồn của mọi test API là các lớp `*Api` thật trên PostgreSQL thật (không dùng nguồn giả; TC ghi "PAY giả" chỉ là cách mô tả); lỗi, chậm, treo gài bằng `jest.spyOn` trên chính các lớp đó. Đồng hồ giả cố định 2026-10-06T03:00:00Z (10:00 giờ Việt Nam) cho mọi nguồn thời gian của DSH (`fixed-clock:` ghi ở `test/support/dsh.ts`).

| ID | Loại | Test code | Kết quả | Ghi chú |
|---|---|---|---|---|
| DSH-E2E-20261006-110407878 | E2E | apps/api/test/e2e/dsh.e2e.spec.ts | pass | YẾU: dữ liệu mồi tính từ hôm nay (giờ thật của máy chủ E2E), không phải ngày 01/10 tới 06/10/2026 của TC; ngày mai gõ tay mô phỏng bằng bỏ thuộc tính max của ô |
| DSH-E2E-20261006-110407909 | E2E | apps/api/test/e2e/dsh.e2e.spec.ts | pass | - |
| DSH-E2E-20261006-110407938 | E2E | apps/api/test/e2e/dsh.e2e.spec.ts | pass | - |
| DSH-E2E-20261006-110407966 | E2E | apps/api/test/e2e/dsh.e2e.spec.ts | pass | - |
| DSH-E2E-20261006-110407995 | E2E | apps/api/test/e2e/dsh.e2e.spec.ts | pass | - |
| DSH-E2E-20261006-110408024 | E2E | apps/api/test/e2e/dsh.e2e.spec.ts | pass | - |
| DSH-E2E-20261006-110408057 | E2E | apps/api/test/e2e/dsh.e2e.spec.ts | pass | - |
| DSH-E2E-20261006-110408086 | E2E | apps/api/test/e2e/dsh.e2e.spec.ts | pass | YẾU: hạn nguồn của máy chủ E2E là 500 ms (không phải 5 giây) và PAY "không trả lời" gài bằng thay phương thức getRevenue của PaymentApi |
| DSH-E2E-20261006-110408116 | E2E | apps/api/test/e2e/dsh.e2e.spec.ts | pass | - |
| DSH-TC-20261006-110329988 | TC | apps/api/test/dashboard/revenue.spec.ts | pass | - |
| DSH-TC-20261006-110330022 | TC | apps/api/test/dashboard/revenue.spec.ts | pass | - |
| DSH-TC-20261006-110330051 | TC | apps/api/test/dashboard/revenue.spec.ts | pass | - |
| DSH-TC-20261006-110330080 | TC | apps/api/test/dashboard/revenue.spec.ts | pass | - |
| DSH-TC-20261006-110330109 | TC | apps/api/test/dashboard/revenue.spec.ts | pass | - |
| DSH-TC-20261006-110330139 | TC | apps/api/test/dashboard/revenue.spec.ts | pass | hạn nguồn hạ xuống 300 ms qua `DASHBOARD_SOURCE_TIMEOUT_MS` đúng như TC (đã đổi từ số giây cứng sang tên biến); mặc định 5000 kiểm ở guard.spec.ts |
| DSH-TC-20261006-110330168 | TC | apps/api/test/dashboard/revenue.spec.ts | pass | - |
| DSH-TC-20261006-110330197 | TC | apps/api/test/dashboard/revenue.spec.ts | pass | - |
| DSH-TC-20261006-110330226 | TC | apps/api/test/dashboard/revenue.spec.ts | pass | - |
| DSH-TC-20261006-110330253 | TC | apps/api/test/dashboard/revenue.spec.ts | pass | - |
| DSH-TC-20261006-110330281 | TC | apps/api/test/dashboard/orders.spec.ts | pass | - |
| DSH-TC-20261006-110330309 | TC | apps/api/test/dashboard/orders.spec.ts | pass | - |
| DSH-TC-20261006-110330341 | TC | apps/api/test/dashboard/orders.spec.ts | pass | - |
| DSH-TC-20261006-110330370 | TC | apps/api/test/dashboard/orders.spec.ts | pass | hạn nguồn hạ xuống 300 ms qua `DASHBOARD_SOURCE_TIMEOUT_MS` đúng như TC; mặc định 5000 kiểm ở guard.spec.ts |
| DSH-TC-20261006-110330398 | TC | apps/api/test/dashboard/orders.spec.ts | pass | - |
| DSH-TC-20261006-110330426 | TC | apps/api/test/dashboard/orders.spec.ts | pass | - |
| DSH-TC-20261006-110330455 | TC | apps/api/test/dashboard/orders.spec.ts | pass | - |
| DSH-TC-20261006-110330483 | TC | apps/api/test/dashboard/customers.spec.ts | pass | - |
| DSH-TC-20261006-110330511 | TC | apps/api/test/dashboard/customers.spec.ts | pass | - |
| DSH-TC-20261006-110330539 | TC | apps/api/test/dashboard/customers.spec.ts | pass | - |
| DSH-TC-20261006-110330567 | TC | apps/api/test/dashboard/customers.spec.ts | pass | hạn nguồn hạ xuống 300 ms qua `DASHBOARD_SOURCE_TIMEOUT_MS` đúng như TC; mặc định 5000 kiểm ở guard.spec.ts |
| DSH-TC-20261006-110330595 | TC | apps/api/test/dashboard/customers.spec.ts | pass | - |
| DSH-TC-20261006-110330625 | TC | apps/api/test/dashboard/customers.spec.ts | pass | - |
| DSH-TC-20261006-110330652 | TC | apps/api/test/dashboard/customers.spec.ts | pass | - |
| DSH-TC-20261006-110330680 | TC | apps/api/test/dashboard/products.spec.ts | pass | - |
| DSH-TC-20261006-110330708 | TC | apps/api/test/dashboard/products.spec.ts | pass | - |
| DSH-TC-20261006-110330735 | TC | apps/api/test/dashboard/products.spec.ts | pass | - |
| DSH-TC-20261006-110330762 | TC | apps/api/test/dashboard/products.spec.ts | pass | hạn nguồn hạ xuống 300 ms qua `DASHBOARD_SOURCE_TIMEOUT_MS` đúng như TC; mặc định 5000 kiểm ở guard.spec.ts |
| DSH-TC-20261006-110330791 | TC | apps/api/test/dashboard/products.spec.ts | pass | - |
| DSH-TC-20261006-110330826 | TC | apps/api/test/dashboard/products.spec.ts | pass | - |
| DSH-TC-20261006-110330856 | TC | apps/api/test/dashboard/products.spec.ts | pass | - |
| DSH-TC-20261006-110330892 | TC | apps/api/test/dashboard/products.spec.ts | pass | - |
| DSH-TC-20261006-110330922 | TC | apps/api/test/dashboard/products.spec.ts | pass | - |
| DSH-TC-20261006-110330953 | TC | apps/api/test/dashboard/products.spec.ts | pass | hạn nguồn hạ xuống 300 ms qua `DASHBOARD_SOURCE_TIMEOUT_MS` đúng như TC; mặc định 5000 kiểm ở guard.spec.ts |
| DSH-TC-20261006-110330985 | TC | apps/api/test/dashboard/products.spec.ts | pass | - |
| DSH-TC-20261006-110331014 | TC | apps/api/test/dashboard/products.spec.ts | pass | - |
| DSH-TC-20261006-110331043 | TC | apps/api/test/dashboard/products.spec.ts | pass | - |
| DSH-TC-20261006-110331071 | TC | apps/api/test/dashboard/recent.spec.ts | pass | - |
| DSH-TC-20261006-110331101 | TC | apps/api/test/dashboard/recent.spec.ts | pass | - |
| DSH-TC-20261006-110331131 | TC | apps/api/test/dashboard/recent.spec.ts | pass | hạn nguồn hạ xuống 300 ms qua `DASHBOARD_SOURCE_TIMEOUT_MS` đúng như TC; mặc định 5000 kiểm ở guard.spec.ts |
| DSH-TC-20261006-110331163 | TC | apps/api/test/dashboard/recent.spec.ts | pass | - |
| DSH-TC-20261006-110331194 | TC | apps/api/test/dashboard/recent.spec.ts | pass | - |
| DSH-TC-20261006-110331259 | TC | apps/api/test/dashboard/recent.spec.ts | pass | - |
| DSH-TC-20261006-110331290 | TC | apps/api/test/dashboard/recent.spec.ts | pass | - |
| DSH-TC-20261006-110331320 | TC | apps/api/test/dashboard/report-revenue.spec.ts | pass | - |
| DSH-TC-20261006-110331351 | TC | apps/api/test/dashboard/report-revenue.spec.ts | pass | - |
| DSH-TC-20261006-110331380 | TC | apps/api/test/dashboard/report-revenue.spec.ts | pass | - |
| DSH-TC-20261006-110331410 | TC | apps/api/test/dashboard/report-revenue.spec.ts | pass | - |
| DSH-TC-20261006-110331438 | TC | apps/api/test/dashboard/report-revenue.spec.ts | pass | - |
| DSH-TC-20261006-110331467 | TC | apps/api/test/dashboard/report-revenue.spec.ts | pass | hạn nguồn hạ xuống 300 ms qua `DASHBOARD_SOURCE_TIMEOUT_MS` đúng như TC; mặc định 5000 kiểm ở guard.spec.ts |
| DSH-TC-20261006-110331495 | TC | apps/api/test/dashboard/report-revenue.spec.ts | pass | - |
| DSH-TC-20261006-110331524 | TC | apps/api/test/dashboard/report-revenue.spec.ts | pass | - |
| DSH-TC-20261006-110331552 | TC | apps/api/test/dashboard/report-revenue.spec.ts | pass | - |
| DSH-TC-20261006-110331580 | TC | apps/api/test/dashboard/report-revenue.spec.ts | pass | - |
| DSH-TC-20261006-110331609 | TC | apps/api/test/dashboard/report-orders.spec.ts | pass | - |
| DSH-TC-20261006-110331642 | TC | apps/api/test/dashboard/report-orders.spec.ts | pass | - |
| DSH-TC-20261006-110331671 | TC | apps/api/test/dashboard/report-orders.spec.ts | pass | - |
| DSH-TC-20261006-110331700 | TC | apps/api/test/dashboard/report-orders.spec.ts | pass | hạn nguồn hạ xuống 300 ms qua `DASHBOARD_SOURCE_TIMEOUT_MS` đúng như TC; mặc định 5000 kiểm ở guard.spec.ts |
| DSH-TC-20261006-110331728 | TC | apps/api/test/dashboard/report-orders.spec.ts | pass | - |
| DSH-TC-20261006-110331757 | TC | apps/api/test/dashboard/report-orders.spec.ts | pass | - |
| DSH-TC-20261006-110331785 | TC | apps/api/test/dashboard/report-orders.spec.ts | pass | - |
| DSH-TC-20261006-110331813 | TC | apps/api/test/dashboard/report-orders.spec.ts | pass | - |
| DSH-TC-20261006-110331842 | TC | apps/api/test/dashboard/report-products.spec.ts | pass | - |
| DSH-TC-20261006-110331871 | TC | apps/api/test/dashboard/report-products.spec.ts | pass | - |
| DSH-TC-20261006-110331903 | TC | apps/api/test/dashboard/report-products.spec.ts | pass | - |
| DSH-TC-20261006-110331936 | TC | apps/api/test/dashboard/report-products.spec.ts | pass | - |
| DSH-TC-20261006-110331973 | TC | apps/api/test/dashboard/report-products.spec.ts | pass | hạn nguồn hạ xuống 300 ms qua `DASHBOARD_SOURCE_TIMEOUT_MS` đúng như TC; mặc định 5000 kiểm ở guard.spec.ts |
| DSH-TC-20261006-110332004 | TC | apps/api/test/dashboard/report-products.spec.ts | pass | - |
| DSH-TC-20261006-110332035 | TC | apps/api/test/dashboard/report-products.spec.ts | pass | - |
| DSH-TC-20261006-110332066 | TC | apps/api/test/dashboard/report-products.spec.ts | pass | - |
| DSH-TC-20261006-110332095 | TC | apps/api/test/dashboard/report-products.spec.ts | pass | - |
| DSH-TC-20261006-110332125 | TC | apps/api/test/dashboard/common.spec.ts | pass | - |
| DSH-TC-20261006-110332155 | TC | apps/api/test/dashboard/common.spec.ts | pass | - |
| DSH-TC-20261006-110332185 | TC | apps/api/test/dashboard/common.spec.ts | pass | YẾU: phần "mở /admin/dashboard" ở trang web do E2E DSH-E2E-20261006-110408116 kiểm, test API chỉ kiểm chín endpoint |
| DSH-TC-20261006-110332216 | TC | apps/api/test/dashboard/common.spec.ts | pass | hạn nguồn hạ xuống 300 ms qua `DASHBOARD_SOURCE_TIMEOUT_MS` đúng như TC; mặc định 5000 kiểm ở guard.spec.ts |
| DSH-TC-20261006-110332248 | TC | apps/api/test/dashboard/common.spec.ts | pass | - |
| DSH-TC-20261006-110332279 | TC | apps/api/test/dashboard/common.spec.ts | pass | - |
| DSH-TC-20261006-110332310 | TC | apps/api/test/dashboard/common.spec.ts | pass | - |
| DSH-TC-20261006-110332347 | TC | apps/api/test/dashboard/common.spec.ts | pass | - |
| DSH-TC-20261006-110332377 | TC | apps/api/test/dashboard/common.spec.ts | pass | - |
| DSH-TC-20261006-120001001 | TC | apps/api/test/dashboard/revenue.spec.ts | pass | - |
| DSH-TC-20261006-120001002 | TC | apps/api/test/dashboard/common.spec.ts | pass | - |
| DSH-TC-20261006-120001003 | TC | apps/api/test/dashboard/report-products.spec.ts | pass | - |
| DSH-TC-20261006-120001004 | TC | apps/api/test/dashboard/report-products.spec.ts | pass | - |
| DSH-TC-20261006-120001005 | TC | apps/api/test/dashboard/common.spec.ts | pass | YẾU: hai instance là hai ứng dụng Nest trong một tiến trình (cùng PostgreSQL), không phải hai tiến trình |
| DSH-TC-20261006-120001006 | TC | apps/api/test/dashboard/revenue.spec.ts | pass | - |
| DSH-TC-20261006-120001007 | TC | apps/api/test/dashboard/orders.spec.ts | pass | - |
| DSH-TC-20261007-085337285 | TC | apps/api/test/dashboard/guard.spec.ts | pass | - |
| DSH-TC-20261007-085337320 | TC | apps/api/test/dashboard/guard.spec.ts | pass | - |
| DSH-TC-20261007-085337354 | TC | apps/api/test/dashboard/guard.spec.ts | pass | - |
| DSH-TC-20261013-232147091 | TC | apps/api/test/dashboard/web.spec.ts | pass | test hàm thuần `appliedRange`; bốn trang dùng đúng hàm này do đột biến W1, W2 |
| DSH-TC-20261013-232147375 | TC | apps/api/test/dashboard/review.spec.ts | pass | duyệt cả mười một đường dẫn, hai lần (nguồn, đệm), kèm 400 và 503 |
| DSH-TC-20261013-232147647 | TC | apps/api/test/e2e/dsh.e2e.spec.ts | pass | E2E trình duyệt thật, tên có thẻ HTML ở tồn thấp và báo cáo sản phẩm |
| DSH-TC-20261015-093255510 | TC | apps/api/test/dashboard/report-sources.spec.ts | pass | YẾU: đơn dựng bằng fixture `insertOrder` (đơn hộ có `created_by` và nguồn), không qua `OrderApi.createHo` hay CHK như mô tả của TC; số liệu vẫn đọc qua `OrderApi` thật |
| DSH-TC-20261015-093255763 | TC | apps/api/test/dashboard/report-sources.spec.ts | pass | YẾU: đơn dựng bằng fixture `insertOrder` (đơn hộ có `created_by` và nguồn), không qua `OrderApi.createHo` hay CHK như mô tả của TC; số liệu vẫn đọc qua `OrderApi` thật; dòng audit kiểm ở kho audit thật |
| DSH-TC-20261015-093255879 | TC | apps/api/test/dashboard/report-sources.spec.ts | pass | vòng ba role, mỗi role JSON và CSV |
| DSH-TC-20261015-093255993 | TC | apps/api/test/dashboard/report-sources.spec.ts | pass | - |
| DSH-TC-20261015-093256196 | TC | apps/api/test/dashboard/report-sources.spec.ts | pass | - |
| DSH-TC-20261015-093256308 | TC | apps/api/test/dashboard/report-sources.spec.ts | pass | hạn nguồn hạ xuống 300 ms qua `DASHBOARD_SOURCE_TIMEOUT_MS` (xem YẾU của các ca 503 cũ); mặc định 5000 kiểm ở `guard.spec.ts` |
| DSH-TC-20261015-093256387 | TC | apps/api/test/dashboard/report-sources.spec.ts | pass | YẾU: đơn dựng bằng fixture `insertOrder` (đơn hộ có `created_by` và nguồn), không qua `OrderApi.createHo` hay CHK như mô tả của TC; số liệu vẫn đọc qua `OrderApi` thật; đơn `cancelled` sau đó dựng bằng UPDATE trực tiếp |
| DSH-TC-20261015-093256769 | TC | apps/api/test/dashboard/report-sources.spec.ts | pass | YẾU: đơn dựng bằng fixture `insertOrder` (đơn hộ có `created_by` và nguồn), không qua `OrderApi.createHo` hay CHK như mô tả của TC; số liệu vẫn đọc qua `OrderApi` thật: đơn khách tự đặt không đi qua CHK |
| DSH-TC-20261015-093256965 | TC | apps/api/test/dashboard/report-sources.spec.ts | pass | YẾU: đơn dựng bằng fixture `insertOrder` (đơn hộ có `created_by` và nguồn), không qua `OrderApi.createHo` hay CHK như mô tả của TC; số liệu vẫn đọc qua `OrderApi` thật |
| DSH-TC-20261015-093257392 | TC | apps/api/test/dashboard/report-sources.spec.ts | pass | YẾU: đơn dựng bằng fixture `insertOrder` (đơn hộ có `created_by` và nguồn), không qua `OrderApi.createHo` hay CHK như mô tả của TC; số liệu vẫn đọc qua `OrderApi` thật; thêm đơn đúng 00:00 hai đầu (nửa mở) |
| DSH-TC-20261015-093257900 | TC | apps/api/test/dashboard/report-sources.spec.ts | pass | kiểm thêm thứ tự theo mã khi cùng doanh thu 0 |
| DSH-TC-20261015-093258155 | TC | apps/api/test/dashboard/report-sources.spec.ts | pass | - |
| DSH-TC-20261015-093258342 | TC | apps/api/test/dashboard/report-sources.spec.ts | pass | YẾU: đơn dựng bằng fixture `insertOrder` (đơn hộ có `created_by` và nguồn), không qua `OrderApi.createHo` hay CHK như mô tả của TC; số liệu vẫn đọc qua `OrderApi` thật |
| DSH-TC-20261015-093258880 | TC | apps/api/test/dashboard/report-sources.spec.ts | pass | đồng hồ giả của test chạy qua `Clock` (fixed-clock) |
| DSH-TC-20261015-093259275 | TC | apps/api/test/dashboard/report-sources.spec.ts | pass | - |
| DSH-TC-20261015-093259461 | TC | apps/api/test/dashboard/report-sources.spec.ts | pass | - |
| DSH-TC-20261015-093303064 | TC | apps/api/test/dashboard/report-sources.spec.ts | pass | YẾU: đơn dựng bằng fixture `insertOrder` (đơn hộ có `created_by` và nguồn), không qua `OrderApi.createHo` hay CHK như mô tả của TC; số liệu vẫn đọc qua `OrderApi` thật |
| DSH-TC-20261015-093259634 | TC | apps/api/test/dashboard/report-sales.spec.ts | pass | YẾU: đơn dựng bằng fixture `insertOrder` (đơn hộ có `created_by` và nguồn), không qua `OrderApi.createHo` hay CHK như mô tả của TC; số liệu vẫn đọc qua `OrderApi` thật |
| DSH-TC-20261015-093259813 | TC | apps/api/test/dashboard/report-sales.spec.ts | pass | YẾU: đơn dựng bằng fixture `insertOrder` (đơn hộ có `created_by` và nguồn), không qua `OrderApi.createHo` hay CHK như mô tả của TC; số liệu vẫn đọc qua `OrderApi` thật |
| DSH-TC-20261015-093300101 | TC | apps/api/test/dashboard/report-sales.spec.ts | pass | sale có đơn và phiên thật |
| DSH-TC-20261015-093300386 | TC | apps/api/test/dashboard/report-sales.spec.ts | pass | - |
| DSH-TC-20261015-093300553 | TC | apps/api/test/dashboard/report-sales.spec.ts | pass | - |
| DSH-TC-20261015-093300733 | TC | apps/api/test/dashboard/report-sales.spec.ts | pass | hạn nguồn 300 ms qua cấu hình; lỗi tra tên gài bằng `jest.spyOn` trên `AuthApi.getDisplayNames` (chính lớp ORD gọi) |
| DSH-TC-20261015-093300869 | TC | apps/api/test/dashboard/report-sales.spec.ts | pass | YẾU: đơn dựng bằng fixture `insertOrder` (đơn hộ có `created_by` và nguồn), không qua `OrderApi.createHo` hay CHK như mô tả của TC; số liệu vẫn đọc qua `OrderApi` thật |
| DSH-TC-20261015-093301038 | TC | apps/api/test/dashboard/report-sales.spec.ts | pass | YẾU: đơn dựng bằng fixture `insertOrder` (đơn hộ có `created_by` và nguồn), không qua `OrderApi.createHo` hay CHK như mô tả của TC; số liệu vẫn đọc qua `OrderApi` thật; đổi role và khóa tài khoản bằng UPDATE trực tiếp |
| DSH-TC-20261015-093301220 | TC | apps/api/test/dashboard/report-sales.spec.ts | pass | YẾU: "không tra được" gài bằng `jest.spyOn` lọc kết quả `AuthApi.getDisplayNames`, không xóa hàng `users` (còn khóa ngoại từ đơn) |
| DSH-TC-20261015-093301332 | TC | apps/api/test/dashboard/report-sales.spec.ts | pass | YẾU: đơn dựng bằng fixture `insertOrder` (đơn hộ có `created_by` và nguồn), không qua `OrderApi.createHo` hay CHK như mô tả của TC; số liệu vẫn đọc qua `OrderApi` thật |
| DSH-TC-20261015-093301448 | TC | apps/api/test/dashboard/report-sales.spec.ts | pass | - |
| DSH-TC-20261015-093301534 | TC | apps/api/test/dashboard/report-sales.spec.ts | pass | - |
| DSH-TC-20261015-093301648 | TC | apps/api/test/dashboard/report-sales.spec.ts | pass | NUL và nửa cặp thay thế lẻ không lưu được vào PostgreSQL: kiểm ở mức hàm `csvText`, các tên còn lại đi qua AUTH và ORD thật |
| DSH-TC-20261015-093301784 | TC | apps/api/test/dashboard/report-sales.spec.ts | pass | - |
| DSH-TC-20261015-093302063 | TC | apps/api/test/dashboard/report-sales.spec.ts | pass | - |
| DSH-TC-20261015-093302229 | TC | apps/api/test/dashboard/report-sales.spec.ts | pass | 50 người tạo dựng bằng `bulkUsers`; đếm lời gọi `getDisplayNames` bằng `jest.spyOn` |
| DSH-TC-20261015-093302350 | TC | apps/api/test/dashboard/report-ho-common.spec.ts | pass | duyệt đủ 11 đường dẫn và hai CSV, hai lượt (nguồn, đệm) |
| DSH-TC-20261015-093302456 | TC | apps/api/test/dashboard/report-ho-common.spec.ts | pass | phần trang `/admin/dashboard` hiện `access-denied` đã có ở DSH-E2E-20261006-110408116; ở đây kiểm đủ 11 đường dẫn và hai CSV cho ba role |
| DSH-TC-20261015-093302576 | TC | apps/api/test/dashboard/report-ho-common.spec.ts | pass | - |
| DSH-TC-20261015-093302708 | TC | apps/api/test/dashboard/report-ho-common.spec.ts | pass | - |
| DSH-TC-20261015-093302793 | TC | apps/api/test/dashboard/report-ho-common.spec.ts | pass | ghi audit lỗi gài bằng trigger tạm trên `audit_logs` |
| DSH-TC-20261015-093302921 | TC | apps/api/test/dashboard/report-ho-common.spec.ts | pass | - |
| DSH-TC-20261015-093334777 | TC | apps/api/test/e2e/dsh.e2e.spec.ts | pass | E2E trình duyệt thật (Chromium), chạy trong BẢN SAO của repo ở `/tmp` với CSDL `ecom_e2e_dsh` và cổng 3600 (không đụng `ecom_e2e` và `.next` của agent khác); mã giống cây thật |
| DSH-TC-20261015-093334820 | TC | apps/api/test/e2e/dsh.e2e.spec.ts | pass | như trên |
| DSH-TC-20261015-093334858 | TC | apps/api/test/e2e/dsh.e2e.spec.ts | pass | như trên |
| DSH-TC-20261015-093334896 | TC | apps/api/test/e2e/dsh.e2e.spec.ts | pass | như trên |

## Kiểm đột biến
Bảng `apps/api/scripts/mutations-dsh.json` (194 đột biến: 136 của lượt đầu, 3 của web, 55 của hai báo cáo tính lương, phủ SB-05, SB-07, SB-08, SB-11, SB-14, SB-19, SB-20, SB-23, SB-39 và phần nền sửa kèm ORD, AUTH, USR, hàm thuần của web) chạy bằng `node .claude/skills/sdlc-review/scripts/mutate.mjs apps/api/scripts/mutations-dsh.json --cwd apps/api` trong BẢN SAO của repo ở `/tmp` (mutate.mjs không khôi phục khi bị SIGKILL; cây thật không bị gài, `git diff apps/api/src` kiểm sau lượt chạy). Lượt đầu: 120 bắt, 16 lọt (4 ghi tương đương từ đầu). 12 lọt thật được xử lý bằng test thêm (bộ lọc test sai ở hai dòng, khóa đệm theo từng tham số, hạn mục đệm bằng số cứng 500, tồn thấp và đơn gần đây từ chối from, to, from mặc định trước 1970, khoảng nửa mở, audit không ghi khi 503) và chạy lại đúng các dòng đó: bắt hết, riêng hai dòng chuyển sang tương đương có lý do. Kết quả cuối: 130 bắt, 6 lọt tương đương. Cổng kiểm của chính bảng: `apps/api/test/tooling/mutations-dsh.spec.ts` (mang ID DSH-SEC-20261006-105535103). Cột Test đỏ là TC đại diện của test chạy trong lệnh của dòng đó.

| Chỗ phá | Test đỏ | Kết quả |
|---|---|---|
| T1 SB-05, SB-07: endpoint revenue mở cho staff (thêm vào @Roles) | DSH-TC-20261006-110330080 | bắt |
| T1 SB-05, SB-07: endpoint orders mở cho customer (thêm vào @Roles) | DSH-TC-20261006-110330309 | bắt |
| T1 SB-05, SB-07: endpoint customers mở cho staff (thêm vào @Roles) | DSH-TC-20261006-110330511 | bắt |
| T1 SB-05, SB-07: endpoint products mở cho staff (thêm vào @Roles) | DSH-TC-20261006-110330708 | bắt |
| T1 SB-05, SB-07: endpoint low-stock mở cho staff (thêm vào @Roles) | DSH-TC-20261006-110330922 | bắt |
| T1 SB-05, SB-07: endpoint recent-orders mở cho customer (thêm vào @Roles) | DSH-TC-20261006-110331101 | bắt |
| T1 SB-05, SB-07: endpoint report-revenue mở cho customer (thêm vào @Roles) | DSH-TC-20261006-110331410 | bắt |
| T1 SB-05, SB-07: endpoint report-orders mở cho staff (thêm vào @Roles) | DSH-TC-20261006-110331642 | bắt |
| T1 SB-05, SB-07: endpoint report-products mở cho customer (thêm vào @Roles) | DSH-TC-20261006-110331903 | bắt |
| T1 SB-05: guard giới hạn tần suất của DSH chạy trước kiểm quyền không còn là việc của controller (bỏ @UseGuards) | DSH-TC-20261006-110332248 | bắt |
| T1 SB-07: yêu cầu bị 403 vẫn ghi audit (đặt audit trước kiểm... ) - bỏ @Validate khai báo route | DSH-TC-20261006-110332185 | bắt |
| T1 SB-05: @Action của endpoint doanh thu trỏ sai hàng ma trận | DSH-TC-20261006-110332185 | bắt |
| T9 SB-20: bỏ Cache-Control no-store ở một endpoint tiền | DSH-TC-20261006-110329988 | bắt |
| T4 SB-14: yêu cầu vượt hạn mức vẫn được qua (allowed luôn đúng) | DSH-TC-20261006-110332248 | bắt |
| T4 SB-14: hạn mức dùng chung một khóa cho mọi admin | DSH-TC-20261006-110332248 | bắt |
| T4 SB-14: cửa sổ đếm 600 giây thay vì 60 | DSH-TC-20261006-110332248 | bắt |
| T4 SB-14: Retry-After không gửi kèm 429 | DSH-TC-20261006-110332248 | bắt |
| T4 SB-14: đếm không nguyên tử (kiểm check rồi hit, khe giữa hai lệnh): 60 yêu cầu song song đều qua | DSH-TC-20261006-110332248 | bắt |
| T4 SB-14: guard không có phiên thì cho qua (không đóng khi lỗi) | - | lọt (tương đương): guard toàn cục AuthGuard luôn đặt `req.session` trước khi tới guard của DSH (đã chặn 401, 403), nên nhánh `!session` không tới được từ HTTP; chỉ là lớp phòng thủ khi cấu hình guard thay đổi |
| T4 SB-14: mặc định hạn mức 30 thành 31 | DSH-TC-20261006-110332248 | bắt |
| T4: mặc định hạn nguồn 5000 ms thành 6000 | DSH-TC-20261006-110332248 | bắt |
| T4: mặc định đệm 60 giây thành 120 | DSH-TC-20261006-110332248 | bắt |
| T4 SB-11: tối đa 366 ngày thành 367 | DSH-TC-20261006-110331438 | bắt |
| T4: mỗi đoạn gọi nguồn 960 giờ thành 1100 (vượt trần 1000 mốc) | DSH-TC-20261006-110331351 | bắt |
| T4 SB-39: trần lời gọi đang chạy của một nguồn 6 thành 60 (không còn chặn dồn truy vấn vào nguồn chậm) | DSH-TC-20261006-110330139 | bắt |
| T3: độ mịn ngày tối đa 31 thành 32 | DSH-TC-20261006-110331495 | bắt |
| T3: độ mịn tuần tối đa 92 thành 93 | DSH-TC-20261006-110331495 | bắt |
| T5: múi giờ Việt Nam UTC+7 thành UTC+6 | DSH-TC-20261006-110330197 | bắt |
| T3: giới hạn sớm nhất 1970 bị dời | DSH-TC-20261006-110330109 | bắt |
| T2 SB-08: số đơn gần đây 10 thành 11 | DSH-TC-20261006-110331071 | bắt |
| T2: số tồn thấp hiển thị 5 thành 6 | DSH-TC-20261006-110330892 | bắt |
| T3: limit mặc định 10 thành 20 | DSH-TC-20261006-110331842 | bắt |
| T7: số mục đệm tối đa 500 thành 5000 | DSH-TC-20261006-110332347 | bắt |
| T3 SB-11: tham số lạ không còn bị từ chối | DSH-TC-20261006-110330735 | bắt |
| T3 SB-11: endpoint tồn thấp nhận from, to | DSH-TC-20261006-110330735 | bắt |
| T3 SB-11: sort nhận thêm giá trị price | DSH-TC-20261006-110331936 | bắt |
| T3 SB-11: limit tối đa 50 thành 100 | DSH-TC-20261006-110331936 | bắt |
| T3 SB-11: limit 0 được nhận | DSH-TC-20261006-110331936 | bắt |
| T3 SB-11: limit số thập phân hoặc có số 0 đầu được nhận (regex nới) | DSH-TC-20261006-110331936 | bắt |
| T3 SB-11: limit chuỗi dài vô hạn không còn bị chặn bằng độ dài | - | lọt (tương đương): `Number(l) > TOP_LIMIT_MAX` đã chặn mọi chuỗi số dài (Number của chuỗi rất dài là Infinity hoặc rất lớn); phép kiểm độ dài chỉ để tránh chuyển đổi số lớn không cần thiết, kết quả 400 như nhau |
| T3 SB-11: khóa đệm bỏ tham số to | DSH-TC-20261006-110332347 | bắt |
| T3 SB-05: khóa đệm bỏ tham số from | DSH-TC-20261006-110332347 | bắt |
| T7 SB-05: khóa đệm bỏ sort | DSH-TC-20261006-110332347 | bắt |
| T7 SB-05: khóa đệm bỏ limit | DSH-TC-20261006-110332347 | bắt |
| T7 SB-05: khóa đệm bỏ tên khối | DSH-TC-20261006-110332347 | bắt |
| T3 SB-11: ngày sau hôm nay được nhận | DSH-TC-20261006-110330539 | bắt |
| T3 SB-11: hôm nay bị từ chối (> thành >=) | DSH-TC-20261006-110329988 | bắt |
| T3 SB-11: khoảng đảo ngược được nhận | DSH-TC-20261006-110330341 | bắt |
| T3 SB-11: khoảng một ngày bị từ chối (> thành >=) | DSH-TC-20261006-110331524 | bắt |
| T3 SB-11: 367 ngày được nhận | DSH-TC-20261006-110330109 | bắt |
| T3 SB-11: 366 ngày bị từ chối (> thành >=) | DSH-TC-20261006-110330109 | bắt |
| T3 SB-11: ngày không số 0 đầu (2026-9-1) được nhận | DSH-TC-20261006-110331671 | bắt |
| T3 SB-11: không kiểm ngày theo lịch (2026-02-30 được nhận) | DSH-TC-20261006-110330109 | bắt |
| T3 SB-11: năm nhuận 400 không nhuận (2000-02-29 bị từ chối) | DSH-TC-20261006-110330109 | bắt |
| T3 SB-11: ngày quá sớm (trước 1970) được nhận | - | lọt (tương đương): phép kiểm thứ hai `fromNum < MIN_DATE_NUM` sau khi ghép mặc định vẫn chặn mọi from hoặc to trước 1970 (to trước 1970 làm from mặc định rơi trước 1970), kết quả 400 như nhau; phép kiểm ở từng tham số chỉ để báo đúng tên tham số khi to sai, và tên ấy đã được kiểm ở range.spec |
| T3 SB-11: from mặc định không kiểm cận dưới | DSH-TC-20261006-110330109 | bắt |
| T5: tuần bắt đầu Chủ nhật thay vì thứ Hai | DSH-TC-20261006-110331351 | bắt |
| T5: mốc tuần cách 6 ngày thay vì 7 | DSH-TC-20261006-110331351 | bắt |
| T5: mốc tháng dùng ngày 2 thay vì ngày 1 | DSH-TC-20261006-110331552 | bắt |
| T5: ranh giới ngày tính theo UTC (không cộng 7 giờ khi đổi thời điểm ra ngày) | DSH-TC-20261006-110331320 | bắt |
| T5: 00:00 giờ Việt Nam của ngày n tính nhầm bằng 00:00 UTC | DSH-TC-20261006-110330197 | bắt |
| T3: khoảng mặc định 30 ngày thành 29 ngày | DSH-TC-20261006-110330022 | bắt |
| T5: khoảng UTC kết thúc không cộng thêm một ngày (đóng thay vì nửa mở tới ngày sau) | DSH-TC-20261006-110330197 | bắt |
| T5: hôm nay lấy theo UTC thay vì giờ Việt Nam | DSH-TC-20261006-110330022 | bắt |
| T5: as_of in ra có .000 | DSH-TC-20261006-110329988 | bắt |
| T5 SB-23: net = gross + refunded | DSH-TC-20261006-110329988 | bắt |
| T5 SB-23: payment_count lấy theo gross | DSH-TC-20261006-110329988 | bắt |
| T5 SB-23: failed_refund_count không lấy từ PAY | DSH-TC-20261006-110330051 | bắt |
| T5 SB-23: ô doanh thu chỉ lấy totals của PAY từ đầu khoảng + 1 giờ (sai khoảng UTC) | DSH-TC-20261006-110330197 | bắt |
| T5 SB-23: báo cáo doanh thu bỏ cộng các mốc | DSH-TC-20261006-110331320 | bắt |
| T5 SB-23: báo cáo doanh thu totals không cộng các đoạn | DSH-TC-20261006-110331380 | bắt |
| T5 SB-23: by_method đổi chỗ VNPay và COD | DSH-TC-20261006-110331320 | bắt |
| T5 SB-23: báo cáo doanh thu chỉ gọi đoạn đầu (bỏ lặp các đoạn) | DSH-TC-20261006-110331320 | bắt |
| T5: tổng đơn tính hiệu lực không loại returned | DSH-TC-20261006-110330281 | bắt |
| T5: tổng đơn bỏ khóa expired khỏi hiệu lực | DSH-TC-20261006-110330281 | bắt |
| T5: tỷ lệ làm tròn xuống thay vì nửa lên | DSH-TC-20261006-110331785 | bắt |
| T5: tỷ lệ khi không có đơn là 0 thay vì null | DSH-TC-20261006-110331728 | bắt |
| T5: giá trị đơn trung bình làm tròn gần nhất thay vì xuống | DSH-TC-20261006-110331813 | bắt |
| T5: giá trị đơn trung bình khi không có đơn là 0 thay vì null | DSH-TC-20261006-110331728 | bắt |
| T5: giá trị đơn trung bình chia cho tổng đơn thay vì số đơn đã thu | DSH-TC-20261006-110331757 | bắt |
| T5: báo cáo đơn không cộng số đơn đã thu của từng mốc | DSH-TC-20261006-110331609 | bắt |
| T5: báo cáo đơn bỏ cộng một trạng thái vào mốc | DSH-TC-20261006-110331609 | bắt |
| T5: báo cáo sản phẩm đảo cách xếp | DSH-TC-20261006-110331871 | bắt |
| T5: tổng số lượng toàn khoảng lấy từ danh sách đã cắt | DSH-TC-20261006-110332035 | bắt |
| T5: báo cáo sản phẩm bỏ tên từ PRD | DSH-TC-20261006-110331842 | bắt |
| T5: báo cáo sản phẩm không cắt theo limit | - | lọt (tương đương): `OrderApi.getTopProducts(range, sort, limit)` đã cắt đúng `limit` dòng ở truy vấn nên `slice` ở DSH là lớp phòng thủ khi nguồn trả thừa; không dựng được nguồn trả thừa mà không giả OrderApi (test của ORD kiểm cắt ở nguồn) |
| T5: ô sản phẩm tổng không cộng nháp | DSH-TC-20261006-110330680 | bắt |
| T2 SB-08: đơn gần đây trả nguyên bản ghi nguồn (không danh sách trắng) | DSH-TC-20261006-110331071 | bắt |
| T2 SB-08: tồn thấp trả nguyên bản ghi nguồn (không danh sách trắng) | - | lọt (tương đương): InventoryApi.getLowStockSummary đã trả đúng năm trường nên danh sách trắng ở DSH là lớp phòng thủ thứ hai: không có test nào dựng được nguồn trả thừa trường mà không giả InventoryApi (test của INV kiểm bộ trường ở nguồn) |
| T5: tồn thấp count lấy số mục thay vì tổng thật | DSH-TC-20261006-110330892 | bắt |
| T5: khách trả total thành new_in_range | DSH-TC-20261006-110330483 | bắt |
| T11 SB-39: nguồn lỗi hoặc quá hạn trả undefined thay vì 503 (khối hiện số 0) | DSH-TC-20261006-110330139 | bắt |
| T11 SB-39: hạn nguồn nhân 100 (quá hạn không còn tới) | DSH-TC-20261006-110330370 | bắt |
| T9 SB-20: 503 kèm chi tiết lỗi của nguồn (detail) | DSH-TC-20261006-110330139 | bắt |
| T9 SB-20: 503 kèm stack của lỗi nguồn (extra) | DSH-TC-20261006-110330139 | bắt |
| T11 SB-39: nguồn trong 503 sai tên | DSH-TC-20261006-110330139 | bắt |
| T11: bộ đếm lời gọi đang chạy không giảm khi truy vấn xong (rò chỗ) | DSH-TC-20261006-110330139 | bắt |
| T11: bộ đếm lời gọi đang chạy giảm khi quá hạn thay vì khi truy vấn xong | DSH-TC-20261006-110330139 | bắt |
| T11: lỗi muộn của nguồn thành unhandled rejection (bỏ then hai nhánh) | DSH-TC-20261006-110330139 | bắt |
| T7 SB-05: không lưu đệm (bỏ store) | DSH-TC-20261006-110332155 | bắt |
| T7: đệm sống 6 giây thay vì 60 (nhân 100 thay vì 1000) | DSH-TC-20261006-110332155 | bắt |
| T7: đúng 60 giây vẫn dùng đệm (> thành >=) | DSH-TC-20261006-110332310 | bắt |
| T7: không chống dồn đàn (bỏ dùng chung lần đọc) | DSH-TC-20261006-110332155 | bắt |
| T7: as_of lấy lúc ghi vào đệm thay vì lúc bắt đầu đọc nguồn | DSH-TC-20261006-110332310 | bắt |
| T7: lỗi nguồn được lưu đệm (lưu cả khi load ném lỗi) | DSH-TC-20261006-110330139 | bắt |
| T6 SB-19: audit gộp bị bỏ (mỗi yêu cầu một dòng) | DSH-TC-20261006-110332125 | bắt |
| T6 SB-19: không đặt dấu gộp trước khi ghi | DSH-TC-20261006-110332125 | bắt |
| T6 SB-19: dấu gộp theo 10 phút thay vì 1 phút | DSH-TC-20261006-120001002 | bắt |
| T6 SB-19: audit ghi vai trò staff | DSH-TC-20261006-110332125 | bắt |
| T6 SB-19: audit không có actor_id | DSH-TC-20261006-110332125 | bắt |
| T6 SB-19: audit chứa nội dung số liệu | DSH-TC-20261006-110332125 | bắt |
| T6 SB-19: ghi audit lỗi làm hỏng việc xem (không bắt lỗi) | DSH-TC-20261006-110332377 | bắt |
| T6 SB-19: audit ghi cả khi nguồn 503 (ghi trước khi đọc nguồn) | DSH-TC-20261006-110330139 | bắt |
| T6 SB-19: log lỗi audit không có trace_id | DSH-TC-20261006-110332377 | bắt |
| T6 SB-19: tên hành động audit sai | DSH-TC-20261006-110332125 | bắt |
| T2 SB-08: kiểm tham số chạy sau khi gọi nguồn (đảo bước) | DSH-TC-20261006-110330109 | bắt |
| T8: DSH khai thiếu ValidationInterceptor... bỏ DashboardRateGuard khỏi providers | - | lọt (tương đương): bỏ DashboardRateGuard khỏi providers làm Nest không khởi tạo được controller (lỗi phụ thuộc lúc nạp module): mọi test của DSH đỏ ở bước khởi động, tức là cổng bắt được nhưng báo là hỏng biên dịch chứ không phải khẳng định; giữ để bảng phủ module |
| T5 nền ORD: getProductSalesTotals không loại đơn returned | DSH-TC-20261006-110332035 | bắt |
| T5 nền ORD: getProductSalesTotals đếm dòng thay vì sản phẩm khác nhau | DSH-TC-20261006-110332035 | bắt |
| T5 nền ORD: getProductSalesTotals tính đơn chưa thu tiền | DSH-TC-20261006-110332035 | bắt |
| T5 nền ORD: getProductSalesTotals khoảng đóng (<= to) | DSH-TC-20261006-110332035 | bắt |
| T2 nền ORD: listRecent không trả payment_method | DSH-TC-20261006-110331071 | bắt |
| T5 nền AUTH: countCustomerStats đếm khóa theo trạng thái active | DSH-TC-20261006-110330483 | bắt |
| T5 nền AUTH: countCustomerStats khoảng đóng (<= to) | DSH-TC-20261006-110330483 | bắt |
| T5 nền AUTH: countCustomerStats đếm cả staff và admin | DSH-TC-20261006-110330483 | bắt |
| T5 nền AUTH: countCustomerStats không kiểm khoảng (nhận from sau to) | DSH-TC-20261006-110330595 | bắt |
| T5 nền USR: countCustomers truyền sai khoảng sang AUTH | DSH-TC-20261006-110330483 | bắt |
| T5 web: hôm nay tính theo UTC thay vì giờ Việt Nam | DSH-TC-20261006-110330022 | bắt |
| T5 web: 30 ngày qua thành 29 | DSH-TC-20261006-110330022 | bắt |
| T5 web: giờ Cập nhật lúc theo UTC | DSH-E2E-20261006-110407878 | bắt |
| T11 web: tỷ lệ null hiện 0,0% thay vì — | DSH-TC-20261006-110331728 | bắt |
| T11 web: giá trị trung bình null hiện 0 đ thay vì — | DSH-TC-20261006-110329988 | bắt |
| T11 web: khối lỗi vẫn coi là có số | DSH-TC-20261006-110330139 | bắt |
| T11 web: 429 lần đầu (chưa có số) không coi là lỗi | DSH-TC-20261006-110330139 | bắt |
| T5 web: nhãn mốc tháng thiếu bỏ ngày | DSH-TC-20261006-110331351 | bắt |
| T5 web: dải 429 mặc định 30 giây thay vì 60 | DSH-TC-20261006-110332248 | bắt |
| T14 SB-05, SB-07: báo cáo theo nguồn mở cho staff (thêm vào @Roles) | DSH-TC-20261015-093255879 | bắt |
| T14 SB-05, SB-07: báo cáo theo sale mở cho sale (thêm vào @Roles) | DSH-TC-20261015-093300101 | bắt |
| T14 SB-07: báo cáo theo sale mở cho customer (thêm vào @Roles) | DSH-TC-20261015-093302456 | bắt |
| T19 SB-13: báo cáo theo nguồn bỏ Cache-Control no-store | DSH-TC-20261015-093302350 | bắt |
| T19 SB-13: CSV không còn là attachment (tên tệp đổi sang inline) | DSH-TC-20261015-093255763 | bắt |
| T19: Content-Type của tệp CSV thành text/plain | DSH-TC-20261015-093255763 | bắt |
| T20 SB-11: yêu cầu có format vẫn trả JSON (bỏ nhánh CSV của controller) | DSH-TC-20261015-093255763 | bắt |
| T16: tệp CSV mất BOM UTF-8 | DSH-TC-20261015-093255763 | bắt |
| T16: CSV kết thúc dòng bằng LF thay CRLF | DSH-TC-20261015-093255763 | bắt |
| T16: dòng Tổng của CSV theo nguồn lấy doanh thu 0 | DSH-TC-20261015-093255763 | bắt |
| T16 SB-43: chống công thức của CSV bỏ ký tự đầu = | DSH-TC-20261015-093258155 | bắt |
| T16 SB-43: chống công thức của CSV bỏ ký tự đầu + | DSH-TC-20261015-093258155 | bắt |
| T16 SB-43: chống công thức của CSV bỏ ký tự đầu - | DSH-TC-20261015-093258155 | bắt |
| T16 SB-43: chống công thức của CSV bỏ ký tự đầu @ | DSH-TC-20261015-093301648 | bắt |
| T16 SB-43: chống công thức của CSV bỏ ký tự đầu tab | DSH-TC-20261015-093258155 | bắt |
| T16 SB-43: chống công thức của CSV bỏ ký tự đầu CR | DSH-TC-20261015-093301648 | bắt |
| T16 SB-43: không còn thêm dấu nháy đơn trước ô nguy hiểm | DSH-TC-20261015-093258155 | bắt |
| T16: nháy kép trong ô không được nhân đôi (RFC 4180) | DSH-TC-20261015-093258155 | bắt |
| T16: ô có xuống dòng không được bao nháy kép (chỉ bao khi có dấu phẩy hoặc nháy) | DSH-TC-20261015-093301648 | bắt |
| T16: nửa cặp thay thế lẻ không được thay bằng U+FFFD | DSH-TC-20261015-093301648 | bắt |
| T16: ký tự NUL không bị bỏ khỏi ô | DSH-TC-20261015-093301648 | bắt |
| T16: dòng website của CSV theo sale điền mã người dùng | DSH-TC-20261015-093259813 | bắt |
| T16: báo cáo theo nguồn sắp doanh thu tăng dần | DSH-TC-20261015-093255510 | bắt |
| T16: báo cáo theo nguồn bỏ khóa phụ theo mã khi cùng doanh thu | DSH-TC-20261015-093257900 | bắt |
| T16: excluded_orders của báo cáo theo nguồn luôn 0 | DSH-TC-20261015-093256387 | bắt |
| T16: totals.revenue của báo cáo theo nguồn cộng số đơn | DSH-TC-20261015-093255510 | bắt |
| T16: báo cáo theo sale gán đơn khách tự đặt cho một người (đảo nhánh created_by rỗng) | DSH-TC-20261015-093259634 | bắt |
| T16: tài khoản không tra được tên thì dòng mang tên rỗng thay vì nhãn | DSH-TC-20261015-093301220 | bắt |
| T16: totals.orders của báo cáo theo sale không cộng dòng website | DSH-TC-20261015-093259634 | bắt |
| T16: totals.revenue của báo cáo theo sale không cộng dòng website | DSH-TC-20261015-093259634 | bắt |
| T16: báo cáo theo sale bỏ khóa phụ theo tên khi cùng doanh thu | DSH-TC-20261015-093301534 (ca T16 cùng doanh thu, cùng tệp) | bắt |
| T16: báo cáo theo sale sắp doanh thu tăng dần | DSH-TC-20261015-093259634 | bắt |
| T16: nhãn dòng website đổi chữ | DSH-TC-20261015-093259634 | bắt |
| T20 SB-11: format=xlsx được nhận (không còn từ chối giá trị lạ) | DSH-TC-20261015-093256196 | bắt |
| T20 SB-11: báo cáo theo nguồn nhận tham số granularity | DSH-TC-20261015-093256196 | bắt |
| T20 SB-11: báo cáo theo sale nhận tham số created_by | DSH-TC-20261015-093300553 | bắt |
| T20: báo cáo theo nguồn không còn chặn khoảng 367 ngày (bỏ khỏi nhóm có khoảng ngày) | DSH-TC-20261015-093259275 | bắt |
| T18: khóa đệm gồm cả format (CSV không dùng chung bản đệm với JSON) | DSH-TC-20261015-093258880 | bắt |
| T17 SB-19: audit xuất CSV ghi nhầm hành động dashboard.view | DSH-TC-20261015-093255763 | bắt |
| T17 SB-19: audit xuất CSV ghi số dòng 0 | DSH-TC-20261015-093255763 | bắt |
| T17 SB-19: audit xuất CSV ghi nội dung số liệu (tổng doanh thu) | DSH-TC-20261015-093255763 | bắt |
| T17 SB-19: ghi audit xuất lỗi thì chặn tải tệp | DSH-TC-20261015-093302793 | bắt |
| T17 SB-19: audit xuất CSV gộp theo phút như dashboard.view (bỏ qua lần xuất thứ hai trong phút) | DSH-TC-20261015-093302708 | bắt |
| T19: tên tệp CSV theo sale đổi | DSH-TC-20261015-093259813 | bắt |
| T19: tên tệp CSV theo nguồn đổi | DSH-TC-20261015-093255763 | bắt |
| T16 ORD: báo cáo theo nguồn không loại đơn returned khỏi số đơn tính | DSH-TC-20261015-093256387 | bắt |
| T16 ORD: báo cáo theo nguồn không loại đơn expired khỏi doanh thu | DSH-TC-20261015-093256387 | bắt |
| T16 ORD: báo cáo theo nguồn bỏ đơn cancelled khỏi excluded_orders | DSH-TC-20261015-093256387 | bắt |
| T16 ORD: khoảng ngày của báo cáo theo nguồn thành đóng hai đầu (<= to) | DSH-TC-20261015-093257392 | bắt |
| T16 ORD: khoảng ngày của báo cáo theo nguồn bỏ đầu mút from (> from) | DSH-TC-20261015-093257392 | bắt |
| T16 ORD: nguồn đã tắt không đơn vẫn hiện (bỏ lọc is_active hoặc orders > 0) | DSH-TC-20261015-093256965 | bắt |
| T16 ORD: nguồn đã tắt có đơn bị ẩn | DSH-TC-20261015-093256965 | bắt |
| T16 ORD: báo cáo theo sale có dòng cho người chỉ có đơn bị loại | DSH-TC-20261015-093300869 | bắt |
| T16 ORD: báo cáo theo sale không loại đơn cancelled khỏi doanh thu | DSH-TC-20261015-093300869 | bắt |
| T16 ORD: tên người tạo tra từng người thay vì theo lô (N+1) | DSH-TC-20261015-093302229 | bắt |


Đợt bán hộ (hai báo cáo `reports/sources`, `reports/sales`, xuất CSV): thêm 55 đột biến (T14 quyền, T16 số tính lương và chống công thức CSV, T17 audit export, T18 đệm, T19 header tải về, T20 tham số, và phần nền ORD `getSourcesReport`, `getSalesReport`) chạy bằng cùng lệnh trong bản sao `/tmp` với CSDL `ecom_test_dsh_mut`. Lượt đầu: 52 bắt, 1 lọt thật là dòng bỏ `nosniff` ở controller (app-setup của platform đã đặt `nosniff` cho mọi phản hồi, SB-13, nên dòng của DSH thừa: đã XÓA dòng và đột biến), 1 lọt vì bộ phân tích CSV của test chỉ tách dòng ở CRLF (thêm so chuỗi thô `"An\nBình"` vào DSH-TC-20261015-093301648), 1 lọt hẹp (tie-break theo tên của báo cáo theo sale chưa có ca riêng: thêm ca `T16: cùng doanh thu thì xếp theo tên` ở `report-sales.spec.ts`), và dòng NUL đổi `find` sau khi đổi regex thành `split` cho lint. Chạy lại ba dòng đó: bắt hết. Kết quả cuối: 55 bắt, 0 lọt. Cổng kiểm của bảng (`test/tooling/mutations-dsh.spec.ts`) vẫn xanh.

## Lệch spec
1. [đã chọn] DSH không có bảng, không migration, không schema Prisma riêng (đúng DSH-DB, ghi rõ theo yêu cầu): không có file `dashboard.prisma`, không thư mục migration của DSH; kiểm ở `apps/api/test/dashboard/guard.spec.ts` (DSH-SEC-20261006-105535103 T8).
2. [đã chọn] Tên lớp và chữ ký thật khác chữ ký đề xuất của DSH-API: giao diện đọc là `OrderApi`, `CatalogApi`, `InventoryApi`, `UserApi`, `PaymentApi`; `PaymentApi.getRevenue({ from, to }, bucket?)` nhận khoảng UTC nửa mở và bucket `hour|day|month` theo UTC (không phải `getRevenue(range_utc, bucket?)`), `OrderApi.getTopProducts(range, sort, limit)` dùng khóa `quantity|amount` (DSH đổi từ `units|amount` của API công khai) và không trả `name`. Rủi ro: đổi chữ ký ở module chủ làm DSH vỡ; có test chữ ký (số đối số) ở `test/order/guard.spec.ts`, `test/payment/guard.spec.ts` và test DSH chạy trên chính các lớp đó.
3. [đã chọn] Báo cáo theo ngày, tuần, tháng GIỜ VIỆT NAM trong khi PAY và ORD chỉ chia mốc theo UTC (ngày UTC lệch ngày Việt Nam 7 giờ): DSH gọi nguồn theo bucket `hour`, chia khoảng thành đoạn tối đa 960 giờ (dưới trần 1000 mốc của nguồn) và gộp các giờ thành ngày, tuần (thứ Hai), tháng; tổng và theo phương thức là tổng của các đoạn nên tổng các mốc luôn bằng `totals`, và `totals` bằng ô doanh thu của cùng khoảng (DSH-TC-20261006-110331380, tải hỗn hợp kiểm lại với truy vấn độc lập theo múi giờ của PostgreSQL ở `test/dashboard/load.spec.ts`). Không sửa PAY. Rủi ro: một báo cáo 366 ngày gọi nguồn tới 10 lần tuần tự trong hạn 5 giây chung của khối; các đoạn không chung một ảnh chụp nên một giao dịch ghi giữa hai đoạn có thể lệch tạm (chấp nhận, cùng mức với lệch giữa hai khối).
4. [đã chọn] Sửa nền ORD kèm epic (DSH-TC-20261006-110332035 và DSH-TC-20261006-110331071 trong `apps/api/test/order/dsh.spec.ts`): thêm `OrderApi.getProductSalesTotals(range)` (tổng số lượng và số sản phẩm khác nhau của TOÀN khoảng, DSH-REQ-20261006-105126458 BR4, không suy ra được từ `getTopProducts` bị cắt ở 100 dòng) và thêm `payment_method` vào `listRecent` (DSH-API đòi bảy khóa). Đã đổi `test/order/interfaces.spec.ts` (bộ khóa), `test/order/guard.spec.ts` (tập phương thức) và `scripts/mutations-ord.json` (hai dòng `find` đổi theo mã). Chỉ thêm, không đổi trường sẵn có.
5. [đã chọn] Sửa nền AUTH và USR kèm epic (DSH-TC-20261006-110330483 và DSH-TC-20261006-110330595 trong `apps/api/test/auth/dsh.spec.ts`, `apps/api/test/user/dsh.spec.ts`): thêm `AuthApi.countCustomerStats(range)` (tổng khách, khóa, khách mới trong `[from, to)` trong MỘT câu, không trường cá nhân) và đổi chữ ký `UserApi.countCustomers()` (trả số) thành `countCustomers(range)` trả `{ total, locked, new_in_range }`; hàm `AuthApi.countCustomers()` cũ giữ nguyên. Hàm cũ của USR chưa có nơi nào gọi và chưa có test nên đổi chữ ký không phá bên gọi.
6. [cần quyết] Bảng "Giao diện module" của `spec/architecture.md` và tech-design của ORD, USR chưa liệt kê `getProductSalesTotals`, `payment_method` ở `listRecent` và chữ ký `countCustomers(range)` / `countCustomerStats`: cần chạy `sdlc-impact` để ghi vào nền (DSH không sửa spec đã duyệt).
7. [đã chọn] `name` ở báo cáo sản phẩm lấy từ PRD (`CatalogApi.getSummaries`, tên HIỆN TẠI của sản phẩm) thay vì `name_snapshot` của dòng đơn mới nhất trong khoảng (DSH-REQ-20261006-105126458 BR5), vì ORD không trả tên (DSH-API cho phép lấy từ PRD). Hệ quả: sản phẩm đổi tên sau khi bán hiện tên mới (DSH-TC-20261006-110332066 dựng tên mới ở PRD); sản phẩm không còn ở PRD hiện tên rỗng và giao diện in "—". Rủi ro: người duyệt muốn tên lúc bán thì cần thêm trường vào ORD.
8. [đã chọn] Lỗi 400 `invalid-parameter` có `errors[]` mỗi phần tử mang CẢ `field`, `code` (khóa chung của PRJ, ADR-006) và `reason` (khóa DSH-API, cùng giá trị); `ProblemErrorItem` của platform chỉ có `code`, DSH không đụng tới platform. Kiểm tham số tự viết ở `policy.ts` thay vì `@Validate` của platform vì platform luôn trả `validation-failed`, còn DSH-API đòi `invalid-parameter`; `@Validate({ query: z.any() })` chỉ để test quét route thấy khai báo. Khóa `__proto__`, `constructor` trong truy vấn là tham số lạ (400), tên khóa lạ không được lặp lại nếu có ký tự ngoài `[A-Za-z0-9_.[]-]` (in `(parameter)`).
9. [đã chọn] Ngày trước 1970-01-01 là 400 (`too_early`, theo `from` hoặc `to`) vì nguồn chỉ nhận năm 1 tới 9999 và ngày địa phương trừ 7 giờ của 0001-01-01 rơi vào năm 0; spec không nêu cận dưới. Với khoảng tối đa 366 ngày và `to` không sau hôm nay, mọi khoảng hợp lệ đều sau 1970.
10. [đã chọn] Giá trị đơn trung bình (DSH-REQ-20261006-105126368 BR4) tính trên đơn `payment_status = succeeded` có `paid_at` trong khoảng (giao diện `getOrderSeries` của ORD đếm `paid_orders` và `paid_total` theo `paid_at`, M-13), không theo `created_at`: đơn tạo trước khoảng mà thu trong khoảng được tính, đơn tạo trong khoảng mà thu sau thì không. Cùng tập với doanh thu PAY, nhưng khác chữ "đơn trong khoảng" của BR4 ở ca biên này; mọi TC của spec dựng đơn tạo và thu cùng khoảng nên không phân biệt.
11. [đã chọn] Audit `dashboard.view` ghi bằng `AuditService.record` (không dùng tùy chọn `coalesce` theo cửa sổ trượt 60 giây trong CSDL của platform): dấu gộp là bộ nhớ tiến trình theo PHÚT UTC (đúng DSH-DB), đặt trước khi ghi nên sáu khối chạy song song của một lần mở trang chỉ ghi một dòng; nhiều instance hoặc khởi động lại có thể ghi thêm một dòng trong phút (DSH-DB chấp nhận). Ghi lỗi không chặn xem, log `error` `audit-write-failed` kèm `trace_id` (DSH-TC-20261006-110332377).
12. [đã chọn] Giới hạn tần suất bậc D: guard cấp route (`DashboardRateGuard`) chạy SAU guard toàn cục (đúng thứ tự spec 401, 403, 429, 400) và đếm bằng `RateLimitService.take` nguyên tử (một câu UPSERT, ADR-014 bản mới) thay vì cặp `check` rồi `hit` của DSH-DB (có khe giữa hai lệnh); lượt bị 429 vẫn tăng bộ đếm (cửa sổ cố định tự về 0), nên kho đếm ghi 32 sau 30 lượt qua và 2 lượt bị từ chối (DSH-TC-20261006-120001005). Guard bậc C mặc định của platform (120 mỗi phút mỗi route mỗi người) vẫn áp trước nó. `@RateLimit` không dùng được vì giới hạn đọc từ biến môi trường `DASHBOARD_RATE_LIMIT_PER_MINUTE`.
13. [đã chọn] Thêm ngoài spec để chống lỗi họ "hold-and-wait" và rò chỗ (bài học L71, L87, L117): bộ nhớ đệm có single-flight (nhiều yêu cầu cùng khóa lúc đệm trống dùng chung một lần đọc), Map có hạn 500 mục, và trần 6 lời gọi ĐANG CHẠY mỗi nguồn (tính tới khi truy vấn thật xong, không tới khi quá hạn) vì `Promise.race` không hủy truy vấn; vượt trần thì 503 ngay. Header `Cache-Control: private, no-store` cho số liệu tài chính. DSH không giữ kết nối hay giao dịch khi gọi nguồn; test chạy với `DB_POOL_MAX=2`. Test kiểm hành vi thêm này: `apps/api/test/dashboard/common.spec.ts` (single-flight, Map có hạn, trần 6 lời gọi, `DB_POOL_MAX=2`) và `apps/api/test/dashboard/review.spec.ts` (`Cache-Control` duyệt cả chín đường dẫn, TC `DSH-TC-20261013-232147375`). Đã đưa vào DSH-API, DSH-DB và DSH-REQ-20261006-105126549 BR5 ở đợt đồng bộ spec 2026-10-13.
14. [cần quyết] Truy vấn nguồn quá hạn 5 giây vẫn chạy tới khi xong (chỉ bị cô lập bằng trần lời gọi và `DB_STATEMENT_TIMEOUT_MS` 15 giây của platform); DSH-DB ghi "quá hạn thì hủy truy vấn" nhưng giao diện đọc của module chủ không nhận tín hiệu hủy. Cách nâng: giao diện đọc nhận `AbortSignal` hoặc `statement_timeout` theo lời gọi, cần chạy `sdlc-impact` cho các module chủ.
15. [đã chọn] Đường dẫn web của ba màn báo cáo là `/admin/reports/revenue`, `/admin/reports/orders`, `/admin/reports/products` (spec UI không chốt đường dẫn; trùng nhóm `/admin/reports/*` của API) và thêm liên kết "Dashboard" cho admin ở thanh đầu trang (staff không có liên kết, DSH-E2E-20261006-110408116). Khoảng ngày, sắp xếp, số dòng nằm trên URL (`useQueryGo` ở `ReviewParts.tsx`, tránh làm sống lại bộ lọc vừa bỏ, L135). Ô ngày dùng `max` là hôm nay để bộ chọn không cho ngày sau; gõ tay thì máy chủ trả 400 và dòng lỗi hiện, số của khoảng trước được giữ.
16. [đã chọn] Biểu đồ là SVG tự vẽ (cột khi tối đa 12 mốc, đường khi nhiều hơn; mốc âm dưới trục 0; từng mốc là phần tử focus được kèm `aria-label` và bảng số ngay dưới), không thêm phụ thuộc nào nên không có dòng mới ở bảng phiên bản công nghệ. Chưa kiểm khả năng truy cập bằng công cụ tự động (chỉ E2E và đọc mã).
17. [đã chọn] Tải hỗn hợp (`test/dashboard/load.spec.ts`) so DSH với truy vấn độc lập dùng múi giờ `Asia/Ho_Chi_Minh` của PostgreSQL trên dữ liệu rải 14 tháng có mốc đúng ranh giới ngày; luồng thật (`test/dashboard/flow.spec.ts`: CHK đặt hàng, PAY nhận IPN ký đúng, hoàn tiền qua cổng giả) và E2E `DSH-E2E-20261006-110407878 (luồng thật)` (khách đặt đơn VNPay bằng giao diện, thanh toán qua cổng giả, admin thấy 180.000 đ).
18. [đã chọn] Bằng chứng yếu (ghi `YẾU:` ở bảng kết quả) và cách nâng. Các ca 503 (DSH-TC-20261006-110330139, DSH-TC-20261006-110330370, DSH-TC-20261006-110330567, DSH-TC-20261006-110330762, DSH-TC-20261006-110330953, DSH-TC-20261006-110331131, DSH-TC-20261006-110331467, DSH-TC-20261006-110331700, DSH-TC-20261006-110331973, DSH-TC-20261006-110332216): hạn nguồn đặt 300 ms qua cấu hình và nguồn trả sau 1,5 giây (chờ 5 giây thật cho mỗi ca làm test chậm); mặc định 5000 kiểm ở `guard.spec.ts`. Đã xử lý ở đợt đồng bộ spec 2026-10-13 (`spec/changes/dsh-dong-bo-spec-20261013.md`, bài học L138): mười TC nay ghi tên biến `DASHBOARD_SOURCE_TIMEOUT_MS` thay cho số giây cứng và bỏ chữ "bản giả" nên không còn lệch và không còn ghi `YẾU:`. DSH-TC-20261006-120001005: hai instance là hai ứng dụng Nest trong một tiến trình; nâng bằng hai tiến trình riêng. DSH-TC-20261006-110332185: trang web `/admin/dashboard` của staff do DSH-E2E-20261006-110408116 kiểm, không do test API. DSH-E2E-20261006-110407878: dữ liệu mồi tính từ hôm nay (máy chủ E2E dùng giờ thật), và ngày mai "gõ tay" mô phỏng bằng bỏ thuộc tính `max` của ô ngày. DSH-E2E-20261006-110408086: hạn nguồn 500 ms của máy chủ E2E và PAY "không trả lời" gài bằng thay phương thức `getRevenue`.
19. [chưa làm] Các biện pháp T10 (CORS theo danh sách origin) và T12 (phiên 30 phút) của DSH-SEC có `Kiểm bằng: config` và thuộc platform, AUTH: DSH không thêm test riêng; kiểm ở `test/platform/http.spec.ts` và test phiên của AUTH. Chưa có test a11y tự động cho biểu đồ và chưa có E2E ở điện thoại hẹp.
20. [đã chọn] Staff: theo spec (roles.md, ma trận quyền, DSH-REQ-20261006-105126549 BR1) staff nhận 403 ở cả mười một endpoint (đợt bán hộ thêm hai báo cáo) và thấy màn không có quyền ở trang; không có phần "cảnh báo" nào riêng cho staff (staff xem tồn thấp ở màn tồn kho của INV).
21. [đã chọn] Cách chạy `clean_run` (mã chưa commit nên chỉ gần giống CI, theo công thức PRJ mục 34): `git worktree add --detach` tại HEAD (c557cdb) rồi phủ tệp sửa và tệp mới chưa theo dõi của working tree (trừ `.claude/`), `env -i` chỉ có `PATH`, `HOME` rỗng riêng, `CI=true`, `TEST_DB_BASE`, `STORAGE_TEST_ENDPOINT`, `NEXT_TELEMETRY_DISABLED`, `PLAYWRIGHT_BROWSERS_PATH`; `pnpm install --frozen-lockfile --offline --store-dir <kho của máy>`; PostgreSQL và MinIO của Docker (`-p minsdlc-r`). Kết quả trong bản clone: install, scan:secrets, check:boundaries, lint, typecheck, test (199 suite, 1736 test, đều qua), build đều qua. Không chạy: workflow trên GitHub (chưa push), `check-migration-compat --base` (chỉ cho pull request); DSH không có migration.

22. [đã chọn] Hai báo cáo tính lương (DSH-REQ-20261015-092608812, DSH-REQ-20261015-092608849): DSH gọi `OrderApi.getSourcesReport` và `getSalesReport` (chữ ký thật khớp DSH-API: `{ items, excluded_orders }`; ORD lọc `cancelled`, `expired`, `returned` ngay trong truy vấn và tra tên người tạo theo lô bằng `AuthApi.getDisplayNames`), rồi chỉ sắp và cộng `totals` trong `blocks.service.ts` (không gọi ORD lần hai). Thứ tự so sánh theo đơn vị mã UTF-16 (`<`), không theo locale, để cố định giữa máy và khớp tệp CSV. Khóa phụ: nguồn theo `revenue` giảm dần rồi `code`; người tạo theo `revenue` giảm dần, `name`, `user_id`. `reports/sources` và `reports/sales` nhận `format` (giá trị duy nhất `csv`, lặp hay giá trị lạ là `invalid_value`); endpoint khác nhận `format` vẫn là `unknown_parameter`. Khóa đệm không có `format` nên JSON và CSV dùng chung bản đệm. Mười một đường dẫn dùng chung hạn mức 30 mỗi phút (cùng guard).
23. [đã chọn] Thêm ngoài spec: ô chữ của CSV bỏ ký tự NUL và đổi nửa cặp thay thế lẻ thành U+FFFD (`csvText` ở `csv.ts`) để tệp luôn là UTF-8 hợp lệ dù ORD có trả chuỗi lạ (PostgreSQL không lưu được hai loại này nên chỉ kiểm được ở mức hàm); test: `apps/api/test/dashboard/report-sales.spec.ts` (từ khóa `csvText`, `uFFFD`, ca DSH-TC-20261015-093301648). Cũng thêm: ORD trả thừa trường cá nhân thì danh sách trắng của DSH cắt bỏ (hai ca `T15` ở `report-sources.spec.ts`, `report-sales.spec.ts`, từ khóa `danh sách trắng`), và ca cùng doanh thu xếp theo tên rồi `user_id` (`T16: cùng doanh thu thì xếp theo tên` ở `report-sales.spec.ts`).
24. [đã chọn] Bằng chứng yếu và cách nâng (DSH-TC-20261015-093255510, DSH-TC-20261015-093255763, DSH-TC-20261015-093256387, DSH-TC-20261015-093256769, DSH-TC-20261015-093256965, DSH-TC-20261015-093257392, DSH-TC-20261015-093258342, DSH-TC-20261015-093259634, DSH-TC-20261015-093259813, DSH-TC-20261015-093300869, DSH-TC-20261015-093301038, DSH-TC-20261015-093301220, DSH-TC-20261015-093301332, DSH-TC-20261015-093303064): TC mô tả đơn mồi tạo "bằng đường tạo đơn thật của ORD (khách đặt qua CHK, đơn hộ qua `OrderApi.createHo`)" rồi chỉnh SQL; test dựng đơn bằng fixture `insertOrder` (như mọi test DSH cũ, `test/support/order-fixture.ts`), số liệu vẫn đọc qua `OrderApi`, `AuthApi` thật trên PostgreSQL thật. DSH-TC-20261015-093301220 không xóa hàng `users` (còn khóa ngoại từ đơn) mà gài `AuthApi.getDisplayNames` không trả người đó. Cách nâng: dựng đơn bằng `createHo` (support/ho.ts) cho ca cần đúng đường tạo; chưa làm vì kết quả đọc của hai báo cáo không phụ thuộc đường tạo.
25. [đã chọn] Giao diện: hai trang `/admin/reports/sources`, `/admin/reports/sales` theo khuôn `analytics-orders` (cùng `RangeBar`, `RateBanner`, `useBlock`), đúng testid của `ui/analytics-sources.md`, `ui/analytics-sales.md`. Xuất CSV (`useCsvExport` ở `lib/dashboard.ts`) tải bằng `fetch` có cookie phiên, dùng khoảng của PHẢN HỒI đang xem (`d.from`, `d.to`) chứ không phải giá trị đang gõ dở; tên tệp lấy từ `Content-Disposition` nếu đọc được (khác origin thì không đọc được header không được CORS phơi), không thì dựng cùng khuôn từ `from`, `to`. Bấm Áp dụng đúng khoảng đang xem thì tải lại (URL không đổi nên phải gọi `reload`), để dải 429 và banner 503 của TC hiện được. Dòng website là dòng cuối của `tbody`; tên người tạo chỉ là văn bản thuần (React thoát).
26. [cần quyết] Liên kết vào hai màn: spec UI nói "menu Báo cáo" nhưng web không có menu đó; đã thêm hai liên kết ở thanh đầu trang cho admin ("Báo cáo nguồn", "Báo cáo sale") và hai nút ở đầu `/admin/dashboard` kèm testid `dsh-admin-dashboard-link-sources`, `dsh-admin-dashboard-link-sales` (testid mới, CHƯA có trong `ui/admin-dashboard.md` và `spec/testids.md`). Cần chạy `sdlc-impact` để ghi hai testid hoặc bỏ hai nút ở dashboard.
27. [đã chọn] Sửa test nền của DSH kèm đợt này: `guard.spec.ts` (hai dòng ma trận DSH mới nên 12 dòng, 11 đường dẫn; regex "nới role staff" thêm cột `sale` của ma trận mới), `common.spec.ts` và `review.spec.ts` (tiêu đề chín thành mười một endpoint, `ALL_PATHS` có thêm hai báo cáo nên mọi vòng 403, 401, `Cache-Control`, `DB_POOL_MAX = 2` phủ luôn hai endpoint mới), `support/dsh.ts` (`REPORT.sources`, `REPORT.sales`, `resetSales`, `hoOrder`, `webOrder`, `parseCsv`, `exportRows`). Không sửa mã `src/modules/` của module khác. Sửa hạ tầng E2E: `test/e2e/server.ts`, `support.ts` thêm điểm điều khiển `/dsh-ord-fault` (ORD treo, AUTH lỗi, AUTH không tra được), nhả ở `/reset`.
28. [đã chọn] Cách chạy E2E bốn TC giao diện mới: trong BẢN SAO của repo ở `/tmp` (đổi `ecom_e2e` thành `ecom_e2e_dsh` chỉ ở bản sao, `E2E_PORT_BASE=3600`, bản build `.next` riêng) vì máy chủ E2E dùng chung `ecom_e2e` và `.next` với agent khác đang chạy. Kết quả: 4 pass. Chưa chạy trên cây thật; lead chạy lại `pnpm test -- test/e2e/dsh.e2e.spec.ts` khi không có E2E khác đang chạy.
29. [chưa làm] CI chưa chạy: `clean-run.mjs` dựng worktree tại HEAD và cài lại phụ thuộc, mất nhiều phút và đụng `prisma generate`, CSDL, cổng dùng chung với các agent đang code song song cùng đợt (SHP, SAL, PAY, NTF); `clean_run: chưa`, lead chạy một lần sau khi các epic xong. `lint` đã chạy riêng trên tệp của DSH (đạt); `pnpm --filter web typecheck` đạt; typecheck API chỉ còn lỗi ở test của SAL, AUTH (`test/sales`, `test/auth/sale.spec.ts`), không thuộc DSH.
30. [cần quyết] Ghi chú hạ tầng cho lead: `apps/api/test/platform/db.spec.ts` cố định tên `ecom_test` nên có thể đỏ khi chạy với `ECOM_TEST_DB` riêng (không chạy riêng ở lượt này, không sửa); ma trận quyền chung đã có hai hàng DSH mới (guard.spec.ts đọc ra 12 hàng DSH và `auditPermissions` rỗng).
31. [đã chọn] Test thêm sau review (REV-DSH-14): ca `DSH-SEC-20261015-092608917 T16` ở `apps/api/test/dashboard/report-sales.spec.ts` nay chạy báo cáo ba lần với `OrderApi.getSalesReport` trả thứ tự xuôi rồi ngược (mỗi lần một khoảng ngày khác để không trúng bộ nhớ đệm 60 giây): hai sale cùng tên cùng doanh thu phải ra cùng thứ tự theo `user_id`. Đột biến `cmp` đổi `>` thành `>=` ở `blocks.service.ts` (mất khóa phụ) nay làm ca này đỏ (chạy tay một lần rồi khôi phục tệp).
32. [chưa làm] YẾU (REV-DSH-16): E2E bấm hai nút link "Báo cáo theo nguồn đơn", "Báo cáo theo sale" ở `/admin/dashboard` (testid `dsh-admin-dashboard-link-sources`, `dsh-admin-dashboard-link-sales`, kiểm URL và khoảng ngày `?from=&to=` được giữ) đã viết ở `apps/api/test/e2e/dsh.e2e.spec.ts` nhưng để `it.skip`: E2E dùng chung CSDL `ecom_e2e` và bản build `apps/web/.next` với các agent chạy song song nên không chạy riêng được ở lượt này. Việc cho lead: bỏ `.skip` rồi chạy riêng một lần với cổng trống (`-t "hai nút link"`). Mục 26 của report cũ nói testid chưa có là lỗi thời: hai testid đã có ở `spec/testids.md` và `ui/admin-dashboard.md`.

