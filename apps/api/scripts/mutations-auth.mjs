#!/usr/bin/env node
// Kiểm đột biến cho AUTH (sdlc-implement: khung/ epic có TC `lỗi` kiểm SEC thay "test fail đúng lý do"): gài một lỗi có chủ ý vào mã, chạy
// ĐÚNG test của nó, kỳ vọng ĐỎ; luôn khôi phục tệp. Dòng nào "lọt" (test xanh) thì sửa test. In bảng cho report.md.
// Dùng: node scripts/mutations-auth.mjs [--only <SB-xx>] [--match <chuỗi ID>]   (cần `docker compose up -d db`; chạy từ apps/api)
import { readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const api = resolve(import.meta.dirname, '..');
const A = 'src/modules/auth';
const J = (file) => ({ file });

/** edits: [{ file, from, to, all? }]; test: nơi chạy; id: ID TC lọc bằng -t; retries: số lần thử khi lỗi chạy đua (đột biến về tranh chấp). */
export const MUTATIONS = [
  { sb: 'SB-01', what: 'bỏ băm lại khi tham số argon2id đổi', edits: [{ file: `${A}/auth.service.ts`, from: 'const rehash = needsRehash(user.password_hash, this.argon) ? await hashPassword(input.password, this.argon) : null;', to: 'const rehash = null;' }], test: J('test/auth/login.spec.ts'), id: 'AUTH-TC-20261006-100641333' },
  { sb: 'SB-02', what: 'bỏ băm giả khi email không tồn tại (lộ qua độ trễ)', edits: [{ file: `${A}/auth.service.ts`, from: 'user?.password_hash ?? (await this.dummyHash())', to: "user?.password_hash ?? ''" }], test: J('test/auth/login.spec.ts'), id: 'AUTH-TC-20261006-100641289' },
  { sb: 'SB-02', what: 'ngưỡng khóa tạm 5 thành 6', edits: [{ file: `${A}/config.ts`, from: 'LOGIN_LOCK_THRESHOLD = 5', to: 'LOGIN_LOCK_THRESHOLD = 6' }], test: J('test/auth/login.spec.ts'), id: 'AUTH-TC-20261006-100641289' },
  { sb: 'SB-02', what: 'đăng ký trả lỗi khi email đã có (lộ email)', edits: [{ file: `${A}/auth.service.ts`, from: 'if (!rows.length) return; // email đã có', to: "if (!rows.length) throw new DomainError('conflict'); // email đã có" }], test: J('test/auth/register.spec.ts'), id: 'AUTH-TC-20261006-100640887' },
  { sb: 'SB-02', what: 'quên mật khẩu làm việc tra email TRƯỚC khi trả lời (lộ qua độ trễ)', edits: [{ file: `${A}/auth.controller.ts`, from: 'forgot(@ValidBody() b: { email: string }) {\n    this.auth.forgotPassword(b.email);', to: 'async forgot(@ValidBody() b: { email: string }) {\n    this.auth.forgotPassword(b.email);\n    await this.auth.idle();' }], test: J('test/auth/password.spec.ts'), id: 'AUTH-TC-20261006-100641728' },
  { sb: 'SB-03', what: 'đặt lại mật khẩu không thu hồi mọi phiên', edits: [{ file: `${A}/auth.service.ts`, from: "await revokeAllSessions(this.events, tx, t.user_id, 'password_changed', now);", to: '' }], test: J('test/auth/password.spec.ts'), id: 'AUTH-TC-20261006-100641816' },
  { sb: 'SB-03', what: 'token đặt lại dùng lại được (bỏ điều kiện status issued)', edits: [{ file: `${A}/auth.service.ts`, from: "WHERE t.token_hash = ${tokenHash} AND t.status = 'issued' AND", to: 'WHERE t.token_hash = ${tokenHash} AND' }, { file: `${A}/auth.service.ts`, from: "WHERE token_hash = ${tokenHash} AND status = 'issued' AND expires_at > ${now}::timestamptz RETURNING id", to: 'WHERE token_hash = ${tokenHash} AND expires_at > ${now}::timestamptz RETURNING id' }], test: J('test/auth/password.spec.ts'), id: 'AUTH-TC-20261006-100641859' },
  { sb: 'SB-04', what: 'không thu hồi phiên cũ của request khi đăng nhập (session fixation)', edits: [{ file: `${A}/auth.service.ts`, from: 'if (ctx.cookieToken) {', to: 'if (false as boolean) {' }], test: J('test/auth/login.spec.ts'), id: 'AUTH-TC-20261006-100641333' },
  { sb: 'SB-04', what: 'bỏ giới hạn 10 phiên', edits: [{ file: `${A}/auth.service.ts`, from: 'OFFSET ${this.maxSessions})', to: 'OFFSET ${this.maxSessions + 1000})' }], test: J('test/auth/session.spec.ts'), id: 'AUTH-TC-20261006-100641639' },
  { sb: 'SB-04', what: 'bỏ hạn tuyệt đối 7 ngày (cả kiểm lúc đọc lẫn kẹp hạn trượt vào hạn tuyệt đối; kiểm riêng lẻ là đột biến tương đương vì hạn trượt luôn kẹp và có CHECK ở CSDL)', edits: [{ file: `${A}/session.resolver.ts`, from: "s.status === 'expired' || s.expires_at <= now || s.absolute_expires_at <= now", to: "s.status === 'expired' || s.expires_at <= now" }, { file: `${A}/session.resolver.ts`, from: 'Math.min(now.getTime() + SESSION_IDLE_MS, s.absolute_expires_at.getTime())', to: 'now.getTime() + SESSION_IDLE_MS' }, { file: `${A}/session.store.ts`, from: 'Math.min(now.getTime() + SESSION_IDLE_MS, absolute.getTime())', to: 'now.getTime() + SESSION_IDLE_MS' }], test: J('test/auth/session.spec.ts'), id: 'AUTH-TC-20261006-100641595' },
  { sb: 'SB-04', what: 'cookie phiên không Secure', edits: [{ file: `${A}/auth.controller.ts`, from: 'httpOnly: true, secure: true,', to: 'httpOnly: true, secure: false,' }], test: J('test/auth/login.spec.ts'), id: 'AUTH-TC-20261006-100641243' },
  { sb: 'SB-26', what: 'token xác minh dùng lại được (bỏ điều kiện status issued)', edits: [{ file: `${A}/auth.service.ts`, from: "WHERE token_hash = ${hashToken(token)} AND status = 'issued' AND expires_at > ${now}::timestamptz RETURNING user_id", to: 'WHERE token_hash = ${hashToken(token)} AND expires_at > ${now}::timestamptz RETURNING user_id' }], test: J('test/auth/verify.spec.ts'), id: 'AUTH-TC-20261006-100641021' },
  { sb: 'SB-26', what: 'token xác minh quá hạn vẫn dùng được', edits: [{ file: `${A}/auth.service.ts`, from: "WHERE token_hash = ${hashToken(token)} AND status = 'issued' AND expires_at > ${now}::timestamptz RETURNING user_id", to: "WHERE token_hash = ${hashToken(token)} AND status = 'issued' RETURNING user_id" }], test: J('test/auth/verify.spec.ts'), id: 'AUTH-TC-20261006-100641066' },
  { sb: 'SB-28', what: 'next chấp nhận `//host` (open redirect)', edits: [{ file: '../web/lib/safe-next.ts', from: "if (!raw.startsWith('/') || raw.startsWith('//')) return null;", to: "if (!raw.startsWith('/')) return null;" }], test: J('test/auth/safe-next.spec.ts'), id: 'AUTH-TC-20261006-100641376' },
  { sb: 'SB-29', what: 'bỏ khóa tập admin (hai admin hạ nhau cùng lúc về 0 admin)', edits: [{ file: `${A}/admin.service.ts`, from: 'await this.lockAdmins(tx, actor);', to: '', all: true }], test: J('test/auth/admin.spec.ts'), id: 'AUTH-TC-20261006-100642169', retries: 4 },
  { sb: 'SB-29', what: 'cho admin tự đổi role của mình', edits: [{ file: `${A}/admin.service.ts`, from: "if (id === actor.user_id) throw new DomainError('cannot_change_own_role');", to: '' }], test: J('test/auth/admin.spec.ts'), id: 'AUTH-TC-20261006-100642126' },
  { sb: 'SB-27', what: 'tên event khóa tạm sai (UserLocked thành UserLockedX)', edits: [{ file: `${A}/auth.service.ts`, from: "type: 'UserLocked'", to: "type: 'UserLockedX'" }], test: J('test/auth/login.spec.ts'), id: 'AUTH-TC-20261006-100641333' },
  { sb: 'SB-27', what: 'đăng ký không ghi UserRegistered vào outbox', edits: [{ file: `${A}/auth.service.ts`, from: "await this.events.publish(tx, { type: 'UserRegistered'", to: "if ((0 as number) > 1) await this.events.publish(tx, { type: 'UserRegistered'" }], test: J('test/auth/register.spec.ts'), id: 'AUTH-TC-20261006-100640840' },
  { sb: 'SB-05', what: 'staff được xem danh sách người dùng (sai ma trận)', edits: [{ file: `${A}/auth.controller.ts`, from: "@Get() @Action('Xem danh sách người dùng (lọc, tìm theo email)') @Roles('admin')", to: "@Get() @Action('Xem danh sách người dùng (lọc, tìm theo email)') @Roles('admin', 'staff')" }], test: J('test/auth/admin.spec.ts'), id: 'AUTH-TC-20261006-100642126' },
  { sb: 'SB-05', what: 'endpoint không khai quyền được phép (bỏ mặc định từ chối)', edits: [{ file: 'src/modules/platform/http/session.ts', from: "if (!roles?.length) throw new DomainError('forbidden');", to: 'if (!roles?.length) return true;' }], test: J('test/auth/guard.spec.ts'), id: 'AUTH-TC-20261006-100642038' },
  { sb: 'SB-07', what: 'gửi lại email cho cả staff (lệch ma trận)', edits: [{ file: `${A}/auth.controller.ts`, from: "@Action('Gửi lại email xác minh') @HttpCode(202) @Roles('customer')", to: "@Action('Gửi lại email xác minh') @HttpCode(202) @Roles('customer', 'staff')" }], test: J('test/auth/guard.spec.ts'), id: 'AUTH-TC-20261006-100642038' },
  { sb: 'SB-13', what: 'bỏ kiểm Origin (CSRF)', edits: [{ file: 'src/modules/platform/http/csrf.guard.ts', from: "if (!origin || !this.allowed.has(origin)) throw new DomainError('csrf_failed');", to: '' }], test: J('test/auth/register.spec.ts'), id: 'AUTH-TC-20261006-100640887' },
  { sb: 'SB-14', what: 'giới hạn đăng ký 10 thành 1000 mỗi giờ', edits: [{ file: `${A}/auth.controller.ts`, from: "@Public() @RateLimit({ tier: 'A', limit: 10, windowSeconds: HOUR }) @Validate({ body: registerBody })", to: "@Public() @RateLimit({ tier: 'A', limit: 1000, windowSeconds: HOUR }) @Validate({ body: registerBody })" }], test: J('test/auth/register.spec.ts'), id: 'AUTH-TC-20261006-100640887' },
  { sb: 'SB-11', what: 'cho trường lạ (role) lọt qua schema', edits: [{ file: `${A}/policy.ts`, from: "if (!known.has(k)) add(k, 'unknown_field');", to: '' }], test: J('test/auth/register.spec.ts'), id: 'AUTH-TC-20261006-100640887' },
  { sb: 'SB-11', what: 'tìm tiền tố không escape `_` (ký tự đại diện LIKE)', edits: [{ file: `${A}/admin.service.ts`, from: "replace(/[\\\\%_]/g, '\\\\$&')", to: "replace(/[\\\\]/g, '\\\\$&')" }], test: J('test/auth/admin.spec.ts'), id: 'AUTH-TC-20261006-100642082' },
  { sb: 'SB-18', what: 'ghi token đặt lại vào log', edits: [{ file: `${A}/auth.service.ts`, from: 'const expires = new Date(now.getTime() + RESET_TOKEN_MS);', to: 'const expires = new Date(now.getTime() + RESET_TOKEN_MS); this.log.info(`reset ${token}`);' }], test: J('test/auth/password.spec.ts'), id: 'AUTH-TC-20261006-100641685' },
  { sb: 'SB-19', what: 'đổi role không ghi audit', edits: [{ file: `${A}/admin.service.ts`, from: "await this.audit.record(tx, { actor_id: actor.user_id, actor_role: actor.role, action: 'user.change_role'", to: "if ((0 as number) > 1) await this.audit.record(tx, { actor_id: actor.user_id, actor_role: actor.role, action: 'user.change_role'" }], test: J('test/auth/admin.spec.ts'), id: 'AUTH-TC-20261006-100642082' },
  { sb: 'SB-04', what: 'admin khóa không thu hồi phiên của người bị khóa', edits: [{ file: `${A}/admin.service.ts`, from: "await revokeAllSessions(this.events, tx, id, 'admin_lock', now);", to: '' }], test: J('test/auth/admin.spec.ts'), id: 'AUTH-TC-20261006-100642212' },
  { sb: 'SB-03', what: 'changePassword chỉ thu hồi phiên của request, không thu hồi phiên khác', edits: [{ file: `${A}/auth.api.ts`, from: "WHERE user_id = ${userId}::uuid AND status = 'active' RETURNING id, revoked_reason", to: "WHERE id = ${sid}::uuid AND user_id = ${userId}::uuid AND status = 'active' RETURNING id, revoked_reason" }], test: J('test/auth/interface.spec.ts'), id: 'AUTH-TC-20261006-180336843' },
  { sb: 'SB-03', what: 'changePassword không so khớp băm cũ trong UPDATE (hai lời gọi đồng thời cùng thành công)', edits: [{ file: `${A}/auth.api.ts`, from: " AND password_hash = ${u.password_hash} RETURNING id`;", to: " RETURNING id`;" }], test: J('test/auth/interface.spec.ts'), id: 'AUTH-TC-20261006-180337381' },
  { sb: 'SB-14', what: 'changePassword không đặt bộ đếm sai về 0 khi thành công', edits: [{ file: `${A}/auth.api.ts`, from: "await this.limiter.reset(wrongKey);", to: "" }], test: J('test/auth/interface.spec.ts'), id: 'AUTH-TC-20261006-180336843' },
  { sb: 'SB-14', what: 'changePassword bỏ trần 10 lần gọi mỗi giờ', edits: [{ file: `${A}/auth.api.ts`, from: "await this.limiter.take(callKey, PWCHANGE_CALL_LIMIT, PWCHANGE_CALL_WINDOW_S)", to: "await this.limiter.take(callKey, 1_000_000, PWCHANGE_CALL_WINDOW_S)" }], test: J('test/auth/interface.spec.ts'), id: 'AUTH-TC-20261006-180337117' },
  { sb: 'SB-14', what: 'changePassword không tăng bộ đếm khi mật khẩu hiện tại sai (dò vô hạn)', edits: [{ file: `${A}/auth.api.ts`, from: "if (typeof current !== 'string' || !(await verifyPassword(current, u.password_hash))) throw new DomainError('invalid_current_password');", to: "if (typeof current !== 'string' || !(await verifyPassword(current, u.password_hash))) { await this.limiter.refund(wrongKey, PWCHANGE_WRONG_WINDOW_S); throw new DomainError('invalid_current_password'); }" }], test: J('test/auth/interface.spec.ts'), id: 'AUTH-TC-20261006-180337117' },
  { sb: 'SB-14', what: 'changePassword đếm lần sai không nguyên tử (check rồi mới đếm): 40 lời gọi song song đều qua cổng', edits: [{ file: `${A}/auth.api.ts`, from: "const byWrong = byCalls.allowed ? await this.limiter.take(wrongKey, PWCHANGE_WRONG_LIMIT, PWCHANGE_WRONG_WINDOW_S) : null;", to: "const pre = byCalls.allowed ? await this.limiter.check(wrongKey, PWCHANGE_WRONG_LIMIT, PWCHANGE_WRONG_WINDOW_S) : null; const byWrong = pre?.allowed ? { ...(await this.limiter.take(wrongKey, 1_000_000, PWCHANGE_WRONG_WINDOW_S)), retryAfter: 1 } : null;" }], test: J('test/auth/interface.spec.ts'), id: 'AUTH-TC-20261006-180337117' },
  { sb: 'SB-01', what: 'giao diện USR trả cả password_hash (SELECT *)', edits: [{ file: `${A}/auth.api.ts`, from: "SELECT id, email::text AS email, full_name, phone, avatar_url, role, status,", to: "SELECT *, email::text AS email," }], test: J('test/auth/interface.spec.ts'), id: 'AUTH-TC-20261006-180338166' },
  { sb: 'SB-05', what: 'updateProfile ghi cả role (mass assignment)', edits: [{ file: `${A}/auth.api.ts`, from: "avatar_url = CASE WHEN ${hasAvatar}::boolean THEN ${patch.avatar_url ?? null}::text ELSE avatar_url END,", to: "avatar_url = CASE WHEN ${hasAvatar}::boolean THEN ${patch.avatar_url ?? null}::text ELSE avatar_url END, role = ${(patch as any).role ?? 'customer'}::user_role," }], test: J('test/auth/interface.spec.ts'), id: 'AUTH-TC-20261006-180338166' },
  { sb: 'SB-05', what: 'findCustomerById không lọc role customer', edits: [{ file: `${A}/auth.api.ts`, from: "id = ${id}::uuid AND role = 'customer'", to: "id = ${id}::uuid" }], test: J('test/auth/interface.spec.ts'), id: 'AUTH-TC-20261006-180338166' },
  { sb: 'SB-26', what: 'listActiveUserIdsByRole gồm cả người dùng bị khóa', edits: [{ file: `${A}/auth.api.ts`, from: "WHERE status = 'active' AND role::text", to: "WHERE role::text" }], test: J('test/auth/interface.spec.ts'), id: 'AUTH-TC-20261006-180337643' },
  { sb: 'SB-05', what: 'sale vào được danh sách người dùng của admin (sai ma trận)', edits: [{ file: `${A}/auth.controller.ts`, from: "@Get() @Action('Xem danh sách người dùng (lọc, tìm theo email)') @Roles('admin')", to: "@Get() @Action('Xem danh sách người dùng (lọc, tìm theo email)') @Roles('sale', 'admin')" }], test: J('test/auth/sale.spec.ts'), id: 'AUTH-TC-20261015-092750085' },
  { sb: 'SB-05', what: 'role lạ trong CSDL được cấp admin (guard mở khi không chắc)', edits: [{ file: `${A}/session.resolver.ts`, from: 'return { user_id: s.user_id, role: s.role, email_verified, display_name: s.full_name };', to: "return { user_id: s.user_id, role: (['customer', 'staff', 'sale', 'admin'].includes(s.role) ? s.role : 'admin') as SessionContext['role'], email_verified, display_name: s.full_name };" }], test: J('test/auth/sale.spec.ts'), id: 'AUTH-TC-20261015-092750167' },
  { sb: 'SB-05', what: 'kiểm lệch ma trận bỏ cột sale', edits: [{ file: 'src/modules/platform/http/route-audit.ts', from: "(['admin', 'customer', 'sale', 'staff'] as const)", to: "(['admin', 'customer', 'staff'] as const)" }], test: J('test/auth/sale.spec.ts'), id: 'AUTH-TC-20261015-092750167' },
  { sb: 'SB-29', what: 'đổi role nhận giá trị ngoài bốn role (superuser, system)', edits: [{ file: `${A}/policy.ts`, from: "role: z.enum(['customer', 'staff', 'sale', 'admin'], { errorMap: (i, c)", to: "role: z.string({ errorMap: (i, c)" }], test: J('test/auth/sale.spec.ts'), id: 'AUTH-TC-20261015-092750085' },
  { sb: 'SB-04', what: 'sale không đăng xuất được (bỏ sale khỏi @Roles của logout)', edits: [{ file: `${A}/auth.controller.ts`, from: "@HttpCode(204) @Roles('customer', 'staff', 'sale', 'admin')", to: "@HttpCode(204) @Roles('customer', 'staff', 'admin')" }], test: J('test/auth/sale.spec.ts'), id: 'AUTH-TC-20261015-095530439' },
  { sb: 'SB-04', what: 'phiên của sale không có trên GET /auth/session (bỏ sale khỏi @Roles)', edits: [{ file: `${A}/auth.controller.ts`, from: "@Get('session') @Action('Xem thông tin và hạn của phiên hiện tại') @Roles('customer', 'staff', 'sale', 'admin')", to: "@Get('session') @Action('Xem thông tin và hạn của phiên hiện tại') @Roles('customer', 'staff', 'admin')" }], test: J('test/auth/sale.spec.ts'), id: 'AUTH-TC-20261015-095530480' },
];

const run = (m) => {
  const r = spawnSync(process.execPath, ['scripts/run-jest.mjs', m.test.file, '-t', m.id], { cwd: api, encoding: 'utf8', env: { ...process.env, APP_ENV: 'dev' } });
  const out = `${r.stdout}${r.stderr}`;
  const failed = [...new Set([...out.matchAll(/(AUTH-(?:TC|E2E)-\d{8}-\d{9})/g)].map((x) => x[1]))].filter((id) => new RegExp(`●[^\\n]*${id}|✘[^\\n]*${id}|\\) [^\\n]*${id}`).test(out));
  return { red: r.status !== 0, failed, out };
};

const only = process.argv.includes('--only') ? process.argv[process.argv.indexOf('--only') + 1] : null;
const rows = [];
const match = process.argv.includes('--match') ? process.argv[process.argv.indexOf('--match') + 1] : null; // chỉ đột biến có ID test chứa chuỗi này (ví dụ 20261015: đợt bán hộ)
for (const m of MUTATIONS.filter((x) => (!only || x.sb === only) && (!match || x.id.includes(match)))) {
  const saved = new Map();
  try {
    for (const e of m.edits) {
      const p = resolve(api, e.file);
      const text = saved.get(p) ?? readFileSync(p, 'utf8');
      saved.set(p, saved.get(p) ?? text);
      const cur = readFileSync(p, 'utf8');
      if (!cur.includes(e.from)) throw new Error(`không thấy đoạn cần phá trong ${e.file}: ${e.from.slice(0, 60)}`);
      writeFileSync(p, e.all ? cur.split(e.from).join(e.to) : cur.replace(e.from, e.to));
    }
    let res, tries = 0;
    do { res = run(m); tries++; } while (!res.red && tries < (m.retries ?? 1));
    rows.push({ sb: m.sb, what: m.what, test: res.failed.length ? res.failed.join(', ') : (res.red ? m.id : '-'), result: res.red ? `bắt${tries > 1 ? ` (lần thử ${tries})` : ''}` : 'lọt' });
  } catch (err) {
    rows.push({ sb: m.sb, what: m.what, test: '-', result: `LỖI: ${err.message}` });
  } finally {
    for (const [p, text] of saved) writeFileSync(p, text);
  }
}
process.stdout.write('| SB | Chỗ phá | Test đỏ | Kết quả |\n|---|---|---|---|\n');
for (const r of rows) process.stdout.write(`| ${r.sb} | ${r.what} | ${r.test} | ${r.result} |\n`);
process.exit(rows.some((r) => r.result === 'lọt' || r.result.startsWith('LỖI')) ? 1 : 0);
