---
epic: SAL
status: draft
kit_version: 4
clean_run: chưa
test_command: E2E_PORT_BASE=3500 ECOM_TEST_DB=ecom_test_sal pnpm test -- test/sales test/e2e/sal.e2e.spec.ts test/tooling/mutations-sal.spec.ts test/tooling/boundaries.spec.ts
test_result: Tests:       101 passed, 101 total
---
# Báo cáo triển khai: SAL

## Kế hoạch task
Thứ tự theo phụ thuộc: nền dùng chung, rồi API, rồi giao diện, rồi E2E. Module `sales` (`apps/api/src/modules/sales/`) không có bảng riêng (SAL-DB) nên không có migration; web ở `apps/web/` (route `/sales/orders/new`, `/sales/orders`, `/sales/orders/[code]`). Các module PRD, INV, SHP, ORD, USR dùng đúng giao diện đã có trong cây mã (`CatalogApi.getForSale`, `InventoryApi.reserve`, `ShippingApi.listActiveMethods` và `quote`, `OrderApi.createHo`, `listSources`, `listForSale`, `getForSale`, `UserApi.lookupForSale`, `isCustomer`).

| # | Task | Nguồn | Phụ thuộc | Trạng thái |
|---|---|---|---|---|
| 1 | Nền lint ranh giới: module không sở hữu bảng (`sales`) không import PrismaService hay @prisma/client, thư mục module rỗng hay tệp lỗi cú pháp thì đỏ (thoát 2) trong `scripts/check-boundaries.mjs` | SAL-SEC-20261015-093121500 | - | done |
| 2 | Khung module `sales`: hằng số, bậc giới hạn tần suất, mã lỗi (`errors.ts`), cổng gọi năm module có hạn 2 giây (`deps.service.ts`), đăng ký trong `app.module.ts` | SAL-API-20261015-093121317, SAL-DB-20261015-093121408 | 1 | done |
| 3 | Schema đóng của thân và query (`policy.ts`): trường lạ, chuẩn hóa NFC, ký tự điều khiển, điện thoại, ghi chú 1000 và 500, 50 dòng chặn trước khi duyệt từng phần tử | SAL-API-20261015-093121317, SAL-REQ-20261015-092710847 | 2 | done |
| 4 | `POST /sales/orders`: giai đoạn đọc ngoài giao dịch (nguồn, khách, sản phẩm, trần, phí, tổng), một giao dịch ghi (`createHo`, `reserve`, khóa idempotency), phát lại 200, 503, hoàn tác | SAL-REQ-20261015-092710847, SAL-REQ-20261015-092711128, SAL-REQ-20261015-092711037, SAL-API-20261015-093121317 | 2, 3 | done |
| 5 | `GET /sales/customers/lookup` (bản che, bậc D chung bộ đếm `usr:customer-lookup`) và `GET /sales/shipping-options` (bậc C) | SAL-REQ-20261015-092710942, SAL-REQ-20261015-092711037 | 2, 3 | done |
| 6 | `GET /sales/orders` và `GET /sales/orders/{code}` (Đơn của tôi: sale theo phiên, admin mọi đơn hộ, 404 chung, serializer liệt kê trường được phép) | SAL-REQ-20261015-092711222, SAL-REQ-20261015-092711321 | 2, 3 | done |
| 7 | Kiểm quyền và ma trận trên AppModule thật (năm route, `@Roles`, `@Action` khớp `permission-rows.md`, bậc giới hạn từng route), kiểm ranh giới | SAL-SEC-20261015-093121500 | 4, 5, 6 | done |
| 8 | Bảng đột biến SAL (`scripts/mutations-sal.json`) và cổng kiểm của nó | SAL-SEC-20261015-093121500 | 4, 5, 6, 7 | done |
| 9 | Web: lib `sales.ts` (hàm thuần), màn `sale-create-order` (`/sales/orders/new`) | ui/sale-create-order | 4, 5 | done |
| 10 | Web: màn `sale-order-list` (`/sales/orders`) và `sale-order-detail` (`/sales/orders/[code]`) | ui/sale-order-list, ui/sale-order-detail | 6 | done |
| 11 | Web: menu `HeaderLinks` cho sale ("Tạo đơn", "Đơn của tôi", "Vận đơn") và cho admin ("Tạo đơn hộ", "Đơn hộ") | ui/sale-create-order, ui/sale-order-list | 9, 10 | done |
| 12 | E2E trình duyệt bảy ca của SAL (viết xong, chạy riêng được; không chạy trong lượt này, xem Lệch spec 9) | SAL-E2E-20261015-094000544, SAL-E2E-20261015-094000581, SAL-E2E-20261015-094000613, SAL-E2E-20261015-094000645, SAL-E2E-20261015-094000682, SAL-E2E-20261015-094000727, SAL-E2E-20261015-094000767 | 9, 10, 11 | done |

## Kết quả test
Mọi TC và E2E của epic một dòng. TC API chạy trên PostgreSQL thật (`ecom_test_sal`) với AppModule đầy đủ (PRD, INV, SHP, ORD, USR, SAL), không bản giả của module nào SAL gọi: gài lỗi hay đếm lời gọi bằng `jest.spyOn` trên chính các lớp `*Api`. Phần giao diện của các TC có testid chỉ kiểm được bằng E2E trình duyệt (skip ở lượt này): các dòng đó ghi `YẾU:` kèm lý do ở Lệch spec 9. Hàm thuần của web (`apps/web/lib/sales.ts`) được test API import trực tiếp (`apps/api/test/sales/web-lib.spec.ts`).

