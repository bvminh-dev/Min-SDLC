---
epic: USR
status: draft
kit_version: 3
clean_run: chưa
test_command: cd apps/api && ECOM_TEST_DB=ecom_test_fx1 pnpm test -- test/auth test/user test/notification test/platform test/sales test/checkout test/payment
test_result: Tests:       1 skipped, 800 passed, 801 total
---
# Báo cáo triển khai: USR

## Kế hoạch task
Thứ tự theo phụ thuộc: DB, rồi API, rồi giao diện, rồi E2E. Mọi task `done`; không có task `blocked`.

| # | Task | Nguồn | Phụ thuộc | Trạng thái |
|---|---|---|---|---|
| 1 | Migration bảng `addresses` (CHECK, chỉ mục một phần, khóa ngoại tới `users`), schema Prisma `user.prisma` | USR-DB-20261006-101342348 | - | done |
| 2 | Nền cho USR: giới hạn tần suất chung bộ đếm (`group`), ngoại lệ multipart hẹp, trường phụ của problem+json, biến cấu hình kho ảnh bắt buộc ngoài dev, helper cookie phiên của AUTH | USR-API-20261006-101342436 | 1 | done |
| 3 | Xem và sửa hồ sơ (qua `AuthApi.getUser`, `updateProfile`) | USR-API-20261006-101342436 | 2 | done |
| 4 | Đổi mật khẩu (qua `AuthApi.changePassword`, cookie phiên mới, ánh xạ lỗi theo trường) | USR-API-20261006-101342436 | 2 | done |
| 5 | Ảnh đại diện: client S3 ký SigV4, đọc multipart có giới hạn, xử lý ảnh (magic bytes, trần điểm ảnh từ tiêu đề, bỏ metadata, WebP 512), job quét ảnh mồ côi | USR-API-20261006-101342436 | 2 | done |
| 6 | Sổ địa chỉ: thêm, sửa, đặt mặc định, xóa mềm, khóa tư vấn theo người dùng, giao diện nội bộ `listAddresses`/`getAddress` cho CHK, job xóa cứng sau 30 ngày | USR-DB-20261006-101342348, USR-API-20261006-101342436 | 1, 2 | done |
| 7 | Tra cứu khách của staff (bản che) và admin (đầy đủ), audit trước khi trả dữ liệu, `UserApi.countCustomers` cho DSH | USR-API-20261006-101342436 | 2, 6 | done |
| 8 | Kiểm lệch ma trận quyền phủ route của USR trên AppModule thật | USR-SEC-20261006-101342524 | 3, 4, 5, 6, 7 | done |
| 9 | Màn hồ sơ (kèm ảnh đại diện) và màn đổi mật khẩu | ui/profile, ui/change-password | 3, 4, 5 | done |
| 10 | Màn sổ địa chỉ và màn thêm, sửa địa chỉ | ui/address-list, ui/address-form | 6 | done |
| 11 | Màn tra cứu khách (staff, admin) và thẻ khách theo id (admin) | ui/customer-lookup | 7 | done |
| 12 | E2E: Jest điều khiển Chromium bằng playwright-core; S3 giả và cổng điều khiển trong máy chủ E2E, 7 luồng | USR-E2E-20261006-102054347, USR-E2E-20261006-102054373, USR-E2E-20261006-102054399, USR-E2E-20261006-102054425, USR-E2E-20261006-102054450, USR-E2E-20261006-102054475, USR-E2E-20261006-102054499 | 9, 10, 11 | done |
| 13 | Kiểm đột biến riêng cho USR (`apps/api/scripts/mutations-usr.mjs`) và cổng kiểm chính bảng đột biến | USR-SEC-20261006-101342524 | 3, 4, 5, 6, 7, 8 | done |
| 14 | Giao diện nội bộ cho SAL (đợt bán hộ): `UserApi.lookupForSale({ actor_id, actor_role }, { phone, email })` (bản che tối đa 5, audit trước khi trả, khóa tra băm sha256) và `UserApi.isCustomer(user_id)`, export qua `index.ts`; hai endpoint tra cứu của USR giữ `@Roles('staff', 'admin')` nên sale nhận 403 | USR-REQ-20261006-101004117 | 7 | done |

## Kết quả test
Mỗi test case và E2E của epic một dòng. Test API chạy bằng Jest trên PostgreSQL 16 thật (docker compose, cổng 5433), đồng hồ giả của ứng dụng, client S3 thật của USR nói chuyện qua HTTP với dịch vụ S3 giả trong tiến trình (mặc định) hoặc MinIO thật của docker compose khi đặt `STORAGE_TEST_ENDPOINT` (kết quả bên dưới là lượt chạy có MinIO; không đặt biến thì bộ `storage.minio.spec.ts` bỏ qua và báo lý do ra stderr, T19 chỉ chạy bản S3 giả); E2E chạy bằng Jest (playwright-core điều khiển Chromium thật) với API thật (CSDL `ecom_e2e` dựng lại từ migration), kho ảnh như trên và bản build production của web. Ngoài TC và E2E còn các test hạ tầng của USR (không có dòng riêng vì không phải TC): kiểm bộ ký SigV4 và client S3 (`apps/api/test/user/storage.spec.ts`), kiểm lệch ma trận quyền cho route USR (`apps/api/test/user/guard.spec.ts`), cổng kiểm bảng đột biến (`apps/api/test/tooling/mutations-usr.spec.ts`).

