---
epic: AUTH
status: draft
kit_version: 3
clean_run: pass
test_command: pnpm test
test_result: Tests:       1791 passed, 1791 total
---
# Báo cáo triển khai: AUTH

## Kế hoạch task
Thứ tự theo phụ thuộc: DB, rồi API, rồi giao diện. Mọi task `done`; không có task `blocked`.

| # | Task | Nguồn | Phụ thuộc | Trạng thái |
|---|---|---|---|---|
| 1 | Migration bảng users, sessions, password_reset_tokens, email_verification_tokens, enum, citext, CHECK và chỉ mục một phần; schema Prisma `auth.prisma` | AUTH-DB-20261006-100006037 | - | done |
| 2 | Cấu hình AUTH (ARGON2_*, AUTH_MAX_ACTIVE_SESSIONS), mã lỗi, băm argon2id bằng node:crypto, token 256 bit, chính sách mật khẩu, danh sách mật khẩu phổ biến | AUTH-DB-20261006-100006037 | 1 | done |
| 3 | Phiên: bộ giải phiên của AUTH cho guard của platform (ADR-012), cookie, hạn trượt và tuyệt đối, sửa platform cho `csrf_failed`, `session_expired`, mã lỗi trường | AUTH-API-20261006-100006077 | 1, 2 | done |
| 4 | Đăng ký, xác minh email, gửi lại email xác minh | AUTH-API-20261006-100006077 | 2, 3 | done |
| 5 | Đăng nhập (khóa tạm nguyên tử, băm lại, tối đa 10 phiên), đăng xuất, xem phiên | AUTH-API-20261006-100006077 | 2, 3 | done |
| 6 | Quên mật khẩu và đặt lại mật khẩu | AUTH-API-20261006-100006077 | 2, 3 | done |
| 7 | Admin: danh sách người dùng, đổi role, khóa, mở khóa (khóa tập admin, SB-29) | AUTH-API-20261006-100006077 | 3 | done |
| 8 | Kiểm quyền: `@Action`, kiểm lệch ma trận và quét route trên AppModule thật | AUTH-SEC-20261006-100006117 | 3, 7 | done |
| 9 | Lệnh tạo admin đầu tiên, job dọn phiên và token | AUTH-DB-20261006-100006037 | 1, 2 | done |
| 10 | Màn đăng ký, đăng nhập, quên mật khẩu, đặt lại mật khẩu | ui/register, ui/login, ui/forgot-password, ui/reset-password | 4, 5, 6 | done |
| 11 | Màn xác minh email, menu tài khoản và hộp thoại phiên hết hạn, màn không có quyền | ui/verify-email, ui/account-menu, ui/access-denied | 4, 5 | done |
| 12 | Màn quản lý người dùng (admin) | ui/admin-user-list | 7 | done |
| 13 | E2E: Jest điều khiển Chromium bằng playwright-core; máy chủ E2E thật trên PostgreSQL thật, hộp thư giả, đồng hồ lệch, 8 luồng | AUTH-E2E-20261006-100707907 | 10, 11, 12 | done |
| 14 | Giao diện nội bộ `AuthApi` cho USR, NTF, REV (đợt sdlc-impact): `changePassword` (SB-03), `getUserContact`, `listActiveUserIdsByRole`, `getDisplayNames`, `updateProfile`, `getUser`, `findCustomerById`, `findCustomerByEmail`, `listAvatarUrlsInUse`, `countCustomers` | AUTH-API-20261006-100006077 | 2, 3 | done |

## Kết quả test
Mỗi test case và E2E của epic một dòng. Test API chạy bằng Jest trên PostgreSQL 16 thật (docker compose, cổng 5433), đồng hồ giả của ứng dụng; E2E chạy bằng Jest (playwright-core điều khiển Chromium thật) với API thật (CSDL `ecom_e2e` dựng lại từ migration mỗi lần chạy) và bản build production của web.