| ID | Loại | Test code | Kết quả | Ghi chú |
|---|---|---|---|---|
| SAL-TC-20261015-093909632 | TC | apps/api/test/sales/create.spec.ts | pass | audit `order.created_ho` kiểm đúng bộ khóa `{ order_code, source, has_user_id, items, grand_total, payment_method }` (không dữ liệu cá nhân, không giá vốn); không còn YẾU (Lệch spec 4 đã đóng) |
| SAL-TC-20261015-093909666 | TC | apps/api/test/sales/create.spec.ts | pass | - |
| SAL-TC-20261015-093909700 | TC | apps/api/test/sales/create.spec.ts | pass | - |
| SAL-TC-20261015-093909733 | TC | apps/api/test/sales/create.spec.ts | pass | Hai nơi: create.spec.ts (HTTP) và guard.spec.ts (route, ma trận từ permission-rows.md) |
| SAL-TC-20261015-093909766 | TC | apps/api/test/sales/create.spec.ts | pass | - |
| SAL-TC-20261015-093909798 | TC | apps/api/test/sales/create.spec.ts | pass | - |
| SAL-TC-20261015-093909831 | TC | apps/api/test/sales/create.spec.ts | pass | Nguồn `Facebook!` kiểm theo SAL-REQ BR2 là 409, không phải 400 (Lệch spec 1) |
| SAL-TC-20261015-093909866 | TC | apps/api/test/sales/create.spec.ts | pass | - |
| SAL-TC-20261015-093909900 | TC | apps/api/test/sales/create.spec.ts | pass | - |
| SAL-TC-20261015-093909933 | TC | apps/api/test/sales/create.spec.ts | pass | - |
| SAL-TC-20261015-093909966 | TC | apps/api/test/sales/create.spec.ts | pass | - |
| SAL-TC-20261015-093909998 | TC | apps/api/test/sales/create.spec.ts | pass | Phần giao diện của Then chạy trong E2E `apps/api/test/e2e/sal.e2e.spec.ts` (pass) |
| SAL-TC-20261015-093910031 | TC | apps/api/test/sales/create.spec.ts | pass | - |
| SAL-TC-20261015-093910063 | TC | apps/api/test/sales/create.spec.ts | pass | YẾU: bộ đếm hoàn tác cùng giao dịch nên không có chỗ trống (ADR-024 bản sửa), test kiểm không trùng và liên tiếp 00001..00400; gọi CreateService vì HTTP bị giới hạn 10 đơn mỗi phút |
| SAL-TC-20261015-093910095 | TC | apps/api/test/sales/create.spec.ts | pass | - |
| SAL-TC-20261015-093910128 | TC | apps/api/test/sales/create.spec.ts | pass | - |
| SAL-TC-20261015-093910162 | TC | apps/api/test/sales/create.spec.ts | pass | YẾU: phần giao diện của Then (testid của màn) chưa có ca trình duyệt riêng (các E2E SAL không đi qua trạng thái đó); phần API và hàm thuần web pass (Lệch spec 9) |
| SAL-TC-20261015-093910194 | TC | apps/api/test/sales/create.spec.ts | pass | - |
| SAL-TC-20261015-093910227 | TC | apps/api/test/sales/create.spec.ts | pass | - |
| SAL-TC-20261015-093910259 | TC | apps/api/test/sales/guard.spec.ts | pass | Sửa nền scripts/check-boundaries.mjs (Lệch spec 8) |
| SAL-TC-20261015-093910292 | TC | apps/api/test/sales/guard.spec.ts | pass | Sửa nền scripts/check-boundaries.mjs (Lệch spec 8) |
| SAL-TC-20261015-093910324 | TC | apps/api/test/sales/lookup.spec.ts | pass | - |
| SAL-TC-20261015-093910356 | TC | apps/api/test/sales/lookup.spec.ts | pass | hai khách cùng số: khách tạo sau đứng trước (`created_at` giảm dần), mỗi khách bản che riêng; AUTH đã sắp `created_at DESC, id` (Lệch spec 3 đã đóng); thêm `apps/api/test/user/sale-lookup.spec.ts` kiểm thứ tự, trần và `id` khi cùng `created_at` ở `AuthApi.findCustomersByPhone` |
| SAL-TC-20261015-093910388 | TC | apps/api/test/sales/lookup.spec.ts | pass | - |
| SAL-TC-20261015-093910421 | TC | apps/api/test/sales/lookup.spec.ts | pass | - |
| SAL-TC-20261015-093910454 | TC | apps/api/test/sales/lookup.spec.ts | pass | - |
| SAL-TC-20261015-093910487 | TC | apps/api/test/sales/lookup.spec.ts | pass | - |
| SAL-TC-20261015-093910521 | TC | apps/api/test/sales/lookup.spec.ts | pass | YẾU: phần giao diện của Then (testid của màn) chưa có ca trình duyệt riêng (các E2E SAL không đi qua trạng thái đó); phần API và hàm thuần web pass (Lệch spec 9) |
| SAL-TC-20261015-093910553 | TC | apps/api/test/sales/lookup.spec.ts | pass | - |
| SAL-TC-20261015-093910594 | TC | apps/api/test/sales/lookup.spec.ts | pass | - |
| SAL-TC-20261015-093910631 | TC | apps/api/test/sales/lookup.spec.ts | pass | - |
| SAL-TC-20261015-093910668 | TC | apps/api/test/sales/lookup.spec.ts | pass | bảy khách cùng số: đúng năm khách gần nhất, mới nhất trước (id so theo thứ tự); không còn YẾU (Lệch spec 3 đã đóng) |
| SAL-TC-20261015-093910702 | TC | apps/api/test/sales/lookup.spec.ts | pass | - |
| SAL-TC-20261015-093910737 | TC | apps/api/test/sales/shipping.spec.ts | pass | - |
| SAL-TC-20261015-093910770 | TC | apps/api/test/sales/shipping.spec.ts | pass | - |
| SAL-TC-20261015-093910803 | TC | apps/api/test/sales/shipping.spec.ts | pass | - |
| SAL-TC-20261015-093910835 | TC | apps/api/test/sales/shipping.spec.ts | pass | - |
| SAL-TC-20261015-093910868 | TC | apps/api/test/sales/shipping.spec.ts | pass | - |
| SAL-TC-20261015-093910900 | TC | apps/api/test/sales/reject.spec.ts | pass | YẾU: phần giao diện của Then (testid của màn) chưa có ca trình duyệt riêng (các E2E SAL không đi qua trạng thái đó); phần API và hàm thuần web pass (Lệch spec 9) |
| SAL-TC-20261015-093910933 | TC | apps/api/test/sales/shipping.spec.ts | pass | - |
| SAL-TC-20261015-093910970 | TC | apps/api/test/sales/shipping.spec.ts | pass | - |
| SAL-TC-20261015-093911008 | TC | apps/api/test/sales/shipping.spec.ts | pass | - |
| SAL-TC-20261015-093911042 | TC | apps/api/test/sales/web-lib.spec.ts | pass | Phần giao diện của Then chạy trong E2E `apps/api/test/e2e/sal.e2e.spec.ts` (pass) |
| SAL-TC-20261015-093911074 | TC | apps/api/test/sales/reject.spec.ts | pass | Phần giao diện của Then chạy trong E2E `apps/api/test/e2e/sal.e2e.spec.ts` (pass) |
| SAL-TC-20261015-093911106 | TC | apps/api/test/sales/reject.spec.ts | pass | Phần giao diện của Then chạy trong E2E `apps/api/test/e2e/sal.e2e.spec.ts` (pass) |
| SAL-TC-20261015-093911140 | TC | apps/api/test/sales/reject.spec.ts | pass | - |
| SAL-TC-20261015-093911174 | TC | apps/api/test/sales/reject.spec.ts | pass | - |
| SAL-TC-20261015-093911207 | TC | apps/api/test/sales/reject.spec.ts | pass | - |
| SAL-TC-20261015-093911240 | TC | apps/api/test/sales/reject.spec.ts | pass | - |
| SAL-TC-20261015-093911272 | TC | apps/api/test/sales/reject.spec.ts | pass | - |
| SAL-TC-20261015-093911306 | TC | apps/api/test/sales/reject.spec.ts | pass | - |
| SAL-TC-20261015-093911343 | TC | apps/api/test/sales/reject.spec.ts | pass | - |
| SAL-TC-20261015-093911378 | TC | apps/api/test/sales/reject.spec.ts | pass | - |
| SAL-TC-20261015-093911412 | TC | apps/api/test/sales/reject.spec.ts | pass | - |
| SAL-TC-20261015-093911445 | TC | apps/api/test/sales/reject.spec.ts | pass | YẾU: gài lỗi audit của createHo và reserve, chưa gài được lỗi ghi IdempotencyKey (SQL trong IdempotencyService của platform) (Lệch spec 5) |
| SAL-TC-20261015-093911477 | TC | apps/api/test/sales/orders.spec.ts | pass | - |
| SAL-TC-20261015-093911510 | TC | apps/api/test/sales/orders.spec.ts | pass | - |
| SAL-TC-20261015-093911545 | TC | apps/api/test/sales/orders.spec.ts | pass | - |
| SAL-TC-20261015-093911578 | TC | apps/api/test/sales/orders.spec.ts | pass | - |
| SAL-TC-20261015-093911611 | TC | apps/api/test/sales/orders.spec.ts | pass | - |
| SAL-TC-20261015-093911648 | TC | apps/api/test/sales/orders.spec.ts | pass | - |
| SAL-TC-20261015-093911681 | TC | apps/api/test/sales/orders.spec.ts | pass | YẾU: phần giao diện của Then (testid của màn) chưa có ca trình duyệt riêng (các E2E SAL không đi qua trạng thái đó); phần API và hàm thuần web pass (Lệch spec 9) |
| SAL-TC-20261015-093911714 | TC | apps/api/test/sales/orders.spec.ts | pass | - |
| SAL-TC-20261015-093911746 | TC | apps/api/test/sales/orders.spec.ts | pass | - |
| SAL-TC-20261015-093911779 | TC | apps/api/test/sales/orders.spec.ts | pass | Phần giao diện của Then chạy trong E2E `apps/api/test/e2e/sal.e2e.spec.ts` (pass) |
| SAL-TC-20261015-093911813 | TC | apps/api/test/sales/orders.spec.ts | pass | - |
| SAL-TC-20261015-093911848 | TC | apps/api/test/sales/orders.spec.ts | pass | - |
| SAL-TC-20261015-093911880 | TC | apps/api/test/sales/orders.spec.ts | pass | - |
| SAL-TC-20261015-093911913 | TC | apps/api/test/sales/orders.spec.ts | pass | - |
| SAL-TC-20261015-093911946 | TC | apps/api/test/sales/orders.spec.ts | pass | - |
| SAL-TC-20261015-093911979 | TC | apps/api/test/sales/orders.spec.ts | pass | YẾU: phần giao diện của Then (testid của màn) chưa có ca trình duyệt riêng (các E2E SAL không đi qua trạng thái đó); phần API và hàm thuần web pass (Lệch spec 9) |
| SAL-TC-20261015-093912011 | TC | apps/api/test/sales/orders.spec.ts | pass | Phần giao diện của Then chạy trong E2E `apps/api/test/e2e/sal.e2e.spec.ts` (pass) |
| SAL-TC-20261015-093912044 | TC | apps/api/test/sales/orders.spec.ts | pass | YẾU: phần giao diện của Then (testid của màn) chưa có ca trình duyệt riêng (các E2E SAL không đi qua trạng thái đó); phần API và hàm thuần web pass (Lệch spec 9) |
| SAL-TC-20261015-093912079 | TC | apps/api/test/sales/orders.spec.ts | pass | YẾU: phần giao diện của Then (testid của màn) chưa có ca trình duyệt riêng (các E2E SAL không đi qua trạng thái đó); phần API và hàm thuần web pass (Lệch spec 9) |
| SAL-TC-20261015-093912115 | TC | apps/api/test/sales/orders.spec.ts | pass | YẾU: phần giao diện của Then (testid của màn) chưa có ca trình duyệt riêng (các E2E SAL không đi qua trạng thái đó); phần API và hàm thuần web pass (Lệch spec 9) |
| SAL-E2E-20261015-094000544 | E2E | apps/api/test/e2e/sal.e2e.spec.ts | pass | Chromium thật, API thật trên `ecom_e2e`, `E2E_PORT_BASE=3500`; dữ liệu mồi qua cổng điều khiển |
| SAL-E2E-20261015-094000581 | E2E | apps/api/test/e2e/sal.e2e.spec.ts | pass | Chromium thật, API thật trên `ecom_e2e`, `E2E_PORT_BASE=3500`; dữ liệu mồi qua cổng điều khiển |
| SAL-E2E-20261015-094000613 | E2E | apps/api/test/e2e/sal.e2e.spec.ts | pass | Chromium thật, API thật trên `ecom_e2e`, `E2E_PORT_BASE=3500`; dữ liệu mồi qua cổng điều khiển |
| SAL-E2E-20261015-094000645 | E2E | apps/api/test/e2e/sal.e2e.spec.ts | pass | Chromium thật, API thật trên `ecom_e2e`, `E2E_PORT_BASE=3500`; dữ liệu mồi qua cổng điều khiển |
| SAL-E2E-20261015-094000682 | E2E | apps/api/test/e2e/sal.e2e.spec.ts | pass | Chromium thật, API thật trên `ecom_e2e`, `E2E_PORT_BASE=3500`; dữ liệu mồi qua cổng điều khiển |
| SAL-E2E-20261015-094000727 | E2E | apps/api/test/e2e/sal.e2e.spec.ts | pass | Chromium thật, API thật trên `ecom_e2e`, `E2E_PORT_BASE=3500`; dữ liệu mồi qua cổng điều khiển |
| SAL-E2E-20261015-094000767 | E2E | apps/api/test/e2e/sal.e2e.spec.ts | pass | Chromium thật, API thật trên `ecom_e2e`, `E2E_PORT_BASE=3500`; dữ liệu mồi qua cổng điều khiển |