| ID | Loại | Test code | Kết quả | Ghi chú |
|---|---|---|---|---|
| USR-E2E-20261006-102054347 | E2E | apps/api/test/e2e/usr.e2e.spec.ts | pass | Đã chạy với MinIO thật của docker compose (`STORAGE_TEST_ENDPOINT=http://localhost:9210`: trình duyệt tải ảnh thẳng từ MinIO, ảnh 512 px, đối tượng có trong kho rồi mất sau khi xóa; chạy lại với khóa sai thì máy chủ E2E không lên, chứng tỏ đúng là MinIO); mặc định (không đặt biến) dùng S3 giả. CDN thật chưa có (xem Lệch spec 3, 22). Bước giới hạn tải ảnh dùng 8 lần tải tự động trong trình duyệt để tới ngưỡng 10 lần mỗi giờ |
| USR-E2E-20261006-102054373 | E2E | apps/api/test/e2e/usr.e2e.spec.ts | pass | - |
| USR-E2E-20261006-102054399 | E2E | apps/api/test/e2e/usr.e2e.spec.ts | pass | - |
| USR-E2E-20261006-102054425 | E2E | apps/api/test/e2e/usr.e2e.spec.ts | pass | - |
| USR-E2E-20261006-102054450 | E2E | apps/api/test/e2e/usr.e2e.spec.ts | pass | - |
| USR-E2E-20261006-102054475 | E2E | apps/api/test/e2e/usr.e2e.spec.ts | pass | - |
| USR-E2E-20261006-102054499 | E2E | apps/api/test/e2e/usr.e2e.spec.ts | pass | - |
| USR-E2E-20261007-085336817 | E2E | apps/api/test/e2e/usr.e2e.spec.ts | pass | Trạng thái bị giới hạn của change-password: cùng test với USR-E2E-20261006-102054373 (đã có bước banner, nút khóa, tua giờ chờ); test mang thêm ID này |
| USR-E2E-20261007-085336850 | E2E | apps/api/test/e2e/usr.e2e.spec.ts | pass | Trạng thái bị giới hạn của customer-lookup: cùng test với USR-E2E-20261006-102054475; test mang thêm ID này |
| USR-TC-20261006-102053219 | TC | apps/api/test/user/profile.spec.ts | pass | - |
| USR-TC-20261006-102053246 | TC | apps/api/test/user/profile.spec.ts | pass | - |
| USR-TC-20261006-102053272 | TC | apps/api/test/user/profile.spec.ts | pass | - |
| USR-TC-20261006-102053297 | TC | apps/api/test/user/profile.spec.ts | pass | - |
| USR-TC-20261006-102053322 | TC | apps/api/test/user/profile.spec.ts | pass | - |
| USR-TC-20261006-102053348 | TC | apps/api/test/user/profile.spec.ts | pass | - |
| USR-TC-20261006-102053373 | TC | apps/api/test/user/password.spec.ts | pass | Gồm ca ép lỗi giữa giao dịch (băm, phiên, outbox, audit cùng không đổi) |
| USR-TC-20261006-102053397 | TC | apps/api/test/user/password.spec.ts | pass | - |
| USR-TC-20261006-102053423 | TC | apps/api/test/user/password.spec.ts | pass | - |
| USR-TC-20261006-102053447 | TC | apps/api/test/user/password.spec.ts | pass | - |
| USR-TC-20261006-102053472 | TC | apps/api/test/user/password.spec.ts | pass | - |
| USR-TC-20261006-102053496 | TC | apps/api/test/user/password.spec.ts | pass | - |
| USR-TC-20261006-102053521 | TC | apps/api/test/user/password.spec.ts | pass | Bước theo mã sau `sdlc-impact` (xem Lệch spec 9) |
| USR-TC-20261006-102053545 | TC | apps/api/test/user/password.spec.ts | pass | - |
| USR-TC-20261006-102053569 | TC | apps/api/test/user/avatar.spec.ts | pass | Chạy hai lần: S3 giả (avatar.spec.ts, luôn chạy) và MinIO thật (apps/api/test/user/storage.minio.spec.ts, khi đặt `STORAGE_TEST_ENDPOINT`; đã chạy ở máy này, SigV4 thật, `Cache-Control: public, max-age=300` đọc lại từ MinIO); EXIF kiểm bằng sharp và dò chuỗi `Exif`, `GPS` trên byte đã lưu; gồm job usr.sweep-orphan-avatars qua nhiều trang list |
| USR-TC-20261006-102053594 | TC | apps/api/test/user/avatar.spec.ts | pass | - |
| USR-TC-20261006-102053618 | TC | apps/api/test/user/avatar.spec.ts | pass | Gồm ca xử lý ảnh quá hạn, dữ liệu thừa sau phần kết thúc định dạng, đo byte đã đọc qua log |
| USR-TC-20261006-102053643 | TC | apps/api/test/user/avatar.spec.ts | pass | - |
| USR-TC-20261006-102053668 | TC | apps/api/test/user/avatar.spec.ts | pass | - |
| USR-TC-20261006-102053694 | TC | apps/api/test/user/avatar.spec.ts | pass | Cửa sổ cố định 60 phút, TC đã khớp (xem Lệch spec 10) |
| USR-TC-20261006-102053718 | TC | apps/api/test/user/avatar.spec.ts | pass | Lỗi ghi dựng hai cách: S3 giả trả 500 (avatar.spec.ts) và MinIO thật từ chối khóa bí mật sai (apps/api/test/user/storage.minio.spec.ts, đã chạy ở máy này); MinIO thật còn kiểm khóa có dấu cách và `+`, list 1005 đối tượng qua `continuation-token`, xóa idempotent, 403 không lộ bí mật |
| USR-TC-20261007-080907024 | TC | apps/api/test/user/avatar-cache.spec.ts | pass | T19: ba ca (header cache, URL cũ 404 sau khi thay hoặc xóa, đổi gốc URL công khai thì job quét không xóa) chạy với S3 giả và với MinIO thật (đã chạy cả hai ở máy này); chưa có CDN thật nên "hết phát trong 300 giây" chỉ được chứng minh bằng header và việc đối tượng bị xóa ở nguồn (xem Lệch spec 3, 22) |
| USR-TC-20261006-102053743 | TC | apps/api/test/user/address.spec.ts | pass | - |
| USR-TC-20261006-102053767 | TC | apps/api/test/user/address.spec.ts | pass | Gồm ca kiểm lệch ma trận báo khi code hay ma trận sai (apps/api/test/user/guard.spec.ts) |
| USR-TC-20261006-102053791 | TC | apps/api/test/user/address.spec.ts | pass | - |
| USR-TC-20261006-102053816 | TC | apps/api/test/user/address.spec.ts | pass | - |
| USR-TC-20261006-102053842 | TC | apps/api/test/user/address.spec.ts | pass | - |
| USR-TC-20261006-102053867 | TC | apps/api/test/user/address.spec.ts | pass | - |
| USR-TC-20261006-102053892 | TC | apps/api/test/user/address.spec.ts | pass | - |
| USR-TC-20261006-102053919 | TC | apps/api/test/user/address.spec.ts | pass | - |
| USR-TC-20261006-102053943 | TC | apps/api/test/user/address.spec.ts | pass | - |
| USR-TC-20261006-102053968 | TC | apps/api/test/user/address.spec.ts | pass | - |
| USR-TC-20261006-102053992 | TC | apps/api/test/user/address.spec.ts | pass | - |
| USR-TC-20261006-102054018 | TC | apps/api/test/user/address.spec.ts | pass | - |
| USR-TC-20261006-102054043 | TC | apps/api/test/user/address.spec.ts | pass | - |
| USR-TC-20261006-102054073 | TC | apps/api/test/user/address.spec.ts | pass | - |
| USR-TC-20261006-102054099 | TC | apps/api/test/user/address.spec.ts | pass | - |
| USR-TC-20261006-102054124 | TC | apps/api/test/user/address.spec.ts | pass | - |
| USR-TC-20261006-102054149 | TC | apps/api/test/user/address.spec.ts | pass | - |
| USR-TC-20261006-102054173 | TC | apps/api/test/user/address.spec.ts | pass | - |
| USR-TC-20261006-102054198 | TC | apps/api/test/user/lookup.spec.ts | pass | Lời gọi qua `GET /api/v1/admin/customers?email=`; log không chứa email hay điện thoại |
| USR-TC-20261006-102054222 | TC | apps/api/test/user/lookup.spec.ts | pass | - |
| USR-TC-20261006-102054247 | TC | apps/api/test/user/lookup.spec.ts | pass | - |
| USR-TC-20261006-102054271 | TC | apps/api/test/user/lookup.spec.ts | pass | Gồm kiểm lệch ma trận quyền trên AppModule thật (apps/api/test/user/guard.spec.ts) |
| USR-TC-20261006-102054297 | TC | apps/api/test/user/lookup.spec.ts | pass | - |
| USR-TC-20261006-102054322 | TC | apps/api/test/user/lookup.spec.ts | pass | - |
| USR-TC-20261006-102054520 | TC | apps/api/test/user/address.spec.ts | pass | - |
| USR-TC-20261006-102054545 | TC | apps/api/test/user/lookup.spec.ts | pass | - |
| USR-TC-20261006-102054570 | TC | apps/api/test/user/profile.spec.ts | pass | - |
| USR-TC-20261006-102054595 | TC | apps/api/test/user/address.spec.ts | pass | - |
| USR-TC-20261007-144433797 | TC | apps/api/test/auth/interface.spec.ts | pass | TC mới (sdlc-impact review PRM): 40 lời gọi đổi mật khẩu sai song song chỉ cho 5 lần sai; test ở bộ AUTH vì chạy `AuthApi.changePassword` trực tiếp |
| USR-TC-20261015-094057672 | TC | apps/api/test/user/sale-lookup.spec.ts | pass | Sale gọi hai endpoint của USR nhận 403 (chạy qua HTTP thật); staff vẫn 200 bản che |
| USR-TC-20261015-094057707 | TC | apps/api/test/user/sale-lookup.spec.ts | pass | Gọi hàm trực tiếp trong tiến trình; `AuthApi.findCustomersByPhone` bản thật; thứ tự audit kiểm bằng `jest.spyOn(AuditService.prototype, 'record')` (lỗi audit thì ném lỗi và không trả dữ liệu); đồng hồ giả nên các dòng audit cùng `created_at`, test tìm dòng theo khóa băm |
| USR-TC-20261015-094057743 | TC | apps/api/test/user/sale-lookup.spec.ts | pass | - |