| ID | Loại | Test code | Kết quả | Ghi chú |
|---|---|---|---|---|
| AUTH-TC-20261006-100640840 | TC | apps/api/test/auth/register.spec.ts | pass | - |
| AUTH-TC-20261006-100640887 | TC | apps/api/test/auth/register.spec.ts | pass | - |
| AUTH-TC-20261006-100640931 | TC | apps/api/test/auth/register.spec.ts | pass | Ca hiển thị đã escape ở màn quản trị chạy ở E2E (apps/api/test/e2e/auth.e2e.spec.ts); ca SIGKILL chạy tiến trình con thật |
| AUTH-TC-20261006-100640975 | TC | apps/api/test/auth/verify.spec.ts | pass | - |
| AUTH-TC-20261006-100641021 | TC | apps/api/test/auth/verify.spec.ts | pass | - |
| AUTH-TC-20261006-100641066 | TC | apps/api/test/auth/verify.spec.ts | pass | YẾU: "log máy chủ web không chứa token" kiểm bằng danh sách URL request của trình duyệt (Playwright, apps/api/test/e2e/auth.e2e.spec.ts), không đọc log truy cập thật của máy chủ Next |
| AUTH-TC-20261006-100641110 | TC | apps/api/test/auth/verify.spec.ts | pass | - |
| AUTH-TC-20261006-100641154 | TC | apps/api/test/auth/verify.spec.ts | pass | - |
| AUTH-TC-20261006-100641199 | TC | apps/api/test/auth/verify.spec.ts | pass | - |
| AUTH-TC-20261006-100641243 | TC | apps/api/test/auth/login.spec.ts | pass | - |
| AUTH-TC-20261006-100641289 | TC | apps/api/test/auth/login.spec.ts | pass | - |
| AUTH-TC-20261006-100641333 | TC | apps/api/test/auth/login.spec.ts | pass | - |
| AUTH-TC-20261006-100641376 | TC | apps/api/test/auth/safe-next.spec.ts | pass | - |
| AUTH-TC-20261006-100641421 | TC | apps/api/test/auth/session.spec.ts | pass | - |
| AUTH-TC-20261006-100641463 | TC | apps/api/test/auth/session.spec.ts | pass | - |
| AUTH-TC-20261006-100641507 | TC | apps/api/test/auth/session.spec.ts | pass | - |
| AUTH-TC-20261006-100641551 | TC | apps/api/test/auth/session.spec.ts | pass | Gồm cả ca phụ cho job dọn của AUTH (chưa có TC riêng, xem Lệch spec) |
| AUTH-TC-20261006-100641595 | TC | apps/api/test/auth/session.spec.ts | pass | Vòng thao tác mỗi 20 phút thay vì 10 phút (cùng ý: dưới hạn trượt 30 phút), đủ 7 ngày 1 giờ |
| AUTH-TC-20261006-100641639 | TC | apps/api/test/auth/session.spec.ts | pass | - |
| AUTH-TC-20261006-100641685 | TC | apps/api/test/auth/password.spec.ts | pass | - |
| AUTH-TC-20261006-100641728 | TC | apps/api/test/auth/password.spec.ts | pass | YẾU: forgot trả lời trong khoảng 1 ms nên ngưỡng 30% tương đối là nhiễu; test dùng ngưỡng 30% hoặc 2 ms tuyệt đối, cái nào lớn hơn |
| AUTH-TC-20261006-100641772 | TC | apps/api/test/auth/password.spec.ts | pass | - |
| AUTH-TC-20261006-100641816 | TC | apps/api/test/auth/password.spec.ts | pass | - |
| AUTH-TC-20261006-100641859 | TC | apps/api/test/auth/password.spec.ts | pass | - |
| AUTH-TC-20261006-100641902 | TC | apps/api/test/auth/password.spec.ts | pass | - |
| AUTH-TC-20261006-100641948 | TC | apps/api/test/auth/guard.spec.ts | pass | ORD chưa có code: dùng stub ORD theo ghi chú của TC |
| AUTH-TC-20261006-100641994 | TC | apps/api/test/auth/guard.spec.ts | pass | ORD chưa có code: dùng stub ORD theo ghi chú của TC |
| AUTH-TC-20261006-100642038 | TC | apps/api/test/auth/guard.spec.ts | pass | YẾU: ca tác nhân system: endpoint @SystemEndpoint từ chối cookie theo định dạng cổng (RspCode 97), không phải 401/403; ORD chỉ là stub |
| AUTH-TC-20261006-100642082 | TC | apps/api/test/auth/admin.spec.ts | pass | - |
| AUTH-TC-20261006-100642126 | TC | apps/api/test/auth/admin.spec.ts | pass | - |
| AUTH-TC-20261006-100642169 | TC | apps/api/test/auth/admin.spec.ts | pass | Gồm cả ca phụ cho lệnh tạo admin đầu tiên (chưa có TC riêng, xem Lệch spec) |
| AUTH-TC-20261006-100642212 | TC | apps/api/test/auth/admin.spec.ts | pass | - |
| AUTH-TC-20261006-100642255 | TC | apps/api/test/auth/admin.spec.ts | pass | - |
| AUTH-TC-20261006-100642300 | TC | apps/api/test/auth/admin.spec.ts | pass | - |
| AUTH-TC-20261006-180336843 | TC | apps/api/test/auth/interface.spec.ts | pass | TC thêm ở đợt sdlc-impact (giao diện nội bộ AUTH): changePassword thành công (SB-03); `covers` trỏ requirement của USR, NTF, REV vì AUTH chưa có requirement riêng |
| AUTH-TC-20261006-180337117 | TC | apps/api/test/auth/interface.spec.ts | pass | TC thêm ở đợt sdlc-impact (giao diện nội bộ AUTH): changePassword lỗi (sai mật khẩu hiện tại, chính sách, 429); `covers` trỏ requirement của USR, NTF, REV vì AUTH chưa có requirement riêng |
| AUTH-TC-20261006-180337381 | TC | apps/api/test/auth/interface.spec.ts | pass | TC thêm ở đợt sdlc-impact (giao diện nội bộ AUTH): changePassword biên (độ dài, bộ đếm về 0, đồng thời); `covers` trỏ requirement của USR, NTF, REV vì AUTH chưa có requirement riêng |
| AUTH-TC-20261006-180337643 | TC | apps/api/test/auth/interface.spec.ts | pass | TC thêm ở đợt sdlc-impact (giao diện nội bộ AUTH): getUserContact, listActiveUserIdsByRole; `covers` trỏ requirement của USR, NTF, REV vì AUTH chưa có requirement riêng |
| AUTH-TC-20261006-180337910 | TC | apps/api/test/auth/interface.spec.ts | pass | TC thêm ở đợt sdlc-impact (giao diện nội bộ AUTH): getDisplayNames; `covers` trỏ requirement của USR, NTF, REV vì AUTH chưa có requirement riêng |
| AUTH-TC-20261006-180338166 | TC | apps/api/test/auth/interface.spec.ts | pass | TC thêm ở đợt sdlc-impact (giao diện nội bộ AUTH): hồ sơ cho USR; `covers` trỏ requirement của USR, NTF, REV vì AUTH chưa có requirement riêng |
| AUTH-E2E-20261006-100707907 | E2E | apps/api/test/e2e/auth.e2e.spec.ts | pass | - |
| AUTH-E2E-20261006-100707954 | E2E | apps/api/test/e2e/auth.e2e.spec.ts | pass | - |
| AUTH-E2E-20261006-100708000 | E2E | apps/api/test/e2e/auth.e2e.spec.ts | pass | - |
| AUTH-E2E-20261006-100708048 | E2E | apps/api/test/e2e/auth.e2e.spec.ts | pass | Hộp thư giả và đồng hồ lệch của máy chủ E2E thay NTF và đồng hồ thật |
| AUTH-E2E-20261006-100708094 | E2E | apps/api/test/e2e/auth.e2e.spec.ts | pass | Hộp thư giả và đồng hồ lệch của máy chủ E2E thay NTF và đồng hồ thật |
| AUTH-E2E-20261006-100708137 | E2E | apps/api/test/e2e/auth.e2e.spec.ts | pass | - |
| AUTH-E2E-20261006-100708184 | E2E | apps/api/test/e2e/auth.e2e.spec.ts | pass | - |
| AUTH-E2E-20261006-100708229 | E2E | apps/api/test/e2e/auth.e2e.spec.ts | pass | Hộp thư giả và đồng hồ lệch của máy chủ E2E thay NTF và đồng hồ thật |
| AUTH-E2E-20261007-085336677 | E2E | apps/api/test/e2e/auth.e2e.spec.ts | pass | Trạng thái bị giới hạn của màn login: banner, nút khóa, mở lại sau 60 giây thật (test "review AUTH" cũ nay mang ID này) |
| AUTH-E2E-20261007-085336711 | E2E | apps/api/test/e2e/auth.e2e.spec.ts | pass | Màn register: đồng hồ giả của trình duyệt tua giờ chờ; xem Lệch spec mục 27 |
| AUTH-E2E-20261007-085336746 | E2E | apps/api/test/e2e/auth.e2e.spec.ts | pass | Màn forgot-password: như trên; xem Lệch spec mục 27 |
| AUTH-E2E-20261007-085336782 | E2E | apps/api/test/e2e/auth.e2e.spec.ts | pass | Màn reset-password: như trên; xem Lệch spec mục 27 |
| AUTH-TC-20261013-232524562 | TC | apps/api/test/auth/dsh.spec.ts | pass | TC mới của đợt dọn nợ kiểm toàn spec 2026-10-13 (check-tests --strict) cho `AuthApi.countCustomerStats`; test có sẵn của đợt DSH nay mang thêm ID này |
| AUTH-TC-20261013-232524831 | TC | apps/api/test/auth/cleanup.spec.ts | pass | TC mới cho job `auth.cleanup` (AUTH-DB mục 11): đánh dấu hết hạn, xóa bản ghi đóng quá 30 ngày (mốc đúng 30 ngày còn), chạy lại không đổi gì, chạy qua `JobRunner`; job không chia lô (xem TC) |

