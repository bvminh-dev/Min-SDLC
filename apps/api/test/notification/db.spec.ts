import { randomUUID } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { API_DIR, truncateAll } from '../support/db';
import { createNtfApp, mkUser, q, seedMail, seedNote, count, type NtfApp } from '../support/ntf';
import { pgCode } from '../support/ord';
import { run } from '../support/sh';

// Lược đồ NTF (NTF-DB-20261006-103815422): enum, CHECK, unique, unique một phần, khóa ngoại, trigger vòng đời, chỉ mục. PostgreSQL thật.
const DB = 'NTF-DB-20261006-103815422';
describe('NTF lược đồ cơ sở dữ liệu', () => {
  let t: NtfApp;
  beforeAll(async () => { t = await createNtfApp(); });
  afterAll(() => t.close());
  beforeEach(async () => { await truncateAll(t.prisma); });
  const enumOf = async (name: string) => (await q<{ e: string }>(t, `SELECT unnest(enum_range(NULL::${name}))::text AS e`)).map((r) => r.e);
  const insertNote = (userId: string, o: Record<string, string | null> = {}) => {
    const v = { type: 'order_created', title: 't', body: 'b', link: 'NULL', data: "'{}'", status: 'unread', read_at: 'NULL', dedupe: `'${randomUUID()}'`, ...o };
    return q(t, `INSERT INTO notifications (user_id, type, title, body, link, data, status, read_at, event_id, dedupe_key) VALUES ('${userId}', '${v.type}', ${v.title === 'NULL' ? 'NULL' : `'${v.title}'`}, '${v.body}', ${v.link}, ${v.data}, '${v.status}', ${v.read_at}, '${randomUUID()}', ${v.dedupe})`);
  };
  const insertMail = (userId: string, o: Record<string, string | number> = {}) => {
    const v = { type: 'order_created', attempts: 0, data: "'{}'", reason: 'NULL', dedupe: `'${randomUUID()}'`, ...o };
    return q(t, `INSERT INTO email_deliveries (user_id, type, attempts, data, delivery_reason, event_id, dedupe_key) VALUES ('${userId}', '${v.type}', ${v.attempts}, ${v.data}, ${v.reason}, '${randomUUID()}', ${v.dedupe})`);
  };

  it(`${DB} NTF-TC-20261006-140547263 Bảng, Trạng thái hợp lệ: enum đúng tập của spec (15 loại thông báo, 12 loại email, hai trạng thái đọc, bốn trạng thái gửi, một kênh in_app)`, async () => {
    expect(await enumOf('notification_type')).toEqual(['order_created', 'order_confirmed', 'payment_succeeded', 'payment_failed', 'order_cancelled', 'refund_succeeded', 'order_shipped', 'shipment_failed', 'order_delivered', 'order_returned', 'order_expired', 'welcome', 'password_changed', 'low_stock', 'refund_failed']);
    expect(await enumOf('email_type')).toEqual(['order_created', 'payment_succeeded', 'order_cancelled', 'refund_succeeded', 'order_shipped', 'shipment_failed', 'order_delivered', 'order_returned', 'password_changed', 'account_locked', 'email_verification', 'password_reset']);
    expect(await enumOf('notification_status')).toEqual(['unread', 'read']);
    expect(await enumOf('email_delivery_status')).toEqual(['pending', 'sent', 'failed', 'skipped']);
    expect(await enumOf('notification_channel')).toEqual(['in_app']);
    expect(await enumOf('email_type')).not.toContain('order_expired'); // OrderExpired chỉ trong ứng dụng, không email
    const cols = await q<{ table_name: string; column_name: string }>(t, `SELECT table_name, column_name FROM information_schema.columns WHERE table_name IN ('notifications', 'email_deliveries')`);
    expect(cols.filter((c) => c.table_name === 'email_deliveries').map((c) => c.column_name).filter((n) => /mail_addr|address|full_name|name|body|content|token|subject|text|html/.test(n))).toEqual([]); // không địa chỉ, họ tên, thân thư, token
    expect(cols.filter((c) => c.table_name === 'notifications').map((c) => c.column_name)).not.toEqual(expect.arrayContaining(['email', 'token']));
  });

  it(`${DB} NTF-TC-20261006-104223060 Bảng: CHECK của notifications (độ dài title và body, link nội bộ, data là đối tượng, khớp status và read_at, độ dài dedupe_key) ở biên`, async () => {
    const u = await mkUser(t);
    const ok = async (o: Record<string, string | null>) => pgCode(insertNote(u.id, o));
    expect([await ok({ title: 'x'.repeat(120) }), await ok({ title: 'x'.repeat(121) }), await ok({ title: '' })]).toEqual(['ok', '23514', '23514']);
    expect([await ok({ body: 'x'.repeat(500) }), await ok({ body: 'x'.repeat(501) }), await ok({ body: '' })]).toEqual(['ok', '23514', '23514']);
    expect([await ok({ link: "'/orders/7K3M9Q2XH4TB'" }), await ok({ link: "'/'" }), await ok({ link: "'//evil.test'" }), await ok({ link: "'https://evil.test'" }), await ok({ link: "'/orders?x=1'" }), await ok({ link: "'/orders/../x'" }), await ok({ link: "'orders'" })]).toEqual(['ok', 'ok', '23514', '23514', '23514', '23514', '23514']);
    // REV-NTF-04: `//` đầu là URL cùng giao thức, host không chấm (`//intranet`, `//2130706433`) cũng bị CHECK từ chối
    for (const bad of ['//intranet', '//2130706433', '///', '//a', '//']) expect([bad, await ok({ link: `'${bad}'` })]).toEqual([bad, '23514']);
    expect((await q<{ conname: string }>(t, `SELECT conname FROM pg_constraint WHERE conrelid = 'notifications'::regclass AND conname LIKE 'notifications_link%' ORDER BY 1`)).map((r) => r.conname)).toEqual(['notifications_link_internal_v2']); // CHECK cũ đã bỏ ở migration mới
    for (const good of ['/orders', '/a/b', '/_x', '/-x', '/admin/inventory']) expect([good, await ok({ link: `'${good}'` })]).toEqual([good, 'ok']);
    expect([await ok({ data: "'[]'" }), await ok({ data: "'\"x\"'" }), await ok({ data: "'null'" })]).toEqual(['23514', '23514', '23514']);
    expect([await ok({ status: 'read', read_at: 'NULL' }), await ok({ status: 'unread', read_at: 'now()' }), await ok({ status: 'read', read_at: 'now()' })]).toEqual(['23514', '23514', 'ok']);
    expect([await ok({ dedupe: `'${'k'.repeat(120)}'` }), await ok({ dedupe: `'${'k'.repeat(121)}'` })]).toEqual(['ok', '23514']);
    expect(await pgCode(q(t, `INSERT INTO notifications (user_id, type, title, body, event_id, dedupe_key, channel) VALUES ('${u.id}', 'order_created', 't', 'b', '${randomUUID()}', 'c1', 'email')`))).toBe('22P02'); // kênh chỉ in_app
  });

  it(`${DB} NTF-TC-20261006-104223184 Bảng: CHECK của email_deliveries (attempts 0 đến 3, độ dài lý do, email bí mật không có data)`, async () => {
    const u = await mkUser(t);
    const ok = (o: Record<string, string | number>) => pgCode(insertMail(u.id, o));
    expect([await ok({ attempts: 3 }), await ok({ attempts: 4 }), await ok({ attempts: -1 })]).toEqual(['ok', '23514', '23514']);
    expect([await ok({ reason: `'${'r'.repeat(50)}'` }), await ok({ reason: `'${'r'.repeat(51)}'` })]).toEqual(['ok', '23514']);
    for (const type of ['email_verification', 'password_reset']) {
      expect([type, await ok({ type, data: "'{}'" }), await ok({ type, data: `'{"token":"T"}'` }), await ok({ type, data: `'{"order_code":"X"}'` })]).toEqual([type, 'ok', '23514', '23514']);
    }
    expect(await ok({ type: 'order_created', data: `'{"order_code":"7K3M9Q2XH4TB","amount":1}'` })).toBe('ok');
    expect(await ok({ data: "'[]'" })).toBe('23514');
  });

  it(`${DB} NTF-TC-20261006-104301655 Bảng: unique (user_id, dedupe_key) và (user_id, type, dedupe_key); unique một phần low_stock và refund_failed chỉ khi chưa đọc; khóa ngoại tới users và ON DELETE CASCADE`, async () => {
    const [u, v] = [await mkUser(t), await mkUser(t)];
    await insertNote(u.id, { dedupe: "'same'" });
    expect([await pgCode(insertNote(u.id, { dedupe: "'same'" })), await pgCode(insertNote(v.id, { dedupe: "'same'" }))]).toEqual(['23505', 'ok']);
    await insertMail(u.id, { dedupe: "'same'" });
    expect([await pgCode(insertMail(u.id, { dedupe: "'same'" })), await pgCode(insertMail(u.id, { dedupe: "'same'", type: 'order_delivered' })), await pgCode(insertMail(v.id, { dedupe: "'same'" }))]).toEqual(['23505', 'ok', 'ok']);
    const P = randomUUID(), R = randomUUID();
    const low = (user: string, status = 'unread', product = P) => insertNote(user, { type: 'low_stock', data: `'{"product_id":"${product}"}'`, status, read_at: status === 'read' ? 'now()' : 'NULL' });
    const refund = (user: string, status = 'unread') => insertNote(user, { type: 'refund_failed', data: `'{"refund_id":"${R}"}'`, status, read_at: status === 'read' ? 'now()' : 'NULL' });
    await low(u.id); await refund(u.id);
    expect([await pgCode(low(u.id)), await pgCode(refund(u.id)), await pgCode(low(v.id)), await pgCode(low(u.id, 'unread', randomUUID())), await pgCode(low(u.id, 'read')), await pgCode(low(u.id, 'read')), await pgCode(refund(u.id, 'read'))]).toEqual(['23505', '23505', 'ok', 'ok', 'ok', 'ok', 'ok']);
    await q(t, `UPDATE notifications SET status = 'read', read_at = now() WHERE user_id = '${u.id}' AND type = 'low_stock' AND data->>'product_id' = '${P}' AND status = 'unread'`);
    expect(await pgCode(low(u.id))).toBe('ok'); // đã đọc thì thông báo mới được tạo
    expect(await pgCode(insertNote(randomUUID()))).toBe('23503'); // user không tồn tại
    expect(await pgCode(insertMail(randomUUID()))).toBe('23503');
    await insertNote(v.id); await insertMail(v.id);
    await q(t, `DELETE FROM sessions WHERE user_id = '${v.id}'`);
    await q(t, `DELETE FROM users WHERE id = '${v.id}'`);
    expect([await count(t, 'notifications', `user_id = '${v.id}'`), await count(t, 'email_deliveries', `user_id = '${v.id}'`)]).toEqual([0, 0]);
  });

  it(`${DB} NTF-TC-20261006-104302461 Giao dịch và khóa 7 (SB-24): trigger vòng đời của thông báo: chỉ unread sang read, read là cuối, nội dung bất biến; email chỉ rời pending một lần`, async () => {
    const u = await mkUser(t);
    const n = await seedNote(t, u.id), done = await seedNote(t, u.id, { status: 'read' });
    expect(await pgCode(q(t, `UPDATE notifications SET status = 'unread', read_at = NULL WHERE id = '${done}'`))).toBe('23000');
    expect(await pgCode(q(t, `UPDATE notifications SET read_at = now() + interval '1 day' WHERE id = '${done}'`))).toBe('23000');
    for (const set of ["title = 'x'", "body = 'x'", "link = '/x'", "data = '{\"a\":1}'", `user_id = '${(await mkUser(t)).id}'`, "type = 'welcome'", "created_at = now()", `event_id = '${randomUUID()}'`, "dedupe_key = 'z'"]) {
      expect([set, await pgCode(q(t, `UPDATE notifications SET ${set} WHERE id = '${n}'`))]).toEqual([set, '23000']);
    }
    expect(await pgCode(q(t, `UPDATE notifications SET status = 'read', read_at = now(), updated_at = now() WHERE id = '${n}'`))).toBe('ok');
    const m = await seedMail(t, u.id), sent = await seedMail(t, u.id, { status: 'sent' });
    expect(await pgCode(q(t, `UPDATE email_deliveries SET attempts = 1, next_attempt_at = now() WHERE id = '${m}'`))).toBe('ok'); // thuê dòng và thử lại vẫn ở pending
    for (const set of ["delivery_status = 'failed'", "attempts = 2", "delivery_reason = 'x'"]) expect([set, await pgCode(q(t, `UPDATE email_deliveries SET ${set} WHERE id = '${sent}'`))]).toEqual([set, '23000']);
    for (const set of ["type = 'order_delivered'", "data = '{\"a\":1}'", "dedupe_key = 'z'", `user_id = '${(await mkUser(t)).id}'`]) expect([set, await pgCode(q(t, `UPDATE email_deliveries SET ${set} WHERE id = '${m}'`))]).toEqual([set, '23000']);
    expect(await pgCode(q(t, `UPDATE email_deliveries SET delivery_status = 'sent', sent_at = now() WHERE id = '${m}'`))).toBe('ok');
    expect(await pgCode(q(t, `UPDATE email_deliveries SET delivery_status = 'pending' WHERE id = '${m}'`))).toBe('23000');
  });

  it(`${DB} NTF-TC-20261006-104302787 Bảng (chỉ mục): có chỉ mục lịch sử, đếm chưa đọc một phần, gửi email một phần, hạn mức, hạn lưu; câu danh sách và đếm dùng chỉ mục (không quét tuần tự)`, async () => {
    const defs = (await q<{ indexdef: string }>(t, `SELECT indexdef FROM pg_indexes WHERE tablename IN ('notifications', 'email_deliveries')`)).map((r) => r.indexdef);
    const has = (re: RegExp) => defs.some((d) => re.test(d));
    expect([has(/\(user_id, created_at DESC, id DESC\)/), has(/\(user_id\) WHERE \(status = 'unread'/), has(/\(next_attempt_at, id\) WHERE .*pending.*next_attempt_at IS NOT NULL/), has(/\(user_id, sent_at DESC\) WHERE \(delivery_status = 'sent'/), has(/ON public\.notifications USING btree \(created_at\)/), has(/ON public\.email_deliveries USING btree \(created_at\)/)]).toEqual([true, true, true, true, true, true]);
    const u = await mkUser(t);
    const others: string[] = [];
    for (let i = 0; i < 40; i++) others.push((await mkUser(t)).id);
    // 300 dòng của u và 20.000 dòng của 40 người khác: chọn lọc theo user_id đủ để bộ lập kế hoạch dùng chỉ mục (user_id, created_at DESC, id DESC)
    await q(t, `INSERT INTO notifications (user_id, type, title, body, event_id, dedupe_key, created_at, status, read_at) SELECT '${u.id}', 'order_created', 't', 'b', gen_random_uuid(), 'k' || g, now() - (g || ' minutes')::interval, CASE WHEN g % 3 = 0 THEN 'unread'::notification_status ELSE 'read'::notification_status END, CASE WHEN g % 3 = 0 THEN NULL ELSE now() END FROM generate_series(1, 300) g`);
    await q(t, `INSERT INTO notifications (user_id, type, title, body, event_id, dedupe_key, created_at) SELECT (ARRAY['${others.join("','")}'])[1 + g % 40]::uuid, 'order_created', 't', 'b', gen_random_uuid(), 'k' || g, now() - (g || ' seconds')::interval FROM generate_series(1, 20000) g`);
    await q(t, 'ANALYZE notifications');
    const plan = async (sql: string) => (await q<{ 'QUERY PLAN': string }>(t, `EXPLAIN ${sql}`)).map((r) => r['QUERY PLAN']).join('\n');
    expect(await plan(`SELECT id FROM notifications WHERE user_id = '${u.id}' AND created_at > now() - interval '180 days' ORDER BY created_at DESC, id DESC LIMIT 20`)).toMatch(/notifications_user_id_created_at_id_idx/);
    expect(await plan(`SELECT count(*) FROM notifications WHERE user_id = '${u.id}' AND status = 'unread' AND created_at > now() - interval '180 days'`)).toMatch(/notifications_(unread|user_id_created_at_id)_idx/); // đếm chưa đọc dùng chỉ mục một phần hoặc chỉ mục lịch sử, không quét cả bảng
    expect(await plan(`SELECT id FROM email_deliveries WHERE delivery_status = 'pending' AND next_attempt_at <= now() ORDER BY next_attempt_at, id LIMIT 50`)).toMatch(/email_deliveries_due_idx/);
  });

  it(`${DB} Migration 2 đến 4: migration là một tệp mới, tương thích ngược (không DROP, không thu hẹp), có dòng rollback; schema Prisma khớp migration`, () => {
    const dir = resolve(API_DIR, 'prisma/migrations/20261009000300_notification_tables');
    const file = resolve(dir, 'migration.sql');
    const sql = readFileSync(file, 'utf8');
    expect(sql).toMatch(/Rollback/);
    expect(run(process.execPath, [resolve(API_DIR, 'scripts/check-migration-compat.mjs'), '--files', file]).status).toBe(0);
    expect(sql).not.toMatch(/CREATE TABLE "processed_events"/); // không tạo processed_events (bảng của platform)
    expect(sql.match(/CREATE TABLE "(\w+)"/g)).toEqual(['CREATE TABLE "notifications"', 'CREATE TABLE "email_deliveries"']);
    expect(sql.match(/CREATE TYPE "(\w+)"/g)).toHaveLength(5);
  });

  it(`${DB} NTF-TC-20261006-104223060 Migration đổi CHECK link (REV-NTF-04): migration MỚI (migration cũ không sửa), thêm CHECK chặt hơn rồi bỏ CHECK cũ có dòng contract-step, tương thích ngược theo check-migration-compat`, () => {
    const file = resolve(API_DIR, 'prisma/migrations/20261013000300_notification_link_hardening/migration.sql');
    const sql = readFileSync(file, 'utf8');
    expect(sql).toMatch(/Rollback/);
    expect(sql).toMatch(/^-- contract-step: 20261009000300_notification_tables$/m);
    expect(sql.match(/DROP CONSTRAINT "(\w+)"/g)).toEqual(['DROP CONSTRAINT "notifications_link_internal"']); // chỉ bỏ đúng CHECK cũ của link
    expect(sql.indexOf('ADD CONSTRAINT "notifications_link_internal_v2"')).toBeGreaterThan(-1);
    expect(sql.indexOf('ADD CONSTRAINT')).toBeLessThan(sql.indexOf('DROP CONSTRAINT')); // thêm trước, bỏ sau: không có khoảng trống không kiểm
    expect(run(process.execPath, [resolve(API_DIR, 'scripts/check-migration-compat.mjs'), '--files', file]).status).toBe(0);
    // bỏ dòng contract-step thì check-migration-compat đỏ (cổng có tác dụng với tệp này)
    const dir = mkdtempSync(join(tmpdir(), 'ntf-mig-'));
    try {
      const bare = join(dir, 'migration.sql');
      writeFileSync(bare, sql.replace(/^-- contract-step:.*$/m, '-- (bỏ)'));
      expect(run(process.execPath, [resolve(API_DIR, 'scripts/check-migration-compat.mjs'), '--files', bare]).status).toBe(1);
    } finally { rmSync(dir, { recursive: true, force: true }); }
    expect(readFileSync(resolve(API_DIR, 'prisma/migrations/20261009000300_notification_tables/migration.sql'), 'utf8')).toMatch(/link ~ '\^\/\[A-Za-z0-9\/_-\]\*\$'/); // migration cũ giữ nguyên chữ (đã áp dụng)
  });
});
