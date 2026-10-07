#!/usr/bin/env node
// Kiểm đột biến cho USR (sdlc-implement: epic có TC `lỗi` kiểm SEC thay "test fail đúng lý do"): gài một lỗi có chủ ý vào mã, chạy ĐÚNG test của nó,
// kỳ vọng ĐỎ do khẳng định của chính test đó; luôn khôi phục tệp. In bảng cho report.md.
// Dùng: node scripts/mutations-usr.mjs [--only <SB-xx>] [--check]   (chạy từ apps/api; cần `docker compose up -d db`; mục web cần Chromium cho E2E)
//   --check              không chạy test: kiểm CHÍNH bảng đột biến (đoạn cần phá còn tồn tại đúng một lần trong mã, test có thật và chứa ID,
//                        mỗi SB `Kiểm bằng: test` của USR-SEC đều có ít nhất một đột biến). Đỏ khi bảng lỗi thời hoặc không đọc được USR-SEC.
//   --print              in bảng ra JSON (test của công cụ dùng)
//   --file <json>        dùng bảng khác (test của chính công cụ này); --sec <md> dùng tài liệu SEC khác.
// Kết quả: `bắt` = test đỏ VÀ đầu ra có dòng thất bại của đúng ID; `lọt` = test xanh; `hỏng` = đỏ nhưng không do khẳng định của ID (lỗi biên dịch, test không chạy)
// và KHÔNG tính là bắt (L47). Thoát 1 nếu còn `lọt` hoặc `hỏng`.
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const api = resolve(import.meta.dirname, '..');
const repo = resolve(api, '../..');
const U = 'src/modules/user';
const J = (file) => ({ file });
const E2E = J('test/e2e/usr.e2e.spec.ts');