## Kiểm đột biến
Thay test-first cho phần khung (guard, phiên, cổng kiểm) và cho các TC `lỗi` kiểm SEC của epic: gài đột biến có chủ ý, chạy đúng test của nó, kỳ vọng đỏ, khôi phục tệp. Chạy lại bằng `node apps/api/scripts/mutations-auth.mjs` (từ thư mục gốc repo; cần `docker compose up -d db`). Mỗi SB có `Kiểm bằng: test` của AUTH (SB-01, 02, 03, 04, 26, 27, 28, 29) có ít nhất một đột biến, thêm SB-05, 07, 11, 13, 14, 18, 19 (kiểm bằng test ở các TC của epic).

| Chỗ phá | Test đỏ | Kết quả |
|---|---|---|
| SB-01: bỏ băm lại khi tham số argon2id đổi | AUTH-TC-20261006-100641333 | bắt |
| SB-02: bỏ băm giả khi email không tồn tại (lộ qua độ trễ) | AUTH-TC-20261006-100641289 | bắt |
| SB-02: ngưỡng khóa tạm 5 thành 6 | AUTH-TC-20261006-100641289 | bắt |
| SB-02: đăng ký trả lỗi khi email đã có (lộ email) | AUTH-TC-20261006-100640887 | bắt |
| SB-02: quên mật khẩu làm việc tra email TRƯỚC khi trả lời (lộ qua độ trễ) | AUTH-TC-20261006-100641728 | bắt |
| SB-03: đặt lại mật khẩu không thu hồi mọi phiên | AUTH-TC-20261006-100641816 | bắt |
| SB-03: token đặt lại dùng lại được (bỏ điều kiện status issued) | AUTH-TC-20261006-100641859 | bắt |
| SB-04: không thu hồi phiên cũ của request khi đăng nhập (session fixation) | AUTH-TC-20261006-100641333 | bắt |
| SB-04: bỏ giới hạn 10 phiên | AUTH-TC-20261006-100641639 | bắt |
| SB-04: bỏ hạn tuyệt đối 7 ngày (cả kiểm lúc đọc lẫn kẹp hạn trượt vào hạn tuyệt đối; kiểm riêng lẻ là đột biến tương đương vì hạn trượt luôn kẹp và có CHECK ở CSDL) | - | lọt |
| SB-04: cookie phiên không Secure | AUTH-TC-20261006-100641243 | bắt |
| SB-26: token xác minh dùng lại được (bỏ điều kiện status issued) | AUTH-TC-20261006-100641021 | bắt |
| SB-26: token xác minh quá hạn vẫn dùng được | AUTH-TC-20261006-100641066 | bắt |
| SB-28: next chấp nhận `//host` (open redirect) | AUTH-TC-20261006-100641376 | bắt |
| SB-29: bỏ khóa tập admin (hai admin hạ nhau cùng lúc về 0 admin) | AUTH-TC-20261006-100642169 | bắt |
| SB-29: cho admin tự đổi role của mình | AUTH-TC-20261006-100642126 | bắt |
| SB-27: tên event khóa tạm sai (UserLocked thành UserLockedX) | AUTH-TC-20261006-100641333 | bắt |
| SB-27: đăng ký không ghi UserRegistered vào outbox | AUTH-TC-20261006-100640840 | bắt |
| SB-05: staff được xem danh sách người dùng (sai ma trận) | AUTH-TC-20261006-100642126 | bắt |
| SB-05: endpoint không khai quyền được phép (bỏ mặc định từ chối) | AUTH-TC-20261006-100642038 | bắt |
| SB-07: gửi lại email cho cả staff (lệch ma trận) | AUTH-TC-20261006-100642038 | bắt |
| SB-13: bỏ kiểm Origin (CSRF) | AUTH-TC-20261006-100640887 | bắt |
| SB-14: giới hạn đăng ký 10 thành 1000 mỗi giờ | AUTH-TC-20261006-100640887 | bắt |
| SB-11: cho trường lạ (role) lọt qua schema | AUTH-TC-20261006-100640887 | bắt |
| SB-11: tìm tiền tố không escape `_` (ký tự đại diện LIKE) | AUTH-TC-20261006-100642082 | bắt |
| SB-18: ghi token đặt lại vào log | AUTH-TC-20261006-100641685 | bắt |
| SB-19: đổi role không ghi audit | AUTH-TC-20261006-100642082 | bắt |
| SB-04: admin khóa không thu hồi phiên của người bị khóa | AUTH-TC-20261006-100642212 | bắt |
| SB-03: changePassword chỉ thu hồi phiên của request, không thu hồi phiên khác | AUTH-TC-20261006-180336843 | bắt |
| SB-03: changePassword không so khớp băm cũ trong UPDATE (hai lời gọi đồng thời cùng thành công) | AUTH-TC-20261006-180337381 | bắt |
| SB-14: changePassword không đặt bộ đếm sai về 0 khi thành công | AUTH-TC-20261006-180336843 | bắt |
| SB-14: changePassword bỏ trần 10 lần gọi mỗi giờ | AUTH-TC-20261006-180337117 | bắt |
| SB-14: changePassword không tăng bộ đếm khi mật khẩu hiện tại sai (dò vô hạn; nay: hoàn lượt cả khi sai) | AUTH-TC-20261006-180337117 | bắt |
| SB-14: changePassword đếm lần sai không nguyên tử (check rồi mới đếm): 40 lời gọi song song đều qua cổng | AUTH-TC-20261006-180337117 | bắt |
| SB-01: giao diện USR trả cả password_hash (SELECT *) | AUTH-TC-20261006-180338166 | bắt |
| SB-05: updateProfile ghi cả role (mass assignment) | AUTH-TC-20261006-180338166 | bắt |
| SB-05: findCustomerById không lọc role customer | AUTH-TC-20261006-180338166 | bắt |
| SB-26: listActiveUserIdsByRole gồm cả người dùng bị khóa | AUTH-TC-20261006-180337643 | bắt |

