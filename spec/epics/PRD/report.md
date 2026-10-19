---
epic: PRD
status: draft
kit_version: 4
clean_run: chưa
test_command: E2E_PORT_BASE=3300 ECOM_TEST_DB=ecom_test_prd pnpm test -- test/catalog test/tooling/mutations-prd.spec.ts
test_result: Tests:       1 skipped, 122 passed, 123 total
---
# Báo cáo triển khai: PRD

## Kế hoạch task
Thứ tự theo phụ thuộc: DB, rồi nền dùng chung, rồi API, rồi giao diện, rồi E2E. Mọi task `done`; không có task `blocked`. Module `catalog` (`apps/api/src/modules/catalog/`), web ở `apps/web/` (route `/products`, `/products/[id]`, `/admin/categories`, `/admin/products`, `/admin/products/new`, `/admin/products/[id]`).

| # | Task | Nguồn | Phụ thuộc | Trạng thái |
|---|---|---|---|---|
| 1 | Migration `20261007000800_catalog_tables` (4 bảng, CHECK, unique hoãn được, GIN trigram, extension pg_trgm và unaccent), schema Prisma `catalog.prisma` | PRD-DB-20261006-095502781 | - | done |
| 2 | Nền dùng chung cho ảnh và lỗi (sửa mã nền platform, user): kho object chuyển từ module user sang platform, bộ đọc multipart chung, ngoại lệ multipart theo mẫu đường dẫn, trường phụ dạng danh sách của problem+json, mã `image-invalid` chung | PRD-API-20261006-095502803 | 1 | done |
| 3 | Danh mục: cây công khai, tạo, sửa, chuyển nhánh (vòng, 3 cấp), xóa (lý do `reasons`) | PRD-API-20261006-095502803, PRD-DB-20261006-095502781 | 1, 2 | done |
| 4 | Sản phẩm (admin): tạo, sửa một phần khóa lạc quan, công bố, ngừng bán hoặc hủy nháp, audit và outbox cùng giao dịch | PRD-API-20261006-095502803, PRD-DB-20261006-095502781, PRD-SEC-20261006-095502825 | 1, 2 | done |
| 5 | Ảnh sản phẩm: kiểm và xử lý lại (magic bytes, 25 megapixel từ tiêu đề, bỏ EXIF, cạnh 1600), kho S3, thứ tự, xóa, job `prd.sweep-orphan-images` | PRD-API-20261006-095502803, PRD-SEC-20261006-095502825 | 2, 4 | done |
| 6 | Đọc: danh sách và chi tiết công khai, tìm kiếm pg_trgm (ADR-019), danh sách và chi tiết quản trị | PRD-API-20261006-095502803 | 3, 4 | done |
| 7 | Điểm đánh giá: consumer `catalog` của 5 event REV, idempotent hai lớp | PRD-DB-20261006-095502781, PRD-API-20261006-095502803 | 4 | done |
| 8 | Giao diện nội bộ `CatalogApi` (getForCart, getSummaries, searchProductIds, listActiveProductIds, countByStatus) | PRD-API-20261006-095502803 | 4, 6 | done |
| 9 | Kiểm lệch ma trận quyền phủ route của PRD trên AppModule thật | PRD-SEC-20261006-095502825 | 3, 4, 5, 6, 8 | done |
| 10 | Màn quản lý danh mục | ui/admin-category | 3 | done |
| 11 | Màn danh sách quản trị và màn tạo, sửa sản phẩm (staff chỉ xem) | ui/admin-product-list, ui/admin-product-edit | 4, 5, 6 | done |
| 12 | Màn danh sách sản phẩm (cây, lọc, tìm, nhãn tồn kho) và chi tiết sản phẩm | ui/product-list, ui/product-detail | 6 | done |
| 13 | E2E trình duyệt thật và bảng đột biến PRD cùng cổng kiểm của nó | PRD-E2E-20261006-100417163, PRD-E2E-20261006-100417191, PRD-E2E-20261006-100417219, PRD-E2E-20261006-100417248, PRD-E2E-20261006-100417273, PRD-E2E-20261006-100417300 | 9, 10, 11, 12 | done |
| 14 | Migration `20261015000200_product_cost_price` (cột `products.cost_price` bigint NULL, CHECK 0..1.000.000.000) và schema Prisma | PRD-DB-20261006-095502781 | 1 | done |
| 15 | Giá vốn: schema tạo và sửa (`cost_price` số hoặc `null`), serializer theo role (chỉ admin có khóa), audit có giá vốn cũ và mới | PRD-API-20261006-095502803, PRD-SEC-20261006-095502825 | 14 | done |
| 16 | Role `sale` đọc `/admin/products` (không giá vốn); nhóm ghi quản trị bậc D 30 mỗi phút mỗi người | PRD-API-20261006-095502803 | 15 | done |
| 17 | Import sản phẩm: bộ đọc xlsx và csv (`fflate` 0.8.3), `POST /admin/products/import` (`dry_run`, Idempotency-Key, bậc E), `GET /admin/products/import/template`, biến `PRD_IMPORT_MAX_BYTES`, `PRD_IMPORT_MAX_ROWS`, mã `import-file-invalid` | PRD-API-20261006-095502803, PRD-DB-20261006-095502781, PRD-SEC-20261006-095502825 | 14, 15 | done |
| 18 | Giao diện nội bộ `CatalogApi.getForSale` cho SAL, export qua `index.ts` | PRD-API-20261006-095502803 | 14 | done |
| 19 | Web: ProductEditor (ô Giá bán, ô Giá vốn chỉ admin), danh sách quản trị (nút Nhập từ Excel, sale chỉ đọc), trang `/admin/products/import` | ui/admin-product-edit, ui/admin-product-list, ui/admin-product-import | 15, 16, 17 | done |
| 20 | E2E trình duyệt ba ca của đợt bán hộ (viết trong `apps/api/test/e2e/prd.e2e.spec.ts`) | PRD-E2E-20261015-094000000, PRD-E2E-20261015-094100000, PRD-E2E-20261015-094200000 | 19 | done |

## Kết quả test
Mọi TC và E2E của epic một dòng. TC API chạy trên PostgreSQL thật (`ecom_test`) với S3 giả trong tiến trình (client S3 thật của platform nói chuyện qua HTTP) và MinIO thật cho `apps/api/test/catalog/image.minio.spec.ts`; E2E chạy Chromium thật trên API thật (`ecom_e2e`) và bản build production của web, kho ảnh là MinIO thật khi có `STORAGE_TEST_ENDPOINT`. INV chưa có code nên web gọi `GET /inventory/availability` được giả lập ở mức HTTP (`page.route`), đúng như PRD-TC-20261006-120604504 yêu cầu.