## Kiểm đột biến
Thay test-first cho các TC `lỗi` kiểm mối đe dọa SEC của epic: gài đột biến có chủ ý, chạy đúng test của nó, kỳ vọng đỏ do khẳng định của chính ID đó, khôi phục tệp. Chạy lại bằng `node scripts/mutations-usr.mjs` (từ `apps/api`; cần `docker compose up -d db`; dòng SB-12 chạy E2E nên cần Chromium). Mỗi SB `Kiểm bằng: test` của USR-SEC (SB-01, 03, 04, 05, 06, 07, 08, 10, 11, 12, 13, 14, 18, 19, 33) có ít nhất một đột biến; `node scripts/mutations-usr.mjs --check` (và test `apps/api/test/tooling/mutations-usr.spec.ts`) đỏ khi một SB thiếu đột biến, đoạn cần phá đã đổi hay bảng không đọc được USR-SEC. Kết quả `bắt` chỉ khi test đỏ VÀ có dòng thất bại mang đúng ID; test đỏ vì lý do khác (biên dịch) ghi `hỏng` và không tính. Lượt chạy đầu có hai dòng `lọt` (bỏ kiểm tệp cụt hoặc dữ liệu thừa: test chưa có ca dữ liệu thừa sau phần kết thúc ảnh; ghi query vào log: assertion chỉ dò dạng email thô, không dò dạng mã hóa URL): đã sửa test (USR-TC-20261006-102053618, USR-TC-20261006-102054198) và chạy lại, hai dòng nay `bắt`. Không có đột biến tương đương nào được bỏ qua.