/** edits: [{ file, from, to, all? }]; test: nơi chạy; id: ID TC lọc bằng -t; retries: số lần thử khi lỗi chạy đua (đột biến về tranh chấp). */
export const MUTATIONS = [
  { sb: 'SB-01', what: 'lỗi đổi mật khẩu lặp lại mật khẩu hiện tại của client trong phản hồi', edits: [{ file: `${U}/user.service.ts`, from: "errors: [{ field: 'current_password', code: 'incorrect' }] });", to: "errors: [{ field: 'current_password', code: 'incorrect' }], detail: b.current_password });" }], test: J('test/user/password.spec.ts'), id: 'USR-TC-20261006-102053472' },
  { sb: 'SB-03', what: 'đổi mật khẩu không đặt cookie phiên mới (người dùng bị đăng xuất khỏi thiết bị đang đổi)', edits: [{ file: `${U}/user.service.ts`, from: 'setSessionCookie(res, r.new_session.token);', to: '' }], test: J('test/user/password.spec.ts'), id: 'USR-TC-20261006-102053373' },
  { sb: 'SB-03', what: 'phản hồi đổi mật khẩu báo sai số phiên khác bị thu hồi', edits: [{ file: `${U}/user.service.ts`, from: 'revoked_sessions: r.revoked_others', to: 'revoked_sessions: 0' }], test: J('test/user/password.spec.ts'), id: 'USR-TC-20261006-102053373' },
  { sb: 'SB-03', what: 'mật khẩu hiện tại sai trả 401 thay vì lỗi theo trường 400', edits: [{ file: `${U}/user.service.ts`, from: "throw new DomainError('validation-failed', { errors: [{ field: 'current_password', code: 'incorrect' }] });", to: "throw new DomainError('unauthenticated');" }], test: J('test/user/password.spec.ts'), id: 'USR-TC-20261006-102053397' },
  { sb: 'SB-04', what: 'cookie phiên mới không Secure', edits: [{ file: 'src/modules/auth/session.http.ts', from: 'httpOnly: true, secure: true,', to: 'httpOnly: true, secure: false,' }], test: J('test/user/password.spec.ts'), id: 'USR-TC-20261006-102053373' },
  { sb: 'SB-05', what: 'PATCH hồ sơ nhận thêm trường avatar_url (không còn unknown_field)', edits: [{ file: `${U}/policy.ts`, from: 'phone: clearablePhone.optional() });', to: 'phone: clearablePhone.optional(), avatar_url: z.string().optional() });' }], test: J('test/user/profile.spec.ts'), id: 'USR-TC-20261006-102053322' },
  { sb: 'SB-05', what: 'cho trường lạ (role, user_id) lọt qua schema đóng', edits: [{ file: `${U}/policy.ts`, from: "for (const k of Object.keys(o)) if (!known.has(k)) add(k, 'unknown_field');", to: '' }], test: J('test/user/profile.spec.ts'), id: 'USR-TC-20261006-102053322' },
  { sb: 'SB-11', what: 'thêm địa chỉ nhận trường lạ user_id (gán chủ sở hữu)', edits: [{ file: `${U}/policy.ts`, from: "for (const k of Object.keys(o)) if (!known.has(k)) add(k, 'unknown_field');", to: '' }], test: J('test/user/address.spec.ts'), id: 'USR-TC-20261006-102053842' },
  { sb: 'SB-06', what: 'sửa địa chỉ không lọc theo user_id (IDOR)', edits: [{ file: `${U}/address.service.ts`, from: 'FROM addresses WHERE id = ${addressId}::uuid AND user_id = ${userId}::uuid AND deleted_at IS NULL FOR UPDATE`;\n      if (!cur) throw new DomainError(\'not-found\'); // không tồn tại', to: 'FROM addresses WHERE id = ${addressId}::uuid AND deleted_at IS NULL FOR UPDATE`;\n      if (!cur) throw new DomainError(\'not-found\'); // không tồn tại' }], test: J('test/user/address.spec.ts'), id: 'USR-TC-20261006-102053992' },
  { sb: 'SB-06', what: 'xóa địa chỉ không lọc theo user_id (IDOR)', edits: [{ file: `${U}/address.service.ts`, from: 'SELECT is_default FROM addresses WHERE id = ${addressId}::uuid AND user_id = ${userId}::uuid AND deleted_at IS NULL FOR UPDATE', to: 'SELECT is_default FROM addresses WHERE id = ${addressId}::uuid AND deleted_at IS NULL FOR UPDATE' }], test: J('test/user/address.spec.ts'), id: 'USR-TC-20261006-102054124' },
  { sb: 'SB-06', what: 'danh sách địa chỉ không lọc theo user_id (lộ địa chỉ người khác)', edits: [{ file: `${U}/address.service.ts`, from: 'FROM addresses WHERE user_id = ${userId}::uuid AND deleted_at IS NULL ORDER BY is_default DESC, created_at DESC, id DESC`;', to: 'FROM addresses WHERE deleted_at IS NULL ORDER BY is_default DESC, created_at DESC, id DESC`;' }], test: J('test/user/address.spec.ts'), id: 'USR-TC-20261006-102053791' },
  { sb: 'SB-06', what: 'CHK getAddress trả địa chỉ của người khác', edits: [{ file: `${U}/address.service.ts`, from: 'FROM addresses WHERE id = ${addressId}::uuid AND user_id = ${userId}::uuid AND deleted_at IS NULL`;\n    if (!rows[0]) return null;', to: 'FROM addresses WHERE id = ${addressId}::uuid AND deleted_at IS NULL`;\n    if (!rows[0]) return null;' }], test: J('test/user/address.spec.ts'), id: 'USR-TC-20261006-102053791' },
  { sb: 'SB-07', what: 'staff được tra cứu khách theo id (sai ma trận)', edits: [{ file: `${U}/customer.controller.ts`, from: "@Get(':id') @Action(BY_ID) @Roles('admin')", to: "@Get(':id') @Action(BY_ID) @Roles('staff', 'admin')" }], test: J('test/user/lookup.spec.ts'), id: 'USR-TC-20261006-102054545' },
  { sb: 'SB-07', what: 'staff được xem sổ địa chỉ của customer (sai ma trận)', edits: [{ file: `${U}/address.controller.ts`, from: "@Get() @Action('Xem danh sách địa chỉ giao hàng của mình') @Roles('customer')", to: "@Get() @Action('Xem danh sách địa chỉ giao hàng của mình') @Roles('customer', 'staff')" }], test: J('test/user/address.spec.ts'), id: 'USR-TC-20261006-102053767' },
  { sb: 'SB-07', what: 'customer được tra cứu khách theo email (sai ma trận)', edits: [{ file: `${U}/customer.controller.ts`, from: "@Get() @Action(BY_EMAIL) @Roles('staff', 'admin')", to: "@Get() @Action(BY_EMAIL) @Roles('customer', 'staff', 'admin')" }], test: J('test/user/lookup.spec.ts'), id: 'USR-TC-20261006-102054271' },
  { sb: 'SB-08', what: 'staff nhận email không che', edits: [{ file: `${U}/lookup.service.ts`, from: 'email: maskEmail(found.email)', to: 'email: found.email' }], test: J('test/user/lookup.spec.ts'), id: 'USR-TC-20261006-102054198' },
  { sb: 'SB-08', what: 'staff nhận cả địa chỉ khách', edits: [{ file: `${U}/lookup.service.ts`, from: 'if (!full) return { ...base, email: maskEmail(found.email), phone: maskPhone(found.phone) };', to: 'if (!full) return { ...base, email: maskEmail(found.email), phone: maskPhone(found.phone), addresses: await this.addresses.list(found.id) };' }], test: J('test/user/lookup.spec.ts'), id: 'USR-TC-20261006-102054198' },
  { sb: 'SB-08', what: 'tra cứu khớp tiền tố email (ký tự đại diện)', edits: [{ file: `${U}/lookup.service.ts`, from: 'return this.lookup(actor, \'email\', email, () => this.auth.findCustomerByEmail(email));', to: 'return this.lookup(actor, \'email\', email, () => this.auth.findCustomerByEmail(email.replace(/%$/, \'\')));' }], test: J('test/user/lookup.spec.ts'), id: 'USR-TC-20261006-102054322' },
  { sb: 'SB-08', what: 'job dọn giữ địa chỉ xóa mềm 3650 ngày thay vì 30', edits: [{ file: `${U}/config.ts`, from: 'ADDRESS_PURGE_DAYS = 30', to: 'ADDRESS_PURGE_DAYS = 3650' }], test: J('test/user/address.spec.ts'), id: 'USR-TC-20261006-102054173' },
  { sb: 'SB-08', what: 'job dọn xóa cả địa chỉ mới xóa 29 ngày (hạn 1 ngày)', edits: [{ file: `${U}/config.ts`, from: 'ADDRESS_PURGE_DAYS = 30', to: 'ADDRESS_PURGE_DAYS = 1' }], test: J('test/user/address.spec.ts'), id: 'USR-TC-20261006-102054173' },
  { sb: 'SB-08', what: 'danh sách địa chỉ gồm cả địa chỉ đã xóa mềm', edits: [{ file: `${U}/address.service.ts`, from: 'WHERE user_id = ${userId}::uuid AND deleted_at IS NULL ORDER BY is_default DESC, created_at DESC, id DESC`;', to: 'WHERE user_id = ${userId}::uuid ORDER BY is_default DESC, created_at DESC, id DESC`;' }], test: J('test/user/address.spec.ts'), id: 'USR-TC-20261006-102053791' },
  { sb: 'SB-10', what: 'không kiểm magic bytes (mọi tệp coi như JPEG)', edits: [{ file: `${U}/image.ts`, from: "  return null;\n}\n\n/** Tệp cụt", to: "  return 'jpeg';\n}\n\n/** Tệp cụt" }], test: J('test/user/avatar.spec.ts'), id: 'USR-TC-20261006-102053594' },
  { sb: 'SB-10', what: 'giữ metadata (EXIF, GPS) khi mã hóa lại ảnh', edits: [{ file: `${U}/image.ts`, from: '.webp({ quality: 82 })', to: '.keepMetadata().webp({ quality: 82 })' }], test: J('test/user/avatar.spec.ts'), id: 'USR-TC-20261006-102053569' },
  { sb: 'SB-10', what: 'trần dung lượng ảnh 2 MiB thành 20 MiB', edits: [{ file: `${U}/config.ts`, from: 'AVATAR_MAX_BYTES = 2_097_152', to: 'AVATAR_MAX_BYTES = 20_971_520' }], test: J('test/user/avatar.spec.ts'), id: 'USR-TC-20261006-102053618' },
  { sb: 'SB-10', what: 'bỏ kiểm kích thước điểm ảnh từ tiêu đề (bom giải nén)', edits: [{ file: `${U}/image.ts`, from: 'if (meta.width * meta.height > AVATAR_MAX_PIXELS) throw', to: 'if (false as boolean) throw' }], test: J('test/user/avatar.spec.ts'), id: 'USR-TC-20261006-102053618' },
  { sb: 'SB-10', what: 'bỏ kiểm tệp cụt hoặc dữ liệu thừa', edits: [{ file: `${U}/image.ts`, from: 'if (malformedEnd(kind, input)) throw new ImageError(\'corrupt\');', to: '' }], test: J('test/user/avatar.spec.ts'), id: 'USR-TC-20261006-102053618' },
  { sb: 'SB-10', what: 'ảnh cũ không bị xóa khỏi storage khi thay ảnh', edits: [{ file: `${U}/avatar.service.ts`, from: '    await this.removeKeyOf(before.avatar_url);\n    return { avatar_url: url };', to: '    return { avatar_url: url };' }], test: J('test/user/avatar.spec.ts'), id: 'USR-TC-20261006-102053569' },
  { sb: 'SB-10', what: 'job quét ảnh mồ côi xóa cả ảnh còn mới (dưới 24 giờ)', edits: [{ file: `${U}/avatar.service.ts`, from: 'o.lastModified.getTime() > cutoff', to: 'false' }], test: J('test/user/avatar.spec.ts'), id: 'USR-TC-20261006-102053569' },
  { sb: 'SB-10', what: 'job quét ảnh mồ côi xóa cả ảnh đang được tham chiếu', edits: [{ file: `${U}/avatar.service.ts`, from: '!KEY_RE.test(o.key) || inUse.has(o.key) ||', to: '!KEY_RE.test(o.key) ||' }], test: J('test/user/avatar.spec.ts'), id: 'USR-TC-20261006-102053569' },
  { sb: 'SB-10', what: 'lỗi storage làm đổi avatar_url trước khi ghi xong (đảo thứ tự)', edits: [{ file: `${U}/avatar.service.ts`, from: "      await this.storage.put(key, webp, {", to: "      await this.auth.updateProfile(userId, { avatar_url: this.storage.urlFor(key) });\n      await this.storage.put(key, webp, {" }], test: J('test/user/avatar.spec.ts'), id: 'USR-TC-20261006-102053718' },
  { sb: 'SB-12', what: 'cho ký tự điều khiển lọt vào họ tên và địa chỉ', edits: [{ file: `${U}/policy.ts`, from: 'const CONTROL = /[\\u0000-\\u001F\\u007F]/;', to: 'const CONTROL = /a^/;' }], test: J('test/user/profile.spec.ts'), id: 'USR-TC-20261006-102053348' },
  { sb: 'SB-12', what: 'màn tra cứu của admin hiển thị họ tên bằng innerHTML', edits: [{ file: '../web/components/CustomerCard.tsx', from: '<h2 data-testid="usr-customer-lookup-name" style={{ margin: 0 }}>{c.full_name}</h2>', to: '<h2 data-testid="usr-customer-lookup-name" style={{ margin: 0 }} dangerouslySetInnerHTML={{ __html: c.full_name }} />' }], test: E2E, id: 'USR-E2E-20261006-102054475', slow: true },
  { sb: 'SB-13', what: 'bỏ kiểm Origin (CSRF)', edits: [{ file: 'src/modules/platform/http/csrf.guard.ts', from: "if (!origin || !this.allowed.has(origin)) throw new DomainError('csrf_failed');", to: '' }], test: J('test/user/profile.spec.ts'), id: 'USR-TC-20261006-102053322' },
  { sb: 'SB-13', what: 'ngoại lệ multipart áp cho mọi route (không chỉ tải ảnh)', edits: [{ file: 'src/modules/platform/http/multipart.ts', from: "routes.has(`${req.method} ${norm(req.path)}`) && !!req.is('multipart/form-data')", to: "!!req.is('multipart/form-data')" }], test: J('test/user/avatar.spec.ts'), id: 'USR-TC-20261006-102053643' },
  { sb: 'SB-14', what: 'giới hạn tra cứu khách 30 thành 3000 mỗi phút', edits: [{ file: `${U}/http.ts`, from: "lookup: { tier: 'D', limit: 30,", to: "lookup: { tier: 'D', limit: 3000," }], test: J('test/user/lookup.spec.ts'), id: 'USR-TC-20261006-102054297' },
  { sb: 'SB-14', what: 'hai endpoint tra cứu không chung bộ đếm', edits: [{ file: `${U}/http.ts`, from: ", group: 'usr:customer-lookup' }", to: ' }' }], test: J('test/user/lookup.spec.ts'), id: 'USR-TC-20261006-102054297' },
  { sb: 'SB-14', what: 'giới hạn tải ảnh 10 thành 1000 mỗi giờ', edits: [{ file: `${U}/http.ts`, from: 'avatarUpload: { tier: \'B\', limit: 10,', to: 'avatarUpload: { tier: \'B\', limit: 1000,' }], test: J('test/user/avatar.spec.ts'), id: 'USR-TC-20261006-102053694' },
  { sb: 'SB-14', what: 'giới hạn ghi sổ địa chỉ không chung bộ đếm giữa thêm, sửa, xóa', edits: [{ file: `${U}/http.ts`, from: ", group: 'usr:address-write' }", to: ' }' }], test: J('test/user/address.spec.ts'), id: 'USR-TC-20261006-102054595' },
  { sb: 'SB-14', what: 'giới hạn sửa hồ sơ 120 thành 12000 mỗi phút', edits: [{ file: `${U}/http.ts`, from: 'profileWrite: { tier: \'B\', limit: 120,', to: 'profileWrite: { tier: \'B\', limit: 12000,' }], test: J('test/user/profile.spec.ts'), id: 'USR-TC-20261006-102054570' },
  { sb: 'SB-19', what: 'tra cứu không tìm thấy (404) không ghi audit', edits: [{ file: `${U}/lookup.service.ts`, from: '    const found = await find();\n', to: "    const found = await find();\n    if (!found) throw new DomainError('not-found');\n" }], test: J('test/user/lookup.spec.ts'), id: 'USR-TC-20261006-102054247' },
  { sb: 'SB-19', what: 'audit admin ghi nhầm mức masked', edits: [{ file: `${U}/lookup.service.ts`, from: "mask: full ? 'full' : 'masked'", to: "mask: 'masked'" }], test: J('test/user/lookup.spec.ts'), id: 'USR-TC-20261006-102054222' },
  { sb: 'SB-18', what: 'audit ghi email gốc thay vì băm khi không tìm thấy', edits: [{ file: `${U}/lookup.service.ts`, from: 'target_id: found ? found.id : sha256(input)', to: 'target_id: found ? found.id : input' }], test: J('test/user/lookup.spec.ts'), id: 'USR-TC-20261006-102054247' },
  { sb: 'SB-18', what: 'log request ghi cả query (email khách khi tra cứu) thay vì route mẫu', edits: [{ file: 'src/modules/platform/http/app-setup.ts', from: "return typeof p === 'string' ? p.replace(/:(\\w+)/g, '{$1}') : 'unmatched';", to: 'return req.originalUrl;' }], test: J('test/user/lookup.spec.ts'), id: 'USR-TC-20261006-102054198' },
  { sb: 'SB-33', what: 'trần 10 địa chỉ thành 1000', edits: [{ file: `${U}/config.ts`, from: 'ADDRESS_LIMIT = 10', to: 'ADDRESS_LIMIT = 1000' }], test: J('test/user/address.spec.ts'), id: 'USR-TC-20261006-102053842' },
  { sb: 'SB-33', what: 'bỏ khóa tư vấn theo người dùng (đua vượt 10, hai mặc định, xóa đồng thời)', edits: [{ file: `${U}/address.service.ts`, from: 'await this.lock(tx, userId);', to: '', all: true }], test: J('test/user/address.spec.ts'), id: 'USR-TC-20261006-102053892', retries: 4 },
  { sb: 'SB-33', what: 'địa chỉ đầu tiên không tự mặc định', edits: [{ file: `${U}/address.service.ts`, from: 'const isDefault = Number(n) === 0 || b.is_default === true;', to: 'const isDefault = b.is_default === true;' }], test: J('test/user/address.spec.ts'), id: 'USR-TC-20261006-102053816' },
  { sb: 'SB-33', what: 'cho bỏ mặc định của địa chỉ đang mặc định', edits: [{ file: `${U}/address.service.ts`, from: 'if (p.is_default === false && cur.is_default) {', to: 'if (false as boolean) {' }], test: J('test/user/address.spec.ts'), id: 'USR-TC-20261006-102054018' },
  { sb: 'SB-33', what: 'xóa địa chỉ mặc định không chuyển mặc định cho địa chỉ mới nhất', edits: [{ file: `${U}/address.service.ts`, from: 'if (cur.is_default) { // địa chỉ mới tạo nhất', to: 'if (false as boolean) { // địa chỉ mới tạo nhất' }], test: J('test/user/address.spec.ts'), id: 'USR-TC-20261006-102054099' },
  { sb: 'SB-33', what: 'đổi mặc định cũng đổi updated_at (CHK báo nhầm địa chỉ đã đổi)', edits: [{ file: `${U}/address.service.ts`, from: 'updated_at = ${contentChanged ? now : cur.updated_at}::timestamptz', to: 'updated_at = ${now}::timestamptz' }], test: J('test/user/address.spec.ts'), id: 'USR-TC-20261006-102053968' },
  { sb: 'SB-33', what: 'thêm địa chỉ is_default không bỏ mặc định cũ', edits: [{ file: `${U}/address.service.ts`, from: 'if (isDefault) await tx.$executeRaw`UPDATE addresses SET is_default = false', to: 'if (false as boolean) await tx.$executeRaw`UPDATE addresses SET is_default = false' }], test: J('test/user/address.spec.ts'), id: 'USR-TC-20261006-102053816' },
];