| ID | Loại | Test code | Kết quả | Ghi chú |
|---|---|---|---|---|
| PRD-E2E-20261006-100417163 | E2E | apps/api/test/e2e/prd.e2e.spec.ts | pass | Admin tạo danh mục, tạo sản phẩm nháp, tải ảnh và công bố |
| PRD-E2E-20261006-100417191 | E2E | apps/api/test/e2e/prd.e2e.spec.ts | pass | Admin ngừng bán sản phẩm, có hộp xác nhận, rồi không sửa được nữa |
| PRD-E2E-20261006-100417219 | E2E | apps/api/test/e2e/prd.e2e.spec.ts | pass | Admin xóa danh mục bị chặn khi còn sản phẩm rồi xóa được khi rỗng |
| PRD-E2E-20261006-100417248 | E2E | apps/api/test/e2e/prd.e2e.spec.ts | pass | Khách chưa đăng nhập duyệt theo danh mục, lọc giá, tìm kiếm và mở chi tiết |
| PRD-E2E-20261006-100417273 | E2E | apps/api/test/e2e/prd.e2e.spec.ts | pass | Customer tìm không ra gì và mở sản phẩm đã ngừng bán |
| PRD-E2E-20261006-100417300 | E2E | apps/api/test/e2e/prd.e2e.spec.ts | pass | Staff chỉ xem sản phẩm quản trị, không có thao tác ghi |
| PRD-TC-20261006-100355294 | TC | apps/api/test/catalog/category.spec.ts | pass | Khách chưa đăng nhập xem cây danh mục kèm số sản phẩm |
| PRD-TC-20261006-100355318 | TC | apps/api/test/catalog/category.spec.ts | pass | Cây danh mục lỗi khi CSDL không truy cập được |
| PRD-TC-20261006-100355341 | TC | apps/api/test/catalog/category.spec.ts | pass | Hệ thống chưa có danh mục và danh mục chỉ có sản phẩm archived |
| PRD-TC-20261006-100355364 | TC | apps/api/test/catalog/category.spec.ts | pass | Admin tạo danh mục con, slug sinh tự động và đổi tên không đổi slug |
| PRD-TC-20261006-100355387 | TC | apps/api/test/catalog/category.spec.ts | pass | Danh mục trùng tên trong cùng cha và tạo vòng cha-con bị từ chối |
| PRD-TC-20261006-100355410 | TC | apps/api/test/catalog/category.spec.ts | pass | Chỉ admin được tạo hoặc sửa danh mục |
| PRD-TC-20261006-100355433 | TC | apps/api/test/catalog/category.spec.ts | pass | Cùng tên khác cha được phép; danh mục cấp 4 bị từ chối |
| PRD-TC-20261006-100355456 | TC | apps/api/test/catalog/category.spec.ts | pass | Admin xóa danh mục rỗng |
| PRD-TC-20261006-100355479 | TC | apps/api/test/catalog/category.spec.ts | pass | Không xóa được danh mục còn con hoặc còn sản phẩm archived |
| PRD-TC-20261006-100355501 | TC | apps/api/test/catalog/category.spec.ts | pass | Xóa lần hai cùng id trả 404, xóa đua với chuyển sản phẩm vào |
| PRD-TC-20261006-100355524 | TC | apps/api/test/catalog/product-write.spec.ts | pass | Admin tạo sản phẩm nháp |
| PRD-TC-20261006-100355547 | TC | apps/api/test/catalog/product-write.spec.ts | pass | Tạo sản phẩm bị từ chối: trùng sku, dữ liệu sai, quyền sai |
| PRD-TC-20261006-100355569 | TC | apps/api/test/catalog/product-write.spec.ts | pass | Giá biên, tên chứa mã script và tạo trùng sku song song |
| PRD-TC-20261006-100355592 | TC | apps/api/test/catalog/product-write.spec.ts | pass | Admin sửa giá sản phẩm đang bán, giá mới hiện ngay và có dòng AuditLog |
| PRD-TC-20261006-100355615 | TC | apps/api/test/catalog/product-write.spec.ts | pass | Sửa bị từ chối: sai version, archived, đổi sku khi active, trường cấm |
| PRD-TC-20261006-100355642 | TC | apps/api/test/catalog/product-write.spec.ts | pass | Sửa sku và danh mục ở bản nháp, và body rỗng |
| PRD-TC-20261006-100355666 | TC | apps/api/test/catalog/image.spec.ts | pass | Admin tải ảnh và đổi thứ tự, ảnh đầu là ảnh đại diện |
| PRD-TC-20261006-100355691 | TC | apps/api/test/catalog/image.spec.ts | pass | Tải ảnh bị từ chối: sai nội dung, SVG, quá lớn, quá 8 ảnh, xóa ảnh cuối, sai quyền |
| PRD-TC-20261006-100355716 | TC | apps/api/test/catalog/image.spec.ts | pass | Tệp đúng 5 MB, 5 MB cộng 1 byte, xóa rồi tải lại khi có 8 ảnh, EXIF bị bỏ |
| PRD-TC-20261006-100355739 | TC | apps/api/test/catalog/publish-archive.spec.ts | pass | Admin công bố sản phẩm đủ điều kiện |
| PRD-TC-20261006-100355762 | TC | apps/api/test/catalog/publish-archive.spec.ts | pass | Công bố bị từ chối: thiếu ảnh, đã archived, sai quyền |
| PRD-TC-20261006-100355784 | TC | apps/api/test/catalog/publish-archive.spec.ts | pass | Công bố lại và công bố đua với xóa ảnh duy nhất |
| PRD-TC-20261006-100355807 | TC | apps/api/test/catalog/publish-archive.spec.ts | pass | Admin ngừng bán sản phẩm đang bán và hủy nháp |
| PRD-TC-20261006-100355830 | TC | apps/api/test/catalog/publish-archive.spec.ts | pass | Ngừng bán bị từ chối: đã archived, staff, id không có thật, thiếu CSRF |
| PRD-TC-20261006-100355853 | TC | apps/api/test/catalog/publish-archive.spec.ts | pass | Sản phẩm trong giỏ khách và hai admin ngừng bán song song |
| PRD-TC-20261006-100355878 | TC | apps/api/test/catalog/admin-read.spec.ts | pass | Admin và staff xem danh sách quản trị mọi trạng thái, lọc theo trạng thái |
| PRD-TC-20261006-100355901 | TC | apps/api/test/catalog/admin-read.spec.ts | pass | Quản trị xem bị từ chối: customer, chưa đăng nhập, tham số sai, id không có thật |
| PRD-TC-20261006-100355924 | TC | apps/api/test/catalog/admin-read.spec.ts | pass | Trang quá cuối và danh sách rỗng |
| PRD-TC-20261006-100355948 | TC | apps/api/test/catalog/public-read.spec.ts | pass | Khách chưa đăng nhập xem chi tiết sản phẩm đang bán |
| PRD-TC-20261006-100355971 | TC | apps/api/test/catalog/public-read.spec.ts | pass | Draft, archived, không tồn tại và id sai định dạng cùng một 404; lỗi CSDL không lộ chi tiết |
| PRD-TC-20261006-100355994 | TC | apps/api/test/catalog/public-read.spec.ts | pass | Sản phẩm bị ngừng bán khi khách tải lại, chưa có đánh giá, mô tả rỗng hoặc 5000 ký tự |
| PRD-TC-20261006-100356017 | TC | apps/api/test/catalog/public-read.spec.ts | pass | Duyệt theo danh mục gồm danh mục con, lọc giá và sắp xếp |
| PRD-TC-20261006-100356041 | TC | apps/api/test/catalog/public-read.spec.ts | pass | Duyệt bị từ chối: tham số sai, ký tự lạ trong sort, và quá giới hạn tần suất |
| PRD-TC-20261006-100356064 | TC | apps/api/test/catalog/public-read.spec.ts | pass | Trang quá cuối, thứ tự ổn định khi bằng giá, min bằng max |
| PRD-TC-20261006-100356089 | TC | apps/api/test/catalog/public-read.spec.ts | pass | Tìm theo tên không dấu và theo sku |
| PRD-TC-20261006-100356116 | TC | apps/api/test/catalog/public-read.spec.ts | pass | Tìm kiếm bị từ chối hoặc an toàn: q rỗng, q quá dài, ký tự đặc biệt, sản phẩm chưa công bố |
| PRD-TC-20261006-100356141 | TC | apps/api/test/catalog/public-read.spec.ts | pass | Thứ tự từ không ảnh hưởng, q dài đúng 100, đ và d như nhau |
| PRD-TC-20261006-100356165 | TC | apps/api/test/catalog/rating.spec.ts | pass | Nhận ReviewPublished tăng điểm và ReviewHidden giảm điểm |
| PRD-TC-20261006-100356189 | TC | apps/api/test/catalog/rating.spec.ts | pass | Event lạ bị bỏ qua: sản phẩm không có, review chưa thấy, rating ngoài 1..5; không có HTTP nhận event |
| PRD-TC-20261006-100356212 | TC | apps/api/test/catalog/rating.spec.ts | pass | Giao trùng event, review duy nhất bị ẩn, hai event song song |
| PRD-TC-20261006-120604121 | TC | apps/api/test/catalog/rating.spec.ts | pass | Nhận ReviewDeleted và ReviewRatingChanged cập nhật điểm |
| PRD-TC-20261006-120604215 | TC | apps/api/test/catalog/rating.spec.ts | pass | Review hết ẩn được tính lại, ẩn hoặc xóa lặp không trừ hai lần |
| PRD-TC-20261006-120604307 | TC | apps/api/test/catalog/publish-archive.spec.ts | pass | ProductActivated và ProductArchived đi qua outbox, không mất khi tiến trình chết |
| PRD-TC-20261006-120604408 | TC | apps/api/test/catalog/image.spec.ts | pass | Tải ảnh vượt 25 megapixel bị từ chối trước khi giải mã đầy đủ |
| PRD-TC-20261006-120604504 | TC | apps/api/test/e2e/prd.e2e.spec.ts | pass | Trang chi tiết ghép nhãn còn hàng từ INV, INV lỗi thì ẩn nhãn |
| PRD-TC-20261006-120650138 | TC | apps/api/test/e2e/prd.e2e.spec.ts | pass | Danh sách ghép nhãn còn hàng theo lô từ INV, INV lỗi thì ẩn nhãn |
| PRD-TC-20261006-130100111 | TC | apps/api/test/catalog/rating.spec.ts | pass | Đánh giá đã đăng bị sửa lúc bật duyệt trước, ReviewUnpublished trừ điểm rồi ReviewPublished cộng lại điểm mới |
| PRD-TC-20261007-085337117 | TC | apps/api/test/catalog/interface.spec.ts | pass | getForCart chỉ đánh dấu sellable cho sản phẩm active và chặn quá 100 id |
| PRD-TC-20261007-085337148 | TC | apps/api/test/catalog/interface.spec.ts | pass | getSummaries trả tên, sku, ảnh và trạng thái cho mọi trạng thái sản phẩm |
| PRD-TC-20261007-085337181 | TC | apps/api/test/catalog/interface.spec.ts | pass | searchProductIds khớp tên và sku cùng cách chuẩn hóa với tìm kiếm công khai |
| PRD-TC-20261007-085337214 | TC | apps/api/test/catalog/interface.spec.ts | pass | listActiveProductIds phân trang theo id tăng dần chỉ gồm sản phẩm active |
| PRD-TC-20261007-085337251 | TC | apps/api/test/catalog/interface.spec.ts | pass | countByStatus đếm đúng theo trạng thái kể cả khi chưa có sản phẩm |
| PRD-TC-20261007-104006678 | TC | apps/api/test/catalog/image.spec.ts | pass | Job prd.sweep-orphan-images xóa đúng ảnh mồ côi quá 24 giờ, mỗi lượt tối đa 500, chạy lại xóa 0 |
| PRD-TC-20261007-104007745 | TC | apps/api/test/catalog/image.spec.ts | pass | Job đóng khi không chắc: nguồn tham chiếu rỗng, lỗi CSDL, lỗi kho, đổi STORAGE_PUBLIC_BASE_URL thì không xóa ảnh đang dùng |
| PRD-TC-20261007-104008808 | TC | apps/api/test/catalog/product-write.spec.ts | pass | Nửa cặp thay thế lẻ trong JSON là 400 ở biên (nền, thêm ca ở apps/api/test/platform/http.spec.ts), ký tự điều khiển ở tên và mô tả là 400 |
| PRD-E2E-20261015-094000000 | E2E | apps/api/test/e2e/prd.e2e.spec.ts | pass | Admin tải mẫu, xem trước import có dòng lỗi, xác nhận rồi thấy sản phẩm nháp ở danh sách |
| PRD-E2E-20261015-094100000 | E2E | apps/api/test/e2e/prd.e2e.spec.ts | pass | Admin tạo sản phẩm có giá vốn, sửa giá vốn rồi xóa giá vốn |
| PRD-E2E-20261015-094200000 | E2E | apps/api/test/e2e/prd.e2e.spec.ts | pass | Sale xem sản phẩm quản trị chỉ đọc và không thấy giá vốn |
| PRD-TC-20261015-093100000 | TC | apps/api/test/catalog/cost-price.spec.ts | pass | Admin tạo sản phẩm có giá vốn, đọc lại và audit ghi giá vốn |
| PRD-TC-20261015-093100013 | TC | apps/api/test/catalog/cost-price.spec.ts | pass | Giá vốn không hợp lệ khi tạo bị 400 |
| PRD-TC-20261015-093100026 | TC | apps/api/test/catalog/cost-price.spec.ts | pass | Staff, sale, customer, khách chưa đăng nhập không tạo được sản phẩm kèm giá vốn |
| PRD-TC-20261015-093100039 | TC | apps/api/test/catalog/cost-price.spec.ts | pass | Giá vốn 0, bằng trần, lớn hơn giá bán và bỏ trống đều được nhận |
| PRD-TC-20261015-093100052 | TC | apps/api/test/catalog/cost-price.spec.ts | pass | YẾU: Admin sửa riêng giá vốn của sản phẩm đang bán (phần cost_snapshot của đơn cũ chưa kiểm, xem Lệch spec) |
| PRD-TC-20261015-093100065 | TC | apps/api/test/catalog/cost-price.spec.ts | pass | Giá vốn không hợp lệ khi sửa bị 400 |
| PRD-TC-20261015-093100078 | TC | apps/api/test/catalog/cost-price.spec.ts | pass | Staff và sale gửi sửa giá vốn bị 403, không đổi, không audit |
| PRD-TC-20261015-093100091 | TC | apps/api/test/catalog/cost-price.spec.ts | pass | Sửa giá vốn của sản phẩm đã lưu trữ bị 409 |
| PRD-TC-20261015-093100104 | TC | apps/api/test/catalog/cost-price.spec.ts | pass | Xóa giá vốn bằng null rồi đặt về 0 |
| PRD-TC-20261015-093100117 | TC | apps/api/test/catalog/cost-price.spec.ts | pass | Admin thấy giá vốn ở danh sách và chi tiết quản trị |
| PRD-TC-20261015-093100130 | TC | apps/api/test/catalog/cost-price.spec.ts | pass | Staff không nhận khóa giá vốn ở danh sách và chi tiết quản trị |
| PRD-TC-20261015-093100143 | TC | apps/api/test/catalog/cost-price.spec.ts | pass | Sale xem được sản phẩm quản trị nhưng không nhận khóa giá vốn |
| PRD-TC-20261015-093100156 | TC | apps/api/test/catalog/cost-price.spec.ts | pass | Staff và sale dò giá vốn qua tham số lọc hoặc sắp xếp bị 400 |
| PRD-TC-20261015-093100169 | TC | apps/api/test/catalog/cost-price.spec.ts | pass | Sản phẩm do import tạo chưa có ảnh không công bố được |
| PRD-TC-20261015-093100182 | TC | apps/api/test/catalog/cost-price.spec.ts | pass | Chưa có giá vốn vẫn công bố được, event chỉ mang product_id |
| PRD-TC-20261015-093100195 | TC | apps/api/test/catalog/cost-price.spec.ts | pass | Chi tiết công khai không có khóa giá vốn ở mọi role |
| PRD-TC-20261015-093100208 | TC | apps/api/test/catalog/cost-price.spec.ts | pass | Danh sách theo danh mục và tìm kiếm công khai không có khóa giá vốn |
| PRD-TC-20261015-093100221 | TC | apps/api/test/catalog/cost-price.spec.ts | pass | Giao diện nội bộ của PRD không trả giá vốn |
| PRD-TC-20261015-093100234 | TC | apps/api/test/catalog/import.spec.ts | pass | Xem trước import: báo cáo từng dòng, hiện đổi giá |
| PRD-TC-20261015-093100247 | TC | apps/api/test/catalog/import.spec.ts | pass | Xem trước import không ghi gì |
| PRD-TC-20261015-093100260 | TC | apps/api/test/catalog/import.spec.ts | pass | Xác nhận import: tạo draft, cập nhật theo sku, không đụng tồn kho, một audit |
| PRD-TC-20261015-093100273 | TC | apps/api/test/catalog/import.spec.ts | pass | Import CSV phân cách chấm phẩy |
| PRD-TC-20261015-093100286 | TC | apps/api/test/catalog/import.spec.ts | pass | Dòng lỗi dữ liệu được báo từng dòng, các dòng hợp lệ vẫn ghi |
| PRD-TC-20261015-093100299 | TC | apps/api/test/catalog/import.spec.ts | pass | Ô công thức và ô bắt đầu bằng ký tự công thức bị từ chối; thêm ca khoảng trắng, NBSP, zero-width, ký tự điều khiển đứng trước `=`, `+`, `-`, `@` (xlsx và CSV, tên, mã hàng, nhóm hàng), sau sửa review lượt 2 (mục 39) |
| PRD-TC-20261015-093100312 | TC | apps/api/test/catalog/import.spec.ts | pass | Ô công thức trong tệp CSV bị từ chối |
| PRD-TC-20261015-093100325 | TC | apps/api/test/catalog/import.spec.ts | pass | Ô công thức ở cột số bị từ chối |
| PRD-TC-20261015-093100338 | TC | apps/api/test/catalog/import-limits.spec.ts | pass | Tệp sai loại bị từ chối trước khi đọc |
| PRD-TC-20261015-093100351 | TC | apps/api/test/catalog/import-limits.spec.ts | pass | Tệp rỗng hoặc xlsx hỏng cấu trúc bị từ chối |
| PRD-TC-20261015-093100364 | TC | apps/api/test/catalog/import-limits.spec.ts | pass | Tệp vượt kích thước tối đa bị từ chối |
| PRD-TC-20261015-093100377 | TC | apps/api/test/catalog/import-limits.spec.ts | pass | Tệp 2001 dòng bị từ chối |
| PRD-TC-20261015-093100390 | TC | apps/api/test/catalog/import-limits.spec.ts | pass | Tệp xlsx có macro bị từ chối |
| PRD-TC-20261015-093100403 | TC | apps/api/test/catalog/import-limits.spec.ts | pass | Xlsx nén bất thường (bom giải nén) bị từ chối |
| PRD-TC-20261015-093100416 | TC | apps/api/test/catalog/import-limits.spec.ts | pass | Tệp thiếu cột bắt buộc bị từ chối |
| PRD-TC-20261015-093100429 | TC | apps/api/test/catalog/import-limits.spec.ts | pass | YẾU: Vượt gấp một triệu lần trần kích thước bị từ chối nhanh (gửi phần mở đầu và giữ kết nối mở thay vì thân vô hạn, xem Lệch spec); thêm ca xlsx dưới 4 KB (ô cột `ZZZZZZ2`, cột 65, 100000 thẻ `<row>` hoặc `<c>` mở không đóng, quá trần số dòng và số ô) bị 400 dưới 3 giây, bộ nhớ không tăng (mục 41) |
| PRD-TC-20261015-093100442 | TC | apps/api/test/catalog/import-limits.spec.ts | pass | Chỉ admin được import, vai khác bị từ chối trước khi đọc tệp |
| PRD-TC-20261015-093100455 | TC | apps/api/test/catalog/import-limits.spec.ts | pass | Thiếu Idempotency-Key hoặc thiếu dry_run bị 400 |
| PRD-TC-20261015-093100468 | TC | apps/api/test/catalog/import-limits.spec.ts | pass | Yêu cầu thứ 21 trong một giờ bị 429, không đọc tệp |
| PRD-TC-20261015-093100481 | TC | apps/api/test/catalog/import.spec.ts | pass | Dòng của sản phẩm đã lưu trữ bị lỗi, sản phẩm không đổi |
| PRD-TC-20261015-093100494 | TC | apps/api/test/catalog/import.spec.ts | pass | Sku dùng ký tự đổi hoa thường thành ASCII bị từ chối |
| PRD-TC-20261015-093100507 | TC | apps/api/test/catalog/import.spec.ts | pass | Tên hàng vượt 200 ký tự hoặc có ký tự điều khiển bị lỗi dòng; thêm ca NUL hoặc nửa cặp thay thế ở mã hàng, tên, nhóm hàng: `dry_run` và xác nhận cùng 200 với lỗi dòng, không 500 (mục 40) |
| PRD-TC-20261015-093100520 | TC | apps/api/test/catalog/import.spec.ts | pass | Tên hàng đúng 200 ký tự emoji được nhận |
| PRD-TC-20261015-093100533 | TC | apps/api/test/catalog/import-limits.spec.ts | pass | Import đúng 2000 dòng và đúng 5242880 byte được nhận |
| PRD-TC-20261015-093100546 | TC | apps/api/test/catalog/import.spec.ts | pass | Tệp chỉ có dòng tiêu đề cho báo cáo rỗng |
| PRD-TC-20261015-093100559 | TC | apps/api/test/catalog/import.spec.ts | pass | Ô trống giữ nguyên giá vốn và danh mục của sản phẩm có sẵn |
| PRD-TC-20261015-093100572 | TC | apps/api/test/catalog/import.spec.ts | pass | Tên có thẻ script được lưu nguyên và hiển thị đã escape (hiển thị escape ở PRD-E2E-20261015-094000000) |
| PRD-TC-20261015-093100585 | TC | apps/api/test/catalog/import.spec.ts | pass | Hai lần import song song cùng sku mới chỉ tạo một sản phẩm |
| PRD-TC-20261015-093100598 | TC | apps/api/test/catalog/import.spec.ts | pass | Mất kết nối CSDL giữa lúc ghi lô thì không ghi dở |
| PRD-TC-20261015-093100611 | TC | apps/api/test/catalog/import.spec.ts | pass | Gửi lại cùng Idempotency-Key trả báo cáo cũ, khác tệp thì 422 |
| PRD-TC-20261015-093100624 | TC | apps/api/test/catalog/import-limits.spec.ts | pass | Giới hạn tệp đọc từ cấu hình, mặc định kiểm riêng |
| PRD-TC-20261015-093100637 | TC | apps/api/test/catalog/import.spec.ts | pass | Nội dung ô của tệp không vào log ứng dụng |
| PRD-TC-20261015-093100650 | TC | apps/api/test/catalog/import.spec.ts | pass | Tên tệp có ký tự điều khiển được làm sạch trong audit |
| PRD-TC-20261015-093100663 | TC | apps/api/test/catalog/import-limits.spec.ts | pass | Admin tải tệp mẫu đúng 7 cột và trang hướng dẫn |
| PRD-TC-20261015-093100676 | TC | apps/api/test/catalog/import-limits.spec.ts | pass | Vai khác không tải được tệp mẫu |
| PRD-TC-20261015-093100689 | TC | apps/api/test/catalog/import-limits.spec.ts | pass | Import chính tệp mẫu chưa điền cho báo cáo rỗng |
| PRD-TC-20261015-093100702 | TC | apps/api/test/catalog/import-limits.spec.ts | pass | Tải tệp mẫu lần thứ 31 trong một phút bị 429 |
| PRD-TC-20261015-093900000 | TC | apps/api/test/catalog/image.spec.ts | pass | Job dọn ảnh mồ côi có giới hạn lô 500 và hạn thời gian |
| PRD-TC-20261015-094300000 | TC | apps/api/test/catalog/interface.spec.ts | pass | getForSale trả sản phẩm kèm giá vốn theo lô cho SAL, đúng 100 id được, 101 id bị RangeError |