## Kiểm đột biến
Chạy bằng script chung `node .claude/skills/sdlc-review/scripts/mutate.mjs apps/api/scripts/mutations-sal.json --cwd apps/api` (bảng 50 đột biến, mỗi lệnh chạy đúng một TC bằng `-t`; cổng kiểm của chính bảng: `apps/api/test/tooling/mutations-sal.spec.ts`, `node scripts/check-mutations.mjs` báo phủ 18 SB kiểm bằng test của SAL-SEC). Phủ cả nền sửa kèm (`scripts/check-boundaries.mjs`, bốn đột biến; `platform/http/csrf.guard.ts`, một đột biến) và ORD đọc qua `createHo` (không gài đột biến trong mã ORD để không phá test của epic khác đang chạy). Rút gọn dưới đây theo SB; kết quả từng đột biến nằm trong đầu ra của script (`bắt` = test đỏ do khẳng định).

| Chỗ phá | Test đỏ | Kết quả |
|---|---|---|
| SB-05, T1: staff được tạo đơn hộ (sai ma trận) (`src/modules/sales/sales.controller.ts`) | SAL-TC-20261015-093909733 | bắt |
| SB-05, T1: customer được xem danh sách đơn hộ (`src/modules/sales/sales.controller.ts`) | SAL-TC-20261015-093911611 | bắt |
| SB-05, T1: staff tra khách (`src/modules/sales/sales.controller.ts`) | SAL-TC-20261015-093910454 | bắt |
| SB-05, T1: staff xem báo phí (`src/modules/sales/sales.controller.ts`) | SAL-TC-20261015-093910868 | bắt |
| SB-05, T1: customer xem chi tiết đơn hộ (`src/modules/sales/sales.controller.ts`) | SAL-TC-20261015-093911946 | bắt |
| SB-45, T2: thân nhận trường lạ created_by (bỏ kiểm khóa lạ) (`src/modules/sales/policy.ts`) | SAL-TC-20261015-093909766 | bắt |
| SB-45, T2: created_by lấy từ thân thay vì phiên (người tạo là admin nhưng ghi sale) (`src/modules/sales/create.service.ts`) | SAL-TC-20261015-093909666 | bắt |
| SB-45, T2: bỏ kiểm nguồn đơn trước khi đọc sản phẩm (thứ tự kiểm BR5) (`src/modules/sales/create.service.ts`) | SAL-TC-20261015-093911140 | bắt |
| SB-06, T7: không kiểm khách có sẵn là customer (`src/modules/sales/create.service.ts`) | SAL-TC-20261015-093909866 | bắt |
| SB-23, T4: bỏ so sánh expected_grand_total (`src/modules/sales/create.service.ts`) | SAL-TC-20261015-093909900 | bắt |
| SB-23, T4: giá dòng hàng lệch giá PRD (unit_price + 1) (`src/modules/sales/create.service.ts`) | SAL-TC-20261015-093909632 | bắt |
| SB-23, T4: phí vận chuyển lấy 0 thay vì từ SHP (`src/modules/sales/create.service.ts`) | SAL-TC-20261015-093909900 | bắt |
| SB-23, T16: SAL ghi nhận payment_method cash thành đã thu (tạo Payment) - gài: lưu nhãn khác (`src/modules/sales/create.service.ts`) | SAL-TC-20261015-093909666 | bắt |
| SB-42, T5: giá vốn lọt vào phản hồi tạo đơn (`src/modules/sales/create.service.ts`) | SAL-TC-20261015-093909632 | bắt |
| SB-42, T5: giá vốn lọt vào log tạo đơn thành công (`src/modules/sales/create.service.ts`) | SAL-TC-20261015-093909632 | bắt |
| SB-18, T14: họ tên khách vào log tạo đơn (`src/modules/sales/create.service.ts`) | SAL-TC-20261015-093910227 | bắt |
| SB-08, T14: phản hồi không còn no-store (`src/modules/sales/sales.controller.ts`) | SAL-TC-20261015-093910227 | bắt |
| SB-40, T9: băm yêu cầu bỏ thân (cùng khóa khác nội dung vẫn phát lại) (`src/modules/sales/create.service.ts`) | SAL-TC-20261015-093909966 | bắt |
| SB-40, T9: khóa idempotency nhận 1 ký tự (`src/modules/sales/config.ts`) | SAL-TC-20261015-093909933 | bắt |
| SB-40, T9: phát lại trả 201 thay vì 200 (`src/modules/sales/create.service.ts`) | SAL-TC-20261015-093909966 | bắt |
| SB-24, T10: hết hàng không hoàn tác đơn (bỏ nhánh held.ok) (`src/modules/sales/create.service.ts`) | SAL-TC-20261015-093911042 | bắt |
| SB-25, T10: giữ hàng nhận thiếu hàng như đủ (reserve trả ok sai) - gài: bỏ giữ hàng (`src/modules/sales/create.service.ts`) | SAL-TC-20261015-093911343 | bắt |
| SB-31, T10: lời gọi module khác quá hạn không đổi sang 503 (`src/modules/sales/deps.service.ts`) | SAL-TC-20261015-093911240 | bắt |
| SB-31, T10: lỗi module khác thành 500 thay vì 503 (`src/modules/sales/deps.service.ts`) | SAL-TC-20261015-093911240 | bắt |
| SB-14, T11: tạo đơn cho 11 lần mỗi phút (`src/modules/sales/config.ts`) | SAL-TC-20261015-093909998 | bắt |
| SB-14, T6: tra khách 31 lần mỗi phút (`src/modules/sales/config.ts`) | SAL-TC-20261015-093910521 | bắt |
| SB-14, T3: báo phí, danh sách, chi tiết 121 lần mỗi phút (`src/modules/sales/config.ts`) | SAL-TC-20261015-093911681 | bắt |
| SB-14, T6: tra khách không chung bộ đếm usr:customer-lookup (`src/modules/sales/config.ts`) | SAL-TC-20261015-093909998 | bắt |
| SB-06, T3: danh sách của sale lấy mọi đơn hộ (không lọc theo phiên) (`src/modules/sales/read.service.ts`) | SAL-TC-20261015-093911477 | bắt |
| SB-06, T3: chi tiết của sale xem đơn của sale khác (`src/modules/sales/read.service.ts`) | SAL-TC-20261015-093911880 | bắt |
| SB-06, T3: sale gửi created_by không bị 400 (`src/modules/sales/read.service.ts`) | SAL-TC-20261015-093911648 | bắt |
| SB-44, T3: 404 của đơn không có trả 200 rỗng (`src/modules/sales/read.service.ts`) | SAL-TC-20261015-093911880 | bắt |
| SB-08, T3: danh sách của sale lộ created_by (`src/modules/sales/read.service.ts`) | SAL-TC-20261015-093911477 | bắt |
| SB-42, T5: chi tiết admin lộ giá vốn qua ORD (thêm cost_snapshot) (`src/modules/sales/read.service.ts`) | SAL-TC-20261015-093911848 | bắt |
| SB-08, T6: tra khách thiếu chuẩn hóa +84 (`src/modules/sales/policy.ts`) | SAL-TC-20261015-093910324 | bắt |
| SB-08, T6: tra khách lộ thêm email_verified (`src/modules/sales/read.service.ts`) | SAL-TC-20261015-093910631 | bắt |
| SB-19, T6: lỗi ghi audit tra khách bị nuốt (trả 503 thay vì 500) (`src/modules/sales/deps.service.ts`) | SAL-TC-20261015-093910553 | bắt |
| SB-12, T8: ghi chú nhận ký tự điều khiển NUL (`src/modules/sales/policy.ts`) | SAL-TC-20261015-093910128 | bắt |
| SB-11, T4: bỏ trần 50 dòng ở schema và bước chặn sớm (`src/modules/sales/policy.ts`) | SAL-TC-20261015-093910128 | bắt |
| SB-11, T4: trần số lượng 100000 thành 100001 (`src/modules/sales/config.ts`) | SAL-TC-20261015-093910128 | bắt |
| SB-12, T8: ghi chú đơn trần 1001 ký tự (`src/modules/sales/config.ts`) | SAL-TC-20261015-093910128 | bắt |
| SB-23, T4: thứ tự trả về dùng giá trị client (báo phí sắp ngược) (`src/modules/sales/read.service.ts`) | SAL-TC-20261015-093910737 | bắt |
| SB-11, T4: trần tạm tính báo phí 10 tỷ thành 100 tỷ (`src/modules/sales/policy.ts`) | SAL-TC-20261015-093910803 | bắt |
| SB-23, T4: sản phẩm ngừng bán vẫn bán được (bỏ kiểm sellable) (`src/modules/sales/create.service.ts`) | SAL-TC-20261015-093911106 | bắt |
| SB-23, T4: sản phẩm không tồn tại bị bỏ qua thay vì 409 (chỉ báo dòng đầu) (`src/modules/sales/create.service.ts`) | SAL-TC-20261015-093911106 | bắt |
| SB-35, T15: lint không còn coi sales là module không sở hữu bảng (`scripts/check-boundaries.mjs`) | SAL-TC-20261015-093910259 | bắt |
| SB-35, T15: thư mục module rỗng thoát 0 thay vì 2 (`scripts/check-boundaries.mjs`) | SAL-TC-20261015-093910292 | bắt |
| SB-35, T15: tệp lỗi cú pháp được cho qua (`scripts/check-boundaries.mjs`) | SAL-TC-20261015-093910292 | bắt |
| SB-35, T15: import PrismaService trong sales không bị bắt (`scripts/check-boundaries.mjs`) | SAL-TC-20261015-093910259 | bắt |
| SB-13, T13: CSRF cho phép Origin lạ (`src/modules/platform/http/csrf.guard.ts`) | SAL-TC-20261015-093910031 | bắt |