| Chỗ phá | Test đỏ | Kết quả |
|---|---|---|
| SB-01: lỗi đổi mật khẩu lặp lại mật khẩu hiện tại của client trong phản hồi | USR-TC-20261006-102053472 | bắt |
| SB-03: đổi mật khẩu không đặt cookie phiên mới (người dùng bị đăng xuất khỏi thiết bị đang đổi) | USR-TC-20261006-102053373 | bắt |
| SB-03: phản hồi đổi mật khẩu báo sai số phiên khác bị thu hồi | USR-TC-20261006-102053373 | bắt |
| SB-03: mật khẩu hiện tại sai trả 401 thay vì lỗi theo trường 400 | USR-TC-20261006-102053397 | bắt |
| SB-04: cookie phiên mới không Secure | USR-TC-20261006-102053373 | bắt |
| SB-05: PATCH hồ sơ nhận thêm trường avatar_url (không còn unknown_field) | USR-TC-20261006-102053322 | bắt |
| SB-05: cho trường lạ (role, user_id) lọt qua schema đóng | USR-TC-20261006-102053322 | bắt |
| SB-06: sửa địa chỉ không lọc theo user_id (IDOR) | USR-TC-20261006-102053992 | bắt |
| SB-06: xóa địa chỉ không lọc theo user_id (IDOR) | USR-TC-20261006-102054124 | bắt |
| SB-06: danh sách địa chỉ không lọc theo user_id (lộ địa chỉ người khác) | USR-TC-20261006-102053791 | bắt |
| SB-06: CHK getAddress trả địa chỉ của người khác | USR-TC-20261006-102053791 | bắt |
| SB-07: staff được tra cứu khách theo id (sai ma trận) | USR-TC-20261006-102054545 | bắt |
| SB-07: staff được xem sổ địa chỉ của customer (sai ma trận) | USR-TC-20261006-102053767 | bắt |
| SB-07: customer được tra cứu khách theo email (sai ma trận) | USR-TC-20261006-102054271 | bắt |
| SB-08: staff nhận email không che | USR-TC-20261006-102054198 | bắt |
| SB-08: staff nhận cả địa chỉ khách | USR-TC-20261006-102054198 | bắt |
| SB-08: tra cứu khớp tiền tố email (ký tự đại diện) | USR-TC-20261006-102054322 | bắt |
| SB-08: job dọn giữ địa chỉ xóa mềm 3650 ngày thay vì 30 | USR-TC-20261006-102054173 | bắt |
| SB-08: job dọn xóa cả địa chỉ mới xóa 29 ngày (hạn 1 ngày) | USR-TC-20261006-102054173 | bắt |
| SB-08: danh sách địa chỉ gồm cả địa chỉ đã xóa mềm | USR-TC-20261006-102053791 | bắt |
| SB-10: không kiểm magic bytes (mọi tệp coi như JPEG) | USR-TC-20261006-102053594 | bắt |
| SB-10: giữ metadata (EXIF, GPS) khi mã hóa lại ảnh | USR-TC-20261006-102053569 | bắt |
| SB-10: trần dung lượng ảnh 2 MiB thành 20 MiB | USR-TC-20261006-102053618 | bắt |
| SB-10: bỏ kiểm kích thước điểm ảnh từ tiêu đề (bom giải nén) | USR-TC-20261006-102053618 | bắt |
| SB-10: bỏ kiểm tệp cụt hoặc dữ liệu thừa | USR-TC-20261006-102053618 | bắt |
| SB-10: ảnh cũ không bị xóa khỏi storage khi thay ảnh | USR-TC-20261006-102053569 | bắt |
| SB-10: job quét ảnh mồ côi xóa cả ảnh còn mới (dưới 24 giờ) | USR-TC-20261006-102053569 | bắt |
| SB-10: job quét ảnh mồ côi xóa cả ảnh đang được tham chiếu | USR-TC-20261006-102053569 | bắt |
| SB-10: lỗi storage làm đổi avatar_url trước khi ghi xong (đảo thứ tự) | USR-TC-20261006-102053718 | bắt |
| SB-10: cache ảnh đại diện thành 1 năm và immutable (ảnh đã xóa còn phát cả năm, T19) | USR-TC-20261007-080907024 | bắt |
| SB-10: job quét ảnh mồ côi vẫn chạy khi avatar_url không ánh xạ được về khóa (đổi gốc URL công khai xóa ảnh đang dùng, T19) | USR-TC-20261007-080907024 | bắt |
| SB-11: thêm địa chỉ nhận trường lạ user_id (gán chủ sở hữu) | USR-TC-20261006-102053842 | bắt |
| SB-12: cho ký tự điều khiển lọt vào họ tên và địa chỉ | USR-TC-20261006-102053348 | bắt |
| SB-12: màn tra cứu của admin hiển thị họ tên bằng innerHTML | USR-E2E-20261006-102054475 | bắt |
| SB-13: bỏ kiểm Origin (CSRF) | USR-TC-20261006-102053322 | bắt |
| SB-13: ngoại lệ multipart áp cho mọi route (không chỉ tải ảnh) | USR-TC-20261006-102053643 | bắt |
| SB-14: giới hạn tra cứu khách 30 thành 3000 mỗi phút | USR-TC-20261006-102054297 | bắt |
| SB-14: hai endpoint tra cứu không chung bộ đếm | USR-TC-20261006-102054297 | bắt |
| SB-14: giới hạn tải ảnh 10 thành 1000 mỗi giờ | USR-TC-20261006-102053694 | bắt |
| SB-14: giới hạn ghi sổ địa chỉ không chung bộ đếm giữa thêm, sửa, xóa | USR-TC-20261006-102054595 | bắt |
| SB-14: giới hạn sửa hồ sơ 120 thành 12000 mỗi phút | USR-TC-20261006-102054570 | bắt |
| SB-18: audit ghi email gốc thay vì băm khi không tìm thấy | USR-TC-20261006-102054247 | bắt |
| SB-18: log request ghi cả query (email khách khi tra cứu) thay vì route mẫu | USR-TC-20261006-102054198 | bắt |
| SB-19: tra cứu không tìm thấy (404) không ghi audit | USR-TC-20261006-102054247 | bắt |
| SB-19: audit admin ghi nhầm mức masked | USR-TC-20261006-102054222 | bắt |
| SB-33: trần 10 địa chỉ thành 1000 | USR-TC-20261006-102053842 | bắt |
| SB-33: bỏ khóa tư vấn theo người dùng (đua vượt 10, hai mặc định, xóa đồng thời) | USR-TC-20261006-102053892 | bắt |
| SB-33: địa chỉ đầu tiên không tự mặc định | USR-TC-20261006-102053816 | bắt |
| SB-33: cho bỏ mặc định của địa chỉ đang mặc định | USR-TC-20261006-102054018 | bắt |
| SB-33: xóa địa chỉ mặc định không chuyển mặc định cho địa chỉ mới nhất | USR-TC-20261006-102054099 | bắt |
| SB-33: đổi mặc định cũng đổi updated_at (CHK báo nhầm địa chỉ đã đổi) | USR-TC-20261006-102053968 | bắt |
| SB-33: thêm địa chỉ is_default không bỏ mặc định cũ | USR-TC-20261006-102053816 | bắt |
| SB-05: sale gọi được endpoint tra cứu khách theo email của staff (sai ma trận) | USR-TC-20261015-094057672 | bắt |
| SB-19: UserApi.lookupForSale không ghi audit | USR-TC-20261015-094057707 | bắt |
| SB-18: audit của lookupForSale ghi số điện thoại gốc thay vì băm | USR-TC-20261015-094057707 | bắt |
| SB-08: lookupForSale trả email và điện thoại không che | USR-TC-20261015-094057707 | bắt |
| SB-08: lookupForSale bỏ trần 5 kết quả theo điện thoại | USR-TC-20261015-094057707 | bắt |
| SB-05: UserApi.isCustomer đúng với mọi người dùng (không lọc role customer) | USR-TC-20261015-094057743 | bắt |