## Kiểm đột biến
Có TC `lỗi` kiểm mối đe dọa SEC nên gài đột biến có chủ ý. Chạy lại bằng script chung: `node .claude/skills/sdlc-review/scripts/mutate.mjs apps/api/scripts/mutations-prd.json --cwd apps/api` (từ gốc repo, cần `docker compose up -d db minio minio-bucket minio-policy` và Chromium cho dòng SB-12). Mỗi đột biến chạy ĐÚNG một TC (`-t <ID>`); `check-mutations.mjs` (kiểm bảng, không chạy test) có test `apps/api/test/tooling/mutations-prd.spec.ts` kèm ca công cụ hỏng thì đỏ. Mỗi SB `Kiểm bằng: test` của PRD-SEC (SB-05, 07, 08, 10, 11, 12, 13, 14, 18, 19, 20, 23, 27, 30) có ít nhất một đột biến bị bắt; phủ cả phần nền sửa kèm (platform: `pagination.ts`, `csrf.guard.ts`, `app-setup.ts`, `problem.filter.ts`). Đột biến `lọt` duy nhất là tương đương có lý do (dòng SB-30 thứ ba).

| Chỗ phá | Test đỏ | Kết quả |
|---|---|---|
| SB-11: chuyển nhánh không kiểm vòng cha-con | PRD-TC-20261006-100355387 | bắt |
| SB-11: bỏ kiểm quá 3 cấp khi tạo (chỉ còn CHECK của DB) | PRD-TC-20261006-100355433 | bắt |
| SB-05: staff được tạo sản phẩm (sai ma trận) | PRD-TC-20261006-100355547 | bắt |
| SB-07: staff được tạo và sửa danh mục (sai ma trận) | PRD-TC-20261006-100355410 | bắt |
| SB-05: chi tiết công khai trả cả sản phẩm draft và archived | PRD-TC-20261006-100355971 | bắt |
| SB-05: danh sách và tìm kiếm công khai không lọc trạng thái active | PRD-TC-20261006-100356116 | bắt |
| SB-11: schema nhận trường lạ (status, rating_count) qua PATCH | PRD-TC-20261006-100355615 | bắt |
| SB-23: giá 0 được chấp nhận (bỏ cận dưới 1) | PRD-TC-20261006-100355547 | bắt |
| SB-11: trần giá 1.000.000.000 thành 1.000.000.000.000 | PRD-TC-20261006-100355569 | bắt |
| SB-19: audit sửa sản phẩm không ghi giá trước | PRD-TC-20261006-100355592 | bắt |
| SB-19: công bố không ghi audit | PRD-TC-20261006-100355739 | bắt |
| SB-07: xóa danh mục không ghi audit | PRD-TC-20261006-100355456 | bắt |
| SB-30: sửa không tăng version | PRD-TC-20261006-100355592 | bắt |
| SB-30: sản phẩm archived sửa được | PRD-TC-20261006-100355615 | bắt |
| SB-30: bỏ kiểm version ở đầu hàm (WHERE version = ... bắt cùng ca) | PRD-TC-20261006-100355615 | lọt (tương đương: lưới thứ hai WHERE version = :đang-giữ trả cùng 409) |
| SB-11: công bố lại sản phẩm active không bị chặn | PRD-TC-20261006-100355784 | bắt |
| SB-11: ngừng bán sản phẩm đã archived không bị chặn | PRD-TC-20261006-100355830 | bắt |
| SB-27: công bố không ghi ProductActivated vào outbox | PRD-TC-20261006-100355739 | bắt |
| SB-27: ngừng bán không ghi ProductArchived vào outbox | PRD-TC-20261006-100355807 | bắt |
| SB-27: ReviewPublished lặp (event_id khác) cộng điểm lần hai | PRD-TC-20261006-100356212 | bắt |
| SB-11: trừ điểm theo payload thay vì điểm đã lưu | PRD-TC-20261006-120604121 | bắt |
| SB-05: nhận điểm ngoài 1..5 từ event | PRD-TC-20261006-100356189 | bắt |
| SB-11: ReviewRatingChanged cập nhật tổng khi review đang ẩn | PRD-TC-20261006-120604121 | bắt |
| SB-11: ký tự đại diện của q không được thoát (tìm công khai) | PRD-TC-20261006-100356116 | bắt |
| SB-11: ký tự đại diện của q không được thoát (searchProductIds của INV) | PRD-TC-20261007-085337181 | bắt |
| SB-11: sort nhận chuỗi tùy ý (không còn danh sách trắng) | PRD-TC-20261006-100356041 | bắt |
| SB-11: category_id không kiểm uuid ở danh sách công khai | PRD-TC-20261006-100356041 | bắt |
| SB-14: q dài tối đa 100 thành 1000 | PRD-TC-20261006-100356116 | bắt |
| SB-14: trần limit 100 của platform thành 100000 | PRD-TC-20261006-100356041 | bắt |
| SB-14: giới hạn danh sách quản trị 30 thành 3000 mỗi phút | PRD-TC-20261006-100355901 | bắt |
| SB-13: bỏ kiểm Origin (CSRF) cho endpoint ghi | PRD-TC-20261006-100355830 | bắt |
| SB-10: không kiểm magic bytes (mọi tệp coi như JPEG) | PRD-TC-20261006-100355691 | bắt |
| SB-10: giữ metadata (EXIF, GPS) khi mã hóa lại ảnh JPEG | PRD-TC-20261006-100355716 | bắt |
| SB-10: trần dung lượng ảnh 5 MB thành 50 MB | PRD-TC-20261006-100355716 | bắt |
| SB-10: tối đa 8 ảnh thành 80 | PRD-TC-20261006-100355691 | bắt |
| SB-10: xóa được ảnh cuối của sản phẩm đang bán | PRD-TC-20261006-100355691 | bắt |
| SB-10: bỏ kiểm số điểm ảnh từ tiêu đề (bom giải nén) | PRD-TC-20261006-120604408 | bắt |
| SB-10: job dọn ảnh mồ côi xóa cả ảnh còn mới (dưới 24 giờ) | PRD-TC-20261007-104006678 | bắt |
| SB-10: job dọn ảnh mồ côi xóa cả ảnh đang được tham chiếu | PRD-TC-20261007-104006678 | bắt |
| SB-10: job dọn ảnh vẫn chạy khi nguồn tham chiếu rỗng (xóa hết ảnh đang dùng khi sai CSDL, bài học L52) | PRD-TC-20261007-104007745 | bắt |
| SB-10: job dọn ảnh xóa không giới hạn lô (review PRD) | PRD-TC-20261007-104006678 | bắt |
| SB-11: thân JSON nhận nửa cặp thay thế lẻ (PostgreSQL từ chối: 500 ở AUTH, USR, PRD; review PRD) | PRD-TC-20261007-104008808 | bắt |
| SB-18: log request ghi cả query (từ khóa tìm kiếm) thay vì route mẫu | PRD-TC-20261006-100356116 | bắt |
| SB-20: lỗi CSDL không kết nối lộ thông điệp nội bộ trong problem+json | PRD-TC-20261006-100355318 | bắt |
| SB-12: danh sách công khai hiển thị tên sản phẩm bằng innerHTML | PRD-TC-20261006-100355569 | bắt |
| SB-42: danh sách quản trị trả cost_price cho mọi role (staff, sale) | PRD-TC-20261015-093100130 | bắt |
| SB-42: chi tiết quản trị trả cost_price cho mọi role (sale) | PRD-TC-20261015-093100143 | bắt |
| SB-42: staff được sửa sản phẩm (kể cả giá vốn) | PRD-TC-20261015-093100078 | bắt |
| SB-42: trần giá vốn 1.000.000.000 thành 1.000.000.000.000 (chỉ còn CHECK của DB) | PRD-TC-20261015-093100013 | bắt |
| SB-43: bỏ kiểm chữ ký zip của xlsx (tin phần mở rộng) | PRD-TC-20261015-093100338 | bắt |
| SB-43: trần giải nén 50 MB thành 50 GB | PRD-TC-20261015-093100403 | bắt |
| SB-43: trần byte tệp import mặc định 5 MB thành 50 MB | PRD-TC-20261015-093100364 | bắt |
| SB-43: chữ bắt đầu bằng + - @ tab xuống dòng không bị coi là công thức | PRD-TC-20261015-093100299 | bắt |
| SB-43: ô công thức của xlsx bị đọc như ô giá trị | PRD-TC-20261015-093100299 | bắt |
| SB-43: dry_run vẫn đi vào nhánh ghi (không còn chế độ chỉ đọc) | PRD-TC-20261015-093100247 | bắt |
| SB-40: xác nhận import không cần Idempotency-Key | PRD-TC-20261015-093100455 | bắt |
| SB-30: import cập nhật cả sản phẩm đã lưu trữ (bỏ lỗi product_archived) | PRD-TC-20261015-093100481 | bắt |
| SB-07: staff được import sản phẩm | PRD-TC-20261015-093100442 | bắt |
| SB-19: xác nhận import không ghi audit | PRD-TC-20261015-093100260 | bắt |
| SB-18: log import ghi nội dung ô của tệp | PRD-TC-20261015-093100637 | bắt |
| SB-11: nhóm hàng không ghép được thì gán danh mục gốc đầu tiên thay vì báo lỗi | PRD-TC-20261015-093100286 | bắt |
| SB-31: lô ghi import 50 dòng thành 5000 dòng mỗi câu | PRD-TC-20261015-093100598 | bắt |
| SB-14: bậc E của import 20 mỗi giờ thành 2000 | PRD-TC-20261015-093100468 | bắt |
| SB-14: tải tệp mẫu 30 mỗi phút thành 3000 | PRD-TC-20261015-093100702 | bắt |