const arg = (n) => (process.argv.includes(n) ? process.argv[process.argv.indexOf(n) + 1] : null);
const table = arg('--file') ? JSON.parse(readFileSync(resolve(arg('--file')), 'utf8')) : MUTATIONS;

/** SB mà USR-SEC kiểm bằng `test` (đọc từ spec, không ghi cứng): hàng bảng có cột Kiểm bằng chứa từ `test`. Rỗng nghĩa là công cụ hỏng, không phải "không cần". */
export function requiredSbs(secPath) {
  const out = new Set();
  const text = readFileSync(secPath, 'utf8');
  for (const line of text.split(/\r?\n/)) {
    if (!/^\|\s*T\d+\s*\|/.test(line)) continue;
    const c = line.split('|').slice(1, -1).map((x) => x.trim());
    if (c.length < 7 || !/\btest\b/.test(c[6])) continue;
    for (const sb of c[5].match(/SB-\d+/g) ?? []) out.add(sb);
  }
  return out;
}

function checkTable() {
  const problems = [];
  const sec = arg('--sec') ?? (() => {
    const dir = resolve(repo, 'spec/epics/USR/design');
    const f = existsSync(dir) ? readdirSync(dir).find((n) => n.startsWith('USR-SEC-')) : null;
    return f ? resolve(dir, f) : resolve(dir, 'khong-co');
  })();
  let required = new Set();
  try { required = requiredSbs(sec); } catch (e) { problems.push(`không đọc được tài liệu SEC (${sec}): ${e.message}`); }
  if (!required.size) problems.push('không tìm thấy SB nào có Kiểm bằng `test` trong USR-SEC (công cụ không đọc được bảng mối đe dọa): đóng khi hỏng');
  const covered = new Set(table.map((m) => m.sb));
  for (const sb of required) if (!covered.has(sb)) problems.push(`${sb}: SB \`Kiểm bằng: test\` của USR chưa có đột biến nào`);
  const read = (p) => readFileSync(resolve(api, p), 'utf8');
  for (const m of table) {
    const tag = `${m.sb} (${m.what})`;
    const testFile = resolve(api, m.test.file);
    if (!existsSync(testFile)) problems.push(`${tag}: không có tệp test ${m.test.file}`);
    else if (!read(m.test.file).includes(m.id)) problems.push(`${tag}: tệp test ${m.test.file} không chứa ID ${m.id}`);
    for (const e of m.edits) {
      let text;
      try { text = read(e.file); } catch { problems.push(`${tag}: không có tệp ${e.file}`); continue; }
      const n = text.split(e.from).length - 1;
      if (n === 0) problems.push(`${tag}: không thấy đoạn cần phá trong ${e.file}: ${e.from.slice(0, 60)}`);
      else if (n > 1 && !e.all) problems.push(`${tag}: đoạn cần phá xuất hiện ${n} lần trong ${e.file} (mơ hồ), thêm all: true hoặc làm đoạn dài hơn`);
      if (e.to === e.from) problems.push(`${tag}: đột biến không đổi gì`);
    }
  }
  return { problems, required, count: table.length };
}