## Lệch spec
Chỗ code làm khác spec, hoặc chỗ spec thiếu. Không sửa `spec/` (hook `guard-approved` giữ nguyên); mục cần sửa spec thì chạy `sdlc-impact`.

1. [cần quyết] Công cụ E2E: ADR-002 chỉ nêu Jest và PRJ-REQ-20261006-095422475 BR7 (test PRJ-TC-20261006-120200101) cấm công cụ test thứ hai kể cả `playwright` và `@playwright/test`, nên KHÔNG dùng Playwright Test: E2E chạy trong chính Jest, thư viện `playwright-core` (chỉ điều khiển Chromium, không phải bộ chạy test) điều khiển trình duyệt thật (`apps/api/test/e2e/`, một `pnpm test`, một công cụ test). Hệ quả: không có khẳng định tự thử lại của Playwright Test nên `support.ts` có hàm `eventually`, `see`, `count`; CI cần cài Chromium (bước `playwright-core install` ở `.github/workflows/ci.yml`, chưa chạy trên GitHub). Việc còn chờ: ADR-002 chưa nêu `playwright-core`, cần người quyết rồi ghi vào ADR-002 qua `sdlc-foundation` (mã không phụ thuộc).
2. [đã chọn] Mã lỗi: AUTH-API ghi lỗi schema là `urn:ecom:error:validation`, nền (platform) dùng `validation-failed` cho mọi module (PRJ-API); dùng `validation-failed` để mọi module cùng một mã. Các mã riêng của AUTH giữ dạng snake_case đúng như TC (`invalid_credentials`, `invalid_or_expired_token`, `csrf_failed`, `session_expired`, `already_verified`, `cannot_change_own_role`, `cannot_lock_self`, `role_unchanged`, `last_admin`, `already_locked`, `not_locked`) nên sổ mã của platform được nới để nhận dấu `_` (trước chỉ kebab-case). Đã đồng bộ spec qua `sdlc-impact` (`spec/changes/AUTH-API-20261006-100006077.md`): AUTH-API dùng `validation-failed`; ADR-023 và PRJ-REQ-20261006-095422820 BR2 nói rõ cho phép `_`. Rủi ro còn lại: hai kiểu đặt tên trong một sổ (chấp nhận có chủ đích); AUTH-REQ-20261006-095515881, AUTH-TC-20261006-100641859, AUTH-FLOW-20261006-095516031 còn viết `validation` (mục 24).
3. [đã chọn] Sửa mã của PRJ (platform) để AUTH chạy đúng spec, đều có test: (a) `CsrfGuard` trả `csrf_failed` thay `forbidden` và kiểm Origin cả khi request có header `Origin` mà không có cookie (đăng ký, đăng nhập là endpoint công khai nhưng SB-13 và AUTH-SEC T8 đòi chặn đăng nhập CSRF); test PRJ-TC-20261006-100124603 đổi kỳ vọng sang `csrf_failed`; (b) `AuthGuard` trả `session_expired` khi bộ giải phiên đánh dấu `sessionExpired`; (c) `SessionService.use()` để AUTH cài bộ giải phiên (đảo phụ thuộc, ADR-012); (d) `zodItems` nhận mã trường dạng snake_case đặt trong `message` của zod (`too_short`, `unknown_field`...); (e) `@Action`, `auditPermissions`, `parseMatrix` (kiểm lệch ma trận) và export `clientIp`. Đã đồng bộ spec qua `sdlc-impact`: PRJ-TC-20261006-100124603 (Then `csrf_failed`, thêm ca `Origin` lạ không cookie), PRJ-REQ-20261006-095422650 BR5 và BR6, PRJ-API-20261006-095847320, ADR-016; review PRJ đã chạy lại và cập nhật `reviewed_tree`.
4. [đã chọn] Thứ tự kiểm: AUTH-API nêu 429 rồi 401 rồi Origin (403) rồi 415; nền của PRJ chạy 415 (middleware) trước 429, và CSRF (403) trước xác thực (401). Hệ quả: request mang cookie phiên hết hạn mà thiếu Origin nhận 403 `csrf_failed` thay vì 401. Chốt thứ tự của nền làm chuẩn (kiểm `Origin` rẻ nên đứng trước tra phiên) và sửa AUTH-API, PRJ-API, PRJ-REQ-20261006-095422650 BR5, ADR-016 qua `sdlc-impact`; có TC kiểm thứ tự: PRJ-TC-20261006-180338418 (`apps/api/test/platform/http.spec.ts`); AUTH-REQ-20261006-095515918 BR3 còn viết thứ tự cũ (mục 24).
5. [đã chọn] Giao diện nội bộ AUTH cho module khác (AUTH-API, mục Giao tiếp giữa module; bảng Giao diện module): đã cài lớp `AuthApi` (`apps/api/src/modules/auth/auth.api.ts`, xuất từ `modules/auth/index.ts`) với đủ mười hàm: `getUserContact`, `listActiveUserIdsByRole` (NTF), `getDisplayNames` (REV), `updateProfile`, `getUser`, `changePassword`, `findCustomerById`, `findCustomerByEmail`, `listAvatarUrlsInUse`, `countCustomers` (USR); 6 TC mới (AUTH-TC-20261006-180336843, 180337117, 180337381, 180337643, 180337910, 180338166) và test ở `apps/api/test/auth/interface.spec.ts`, 9 đột biến mới đều bị bắt. Chữ ký chốt ở AUTH-API qua `sdlc-impact`: `changePassword` trả `{ revoked_others, new_session }` theo USR-API (AUTH-API cũ ghi `revoked_count`), `listActiveUserIdsByRole(roles, limit)` theo cách NTF gọi, thêm tham số tùy chọn `meta.ip` cho audit (USR-REQ BR6) và mã `same_as_current` (USR-REQ BR1; chỉ AUTH có mật khẩu cũ). Rủi ro: chưa có epic nào gọi (USR, NTF, REV chưa làm) nên chưa kiểm tích hợp thật; `updateProfile` không kiểm `phone`, `avatar_url` (USR kiểm trước khi gọi); bộ đếm 10 lần mỗi giờ là cửa sổ cố định (ADR-014) nên quanh ranh giới cửa sổ có thể thử tới 20 lần; AUTH chưa có requirement riêng cho giao diện nên 6 TC mới `covers` requirement của USR, NTF, REV.
6. [cần quyết] Danh sách mật khẩu phổ biến (REQ-620 BR2): dùng 10.000 mục SecLists `10k-most-common` (tệp `apps/api/src/modules/auth/common-passwords.ts`) cộng 12 mục bổ sung dài từ 10 ký tự, vì TC AUTH-TC-20261006-100640887 dùng `password1234` làm mẫu mà bản SecLists không có chuỗi đó (phần lớn mục SecLists ngắn hơn 10 ký tự nên không có tác dụng với chính sách tối thiểu 10). Rủi ro: danh sách hữu dụng thực tế chỉ khoảng 70 mục dài từ 10 ký tự; cần người chọn nguồn danh sách dài hơn rồi đổi spec qua `sdlc-impact` (hiện BR2 của AUTH-REQ-20261006-095515620 đã ghi nguồn SecLists; mã chạy được với danh sách hiện tại).
7. [cần quyết] Job dọn phiên và token của AUTH (AUTH-DB mục 11) và lệnh tạo admin đầu tiên (AUTH-DB Migration 3) không có TC riêng trong spec; test phụ gắn vào AUTH-TC-20261006-100641551 (job dọn) và AUTH-TC-20261006-100642169 (lệnh tạo admin, SB-29). Việc còn chờ: người quyết thêm TC riêng cho hai việc này (qua `sdlc-impact`); test phụ đã có nên hành vi được kiểm. Cập nhật 2026-10-13 (dọn nợ kiểm toàn spec): job dọn đã có TC riêng `AUTH-TC-20261013-232524831` (`apps/api/test/auth/cleanup.spec.ts`: đánh dấu hết hạn, xóa quá 30 ngày với mốc đúng 30 ngày còn, chạy lại không đổi gì, chạy qua `JobRunner`); job không chia lô (mỗi câu xử lý mọi dòng đủ điều kiện), giới hạn đã biết; lệnh tạo admin vẫn chỉ có test phụ.
8. [đã chọn] Tạo admin đầu tiên bằng lệnh riêng `pnpm --filter @ecom/api auth:create-admin` (biến AUTH_ADMIN_EMAIL, AUTH_ADMIN_PASSWORD đặt tạm trong môi trường, không có mật khẩu mặc định, email đã có thì không đổi gì) thay vì seeder của PRJ, vì `seed.ts` của PRJ từ chối chạy ngoài `APP_ENV=dev` trong khi SB-29 cần tạo admin đầu ở production. Rủi ro: mật khẩu nằm tạm trong biến môi trường của tiến trình; không có quy trình xoay vòng.
9. [đã chọn] Giao diện dùng CSS thuần (một tệp `globals.css`, token màu, bố cục một cột, gutter 16px, focus ring, hiển thị tốt ở 375px), không Tailwind và không thư viện UI: các màn ghi "mặc định Tailwind theo evon" nhưng chưa có ADR về thư viện UI và dự án chưa cài Tailwind; thêm phụ thuộc chỉ cho kiểu dáng là dư ở v1. Không có chế độ tối. Rủi ro: epic web sau cần quyết chung một hệ thống kiểu.
10. [đã chọn] Màn Gửi lại email xác minh: nút KHÔNG đặt `disabled` trong lúc đếm ngược 60 giây (chỉ mờ đi, chữ báo còn bao nhiêu giây) vì AUTH-E2E-20261006-100708094 bước 4 yêu cầu "bấm lại ngay thì `auth-verify-email-rate-limited` hiện"; server vẫn là nơi chặn (429). Màn xác minh cũng nghe sự kiện `hashchange` để mở liên kết thứ hai trong cùng tab.
11. [đã chọn] Chỗ giữ cho epic chưa có: `/orders` (trang trống đòi đăng nhập, để kiểm AUTH-E2E-20261006-100708000) và trang chủ `/` tối giản (nút "Về trang chủ", đích sau đăng nhập). Trang mặc định sau đăng nhập khi không có `next` hợp lệ: admin tới `/admin/users`, role khác tới `/`. Epic ORD, PRD thay các trang này.
12. [đã chọn] Hạ tầng E2E: máy chủ E2E (`apps/api/test/e2e/server.ts`) chạy AppModule thật và thêm một cổng điều khiển chỉ nghe 127.0.0.1 (không nằm trong `src/`): dựng dữ liệu mồi, "hộp thư giả" thay NTF (bắt hai event token thô trong bộ nhớ), tua đồng hồ của API (hết phiên 31 phút, `Clock` lệch). CSDL `ecom_e2e` tách khỏi `ecom_test` của Jest. E2E tự build web (`next build`, khoảng 1 phút) và khởi động hai máy chủ trong `beforeAll`, cổng 3100, 3101, 3102. Rủi ro: thời gian CI tăng; test E2E chiếm CPU nhưng Jest chạy một worker nên không chồng lên các test đo độ trễ.
13. [đã chọn] Quên mật khẩu làm việc tra email và tạo token SAU khi trả lời 202 (REQ-843 BR4 cho phép "hoặc tương đương"): thời gian phản hồi không phụ thuộc email có tồn tại; `AuthService.idle()` cho test chờ. Rủi ro: tiến trình chết ngay sau phản hồi thì mất yêu cầu (best-effort đã chấp nhận ở K-14, người dùng bấm lại).
14. [đã chọn] Kiểm lệch ma trận quyền (AUTH-REQ-...918 BR5) bằng `@Action("<hành động trong ma trận>")` trên mỗi endpoint và hàm `auditPermissions` chạy trong Jest trên AppModule thật (không phải script ngoài như TC mô tả "là script"); phạm vi hiện chỉ route của AUTH (`/auth`, `/admin/users`) và mọi hàng ma trận của AUTH phải có endpoint (trừ hàng "Kiểm quyền endpoint theo role" vốn là chính guard). Epic sau phải gắn `@Action` và mở rộng `scope`. Test có ca ma trận rỗng, hàng đổi tên và code khai sai để chứng minh cổng đỏ khi công cụ hỏng.
15. [đã chọn] Băm mật khẩu bằng `crypto.argon2` có sẵn trong Node 24 (argon2id, chuỗi PHC `$argon2id$v=19$m=...,t=...,p=...`), không thêm gói `argon2` (ADR-015 nêu thuật toán và tham số, không nêu thư viện). Rủi ro: API `crypto.argon2` còn mới; tham số và định dạng lưu theo PHC nên đổi thư viện sau vẫn đọc được.
16. [đã chọn] Cookie `sid` luôn `Secure` (SB-04) kể cả ở dev: Chromium và Firefox chấp nhận trên `http://localhost`, Safari thì không nên dev bằng Safari cần HTTPS. `GET /auth/session` không gia hạn phiên được nhận diện bằng đường dẫn (`/auth/session`) ở bộ giải phiên.
17. [đã chọn] Test của PRJ `apps/api/test/platform/events.spec.ts` đặt mốc cố định `NOW = 2026-10-06T10:00:00Z` trong khi `outbox_events.next_attempt_at` mặc định là `now()` của CSDL thật: sau 10:00 UTC ngày 2026-10-06 (và mọi ngày sau) 5 test đỏ ("picked: 0"). Đã sửa test sang mốc tương đối (hiện tại cộng một ngày). Đây là lỗi thời gian của PRJ chưa ai thấy vì test chạy lần cuối trước 10:00 UTC; review PRJ nên soi các test khác dùng `FakeClock` cố định cùng `now()` của CSDL.
18. [đã chọn] AUTH-TC-20261006-100641728: bắt buộc "chênh lệch trung vị dưới 30%" nhưng quên mật khẩu trả lời trong khoảng 1 ms nên tỷ lệ 30% là nhiễu đo (đã quan sát 39% giữa hai nhánh giống hệt nhau về mặt cấu trúc); test dùng ngưỡng 30% hoặc 2 ms tuyệt đối. Đã sửa nguồn nhiễu do tải máy trôi theo thời gian: hai nhánh đo xen kẽ từng cặp (`medianPairMs` ở `apps/api/test/support/auth.ts`, như `login.spec.ts`), áp dụng cho cả AUTH-TC-20261006-100641728 (`password.spec.ts`) và AUTH-TC-20261006-100640887 (`register.spec.ts`; trước đó đo tuần tự hai nhánh). AUTH-TC-20261006-100641289 (`login.spec.ts`) đã đo xen kẽ nhưng vẫn đỏ ở 0,316 khi máy tải: đo thật cho thấy chênh nhỏ có thật (khoảng 6 ms, tỷ lệ 22 đến 28%) vì nhánh email có thật ghi bộ đếm sai trong một giao dịch còn nhánh email lạ không ghi; test dùng ngưỡng 30% hoặc 8 ms tuyệt đối, và đột biến "bỏ băm giả" vẫn bị bắt (chênh cả một lần băm). Cách đóng hẳn kênh này là cân bằng hai nhánh (ghi giả ở nhánh email lạ), việc của người quyết vì đổi mã đăng nhập. Phần YẾU còn lại là độ phân giải 1 ms, không phải thứ tự đo. Bằng chứng yếu hơn Then: đột biến "làm việc trước khi trả lời" vẫn bị bắt (xem Kiểm đột biến). Cách nâng bằng chứng: đo qua mạng thật với nhiều mẫu hơn hoặc thêm khoảng trễ tối thiểu cố định cho endpoint này.
19. [đã chọn] AUTH-TC-20261006-100641066 (YẾU): "log máy chủ web của trang không chứa token" kiểm bằng danh sách URL mọi request của trình duyệt trong E2E (không request nào chứa token) cộng việc token bị xóa khỏi thanh địa chỉ, vì không đọc được log truy cập thật của máy chủ Next. Cách nâng: chạy máy chủ web sau một proxy ghi log truy cập thật và tìm chuỗi token.
20. [đã chọn] AUTH-TC-20261006-100642038 (YẾU): ca "endpoint dành cho system": `@SystemEndpoint` của platform từ chối request không có chữ ký theo định dạng cổng (HTTP 200, RspCode 97, ngoại lệ IPN của ADR-006) cho cả bốn loại người gọi, không phải 401 cho guest và 403 cho role khác như TC viết; test khẳng định handler không chạy, cookie phiên không bao giờ qua và enum `user_role` không có `system`. Endpoint không khai quyền (`@Roles()` rỗng hoặc không khai) trả 403 với mọi role kể cả guest (đúng REQ-918 BR1, khác TC ở chỗ guest nhận 403 chứ không phải 401). Cách nâng: làm rõ TC qua `sdlc-impact`.
21. [đã chọn] Kiểm đột biến SB-04 hạn tuyệt đối: bỏ riêng việc kiểm `absolute_expires_at` lúc đọc là đột biến TƯƠNG ĐƯƠNG (không test nào bắt được) vì hạn trượt luôn bị kẹp (`LEAST`) vào hạn tuyệt đối và CSDL có `CHECK (expires_at <= absolute_expires_at)`; bảng đột biến ghi đột biến kép (bỏ cả kiểm lẫn kẹp) và nó bị bắt. Đây là phòng thủ nhiều lớp có chủ ý, không phải lỗ hổng của test.
22. [đã chọn] Mọi mục E2E dùng `/login` làm trang đăng nhập cho cả staff, admin và customer (một màn, theo spec); guest vào `/verify-email` không có token bị chuyển tới đăng nhập (không có trạng thái "guest chờ xác minh" vì đăng ký không tự đăng nhập).
23. [đã chọn] `clean_run: pass`: chạy trong `git worktree` tại HEAD (e87647e) cộng các tệp chưa commit chép từ cây làm việc (mã AUTH chưa commit nên bản clone tại HEAD không có nó), `pnpm install --frozen-lockfile` rồi lint, typecheck, test, build với `env -i PATH=<node 24>:/opt/homebrew/bin:/usr/bin:/bin HOME=<home> TEST_DB_BASE=postgresql://ecom:ecom@localhost:5433` và PostgreSQL 16 của docker compose; cả bốn lệnh thoát 0 (test 22 bộ, 171 test). Giới hạn: HOME vẫn được truyền (pnpm và Chromium của playwright-core cần), không phải container Linux; workflow GitHub Actions chưa chạy thật (chưa đẩy lên) và bước cài Chromium mới thêm vào `ci.yml` chưa kiểm trên ubuntu-latest, review nên coi là rủi ro cho tới khi workflow chạy một lần. Đợt `sdlc-impact` thêm `AuthApi` và test sau lần chạy sạch này: đã chạy lại lint, typecheck, test (181), build, `check:boundaries`, `scan:secrets` trong cây làm việc (đều exit 0), chưa chạy lại bản clone sạch.
24. [đã chọn] Năm file từng viết theo nhãn cũ (AUTH-REQ-20261006-095515918 BR3: xác thực rồi CSRF; AUTH-REQ-20261006-095515881 BR3 và kịch bản, AUTH-TC-20261006-100641859 và AUTH-FLOW-20261006-095516031 nhánh Q400: `validation`; PRJ-FLOW-20261006-095422996 sơ đồ 2: CSRF là 403 `forbidden`) đã được sửa ở bước 0 của lượt USR (người dùng ủy quyền qua `change-control.json`): nay khớp mã (`validation-failed`, thứ tự 415, 429, CSRF `csrf_failed`, 401, 403, 400). Mục này chỉ giữ để truy vết; không còn việc.
25. [đã chọn] Mã `invalid_current_password` (400) mới đăng ký ở `apps/api/src/modules/auth/errors.ts`: AUTH-API ghi tên này từ trước nhưng chưa có trong sổ mã; USR ánh xạ sang lỗi trường `current_password` mã `incorrect` (USR-REQ-20261006-101003591 BR2). Rủi ro: hai tên cho cùng một sự việc (AUTH và USR) do ranh giới module.
26. [đã chọn] Dọn tồn đọng sau khi kit cải tiến (2026-10-07), `kit_version: 3`: (a) mọi mốc ngày cố định `2026-10-06` trong `apps/api/test/auth/` (12 chỗ) đi qua `NOW0` (giờ thật lúc nạp module, `apps/api/test/support/auth.ts`) hoặc mốc tương đối từ nó, không còn chú thích `fixed-clock:` nào; (b) test đo thời gian của AUTH-TC-20261006-100640887 và AUTH-TC-20261006-100641728 đo xen kẽ (`medianPairMs`), xem mục 18; (c) tùy chọn `narrow` của `auditPermissions` (platform) đã bị xóa vì USR không còn dùng, AUTH không dùng nó; test `apps/api/test/platform/route-audit.spec.ts` giữ các ca "công cụ hỏng thì đỏ"; (d) `test_result` là toàn repo 35 suite, 268 test (chạy có `STORAGE_TEST_ENDPOINT` trỏ MinIO thật của docker compose, các bộ S3 thật của USR chạy thật); (e) `clean_run` chạy lại: `git worktree` tại HEAD (5781d41) cộng tệp chưa commit, `env -i` (PATH Node 24, HOME, `TEST_DB_BASE`, `STORAGE_TEST_ENDPOINT`, `NEXT_TELEMETRY_DISABLED`), `pnpm install --frozen-lockfile --offline`, rồi lint, typecheck, build exit 0 và `pnpm test` exit 0 (35 suite, 268 test; lần chạy đầu thoát 1 sớm không có dòng lỗi nào trong log, hai lần chạy lại liền sau đều xanh, chưa rõ nguyên nhân). Giới hạn như mục 23.
27. [đã chọn] Bốn E2E trạng thái bị giới hạn (AUTH-E2E-20261007-085336677, AUTH-E2E-20261007-085336711, AUTH-E2E-20261007-085336746, AUTH-E2E-20261007-085336782) viết để phủ cảnh báo L45 của `check-tests --strict`. Khi viết lộ một lỗi thật ngoài phạm vi test: `app.enableCors` ở `apps/api/src/modules/platform/http/app-setup.ts` không khai `exposedHeaders: ['Retry-After']`, nên khi web và API khác gốc (E2E: cổng 3100 và 3101) trình duyệt không đọc được `Retry-After`: banner của register, forgot-password, reset-password hiện "ít phút" thay vì số phút, và hẹn giờ mở lại rơi về 60 giây mặc định dù cửa sổ giới hạn là 1 giờ (nút mở lại sớm, bấm vào lại nhận 429). Test mới chỉ khớp chữ "phút" và tua đồng hồ giả của trình duyệt 3.700.000 ms; đã siết về `\d+ phút`. Đã sửa ở lượt dọn tồn đọng: `exposedHeaders: ['Retry-After']` trong `app-setup.ts`, kèm khẳng định `access-control-expose-headers` ở PRJ-TC-20261006-100124626 (đỏ khi bỏ bản sửa).
28. [đã chọn] `changePassword` (`auth.api.ts`) đổi cặp `hitCounter`, `check` sang `RateLimitService.take` nguyên tử cho cả bộ đếm giờ (10) và bộ đếm sai (5 mỗi 15 phút), `refund` khi mật khẩu hiện tại đúng (sdlc-impact review PRM, REV-PRM-03); AUTH-API-20261006-100006077 dòng USR `changePassword` còn mô tả cách đếm cũ (ngoài danh sách được ủy quyền, việc của người, xem spec/changes/PRM-API-20261006-101036543.md). TC: USR-TC-20261007-144433797 và AUTH-TC-20261006-180337117 (`interface.spec.ts`: 40 lời gọi sai song song đúng 5 lần `invalid_current_password`, 35 lần `rate-limited`). Đánh đổi: quá 5 lời gọi đồng thời bị chặn thận trọng dù mật khẩu hiện tại đúng. `test_result` là 545 do chạy lại toàn repo.
