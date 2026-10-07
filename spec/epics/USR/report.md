---
epic: USR
status: draft
kit_version: 2
clean_run: pass
test_command: pnpm test
test_result: Tests:       254 passed, 254 total
---
# Báo cáo triển khai: USR

## Kế hoạch task
Thứ tự theo phụ thuộc: DB, rồi API, rồi giao diện, rồi E2E. Mọi task `done`; không có task `blocked`.

| # | Task | Nguồn | Phụ thuộc | Trạng thái |
|---|---|---|---|---|
| 1 | Migration bảng `addresses` (CHECK, chỉ mục một phần, khóa ngoại tới `users`), schema Prisma `user.prisma` | USR-DB-20261006-101342348 | - | done |
| 2 | Nền cho USR: giới hạn tần suất chung bộ đếm (`group`), ngoại lệ multipart hẹp, trường phụ của problem+json, biến cấu hình kho ảnh bắt buộc ngoài dev, tham số `narrow` của kiểm lệch ma trận, helper cookie phiên của AUTH | USR-API-20261006-101342436 | 1 | done |
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

## Kết quả test
Mỗi test case và E2E của epic một dòng. Test API chạy bằng Jest trên PostgreSQL 16 thật (docker compose, cổng 5433), đồng hồ giả của ứng dụng, client S3 thật của USR nói chuyện qua HTTP với dịch vụ S3 giả trong tiến trình; E2E chạy bằng Jest (playwright-core điều khiển Chromium thật) với API thật (CSDL `ecom_e2e` dựng lại từ migration), S3 giả và bản build production của web. Ngoài TC và E2E còn các test hạ tầng của USR (không có dòng riêng vì không phải TC): kiểm bộ ký SigV4 và client S3 (`apps/api/test/user/storage.spec.ts`), kiểm lệch ma trận quyền cho route USR (`apps/api/test/user/guard.spec.ts`), cổng kiểm bảng đột biến (`apps/api/test/tooling/mutations-usr.spec.ts`).

| ID | Loại | Test code | Kết quả | Ghi chú |
|---|---|---|---|---|
| USR-E2E-20261006-102054347 | E2E | apps/api/test/e2e/usr.e2e.spec.ts | pass | YẾU: ảnh nằm trên S3 giả của máy chủ E2E (không phải MinIO hay CDN thật); bước giới hạn tải ảnh dùng 8 lần tải tự động trong trình duyệt để tới ngưỡng 10 lần mỗi giờ |
| USR-E2E-20261006-102054373 | E2E | apps/api/test/e2e/usr.e2e.spec.ts | pass | - |
| USR-E2E-20261006-102054399 | E2E | apps/api/test/e2e/usr.e2e.spec.ts | pass | - |
| USR-E2E-20261006-102054425 | E2E | apps/api/test/e2e/usr.e2e.spec.ts | pass | - |
| USR-E2E-20261006-102054450 | E2E | apps/api/test/e2e/usr.e2e.spec.ts | pass | - |
| USR-E2E-20261006-102054475 | E2E | apps/api/test/e2e/usr.e2e.spec.ts | pass | - |
| USR-E2E-20261006-102054499 | E2E | apps/api/test/e2e/usr.e2e.spec.ts | pass | - |
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
| USR-TC-20261006-102053569 | TC | apps/api/test/user/avatar.spec.ts | pass | YẾU: kho ảnh là dịch vụ S3 giả tự viết trong tiến trình (client S3 thật của USR nói chuyện qua HTTP, chữ ký SigV4 được kiểm), không phải MinIO như TC ghi; EXIF kiểm bằng sharp và dò chuỗi trên byte đã lưu, không bằng thư viện đọc EXIF riêng; gồm job usr.sweep-orphan-avatars qua nhiều trang list |
| USR-TC-20261006-102053594 | TC | apps/api/test/user/avatar.spec.ts | pass | - |
| USR-TC-20261006-102053618 | TC | apps/api/test/user/avatar.spec.ts | pass | Gồm ca xử lý ảnh quá hạn, dữ liệu thừa sau phần kết thúc định dạng, đo byte đã đọc qua log |
| USR-TC-20261006-102053643 | TC | apps/api/test/user/avatar.spec.ts | pass | - |
| USR-TC-20261006-102053668 | TC | apps/api/test/user/avatar.spec.ts | pass | - |
| USR-TC-20261006-102053694 | TC | apps/api/test/user/avatar.spec.ts | pass | Cửa sổ cố định 60 phút, TC đã khớp (xem Lệch spec 10) |
| USR-TC-20261006-102053718 | TC | apps/api/test/user/avatar.spec.ts | pass | YẾU: lỗi storage dựng bằng S3 giả trả 500 ở PUT, không phải MinIO thật bị chặn lệnh ghi |
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