## Lệch spec
Mọi mục có nhãn. SAL không có mã lỗi tự đặt ngoài spec: bốn mã riêng của `errors.ts` (`order-source-unavailable`, `product-unavailable`, `customer-not-found`, `order-total-out-of-range`) đều có ở SAL-API mục Danh mục lỗi; năm mã còn lại dùng chung với CHK, INV (khai có điều kiện, cùng status).

1. [cần quyết] SAL-TC-20261015-093909831 và SAL-TC-20261015-093911074 mâu thuẫn nhau về `source_code` sai định dạng (`Facebook!`, `TikTok!`): TC 093909831 đòi 400 `validation-failed` mã `invalid_format`, TC 093911074, SAL-REQ-20261015-092711128 BR2 và bảng lỗi của SAL-API đòi 409 `order-source-unavailable` (một mã, một nội dung, SB-45). Code theo SAL-REQ và SAL-API (409); test 093909831 kiểm 409 cho ca này. Cần `sdlc-impact` sửa TC 093909831 (hoặc BR2) cho khớp.
2. [đã chọn] Tên trường lỗi dạng `items.0.quantity`, `items.1.product_id`, `customer.phone` (nền `ValidationInterceptor` nối đường dẫn bằng dấu chấm, mọi module khác theo đó) thay vì `items[0].quantity` như TC 093909831 viết; `code` và vị trí đúng spec. Rủi ro: client đọc `errors[].field` phải hiểu dấu chấm; web `SaleCreateOrder` đã đọc đúng dạng này.
3. [đã chọn] (đã đóng: AUTH đổi `AuthApi.findCustomersByPhone` thành `ORDER BY created_at DESC, id`; hai test SAL so thứ tự thật) `AuthApi.findCustomersByPhone` trước đây sắp cũ nhất trước, trái SAL-REQ-20261015-092710942 BR2 và TC SAL-TC-20261015-093910356, SAL-TC-20261015-093910668. Nay SAL-TC-20261015-093910356 kiểm khách mới tạo đứng trước, SAL-TC-20261015-093910668 kiểm năm khách gần nhất theo thứ tự, và `apps/api/test/user/sale-lookup.spec.ts` kiểm thứ tự, trần và `id` khi cùng `created_at`.
4. [đã chọn] (đã đóng: ORD ghi thêm `items`, `grand_total`, `payment_method` vào `after`) Audit `order.created_ho` do ORD ghi có `after` = `{ order_code, source, has_user_id, items, grand_total, payment_method }`; SAL-TC-20261015-093909632 kiểm đúng MỘT dòng, đúng người tạo và vai trò, đúng bộ khóa và không dữ liệu cá nhân hay giá vốn (hết YẾU).
5. [đã chọn] Hai điểm khác cách mô tả của SAL-API mục Thứ tự gọi: (a) không dùng khóa tư vấn theo người dùng riêng: ràng buộc duy nhất `(scope, user_id, key)` của `IdempotencyService` đã tuần tự hóa hai yêu cầu cùng khóa (bên sau chờ cam kết rồi nhận phản hồi đã lưu), test SAL-TC-20261015-093909966 chạy hai yêu cầu song song cùng khóa và thấy đúng một đơn; (b) giai đoạn đọc chạy TRƯỚC, kết quả (kế hoạch hoặc lỗi) vào bên trong lời gọi `IdempotencyService.run`: lỗi của giai đoạn đọc ném trong giao dịch của khóa nên khóa không được ghi, còn phát lại đứng trước mọi kiểm khác (đúng ý spec) mà không cần sửa platform; giá phải trả: mỗi lỗi giai đoạn đọc mở một giao dịch ngắn rồi hoàn tác. SAL-TC-20261015-093911445 gài lỗi audit của `createHo` và `reserve` (đỏ giữa chừng thì không còn Order, reservation, khóa, outbox); YẾU: chưa gài được lỗi ghi `IdempotencyKey` vì đó là SQL trong `IdempotencyService` của platform (cùng giao dịch nên hoàn tác như hai lỗi trên).
6. [đã chọn] SAL-TC-20261015-093910063: bộ đếm mã đơn của ORD hoàn tác cùng giao dịch (ADR-024 bản sửa) nên đơn bị hoàn tác KHÔNG để lại chỗ trống như TC viết; test kiểm 400 mã khác nhau, liên tiếp 00001 tới 00400 và đơn kế sau lỗi không trùng. Test gọi `CreateService` trực tiếp (hai sale, hai mươi đơn song song mỗi lô) vì HTTP bị giới hạn 10 đơn mỗi phút (SAL-REQ BR15); YẾU phần "qua HTTP". `POST /sales/orders` thêm header `Idempotent-Replayed: true` ở phản hồi phát lại như CHK (thêm ngoài spec, kiểm trong `apps/api/test/sales/create.spec.ts` từ khóa `idempotent-replayed`).
7. [đã chọn] Mã lỗi `product-unavailable` do CRT khai 404 (khi thêm vào giỏ); SAL ném cùng mã với `status: 409` theo từng lần (cách CRT đã dùng cho 409 của PATCH), nên sổ mã giữ status của CRT và phản hồi của SAL là 409 (`apps/api/test/sales/reject.spec.ts` SAL-TC-20261015-093911106).
8. [đã chọn] Sửa nền: `scripts/check-boundaries.mjs` thêm (a) module không sở hữu bảng (`NO_TABLE_MODULES` = `sales`) không import PrismaService hay `@prisma/client`; (b) thư mục module rỗng, tệp không đọc được hay có lỗi cú pháp thì đỏ thoát 2 kèm "không đọc được". Do T15 của SAL-SEC và TC 093910259, 093910292 yêu cầu; test: `apps/api/test/sales/guard.spec.ts` SAL-TC-20261015-093910259 và SAL-TC-20261015-093910292, đột biến bốn dòng cuối trước đột biến CSRF trong bảng. `apps/api/src/app.module.ts` thêm `SalesModule` (một dòng) và `apps/web/components/HeaderLinks.tsx`, `apps/web/app/layout.tsx` (một dòng import `sales.css`) thêm phần của SAL; kiểm bằng SAL-TC-20261015-093909733 (route, quyền); menu của sale và admin không có TC riêng, E2E 544 và 727 đi qua màn nhưng mở bằng địa chỉ trực tiếp.
9. [chưa làm] Phần giao diện (testid của màn) của tám TC chưa có ca trình duyệt riêng: SAL-TC-20261015-093910162 (HTML của ghi chú hiện như chữ ở DOM), SAL-TC-20261015-093910521 (`lookup-limited` khi 429), SAL-TC-20261015-093910900 (`shipping-unavailable`), SAL-TC-20261015-093911681 (`sal-sale-order-list-rate-limited`), SAL-TC-20261015-093911979 (`sal-sale-order-detail-rate-limited`), SAL-TC-20261015-093912044 (`note-empty`), SAL-TC-20261015-093912079 (`cancel-reason`), SAL-TC-20261015-093912115 (ghi chú `<b>x</b>&amp;` hiện nguyên chuỗi). Bảy E2E SAL (544, 581, 613, 645, 682, 727, 767) đã chạy Chromium thật và pass, nhưng không đi qua các trạng thái này; phần API của tám TC pass và hàm thuần web có test (`apps/api/test/sales/web-lib.spec.ts`), nên các dòng đó YẾU. Cách nâng: thêm bước vào E2E hoặc ca E2E mới qua `sdlc-impact` (spec E2E hiện không có bước đó). React thoát chuỗi mặc định và mã web không dùng `dangerouslySetInnerHTML` (grep sạch).
10. [đã chọn] Giao diện: kết quả tìm sản phẩm hiện tên và giá, KHÔNG có mã hàng (`GET /products/search` công khai không trả `sku`; ô tìm vẫn khớp theo mã hàng vì `search_text` có sku); gõ sản phẩm đã có trong đơn thì tăng số lượng dòng đó (thân API cấm `product_id` trùng). Ô "Người nhận giống khách" mặc định TẮT (E2E bật bằng `check`). Bản nháp biểu mẫu khi 401 giữ trong `sessionStorage` của tab (xóa ngay khi đọc) để "dữ liệu đã nhập không mất khi quay lại". Thanh nút Tạo đơn dính cuối màn trên di động (ghi chú thiết kế cuối ui/sale-create-order) dùng cột tóm tắt xếp cuối một cột, chưa dính (`position: sticky` chỉ từ 900px).
11. [đã chọn] Menu: sale thấy "Sản phẩm", "Tạo đơn", "Đơn của tôi" và "Vận đơn" (`/admin/shipments`, theo yêu cầu của lead, SHP mở danh sách vận đơn cho sale); admin thấy thêm "Tạo đơn hộ", "Đơn hộ" ở hàng quản trị. Không đụng phần khác của `HeaderLinks`. Sale chưa có liên kết "Đơn hàng" quản trị (ORD) vì ORD quyết, ngoài phạm vi SAL.
12. [cần quyết] Ma trận quyền chung `spec/permissions-matrix.md` chưa có sáu hàng SAL (lead gộp `spec/epics/SAL/permission-rows.md`); test `apps/api/test/sales/guard.spec.ts` đọc đúng tệp `permission-rows.md` nên đỏ nếu lead đổi tên hàng. Hàng "Đơn hộ bị từ chối..." không có endpoint riêng (kết quả của `POST /sales/orders`) nên được miễn ở test. Cần thêm: hàng SAL ở bảng Giao diện module đã có sẵn trong `spec/architecture.md` (dòng SAL→PRD, INV, SHP, ORD, USR), không thiếu gì.
13. [đã chọn] Test: `apps/api/test/platform/db.spec.ts` đỏ một ca khi chạy với `ECOM_TEST_DB=ecom_test_sal` (cố định tên CSDL `ecom_test`, đúng như brief báo; không phải SAL), và `apps/api/test/shipping/guard.spec.ts` đỏ do SHP đang làm dở (hàng ma trận của sale và `Sale xem danh sách vận đơn...`), không liên quan SAL.
14. [chưa làm] CI chưa chạy: chưa dựng bản clone sạch bằng `clean-run.mjs` vì cây mã đang có thay đổi của bảy epic chạy song song (phủ tệp chưa theo dõi của agent khác sẽ cho kết quả không thuộc riêng SAL). CI chưa chạy: chờ lead gộp mọi epic rồi chạy một lần. Đã chạy riêng: typecheck `apps/api` và `apps/web` sạch (không lỗi ở tệp SAL), eslint sạch trên tệp SAL, `node scripts/check-boundaries.mjs` sạch, `next build` của web (kèm kiểm kiểu) chạy và thành công trong lần dựng của E2E SAL.
15. [đã chọn] Test viết cùng lúc với mã (mã trước, test ngay sau) chứ không có lần "fail đúng lý do" riêng từng TC; bù bằng bảng Kiểm đột biến 50 dòng: lần chạy đầu có hai đột biến lọt (đột biến 7 bắt ở TC khác, và đột biến bỏ bước chặn sớm trần 50 dòng vì thân một triệu phần tử bị trần 1 MB chặn trước), đã sửa test (thêm ca 450 nghìn phần tử dưới trần 1 MB, đổi TC của đột biến 7 sang SAL-TC-20261015-093909666) và chạy lại, 50 trên 50 `bắt`.
16. [đã chọn] `OrderBusinessError('order_code_exhausted')` của ORD (hết 99999 số trong ngày) là lỗi tạm của hạ tầng nên `CreateService.write` đổi thành 503 `dependency-unavailable` kèm `Retry-After` (số giây tới 0 giờ Asia/Ho_Chi_Minh tính từ `Clock`), không còn 500; đã hoàn tác hết, khóa idempotency chưa ghi nên gửi lại sau nửa đêm tạo được `HD...-00001`. Test thêm ngoài TC trong `apps/api/test/sales/create.spec.ts` (tên bắt đầu "hết 99999 mã đơn trong ngày"), không đổi spec: SAL-API mục Danh mục lỗi mô tả `dependency-unavailable` 503 cho lỗi tạm của module khác.
17. [đã chọn] `scripts/check-boundaries.mjs` thêm luật cho module không sở hữu bảng: bắt `await import('@prisma/client')` và `$queryRaw`, `$executeRaw`, `$queryRawUnsafe`, `$executeRawUnsafe` (fixture `apps/api/test/fixtures/boundaries/sal331`, test `apps/api/test/tooling/boundaries.spec.ts`); kiểm tên hàm `XxxApi` xem mục 4 của luật ở đầu script (fixture `api331`). Lời gọi `CheckoutDeps -> OrderApi.findForPayment` hợp lệ nhưng bảng Giao diện module không có hàng CHK -> ORD cho tên này: script nới riêng (`TABLE_GAPS`), lead thêm tên vào bảng rồi xóa dòng nới.
