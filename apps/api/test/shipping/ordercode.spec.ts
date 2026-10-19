import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Prisma } from '@prisma/client';
import { OrderApi } from '../../src/modules/order';
import { EventsService, OutboxRelay } from './relay-helpers';
import { API_DIR, truncateAll } from '../support/db';
import { call, createShpApp, pgCode, q, seedMethod, seedOrderFor, seedShipment, who, type ShpApp } from '../support/shp';

// Cột `shipments.order_code` và `created_by` (SHP-DB, quyết định sau review SHP: bản chụp bất biến của mã đơn lúc tạo vận đơn, bỏ N+1 của danh sách): ghi lúc tạo, danh sách đọc từ cột và không gọi ORD,
// đúng khuôn, bất biến, backfill cho vận đơn có sẵn.
const SEC = 'SHP-SEC-20261006-101603066';
const MIGRATION = join(API_DIR, 'prisma/migrations/20261008000100_shipping_order_code/migration.sql');

describe('SHP cột order_code của vận đơn', () => {
  let t: ShpApp;
  beforeAll(async () => { t = await createShpApp(); });
  afterAll(() => t.close());
  beforeEach(async () => { await truncateAll(t.prisma); t.logs.clear(); t.clock.set(new Date(Math.floor(Date.now() / 1000) * 1000)); t.clock.advance(61_000); jest.restoreAllMocks(); });

  it(`SHP-TC-20261008-091406341 SHP-TC-20261006-102134039 ${SEC} T17: vận đơn tạo từ OrderPaid ghi order_code bằng mã đơn; danh sách 100 vận đơn đọc order_code từ cột, KHÔNG gọi OrderApi lần nào, đúng 100 mã duy nhất trong dưới 3 giây; bộ lọc theo mã đơn vẫn đúng`, async () => {
    const s1 = await who(t, 'staff', 's1@shop.vn');
    const m = await seedMethod(t);
    const o1 = await seedOrderFor(t, { status: 'paid', shippingMethod: m });
    await t.tx.run((tx) => t.app.get(EventsService).publish(tx, { type: 'OrderPaid', aggregate_type: 'order', aggregate_id: o1.id, payload: { order_id: o1.id } }));
    const run = await t.app.get(OutboxRelay).runOnce(new Date(Date.now() + 1000));
    expect([run.picked, run.dispatched, run.failed]).toEqual([1, 1, 0]);
    const own = await q<{ order_code: string | null }>(t, `SELECT order_code FROM shipments WHERE order_id = '${o1.id}'`);
    expect(own).toEqual([{ order_code: o1.code }]); // ghi lúc tạo vận đơn, đúng mã của ORD

    for (let i = 0; i < 99; i++) await seedShipment(t, { status: 'pending', method: m, createdAt: new Date(Date.now() - (i + 1) * 60_000) });
    const spies = (['getSummary', 'findByCode', 'findForShipment', 'findOwned', 'getRecipient', 'lockForHandoff'] as const).map((fn) => jest.spyOn(t.app.get(OrderApi), fn));
    const t0 = Date.now();
    const r = await call(t, 'get', '/shipping/shipments?limit=100&sort=newest', { cookie: s1.cookie });
    const ms = Date.now() - t0;
    expect(r.status).toBe(200);
    expect(r.body.items).toHaveLength(100);
    const expected = new Map((await q<{ order_code: string; code: string }>(t, `SELECT s.order_code, o.code FROM shipments s JOIN orders o ON o.id = s.order_id`)).map((x) => [x.code, x.order_code]));
    expect(r.body.items.every((x: { order_code: string }) => /^[0-9A-Z]{12}$/.test(x.order_code) && expected.get(x.order_code) === x.order_code)).toBe(true); // mã trả về chính là cột và khớp mã đơn
    expect(new Set(r.body.items.map((x: { order_code: string }) => x.order_code)).size).toBe(100);
    expect(r.body.items[0].order_code).toBe(o1.code); // mới nhất trước: vận đơn tạo từ event (đồng hồ ứng dụng) mới hơn các vận đơn dựng sẵn
    for (const s of spies) expect(s).not.toHaveBeenCalled();
    expect(ms).toBeLessThan(3000);

    const one = await call(t, 'get', `/shipping/shipments?order_code=${o1.code.toLowerCase()}`, { cookie: s1.cookie });
    expect([one.status, one.body.total, one.body.items.map((x: { order_code: string }) => x.order_code)]).toEqual([200, 1, [o1.code]]);
  }, 120_000);

  it(`SHP-TC-20261008-091406444 ${SEC}: câu backfill của migration điền mã đơn cho vận đơn có sẵn (không chạm dòng đã có mã, chạy lại không đổi gì); CHECK khuôn mã đơn; order_code bất biến`, async () => {
    const m = await seedMethod(t);
    const a = await seedShipment(t, { status: 'pending', method: m, legacyNoOrderCode: true });
    const b = await seedShipment(t, { status: 'shipped', method: m, legacyNoOrderCode: true });
    const c = await seedOrderFor(t, { status: 'paid', shippingMethod: m });
    expect(await pgCode(q(t, `INSERT INTO shipments (order_id, order_code, shipping_method_id) VALUES ('${c.id}', 'ZZZZZZZZZZZZ', '${m}')`))).toBe('ok'); // đã có mã, khác mã đơn
    const code = (id: string) => q<{ order_code: string | null }>(t, `SELECT order_code FROM shipments WHERE id = '${id}'`).then((r) => r[0].order_code);
    expect([await code(a.id), await code(b.id)]).toEqual([null, null]);

    const backfill = readFileSync(MIGRATION, 'utf8').match(/^UPDATE "shipments"[^;]*;/m)?.[0];
    expect(backfill).toBeDefined();
    expect(await t.prisma.$executeRaw(Prisma.raw(backfill as string))).toBe(2); // chỉ hai dòng rỗng
    expect([await code(a.id), await code(b.id)]).toEqual([a.order.code, b.order.code]);
    expect((await q<{ order_code: string }>(t, `SELECT order_code FROM shipments WHERE order_id = '${c.id}'`))[0].order_code).toBe('ZZZZZZZZZZZZ'); // dòng đã có mã không đổi
    expect(await t.prisma.$executeRaw(Prisma.raw(backfill as string))).toBe(0); // chạy lại không đổi dòng nào

    // CHECK khuôn mã đơn của ORD (12 ký tự Crockford hoa, bỏ I, L, O, U); NULL qua được ở bước mở rộng
    const ins = (oc: string) => pgCode(q(t, `INSERT INTO shipments (order_id, order_code, shipping_method_id, status) VALUES ('${c.id}', ${oc}, '${m}', 'cancelled')`));
    for (const bad of [`'ABC'`, `'2N6R4T8W0KM'`, `'2N6R4T8W0KMAA'`, `'2n6r4t8w0kma'`, `'2N6R4T8W0KLA'`, `'2N6R4T8W0KUA'`, `''`]) expect([bad, await ins(bad)]).toEqual([bad, '23514']); // shipments_order_code_format
    expect(await ins('NULL')).toBe('ok');
    expect(await ins(`'2N6R4T8W0KMA'`)).toBe('ok');
    // migration 20261015000100_shipping_order_code_hd: nhận thêm mã `HDyymmdd-NNNNN` (ADR-024), vẫn từ chối mã sai khuôn
    for (const bad of [`'HD261015-0001'`, `'HD261015-000001'`, `'HD26101-00001'`, `'hd261015-00001'`, `'HD261015_00001'`, `'XD261015-00001'`, `'HD26101A-00001'`, `'HD261015-0000A'`, `'HD261015-00001X'`]) expect([bad, await ins(bad)]).toEqual([bad, '23514']);
    expect(await ins(`'HD261015-00001'`)).toBe('ok');
    expect(await ins(`'HD991231-99999'`)).toBe('ok');
    // cùng migration: cột created_by (uuid NULL, không FK, không bất biến) và chỉ mục một phần cho danh sách của sale
    expect(await q(t, `SELECT data_type, is_nullable FROM information_schema.columns WHERE table_name = 'shipments' AND column_name = 'created_by'`)).toEqual([{ data_type: 'uuid', is_nullable: 'YES' }]);
    expect(await q(t, `SELECT count(*)::int AS n FROM information_schema.table_constraints WHERE table_name = 'shipments' AND constraint_type = 'FOREIGN KEY' AND constraint_name LIKE '%created_by%'`)).toEqual([{ n: 0 }]);
    const [idx] = await q<{ def: string }>(t, `SELECT indexdef AS def FROM pg_indexes WHERE tablename = 'shipments' AND indexname = 'shipments_created_by_created_at_id_idx'`);
    expect(idx.def).toMatch(/\(created_by, created_at DESC, id DESC\) WHERE \(created_by IS NOT NULL\)/);

    // bất biến
    const upd = (id: string, v: string) => pgCode(q(t, `UPDATE shipments SET order_code = ${v} WHERE id = '${id}'`));
    expect(await upd(a.id, `'2N6R4T8W0KMA'`)).toBe('23000'); // shipments_order_code_immutable
    expect(await upd(a.id, 'NULL')).toBe('23000'); // không xóa được mã
    expect(await code(a.id)).toBe(a.order.code);
    expect(await upd(a.id, `'${a.order.code}'`)).toBe('ok'); // đặt lại đúng giá trị cũ không phải là đổi
    const [fresh] = await q<{ id: string }>(t, `INSERT INTO shipments (order_id, shipping_method_id, status) VALUES ('${c.id}', '${m}', 'cancelled') RETURNING id`);
    expect(await upd(fresh.id, `'2N6R4T8W0KMA'`)).toBe('ok'); // điền lần đầu từ rỗng được
    expect(await upd(fresh.id, `'2N6R4T8W0KNA'`)).toBe('23000');
  });
});