## Lệch spec
Chỗ code làm khác spec, hoặc chỗ spec thiếu hay mâu thuẫn. Không sửa `spec/` (hook `guard-approved` giữ nguyên); mục `[cần quyết]` cần người quyết.

1. [đã chọn] Thứ tự kiểm: USR-API ghi xác thực (401), CSRF (403), role (403), giới hạn tần suất (429), schema (400); mã chạy theo thứ tự của nền đã chốt ở `spec/changes/AUTH-API-20261006-100006077.md`: kiểu nội dung (415), giới hạn tần suất (429), CSRF (403 `csrf_failed`), xác thực (401), role (403), schema (400). Hệ quả: request chưa đăng nhập cũng bị đếm vào bộ đếm của IP và request có `Origin` lạ bị 403 trước khi tra phiên. USR-API và flow USR còn viết thứ tự cũ. Đã xử lý bằng `sdlc-impact` (`spec/changes/USR-API-20261006-101342436.md`): USR-API và USR-FLOW viết lại theo thứ tự của nền; mã không đổi.
2. [đã chọn] Ma trận quyền: hàng "Tra cứu hồ sơ khách" cho staff và admin phủ hai endpoint, nhưng tra theo `id` chỉ admin (USR-REQ-20261006-101004117 BR1, staff nhận 403 trước khi đọc dữ liệu). Kiểm lệch ma trận (`auditPermissions`) thêm tham số `narrow` khai rõ `GET /api/v1/admin/customers/:id -> admin`; khai thiếu, khai thừa hay khai role ngoài hàng ma trận đều báo lỗi (`apps/api/test/user/guard.spec.ts`). Ma trận nên tách thành hai hàng. Đã xử lý bằng `sdlc-impact` (cùng báo cáo): `spec/permissions-matrix.md` tách hai hàng (theo email: staff và admin; theo id: chỉ admin); đã bỏ `narrow` ở `customer.controller.ts` và `guard.spec.ts` (ma trận khớp mã, 10 hàng USR); thêm ca staff vào route theo id thì báo, giữ ca công cụ hỏng thì đỏ. Tùy chọn `narrow` của `auditPermissions` (nền) còn lại nhưng không còn nơi dùng.
3. [chưa làm] `X-Content-Type-Options: nosniff` lưu cùng đối tượng ảnh (USR-REQ-20261006-101003679 BR5): USR gửi header này và `Content-Type: image/webp` trong lệnh PUT (test kiểm yêu cầu tới kho), nhưng S3 thật không lưu header phản hồi tùy ý; header phải do CDN hoặc cấu hình bucket gắn khi phát ảnh. Hạ tầng chưa có nên chưa kiểm được ở nơi người dùng tải ảnh. Sau `sdlc-impact` (`spec/changes/USR-SEC-20261006-101342524.md`): BR5, T8 (`test, config`) và ADR-010, ADR-018 nói nosniff khi phát là cấu hình hạ tầng; cache ảnh đổi sang `public, max-age=300` ở mã (xem mục 21). Còn lại việc của người: cấu hình CDN hoặc bucket trả `X-Content-Type-Options: nosniff` rồi kiểm ở nơi người dùng nhận ảnh.
4. [cần quyết] Kho ảnh chưa được thử với MinIO hay S3 thật: test dùng dịch vụ S3 giả tự viết chạy trong tiến trình (`apps/api/test/support/fake-s3.ts`, cũng dùng cho E2E) mà client S3 thật của USR nói chuyện qua HTTP và nó kiểm chữ ký SigV4, băm nội dung; bộ ký còn được kiểm bằng bốn ví dụ công bố của AWS. Thiếu: chạy với MinIO ở CI (dịch vụ trong workflow). Liên quan các dòng YẾU USR-TC-20261006-102053569, USR-TC-20261006-102053718, USR-E2E-20261006-102054347.
5. [đã chọn] Không dùng SDK AWS: client S3 tự viết cho ba thao tác PUT, DELETE, list-type=2 (`apps/api/src/modules/user/storage/`), ký SigV4 bằng `node:crypto`; thêm hai phụ thuộc `sharp` (xử lý ảnh) và `busboy` (đọc multipart có giới hạn) ở `apps/api/package.json` và `pnpm-lock.yaml` (không kèm `@types/busboy`, khai kiểu tối thiểu ở `busboy.d.ts`). Rủi ro: tự duy trì chữ ký; endpoint S3 phải là gốc (không có đường dẫn con); kiểu path (`<endpoint>/<bucket>/<khóa>`).
6. [đã chọn] Phải sửa mã nền và AUTH để USR chạy đúng spec, đều có test qua TC của USR: (a) `RateLimit.group` để ghi sổ địa chỉ (ba route) và hai endpoint tra cứu khách dùng chung một bộ đếm (TC ...054595, ...054297); (b) `allowMultipart`: ngoại lệ hẹp của quy tắc 415 chỉ cho `PUT /api/v1/me/avatar` (TC ...053643); (c) `DomainError.options.extra`: trường phụ của problem+json (`reason` của `image-invalid`, `code` snake_case của lỗi nghiệp vụ; không đè khóa chuẩn); (d) `ConfigVar.requiredOutsideDev` cho `STORAGE_ENDPOINT`, `STORAGE_ACCESS_KEY`, `STORAGE_SECRET_KEY` (staging và prod bắt buộc, dev để trống thì tải ảnh trả 503; TC ...053718); test PRJ `http.spec.ts` (staging) phải thêm ba biến này; (e) `auditPermissions.narrow` (mục 2); (f) AUTH: `session.http.ts` xuất `setSessionCookie`, `currentSessionId` để USR đặt cookie phiên mới và lấy id phiên mà không import tệp nội bộ của AUTH; audit đổi mật khẩu thêm `revoked_total` cạnh `revoked_others`.
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
18. [đã chọn] Mối đe dọa T19 và T20 của USR-SEC kiểm bằng `review`; ảnh công khai theo khóa ngẫu nhiên (không ký URL) và không xác minh số điện thoại là rủi ro đã chấp nhận ở spec. Sau review USR: T19 chốt cache `public, max-age=300` (spec và mã khớp, test khẳng định header ghi lên kho, mục 21); T20 chỉ kiểm bằng review.
19. [đã chọn] Test thời gian: không ghi mốc ngày cố định trong test USR; mọi mốc lấy từ `clock.now()` của đồng hồ giả (T0) và cộng trừ tương đối. Test `login.spec.ts` của AUTH (AUTH-TC-20261006-100641289, ngưỡng 30% giữa hai trung vị độ trễ) đỏ một lần trong lượt chạy toàn repo lúc máy tải nặng (0,325) và xanh khi chạy lại; không sửa vì ngoài phạm vi USR; `spec/epics/AUTH/report.md` mục 18 đã ghi ngưỡng này là nhiễu đo.
20. [đã chọn] `clean_run`: chạy trong `git worktree` tại HEAD (e87647e) cộng các tệp chưa commit chép từ cây làm việc (mã AUTH và USR chưa commit), `pnpm install --frozen-lockfile --offline`, rồi lint, typecheck, test, build với `env -i PATH=<node và pnpm> HOME=<home> TEST_DB_BASE=postgresql://ecom:ecom@localhost:5433` và PostgreSQL 16 của docker compose (`docker compose up -d db`). Giới hạn: HOME vẫn được truyền (pnpm và Chromium của playwright-core cần); workflow `.github/workflows/ci.yml` trên GitHub chưa chạy lần nào (chưa push); cổng quét lỗ hổng `audit:deps` cần mạng nên không chạy.
21. [đã chọn] Sau review USR, theo `sdlc-impact` (`spec/changes/USR-API-20261006-101342436.md`, `spec/changes/USR-SEC-20261006-101342524.md`), mã USR đổi hai chỗ: (a) bỏ `narrow` (mục 2) và tách `@Action` của `customer.controller.ts` thành hai hàng ma trận; (b) `cache-control` của ảnh đại diện từ `public, max-age=31536000, immutable` thành `public, max-age=300` (hằng số `AVATAR_CACHE_CONTROL`, `apps/api/src/modules/user/config.ts`) để ảnh đã xóa hết phát trong tối đa 5 phút (T19); test `apps/api/test/user/avatar.spec.ts` khẳng định header ở yêu cầu PUT. Rủi ro: tải CDN tăng; không thể chứng minh nosniff khi phát (mục 3).