## Lệch spec
Chỗ code làm khác spec, hoặc chỗ spec thiếu hay mâu thuẫn. Không sửa `spec/` (hook `guard-approved` giữ nguyên); mục `[cần quyết]` cần người quyết.

1. [đã chọn] Thứ tự kiểm: USR-API ghi xác thực (401), CSRF (403), role (403), giới hạn tần suất (429), schema (400); mã chạy theo thứ tự của nền đã chốt ở `spec/changes/AUTH-API-20261006-100006077.md`: kiểu nội dung (415), giới hạn tần suất (429), CSRF (403 `csrf_failed`), xác thực (401), role (403), schema (400). Hệ quả: request chưa đăng nhập cũng bị đếm vào bộ đếm của IP và request có `Origin` lạ bị 403 trước khi tra phiên. USR-API và flow USR còn viết thứ tự cũ. Đã xử lý bằng `sdlc-impact` (`spec/changes/USR-API-20261006-101342436.md`): USR-API và USR-FLOW viết lại theo thứ tự của nền; mã không đổi.
2. [đã chọn] Ma trận quyền: hàng "Tra cứu hồ sơ khách" cho staff và admin phủ hai endpoint, nhưng tra theo `id` chỉ admin (USR-REQ-20261006-101004117 BR1, staff nhận 403 trước khi đọc dữ liệu). Kiểm lệch ma trận (`auditPermissions`) thêm tham số `narrow` khai rõ `GET /api/v1/admin/customers/:id -> admin`; khai thiếu, khai thừa hay khai role ngoài hàng ma trận đều báo lỗi (`apps/api/test/user/guard.spec.ts`). Ma trận nên tách thành hai hàng. Đã xử lý bằng `sdlc-impact` (cùng báo cáo): `spec/permissions-matrix.md` tách hai hàng (theo email: staff và admin; theo id: chỉ admin); đã bỏ `narrow` ở `customer.controller.ts` và `guard.spec.ts` (ma trận khớp mã, 10 hàng USR); thêm ca staff vào route theo id thì báo, giữ ca công cụ hỏng thì đỏ. Tùy chọn `narrow` của `auditPermissions` (nền) không còn nơi dùng nên đã xóa hẳn khỏi `route-audit.ts` (đợt dọn tồn đọng), các ca "công cụ hỏng thì đỏ" (ma trận rỗng, hàng đổi tên, role lệch, phạm vi rỗng) vẫn giữ ở `apps/api/test/user/guard.spec.ts`; chữ của USR-TC-20261006-102053767 và USR-TC-20261006-102054271 đã sửa cho khớp.
3. [chưa làm] `X-Content-Type-Options: nosniff` lưu cùng đối tượng ảnh (USR-REQ-20261006-101003679 BR5): USR gửi header này và `Content-Type: image/webp` trong lệnh PUT (test kiểm yêu cầu tới kho), nhưng S3 thật không lưu header phản hồi tùy ý; header phải do CDN hoặc cấu hình bucket gắn khi phát ảnh. Hạ tầng chưa có nên chưa kiểm được ở nơi người dùng tải ảnh. Sau `sdlc-impact` (`spec/changes/USR-SEC-20261006-101342524.md`): BR5, T8 (`test, config`) và ADR-010, ADR-018 nói nosniff khi phát là cấu hình hạ tầng; cache ảnh đổi sang `public, max-age=300` ở mã (xem mục 21). Còn lại việc của người: cấu hình CDN hoặc bucket trả `X-Content-Type-Options: nosniff` rồi kiểm ở nơi người dùng nhận ảnh (`docs/runbook-prod.md` dòng 11, kiểm bằng `curl -I`). Với MinIO thật, kho tự thêm `nosniff` ở phản hồi nhưng đó là mặc định của MinIO, không phải bằng chứng cho CDN hay S3 của nhà cung cấp.
4. [đã chọn] Kho ảnh nay có bằng chứng từ MinIO thật (đợt dọn tồn đọng): `docker-compose.yml` thêm `minio`, `minio-bucket`, `minio-policy` (ảnh chainguard vì `minio/minio` không còn kéo được từ Docker Hub; cổng 9210, 9211; bucket `ecom-test` đọc ẩn danh); đặt `STORAGE_TEST_ENDPOINT=http://localhost:9210` thì chạy `apps/api/test/user/storage.minio.spec.ts`, `apps/api/test/user/avatar-cache.spec.ts` (bản MinIO) và E2E USR với kho MinIO (client S3 thật + SigV4 thật qua HTTP; đã chạy ở máy này, kết quả ở bảng trên). Không đặt biến thì các bộ này bỏ qua và báo lý do (không xanh im lặng); S3 giả (`apps/api/test/support/fake-s3.ts`) vẫn chạy mặc định. Nhãn YẾU của USR-TC-20261006-102053569, USR-TC-20261006-102053718, USR-E2E-20261006-102054347 đã gỡ. Giới hạn: xem mục 22.
5. [đã chọn] Không dùng SDK AWS: client S3 tự viết cho ba thao tác PUT, DELETE, list-type=2 (`apps/api/src/modules/user/storage/`), ký SigV4 bằng `node:crypto`; thêm hai phụ thuộc `sharp` (xử lý ảnh) và `busboy` (đọc multipart có giới hạn) ở `apps/api/package.json` và `pnpm-lock.yaml` (không kèm `@types/busboy`, khai kiểu tối thiểu ở `busboy.d.ts`). Rủi ro: tự duy trì chữ ký; endpoint S3 phải là gốc (không có đường dẫn con); kiểu path (`<endpoint>/<bucket>/<khóa>`).
6. [đã chọn] Phải sửa mã nền và AUTH để USR chạy đúng spec, đều có test qua TC của USR: (a) `RateLimit.group` để ghi sổ địa chỉ (ba route) và hai endpoint tra cứu khách dùng chung một bộ đếm (USR-TC-20261006-102054595, USR-TC-20261006-102054297); (b) `allowMultipart`: ngoại lệ hẹp của quy tắc 415 chỉ cho `PUT /api/v1/me/avatar` (USR-TC-20261006-102053643); (c) `DomainError.options.extra`: trường phụ của problem+json (`reason` của `image-invalid`: USR-TC-20261006-102053594; `code` snake_case của lỗi nghiệp vụ: USR-TC-20261006-102053842, USR-TC-20261006-102054018; không đè khóa chuẩn); (d) `ConfigVar.requiredOutsideDev` cho `STORAGE_ENDPOINT`, `STORAGE_ACCESS_KEY`, `STORAGE_SECRET_KEY` (staging và prod bắt buộc, dev để trống thì tải ảnh trả 503; USR-TC-20261006-102053718); test PRJ `http.spec.ts` (staging) phải thêm ba biến này; (e) `auditPermissions.narrow` từng được thêm rồi đã bỏ (mục 2, 21; nay xóa hẳn khỏi `route-audit.ts`), cổng kiểm còn lại do USR-TC-20261006-102053767 và USR-TC-20261006-102054271 kiểm; (f) AUTH: `session.http.ts` xuất `setSessionCookie`, `currentSessionId` để USR đặt cookie phiên mới và lấy id phiên mà không import tệp nội bộ của AUTH; audit đổi mật khẩu thêm `revoked_total` cạnh `revoked_others` (USR-TC-20261006-102053373, `apps/api/test/user/password.spec.ts`).
7. [đã chọn] Mã lỗi theo USR-API: `type` kebab-case `image-invalid`, `address-limit-reached`, `cannot-unset-default` kèm trường `code` snake_case (`address_limit_reached`, `cannot_unset_default`) và `reason` cho ảnh; lỗi theo trường dùng `errors[]` (`cannot_unset_default` ở trường `is_default`, `incorrect` ở `current_password`).
8. [đã chọn] Audit tra cứu khách: `action` `usr.customer_lookup`, `target_type` `customer`, `target_id` là id khách hoặc băm sha256 của đầu vào đã chuẩn hóa khi không tìm thấy, `after` `{ by, found, mask }`; ghi trước khi trả dữ liệu, lỗi ghi thì 500 (TC ...054222). Tên action do implement chọn vì spec không đặt tên.
9. [đã chọn] USR-TC-20261006-102053521 bước 2 (sai 5 lần rồi lần thứ sáu đúng thì 429) cộng bước 1 là 11 lần gọi trong một giờ nên 429 không còn chứng minh "bộ đếm về 0" (trần 10 lần mỗi giờ cũng chặn): test dùng 4 lần sai rồi đúng, kiểm bộ đếm bị xóa, đúng 10 lần gọi rồi lần 11 bị 429 vì trần theo giờ. Đã xử lý bằng `sdlc-impact`: USR-TC-20261006-102053521 sửa theo mã (4 sai rồi đúng, lần 11 trả 429 vì trần theo giờ).
10. [đã chọn] Giới hạn tần suất dùng cửa sổ cố định (kho đếm PostgreSQL của nền, ADR-014 như các epic trước) thay cho "cửa sổ trượt 60 phút theo thời điểm từng lần tải" của USR-TC-20261006-102053694: test lùi đồng hồ qua ranh giới cửa sổ. Rủi ro: người dùng có thể dồn gấp đôi số lần quanh ranh giới cửa sổ. Đã xử lý bằng `sdlc-impact`: USR-TC-20261006-102053694 viết theo cửa sổ cố định (ADR-014), nêu hệ quả giao hai cửa sổ.
11. [đã chọn] USR-TC-20261006-102053373 ghi audit "số phiên thu hồi = 2" (cả phiên của request), còn `AuthApi.changePassword` ghi `revoked_others` (số phiên khác, khớp `revoked_sessions` của phản hồi): AUTH ghi thêm `revoked_total` = 2 để đúng cả hai cách đọc.
12. [đã chọn] USR-TC-20261006-102053297 ghi "log có `user_id` và `trace_id`": log request của nền có `user_id` và `correlation_id`, giá trị này trùng `X-Request-Id` và `trace_id` của lỗi; test so `correlation_id` với `X-Request-Id`.
13. [đã chọn] Tra cứu khách theo email chỉ đòi dạng `phần@phần` (không đòi dấu chấm trong tên miền) để `an.nguyen@shop` (USR-TC-20261006-102054322) trả 404 chứ không 400; `an` (không có `@`) vẫn 400 như USR-REQ ...117 và E2E ...450. Rủi ro: dạng email lỏng hơn mô tả "đúng dạng email" của USR-API.
14. [đã chọn] Giao diện: spec không nêu URL nên chọn `/account/profile`, `/account/password`, `/account/addresses`, `/account/addresses/new`, `/account/addresses/edit?id=<id>`, `/admin/customers` và `/admin/customers/[id]` (chỉ admin; staff nhận màn không có quyền); CSS thuần như AUTH (không Tailwind); menu tài khoản thêm liên kết tới các màn (không có testid trong spec). `usr-address-form-loading` dùng cho cả khung chờ ban đầu và trạng thái đang gửi. Ba ô sổ địa chỉ của `usr-address-form-*` được dựng bằng mẫu `usr-address-form-${tên trường}` nên không tìm thấy bằng grep tên đầy đủ.
15. [đã chọn] Bài học L45 (trạng thái UI có thời hạn phải có đường thoát): ba trạng thái 429 của giao diện (`usr-profile-avatar-rate-limited`, `usr-change-password-rate-limited`, `usr-customer-lookup-rate-limited`) đếm ngược theo `Retry-After` rồi tự mất và mở lại nút; E2E ...054347, ...054373, ...054475 tua đồng hồ trình duyệt (`page.clock`) để kiểm bước thoát (ngoài kịch bản của spec). E2E ...054347 và ...054399 thêm ca chuỗi giống HTML hiển thị như chữ (USR-TC ...053348, ...053919 tầng giao diện), E2E ...054475 thêm ca tên khách giống HTML.
16. [đã chọn] Hạ tầng E2E: máy chủ E2E (`apps/api/test/e2e/server.ts`) chạy AppModule thật, thêm S3 giả cổng 3103 và cổng điều khiển `/seed-address`, `/s3-objects`, `phone` và `avatar` cho `/seed-user`; E2E USR tự build web như E2E của AUTH (hai tệp E2E cùng ba cổng 3100 đến 3102 nên chạy tuần tự).
17. [chưa làm] `UserApi.countCustomers` (DSH gọi USR) chưa có test case riêng vì spec không có TC cho nó; mã chỉ chuyển lời gọi sang `AuthApi.countCustomers` đã có test ở AUTH-TC-20261006-180338166. CHK và DSH chưa có mã nên `AddressService.listAddresses`, `getAddress` chỉ được gọi trong test (USR-TC-20261006-102053791, ...054520).
18. [đã chọn] Mối đe dọa T19 và T20 của USR-SEC kiểm bằng `review`; ảnh công khai theo khóa ngẫu nhiên (không ký URL) và không xác minh số điện thoại là rủi ro đã chấp nhận ở spec. Sau review USR: T19 chốt cache `public, max-age=300` (spec và mã khớp, test khẳng định header ghi lên kho, mục 21) và nay có TC riêng USR-TC-20261007-080907024 (`Kiểm bằng: test, review`; test ở `apps/api/test/user/avatar-cache.spec.ts`, chạy với S3 giả và MinIO thật); T20 chỉ kiểm bằng review.
19. [đã chọn] Test thời gian: không ghi mốc ngày cố định trong test USR; mọi mốc lấy từ `clock.now()` của đồng hồ giả (T0) và cộng trừ tương đối. Test `login.spec.ts` của AUTH (AUTH-TC-20261006-100641289, ngưỡng 30% giữa hai trung vị độ trễ) đỏ một lần trong lượt chạy toàn repo lúc máy tải nặng (0,325). Đã sửa ở đợt dọn tồn đọng: hai test độ trễ còn lại của AUTH (`register.spec.ts`, `password.spec.ts`) đo xen kẽ như `login.spec.ts` (`medianPairMs`); `login.spec.ts` vẫn đỏ được ở 0,316 vì chênh thật khoảng 6 ms (nhánh email có thật ghi bộ đếm sai), nên dùng ngưỡng 30% hoặc 8 ms tuyệt đối, đột biến "bỏ băm giả" vẫn bị bắt; chi tiết ở `spec/epics/AUTH/report.md` mục 18.
20. [đã chọn] `clean_run`: chạy trong `git worktree` tại HEAD (e87647e) cộng các tệp chưa commit chép từ cây làm việc (mã AUTH và USR chưa commit), `pnpm install --frozen-lockfile --offline`, rồi lint, typecheck, test, build với `env -i PATH=<node và pnpm> HOME=<home> TEST_DB_BASE=postgresql://ecom:ecom@localhost:5433` và PostgreSQL 16 của docker compose (`docker compose up -d db`). Giới hạn: HOME vẫn được truyền (pnpm và Chromium của playwright-core cần); workflow `.github/workflows/ci.yml` trên GitHub chưa chạy lần nào (chưa push); cổng quét lỗ hổng `audit:deps` cần mạng nên không chạy.
21. [đã chọn] Sau review USR, theo `sdlc-impact` (`spec/changes/USR-API-20261006-101342436.md`, `spec/changes/USR-SEC-20261006-101342524.md`), mã USR đổi hai chỗ: (a) bỏ `narrow` (mục 2) và tách `@Action` của `customer.controller.ts` thành hai hàng ma trận; (b) `cache-control` của ảnh đại diện từ `public, max-age=31536000, immutable` thành `public, max-age=300` (hằng số `AVATAR_CACHE_CONTROL`, `apps/api/src/modules/user/config.ts`) để ảnh đã xóa hết phát trong tối đa 5 phút (T19); test `apps/api/test/user/avatar.spec.ts` khẳng định header ở yêu cầu PUT. Rủi ro: tải CDN tăng; không thể chứng minh nosniff khi phát (mục 3).
22. [chưa làm] Việc còn lại sau đợt dọn tồn đọng, đều cần người: (a) workflow `.github/workflows/ci.yml` đã thêm bước MinIO (`docker compose up -d minio minio-bucket minio-policy`) và `STORAGE_TEST_ENDPOINT`, `NEXT_TELEMETRY_DISABLED` nhưng chưa chạy trên GitHub (chưa push), ảnh chainguard có thể cần đổi nếu runner không kéo được; (b) chưa có bằng chứng với S3 hay CDN thật của nhà cung cấp: `nosniff` và chính sách cache khi phát ảnh, cấu hình bucket và biến `STORAGE_*` ở prod (`docs/runbook-prod.md` dòng 10 đến 12); (c) trạng thái "bị giới hạn" của màn đổi mật khẩu và màn tra cứu khách (`usr-change-password-rate-limited`, `usr-customer-lookup-rate-limited`) có bước thoát ở E2E nhưng `check-tests` vẫn báo không TC hay E2E trong spec nhắc chúng cùng bước thoát: cần thêm bước vào E2E trong spec qua `sdlc-test-design` (ngoài danh sách file được ủy quyền sửa).
23. [đã chọn] `kit_version: 3` và số liệu thật sau đợt dọn tồn đọng (2026-10-07): `test_result` là toàn repo 35 suite, 268 test, chạy với `STORAGE_TEST_ENDPOINT=http://localhost:9210` (MinIO thật; nếu không đặt biến thì `storage.minio.spec.ts` bỏ qua và `avatar-cache.spec.ts` chỉ chạy bản S3 giả, số test đã chạy ít đi); `clean_run` chạy lại trong `git worktree` tại HEAD (5781d41) cộng tệp chưa commit, `env -i`, `pnpm install --frozen-lockfile --offline`: lint, typecheck, build exit 0, `pnpm test` exit 0 (35 suite, 268 test; lần chạy đầu thoát 1 sớm không có dòng lỗi nào trong log, hai lần chạy lại liền sau đều xanh, chưa rõ nguyên nhân). Giới hạn như mục 20: HOME vẫn được truyền, workflow GitHub chưa chạy, `audit:deps` cần mạng nên không chạy.