const run = (m) => {
  const r = spawnSync(process.execPath, ['scripts/run-jest.mjs', m.test.file, '-t', m.id], { cwd: api, encoding: 'utf8', env: { ...process.env, APP_ENV: 'dev' }, timeout: m.slow ? 900_000 : 300_000 });
  const out = `${r.stdout}${r.stderr}`;
  // đỏ do khẳng định của đúng ID: có dòng thất bại `● ... ID` trong đầu ra của Jest
  const failedThisId = new RegExp(`●[^\\n]*${m.id}`).test(out);
  return { red: r.status !== 0, failedThisId };
};

if (process.argv.includes('--print')) { process.stdout.write(JSON.stringify(table)); process.exit(0); } // cho test của chính công cụ này

if (process.argv.includes('--check')) {
  const { problems, required, count } = checkTable();
  if (problems.length) { process.stderr.write(`${problems.join('\n')}\n`); process.exit(1); }
  process.stdout.write(`mutations-usr: ${count} đột biến hợp lệ, phủ ${required.size} SB (${[...required].sort().join(', ')})\n`);
  process.exit(0);
}

const { problems } = checkTable();
if (problems.length) { process.stderr.write(`bảng đột biến lỗi thời, không chạy:\n${problems.join('\n')}\n`); process.exit(1); }
const only = arg('--only');
const rows = [];
for (const m of table.filter((x) => !only || x.sb === only)) {
  const saved = new Map();
  try {
    for (const e of m.edits) {
      const p = resolve(api, e.file);
      const cur = readFileSync(p, 'utf8');
      if (!saved.has(p)) saved.set(p, cur);
      writeFileSync(p, e.all ? cur.split(e.from).join(e.to) : cur.replace(e.from, e.to));
    }
    let res, tries = 0;
    do { res = run(m); tries++; } while (!(res.red && res.failedThisId) && tries < (m.retries ?? 1));
    const result = res.red && res.failedThisId ? `bắt${tries > 1 ? ` (lần thử ${tries})` : ''}` : res.red ? 'hỏng: test đỏ nhưng không do khẳng định của ID (không tính là bắt)' : 'lọt';
    rows.push({ sb: m.sb, what: m.what, test: res.red && res.failedThisId ? m.id : '-', result });
  } catch (err) {
    rows.push({ sb: m.sb, what: m.what, test: '-', result: `hỏng: ${err.message}` });
  } finally {
    for (const [p, text] of saved) writeFileSync(p, text);
  }
}
process.stdout.write('| Chỗ phá | Test đỏ | Kết quả |\n|---|---|---|\n');
for (const r of rows) process.stdout.write(`| ${r.sb}: ${r.what} | ${r.test} | ${r.result} |\n`);
process.exit(rows.some((r) => !r.result.startsWith('bắt')) ? 1 : 0);