## Lệch spec
Số TC, E2E ở bảng trên là toàn bộ của epic (112 TC, 9 E2E, đợt bán hộ thêm 57 TC và 3 E2E); mọi dòng TC pass, ba E2E mới chạy trình duyệt thật (mục 28). Các mục dưới có nhãn; mục `[cần quyết]` cần người hoặc `sdlc-impact`, `sdlc-foundation`. Mục 5 đến 8, 17, 18 đã đồng bộ ở lượt `sdlc-impact` (báo cáo `spec/changes/PRD-API-20261006-095502803.md`).

1. [đã chọn] Sửa nền (kho object): module `storage` (S3 ký SigV4, `ObjectStorage`, `createStorage`) và biến `STORAGE_*` chuyển từ `modules/user/` sang `modules/platform/storage/`, provider `OBJECT_STORAGE` thành provider chung của platform. Lý do: ADR-012 xếp "kho object" vào phần dùng chung của platform và `check:boundaries` cấm PRD import file của module user. Test: PRD-TC-20261006-100355691 (`apps/api/test/platform/shared-media.spec.ts`: kho là cấu hình platform, staging thiếu biến thì nêu tên), PRD-TC-20261006-100355666 (`apps/api/test/catalog/image.minio.spec.ts`), các test USR cũ đổi import (`apps/api/test/user/storage.spec.ts`, `apps/api/test/user/avatar.spec.ts`, `apps/api/test/user/storage.minio.spec.ts`) vẫn pass. Rủi ro: mọi `loadConfig` của platform ở staging và prod giờ đòi `STORAGE_*` (đã sửa `apps/api/test/platform/config.spec.ts`).
2. [đã chọn] Sửa nền (multipart): bộ đọc một tệp có giới hạn (`readSingleFile`, `UploadError`) chuyển lên `modules/platform/http/upload.ts` (`modules/user/multipart.ts` chỉ còn bọc đổi `UploadError` thành `ImageError`); `allowMultipart` nhận mẫu đường dẫn `:id` (`/api/v1/admin/products/:id/images`), khớp cả chuỗi, đúng method. Test: PRD-TC-20261006-100355666 (ca mẫu đường dẫn ở `apps/api/test/platform/shared-media.spec.ts`), PRD-TC-20261006-100355691 và PRD-TC-20261006-100355716 (dừng đọc không quá 5 MB + 64 KB, `apps/api/test/catalog/image.spec.ts`); đột biến SB-13 của USR (`mutations-usr.mjs`) đã cập nhật đoạn cần phá.
3. [đã chọn] Sửa nền (problem+json): trường phụ `DomainError.options.extra` nhận danh sách mã (`reasons` của 409 `category-not-empty`, `missing` của 422 `product-not-publishable`) ngoài giá trị vô hướng; vẫn không đè khóa chuẩn. Test: PRD-TC-20261006-100355479 (`apps/api/test/platform/shared-media.spec.ts` và `apps/api/test/catalog/category.spec.ts`), PRD-TC-20261006-100355762.
4. [đã chọn] Sửa nền (sổ mã lỗi): `image-invalid` (400) thành mã chung của platform, bỏ khai riêng ở `modules/user/errors.ts`, vì USR và PRD cùng khai và sổ mã báo trùng. Test: PRD-TC-20261006-100355691 (`errorRegistry.audit()` sạch trên AppModule thật, `apps/api/test/platform/shared-media.spec.ts`).
5. [đã chọn] Nền ghi lại bốn thay đổi nền ở mục 1 đến 4 (kho object và `STORAGE_*` thuộc platform, ngoại lệ multipart theo mẫu đường dẫn, `extra` dạng danh sách, `image-invalid` là mã chung) cùng `reviver` JSON chặn nửa cặp thay thế lẻ và ảnh sản phẩm giữ định dạng gốc: `spec/architecture.md` ADR-007, ADR-012, ADR-018, ADR-023 và Nhật ký thay đổi nền 2026-10-07 (sdlc-impact, có ủy quyền). Không đổi mã.
6. [đã chọn] PRD-API nay khai các mã 409 mà mã đã dùng: `product-image-limit` (vượt 8 ảnh), `product-last-image` (xóa ảnh cuối của sản phẩm active), `product-archived` (công bố, ngừng bán hay quản lý ảnh khi đã archived) và mã nền `conflict` (công bố lại sản phẩm đã active), tập `reason` của `image-invalid` và kiểm ký tự điều khiển; TC `...100355691`, `...100355762`, `...100355784` sửa chữ khớp. Không đổi mã.
7. [đã chọn] TC riêng cho job dọn ảnh mồ côi (`prd.sweep-orphan-images`, PRD-DB mục 13): PRD-TC-20261007-104006678 (xóa quá 24 giờ, giữ ảnh đang dùng, lô 500, idempotent) và PRD-TC-20261007-104007745 (đóng khi không chắc: nguồn rỗng, lỗi, đổi `STORAGE_PUBLIC_BASE_URL` xóa 0; bài học L52), thêm ca đổi `STORAGE_PUBLIC_BASE_URL` ở `apps/api/test/catalog/image.spec.ts`; PRD-TC-20261007-104008808 cho nửa cặp thay thế lẻ trong JSON là 400. Test gắn tạm vào PRD-TC-20261006-100355691, PRD-TC-20261006-100355547 và PRJ-TC-20261006-100124768 đã gắn lại ID đúng; PRD-DB mục 13 và PRD-SEC T7 đã sửa. Rủi ro còn lại cho người: bucket dùng chung giữa môi trường.
8. [đã chọn] Hành vi lỗi của `CatalogApi` nay có ở bảng Giao diện module (`spec/architecture.md`) và PRD-API mục Giao tiếp giữa module: lời gọi quá 100 id (getForCart, getSummaries), `limit` ngoài 1..200 hay 1..500 ném `RangeError` (không trả một phần, theo TC); id sai định dạng, trùng hay không tồn tại bị bỏ khỏi kết quả (không lỗi). `searchProductIds` tìm MỌI trạng thái (INV giữ kho cả sản phẩm đã ngừng bán) trong khi tìm kiếm công khai chỉ `active`. CRT, INV, REV, DSH xác nhận khi dựng epic của họ (ghi ở `spec/changes/PRD-API-20261006-095502803.md`, kể cả lệch tên `CatalogService` của CRT-API với `CatalogApi`).
9. [đã chọn] `version` tăng 1 ở công bố và ngừng bán (spec chỉ nói PATCH): form admin mở sẵn gặp 409 `product-version-conflict` sau khi trạng thái đổi, đúng mong muốn. Thêm, xóa, đổi thứ tự ảnh chỉ đổi `updated_at`, không đổi `version` (ảnh có endpoint riêng, không nằm trong form PATCH).
10. [đã chọn] Cây danh mục không đệm (BR6 cho phép đệm tối đa 60 giây): mỗi lần gọi đọc mới, nên hiện ngay. Rủi ro: tải đọc cao (hai truy vấn mỗi lần, vài trăm dòng); thêm đệm 60 giây khi cần.
11. [đã chọn] Giới hạn bậc C của endpoint công khai dùng bộ đếm riêng mỗi route (mặc định của platform, 120 mỗi phút mỗi IP): cào luân phiên bốn route công khai được tối đa bốn lần hạn mức. Rủi ro thấp (đọc công khai, ADR-014 chấp nhận xấp xỉ).
12. [đã chọn] Ảnh sản phẩm giữ định dạng gốc (jpeg, png, webp theo enum `image_type`) và phát với `Content-Type` tương ứng, không đổi sang WebP như ảnh đại diện; `Cache-Control: public, max-age=300` và `nosniff` gửi kèm khi ghi (ADR-018, phần Phát ảnh). Test: PRD-TC-20261006-100355666 (S3 giả và MinIO thật).
13. [chưa làm] `X-Content-Type-Options: nosniff` và cache ngắn ở nơi phát ảnh thật (CDN hay bucket) do hạ tầng bảo đảm, không phải test của ứng dụng; ghi ở `docs/runbook-prod.md` dòng 13. CI chưa chạy MinIO trên GitHub (dòng 12 cùng tệp).
14. [đã chọn] `description` rỗng hoặc `null` lưu thành `NULL`; PATCH nhận `null` hay chuỗi rỗng để xóa mô tả. Tìm kiếm `relevance` đưa lên trước sản phẩm có tên bắt đầu bằng TỪ ĐẦU TIÊN của `q`. Khi `q` chỉ gồm ký tự NUL kết quả rỗng (NUL không lưu được trong PostgreSQL).
15. [đã chọn] Chuyển nhánh danh mục không khóa cả nhánh con (ghi `ponytail:` trong `category.service.ts`): tạo con song song với chuyển nhánh hiếm có thể làm `depth` con lệch nhưng vẫn trong 1..3 nhờ CHECK. Chấp nhận ở v1.
16. [đã chọn] Web, nhãn tồn kho: `fetch` trực tiếp (không cookie) tới `GET /inventory/availability?product_ids=` với hạn 3 giây, chỉ nhận thân `{ items: [{ product_id, in_stock }] }` đúng INV-API; lỗi, quá giờ hay thân lạ thì ẩn nhãn, không banner. Danh sách gọi một lần theo lô sau khi có dữ liệu PRD, chi tiết gọi song song với `GET /products/{id}`. Test: PRD-TC-20261006-120604504 và PRD-TC-20261006-120650138.
17. [đã chọn] Web, màn quản lý danh mục: chốt theo `ui/admin-category.md`: ô chọn danh mục cha (`prd-admin-category-parent`) loại chính nó, con cháu và cha làm nhánh vượt 3 cấp (tránh chu trình; DB đã có CHECK, server vẫn kiểm: PRD-TC-20261006-100355387); PRD-E2E-20261006-100417219 bước 5 sửa theo (kiểm danh sách lựa chọn, không còn chọn chính nó); mã web đổi ở `apps/web/app/admin/categories/page.tsx`, test E2E ở `apps/api/test/e2e/prd.e2e.spec.ts`.
18. [đã chọn] Web, `ui/product-list.md`: dưới `md` hàng lọc giá và sắp xếp nằm sau nút "Bộ lọc" mở và đóng panel (`apps/web/app/products/page.tsx`, `apps/web/app/globals.css`); từ `md` trở lên luôn hiện. Nút và panel chưa có testid vì `spec/testids.md` (từ ui) không khai; muốn E2E cho chúng thì thêm vào ui rồi sinh lại testids (việc của người).
19. [đã chọn] Web, chi tiết nhỏ: bộ lọc trạng thái của danh sách quản trị là `<select>` ở mọi cỡ màn (ui ghi tab, dropdown dưới sm; E2E dùng `selectOption`); nút Công bố luôn bật ở bản nháp để nhận 422 và hiện `prd-admin-product-edit-publish-missing`; lưu mà không đổi gì hiện "Không có thay đổi để lưu." và không gọi API (PATCH chỉ có `version` bị 400); `prd-*-create-root`, `prd-admin-product-list-create`, `prd-*-clear-filter` mỗi lúc chỉ hiện một phần tử; thụt lề cây ở `<option>` bằng CSS (Safari có thể không hiện).
20. [đã chọn] Extension `pg_trgm` và `unaccent` tạo trong migration (PRD-DB Migration 1): role chạy migration cần quyền tạo extension (cả hai là extension tin cậy từ PostgreSQL 13, chủ CSDL tạo được). `unaccent` chỉ cài sẵn, chưa dùng (bỏ dấu do ứng dụng khi ghi `search_text`).
21. [đã chọn] Bảng đột biến PRD dùng script chung `mutate.mjs` với `-t <ID TC>` mỗi dòng; `apps/api/scripts/check-mutations.mjs` kiểm riêng bảng (SB phủ, đoạn cần phá còn đúng một lần, ID có trong test); đột biến SB-30 thứ ba tương đương có lý do (hai lớp kiểm version có chủ đích).
22. [đã chọn] (lượt trước, trước đợt bán hộ; lượt này `clean_run: chưa`, xem mục 38) `clean_run: pass`: chạy trong `git worktree` (HEAD cộng tệp đã sửa chưa commit chép sang, vì chưa có commit cho USR và PRD), `pnpm install --frozen-lockfile --offline`, rồi `scan:secrets`, `check:boundaries`, `lint`, `typecheck`, `test` (342 pass, 0 skip), `build` bằng `env -i` chỉ với PATH, HOME (Chromium của playwright), `TEST_DB_BASE`, `NEXT_TELEMETRY_DISABLED`, `STORAGE_TEST_ENDPOINT` và dịch vụ docker db, minio như workflow CI. Chưa chạy trên GitHub Actions thật (chưa push).
23. [đã chọn] Bằng chứng `file:dòng` của `spec/epics/USR/review.md` cho `modules/user/multipart.ts`, `config.ts`, `user.module.ts` lệch vì mục 1 và 2 chuyển mã sang platform; bằng chứng của các review đó do người review dựng lại theo mã thật (xem `spec/epics/PRD/review.md`, Kết quả sau sửa).
24. [đã chọn] Thư viện xlsx (đợt bán hộ, ADR-025): `fflate` 0.8.3 (MIT, không phụ thuộc gói nào, khoảng 30 KB) chỉ để giải nén streaming có trần; phần đọc xlsx (sharedStrings, inlineStr, ô số, ô công thức, trang tính đầu theo workbook) và dựng tệp mẫu tự viết trên XML chuỗi, nên không có thư viện bảng tính nào trong đường đọc tệp của người dùng. Không chọn SheetJS `xlsx` bản npm (0.18.5 có lỗ hổng đã biết CVE-2023-30533 prototype pollution và CVE-2024-22363 ReDoS, bản sửa chỉ phát hành ngoài npm) và không chọn `exceljs` (nhiều phụ thuộc, giải nén không có chỗ chặn dừng ngay khi vượt trần). Việc cho lead: ghi `fflate` 0.8.3 vào bảng "Phiên bản công nghệ" của `spec/architecture.md`. Rủi ro: bộ đọc tự viết chưa hiểu kiểu ngày của Excel (ô ngày coi như số hoặc chữ, không ảnh hưởng ba cột nhận số nguyên); thêm thư viện bảng tính khi cần đọc định dạng phức tạp hơn. Test: PRD-TC-20261015-093100338, PRD-TC-20261015-093100351, PRD-TC-20261015-093100403.
25. [đã chọn] Ghi import theo lô (`INSERT ... SELECT FROM unnest(...) ON CONFLICT (sku) DO NOTHING RETURNING sku` và `UPDATE ... FROM unnest(...) WHERE version = :đã-khóa`, mỗi lô 50 dòng) thay vì `SAVEPOINT` từng dòng như PRD-DB mục Import dòng 15: 2000 dòng với ba lượt đi về mỗi dòng gần chạm hạn 10 giây của giao dịch, còn dữ liệu đã được kiểm đúng các CHECK của DB trước khi ghi nên chỉ còn lỗi hạ tầng (hủy cả giao dịch, 503). Dòng thua cuộc song song là `sku_conflict` nhờ `RETURNING`. Rủi ro: một lỗi DB không lường trước của một dòng làm 503 cả lô thay vì chỉ dòng đó. Test: PRD-TC-20261015-093100598 (lỗi ở lô thứ hai, không ghi dở), PRD-TC-20261015-093100585, PRD-TC-20261015-093100260.
26. [đã chọn] Đối chiếu dòng với CSDL (sku đã có, cây danh mục) chạy BÊN TRONG giao dịch xác nhận sau khi khóa dòng theo thứ tự `sku`, còn đọc tệp và kiểm cú pháp từng ô chạy ngoài giao dịch (không chạm CSDL); `dry_run` đọc không khóa và không mở giao dịch. PRD-DB mục 14 nói đối chiếu ngoài giao dịch; làm trong giao dịch để kiểm lại với dữ liệu đã khóa (BR2) chỉ tốn hai truy vấn đọc. Test: PRD-TC-20261015-093100247, PRD-TC-20261015-093100481.
27. [đã chọn] Sửa nền (platform): `readSingleFile` (`modules/platform/http/upload.ts`) trả thêm `filename` (tên tệp client khai, chỉ để đoán loại và ghi audit, không dùng làm đường dẫn); `isIdempotencyKey` và `requestHash` (`modules/platform/http/idempotency.ts`) được export qua `platform/index.ts` vì import chỉ cần Idempotency-Key ở `dry_run=false` nên không gắn `@Idempotent` cho cả route. Test: PRD-TC-20261015-093100650 (tên tệp), PRD-TC-20261015-093100455 và PRD-TC-20261015-093100611 (khóa sai định dạng, phát lại, 422); bộ `test/platform` chạy xanh sau sửa.
28. [đã chọn] Ba E2E mới (PRD-E2E-20261015-094000000, ...094100000, ...094200000) chạy Chromium thật trên API thật và bản build production của web: `NEXT_TELEMETRY_DISABLED=1 E2E_PORT_BASE=3300 ECOM_TEST_DB=ecom_test_prd pnpm test -- test/e2e/prd.e2e.spec.ts` in `Tests:       11 passed, 11 total` (sáu E2E cũ và hai ca TC giữ xanh sau khi đổi nhãn Giá bán). Đặt `E2E_PORT_BASE=3300` để không đụng cổng của lượt E2E của epic khác. Sửa nền test E2E: `test/e2e/server.ts` và `support.ts` nhận `cost_price` khi dựng sản phẩm và trả ở `productState`. Test dựng tệp xlsx bằng `test/support/import.ts` (không thư viện bảng tính).
29. [đã chọn] YẾU PRD-TC-20261015-093100052: phần "`cost_snapshot` của đơn cũ vẫn 90000" chưa kiểm vì cột `order_items.cost_snapshot` thuộc epic ORD đang dựng song song; test chỉ kiểm phía PRD (sửa giá vốn chỉ đổi `products` và audit). Nâng bằng chứng: thêm một ca vào test này khi ORD xong, đọc `order_items` bằng SQL.
30. [đã chọn] YẾU PRD-TC-20261015-093100429: ca "thân vô hạn" gửi `Content-Length` gấp một triệu lần trần kèm phần mở đầu rồi giữ kết nối mở (không bơm dữ liệu liên tục), vì máy chủ ngắt kết nối ngay sau khi trả lời và bơm dữ liệu làm TCP reset mất phản hồi (EPIPE); máy chủ phải trả 400 `too_large` dưới 2 giây mà không chờ thân (log `bytes_read` dưới 64 KB), nếu chờ thân thì ca treo và đỏ. Ca "xlsx khai một triệu lần số dòng" dùng chiều trang tính khai 2 tỷ dòng (vượt giới hạn dòng của Excel 1.048.576 nên bị từ chối trước khi quét); chiều khai nhỏ hơn mức đó không bị từ chối riêng mà do bộ đếm dòng thật dừng ngay khi vượt trần (Excel hay ghi chiều rộng hơn dữ liệu).
31. [cần quyết] PRD-API khai nhóm ghi quản trị bậc D (30 mỗi phút mỗi người, một bộ đếm chung `prd:admin-write` cho danh mục và sản phẩm) nhưng `tests/` chưa có TC riêng cho 429 của nhóm ghi (chỉ có TC cho tải tệp mẫu ...702, danh sách quản trị và công khai). Đã làm đúng spec và có test tạm `apps/api/test/catalog/product-write.spec.ts` (tên "PRD-API nhóm ghi quản trị bậc D", không mang ID TC vì chưa có); cần `sdlc-test-design` thêm TC để bảng đột biến gắn được. Rủi ro: một admin sửa hàng loạt bằng tay quá 30 lần mỗi phút bị 429 (import dùng một yêu cầu cho cả lô).
32. [đã chọn] Test cũ đổi theo mã mới: `category.spec.ts` (PRD-TC-20261006-100355501: tiến đồng hồ giả 61 giây mỗi vòng vì mỗi vòng hai yêu cầu ghi và cửa sổ bậc D của nhóm ghi); `guard.spec.ts` (PRD-TC-20261006-100355410 và PRD-TC-20261006-100355547: 19 hàng ma trận PRD, 18 route, năm hàng quyền con miễn vì không có endpoint riêng: ba hàng giá vốn và hàng chi tiết công khai không kèm giá vốn là serializer theo role, kiểm tập khóa ở PRD-TC-20261015-093100130, ...143, ...195); `test/tooling/mutations-prd.spec.ts` (PRD-SEC có 23 mối đe dọa, thêm SB-31, SB-40, SB-42, SB-43); `interface.spec.ts` (thêm PRD-TC-20261015-094300000). Test dùng `audit_logs` sắp theo `created_at` thì tiến đồng hồ giả giữa hai ghi (PRD-TC-20261015-093100104).
33. [đã chọn] Serializer giá vốn: truy vấn quản trị vẫn đọc `cost_price` từ CSDL cho mọi role rồi `withCost` (suy từ role của phiên, không từ tham số) quyết định có đưa khóa vào phản hồi hay không, thay vì không SELECT cột cho staff và sale. Đơn giản, một nhánh; rủi ro rò nếu ai thêm trường mới ngoài nhánh này. Test tập khóa: PRD-TC-20261015-093100130, PRD-TC-20261015-093100143, PRD-TC-20261015-093100195, PRD-TC-20261015-093100208; đột biến SB-42 bắt cả hai nhánh.
34. [đã chọn] Tiêu đề bắt buộc của tệp import chỉ là `Mã hàng` và `Tên hàng` (BR4 chỉ đánh dấu hai cột này bắt buộc); `Nhóm hàng`, `Giá bán`, `Giá vốn` thiếu cả cột thì từng dòng mới bị `category_required`, `price_required` (sản phẩm có sẵn giữ giá trị cũ). Test: PRD-TC-20261015-093100416, PRD-TC-20261015-093100559.
35. [đã chọn] Web: staff và sale vào `/admin/products/import` thấy màn "Không có quyền" của `RequireRole` (mục menu không có), không phải một banner trong trang như bảng trạng thái của ui; vùng chọn tệp không render. Nút "Tải tệp mẫu" tải bằng `fetch` có cookie rồi tạo liên kết tạm (API khác nguồn với web nên không dùng thẻ `<a href>`). `Idempotency-Key` của lần xác nhận sinh một lần bằng `crypto.randomUUID()` và giữ cho tới khi đổi tệp hay hoàn tất (thử lại sau lỗi mạng dùng đúng khóa). Test: PRD-E2E-20261015-094000000, PRD-E2E-20261015-094200000.
36. [đã chọn] Bảng đột biến: thêm 19 dòng cho SB-07, SB-11, SB-14, SB-18, SB-19, SB-30, SB-31, SB-40, SB-42, SB-43 của PRD-SEC T16 đến T23 (chạy bằng `mutate.mjs`, cả 19 bắt); sửa đoạn cần phá của ba dòng cũ cho khớp mã hiện tại (trần giá và giới hạn danh sách quản trị thành mơ hồ vì mã mới có cùng chuỗi; dòng SB-12 web trỏ lớp CSS `pcard-name` đã đổi thành `ct-name` từ trước lượt này nên `check-mutations.mjs` đỏ). Dòng SB-12 web chạy bằng E2E trình duyệt nên chưa chạy lại ở lượt này (`[chưa làm]` cho tới khi chạy E2E).
37. [đã chọn] Biến cấu hình mới `PRD_IMPORT_MAX_BYTES`, `PRD_IMPORT_MAX_ROWS` (ADR-007) đăng ký ở `modules/catalog/config.ts`, ghi ở `.env.example`; có test gán giá trị khác mặc định (10 dòng, 2048 byte) và test giữ mặc định (2000 dòng, 5242880 byte): PRD-TC-20261015-093100624.
38. [đã chọn] CI chưa chạy: `clean-run.mjs` chưa chạy cho lượt bán hộ vì nhiều agent đang sửa cùng cây mã (SAL, ORD, SHP, AUTH, DSH) nên bản sao sạch lẫn mã dở của epic khác và bốn lệnh chuẩn không phân biệt được lỗi của PRD với lỗi của epic khác; lệnh đã chạy là `E2E_PORT_BASE=3300 ECOM_TEST_DB=ecom_test_prd pnpm test -- <thư mục hoặc tệp>` trên CSDL riêng, `tsc --noEmit` của `apps/api` và `apps/web`, và bản build production của web do lượt E2E dựng. Một lượt chạy rộng hơn (catalog, platform, inventory, cart, review, dashboard) bị đỏ hàng loạt vì PostgreSQL (docker) mất kết nối giữa chừng ("Can't reach database server"), không phải do mã PRD; chạy lại riêng catalog xanh. `test/platform/db.spec.ts` chưa chạy riêng với `ECOM_TEST_DB` khác mặc định. Lệnh `clean_run: pass` cũ (mục 22) là của lượt trước.
39. [đã chọn] Sửa sau review lượt 2 (MEDIUM, BR8, SB-43): `textCell` (`import.service.ts`) bỏ khoảng trắng Unicode, NBSP, ký tự điều khiển, zero-width và ký tự định hướng chữ đứng đầu (`LEADING_BLANK`) trước khi kiểm ký tự công thức `= + - @`; chữ bắt đầu bằng tab, xuống dòng vẫn bị từ chối như cũ; cả dòng bị `formula_rejected` (theo ADR-025, SB-43), áp cho tên, mã hàng và nhóm hàng, xlsx và CSV. Test: PRD-TC-20261015-093100299 (ca mới, 10 tiền tố x 4 ký tự, hai định dạng).
40. [đã chọn] Sửa sau review lượt 2 (MEDIUM, SB-11): `textCell` từ chối cả dòng khi ô chữ có NUL hoặc nửa cặp thay thế lẻ (`sku_invalid`, `name_invalid`, `category_invalid`, thông điệp không lặp lại giá trị), nên báo cáo không còn giá trị không lưu được vào `idempotency_keys.response` (jsonb): `dry_run` và xác nhận cùng trả 200 với lỗi dòng, không 500; dòng nhóm hàng hỏng không thêm `category_required`. Test: PRD-TC-20261015-093100507 (ca mới, cả hai chế độ).
41. [đã chọn] Sửa sau review lượt 2 (MEDIUM, SB-43): bộ đọc xlsx (`import-file.ts`) quét tuyến tính bằng `indexOf` (`elements`, thay các regex lười `[\s\S]*?` chạy bình phương khi thẻ mở không đóng; thẻ không đóng hoặc thiếu `>` là `corrupt`), từ chối tham chiếu cột ngoài 64 cột (`IMPORT_SHEET_MAX_COL`: ô có dữ liệu là `corrupt`, ô trống có định dạng bỏ qua) TRƯỚC khi cấp mảng, và thêm trần số thẻ `<row>` (`(PRD_IMPORT_MAX_ROWS + 1) x 10`, tối đa 1048576) và số thẻ `<c>` (`IMPORT_SHEET_MAX_CELLS` 500000) là `too_many_rows`. Hành vi mới: xlsx có thẻ mở không đóng bị `corrupt` thay vì bỏ qua im lặng. Test: PRD-TC-20261015-093100429 (ca mới, bảy tệp dưới 4 KB, mỗi tệp dưới 3 giây, RSS không tăng quá 300 MB). Nền (platform) nay chặn NUL ở biên (`modules/platform/http/validation.ts`, việc của lượt khác): `apps/api/test/catalog/public-read.spec.ts` (PRD-TC-20261006-100356116) chuyển `q=a%00b` sang nhóm 400.