24. [đã chọn] Đồng bộ nền 2026-10-13 (`spec/changes/nen-dong-bo-20261013.md`, REV-REV-15 và bài học L133): khóa bộ đếm giới hạn tần suất của platform nay gồm method và độ dài cửa sổ nên PUT (10 mỗi 3600 giây) và DELETE (120 mỗi 60 giây) `/api/v1/me/avatar` không còn chung một dòng ở đầu giờ; mã USR không đổi. Ca hồi quy ở nền (`PRJ-TC-20261013-184314241`, `apps/api/test/platform/rate-limit.spec.ts`, đỏ trước khi sửa). E2E ảnh đại diện (`apps/api/test/e2e/usr.e2e.spec.ts`) chưa thêm lại `alignWindow(3600)` (bản căn đã bị hoàn tác ở lượt review REV): việc của người nếu muốn kiểm thêm ở tầng trình duyệt; E2E không chạy được trong đợt này vì cổng 3100 đang bị tiến trình ngoài dự án giữ (xem báo cáo PRJ mục 38). `test_result` cập nhật ở frontmatter theo lượt chạy toàn repo (không gồm E2E).

25. [đã chọn] Đợt bán hộ (2026-10-15): `UserApi.lookupForSale` và `UserApi.isCustomer` (USR-REQ-20261006-101004117 BR9). Audit dùng lại `usr.customer_lookup`, `target_type` `customer`, nhưng `target_id` LUÔN là băm sha256 của khóa tra đã chuẩn hóa (không phải id khách, vì một số điện thoại có thể ra tới 5 khách), `after` `{ by: 'phone' | 'email', found: <số kết quả>, mask: 'masked' }`; điện thoại đi qua `normalizePhone` (+84, 84, khoảng trắng) như hồ sơ. Thiếu khóa hay đủ cả hai khóa ném `validation-failed` (400 ở SAL) và không ghi audit. Giới hạn 30 lần mỗi phút chung bộ đếm `usr:customer-lookup` (BR9) do endpoint của SAL khai (`@RateLimit(LIMITS...group)`), USR không có endpoint nào cho sale nên không đặt ở đây.
26. [đã chọn] Sửa mã nền kèm đợt này: test apps/api/test/user/dsh.spec.ts (DSH-TC-20261006-110330483, nền USR) giữ nguyên ý (DSH chỉ nhận số đếm) nhưng danh sách phương thức của `UserApi` nay có thêm `lookupForSale`, `isCustomer` cho SAL. Phần AUTH (role `sale`, `AuthApi.findCustomersByPhone`, chỉ mục `users_phone_idx`) ghi ở spec/epics/AUTH/report.md (mục 29 đến 33).
27. [chưa làm] Màn tra cứu khách của USR không mở cho sale (đúng BR9); màn tra khách khi tạo đơn hộ do SAL dựng. Không có E2E mới cho USR đợt này (spec không có E2E mới).
28. [đã chọn] Thêm ngoài spec: không có hành vi nào ngoài USR-REQ-20261006-101004117 BR9; test `AuthApi.findCustomersByPhone` nằm ở apps/api/test/user/sale-lookup.spec.ts (ghi ở báo cáo AUTH mục 31).
29. [đã chọn] `clean_run`: CI chưa chạy.
CI chưa chạy: dựng worktree sạch tại HEAD và cài lại phụ thuộc dùng chung `prisma generate`, CSDL và cổng với các agent đang code song song cùng đợt; lead chạy một lần sau khi các epic xong.
30. [cần quyết] Sale tự phục vụ GIỐNG HỆT staff (sửa sau review AUTH/USR đợt bán hộ): `ALL_ROLES` của `apps/api/src/modules/user/http.ts` thêm `sale` (hồ sơ, sửa hồ sơ, đổi mật khẩu, ảnh đại diện; sổ địa chỉ vẫn chỉ customer), hai trang web `/account/profile`, `/account/password` mở cho `sale`; ma trận `spec/permissions-matrix.md` cột `sale` của bốn hàng USR (USR-REQ-20261006-101003419, ...3504, ...3591, ...3679) đặt `own`. Test: `apps/api/test/user/sale-lookup.spec.ts` (sale tự phục vụ), `apps/api/test/user/guard.spec.ts` (cột sale bằng cột staff, bỏ sale khỏi ma trận thì bị báo). Lệch spec: bốn requirement trên có `roles:` chưa gồm `sale`: cần `sdlc-impact` thêm `sale` vào `roles:` (lead làm; tài liệu requirement KHÔNG sửa ở đây). Chuỗi biên: `lookupForSale` nay từ chối NUL và email ngoài ASCII (Kelvin) bằng 400 `validation-failed` (xem báo cáo AUTH mục 39), test `sale-lookup.spec.ts`.
