import { spawn } from 'node:child_process';
import type { EventEnvelope } from '../../src/modules/platform';
import { AuditService } from '../../src/modules/platform';
import { ORIGIN } from '../support/app';
import { API_DIR, testDbUrl, truncateAll } from '../support/db';
import { auditOf, call, count, createPrdApp, outbox, productRow, seedCategory, seedProduct, who, type PrdApp, type Who } from '../support/prd';

describe('PRD công bố, ngừng bán và event qua outbox (PRD-REQ-20261006-095502613, ...634)', () => {
  let t: PrdApp;
  let admin: Who, admin2: Who, staff: Who, cat: string;
  beforeAll(async () => { t = await createPrdApp(); });
  afterAll(() => t.close());
  beforeEach(async () => {
    await truncateAll(t.prisma); t.fake.reset();
    [admin, admin2, staff] = [await who(t, 'admin'), await who(t, 'admin', 'admin2@shop.vn'), await who(t, 'staff')];
    cat = await seedCategory(t, 'Áo');
  });
  const publish = (id: string, cookie: string | null = admin.cookie, o: { origin?: string | null } = {}) => call(t, 'post', `/admin/products/${id}/publish`, { cookie: cookie ?? undefined, ...o });
  const archive = (id: string, cookie: string | null = admin.cookie, o: { origin?: string | null } = {}) => call(t, 'post', `/admin/products/${id}/archive`, { cookie: cookie ?? undefined, ...o });
  /** Consumer giả của INV và CRT: đếm số lần xử lý theo event_id (relay phát at-least-once). */
  const consumers = () => {
    const seen = { INV: [] as EventEnvelope[], CRT: [] as EventEnvelope[] };
    for (const [name, types] of [['INV', ['ProductActivated', 'ProductArchived']], ['CRT', ['ProductArchived']]] as const) {
      for (const type of types) t.events.subscribe(`${name}-stub-${Math.random()}`, type, async (_tx, e) => { seen[name].push(e); });
    }
    return seen;
  };
  const relay = async () => { const now = new Date(Date.now() + 10_000); await t.relay.runOnce(now); await t.relay.runOnce(new Date(now.getTime() + 120_000)); };

  it('PRD-TC-20261006-100355739: công bố sản phẩm đủ điều kiện: active, published_at, đúng một ProductActivated (aggregate_id = product_id) cùng giao dịch, hiện ở danh sách công khai, audit', async () => {
    const id = await seedProduct(t, { category: cat, status: 'draft', images: 2 });
    const r = await publish(id);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ id, status: 'active', version: 2 });
    expect(r.body.published_at).toBeTruthy();
    expect((await productRow(t, id)).status).toBe('active');
    const ev = await outbox(t);
    expect(ev.map((e) => [e.type, e.aggregate_id, e.payload])).toEqual([['ProductActivated', id, { product_id: id }]]);
    expect((await call(t, 'get', `/products?category_id=${cat}`)).body.items.map((x: any) => x.id)).toEqual([id]);
    expect((await auditOf(t, 'catalog.product.publish')).map((a) => [a.actor_id, a.before, a.after.status])).toEqual([[admin.id, { status: 'draft' }, 'active']]);
    const seen = consumers(); await relay(); // relay phát đúng một lần tới INV giả lập dù chạy hai lượt
    expect(seen.INV.map((e) => e.type)).toEqual(['ProductActivated']);
  });

  it('PRD-TC-20261006-100355762: công bố bị từ chối: thiếu ảnh (422 missing images), đã archived (409), sai quyền (403, 401); không outbox ProductActivated', async () => {
    const noImg = await seedProduct(t, { category: cat, status: 'draft' }), arch = await seedProduct(t, { category: cat, status: 'archived' });
    const r = await publish(noImg);
    expect([r.status, r.body.type, r.body.missing]).toEqual([422, 'urn:ecom:error:product-not-publishable', ['images']]);
    expect((await productRow(t, noImg)).status).toBe('draft');
    const a = await publish(arch);
    expect([a.status, a.body.type]).toEqual([409, 'urn:ecom:error:product-archived']);
    expect((await publish(noImg, staff.cookie)).status).toBe(403);
    expect((await publish(noImg, null)).status).toBe(401);
    expect((await publish('abc')).status).toBe(404);
    expect(await outbox(t, 'ProductActivated')).toHaveLength(0);
    expect(await count(t, 'audit_logs', "action = 'catalog.product.publish'")).toBe(0);
  });

  it('PRD-TC-20261006-100355784: công bố lại bị 409 (không event thứ hai, published_at không đổi); công bố đua với xóa ảnh duy nhất: không bao giờ có sản phẩm active không ảnh (20 lần)', async () => {
    const id = await seedProduct(t, { category: cat, status: 'draft', images: 1 });
    expect((await publish(id)).status).toBe(200);
    const at = (await productRow(t, id)).published_at;
    const again = await publish(id);
    expect([again.status, again.body.type]).toEqual([409, 'urn:ecom:error:conflict']);
    expect((await productRow(t, id)).published_at).toEqual(at);
    expect(await outbox(t, 'ProductActivated')).toHaveLength(1);
    const outcomes = new Set<string>();
    for (let i = 0; i < 20; i++) {
      const p = await seedProduct(t, { category: cat, status: 'draft', images: 1 });
      const img = (await call(t, 'get', `/admin/products/${p}`, { cookie: admin.cookie })).body.images[0].id;
      const [pub, del] = await Promise.all([publish(p), call(t, 'delete', `/admin/products/${p}/images/${img}`, { cookie: admin2.cookie })]);
      if (pub.status === 200) { expect(del.status).toBe(409); outcomes.add('publish-won'); } else { expect([pub.status, del.status]).toEqual([422, 204]); outcomes.add('delete-won'); }
      expect(await count(t, 'products p', `p.id = '${p}' AND p.status = 'active' AND NOT EXISTS (SELECT 1 FROM product_images i WHERE i.product_id = p.id)`)).toBe(0);
    }
    expect(outcomes.size).toBeGreaterThan(0);
  }, 120_000);

  it('PRD-TC-20261006-100355807: ngừng bán sản phẩm đang bán và hủy nháp: cả hai archived, mỗi lần đúng một ProductArchived tới CRT và INV; chi tiết công khai 404, quản trị vẫn thấy; audit', async () => {
    const p1 = await seedProduct(t, { category: cat, status: 'active', images: 1 }), p2 = await seedProduct(t, { category: cat, status: 'draft' });
    const [a, b] = [await archive(p1), await archive(p2)];
    expect([a.status, a.body.status, b.status, b.body.status]).toEqual([200, 'archived', 200, 'archived']);
    expect((await outbox(t, 'ProductArchived')).map((e) => e.aggregate_id).sort()).toEqual([p1, p2].sort());
    expect((await call(t, 'get', `/products/${p1}`)).status).toBe(404);
    expect((await call(t, 'get', `/admin/products/${p1}`, { cookie: admin.cookie })).body.status).toBe('archived');
    expect((await call(t, 'get', '/admin/products?status=archived', { cookie: staff.cookie })).body.total).toBe(2);
    expect(await count(t, 'audit_logs', "action = 'catalog.product.archive'")).toBe(2);
    const audit = await auditOf(t, 'catalog.product.archive'); // trạng thái trước và sau của từng lần (SB-19; review PRD: đột biến bỏ `before` từng lọt)
    expect(audit.map((a) => [a.before.status, a.after.status]).sort()).toEqual([['active', 'archived'], ['draft', 'archived']]);
    const seen = consumers(); await relay();
    expect([seen.INV.length, seen.CRT.length]).toEqual([2, 2]);
  });

  it('PRD-TC-20261006-100355830: ngừng bán bị từ chối: đã archived (409), staff (403), id lạ hoặc "abc" (404), thiếu hay sai Origin (CSRF); không outbox', async () => {
    const p3 = await seedProduct(t, { category: cat, status: 'archived' }), active = await seedProduct(t, { category: cat, status: 'active', images: 1 });
    expect([(await archive(p3)).status, (await archive(p3)).body.type]).toEqual([409, 'urn:ecom:error:product-archived']);
    expect((await archive(active, staff.cookie)).status).toBe(403);
    expect([(await archive('11111111-1111-4111-8111-111111111111')).status, (await archive('abc')).status]).toEqual([404, 404]);
    for (const origin of [null, 'https://evil.example']) {
      const r = await archive(active, admin.cookie, { origin });
      expect([String(origin), r.status, r.body.type]).toEqual([String(origin), 403, 'urn:ecom:error:csrf_failed']);
    }
    expect((await archive(active, admin.cookie, { origin: ORIGIN })).status).toBe(200); // Origin hợp lệ thì qua
    expect(await outbox(t, 'ProductArchived')).toHaveLength(1);
    expect((await productRow(t, p3)).version).toBe(1);
  });

  it('PRD-TC-20261006-100355853: sản phẩm trong giỏ khách: ProductArchived ra outbox một lần cho CRT xử lý, chi tiết công khai 404; hai admin ngừng bán song song: một 200 một 409, một dòng outbox (20 lần)', async () => {
    const id = await seedProduct(t, { category: cat, status: 'active', images: 1 });
    expect((await call(t, 'get', `/products/${id}`)).status).toBe(200);
    expect((await archive(id)).status).toBe(200);
    expect((await call(t, 'get', `/products/${id}`)).status).toBe(404);
    const seen = consumers(); await relay();
    expect(seen.CRT.map((e) => e.aggregate_id)).toEqual([id]);
    for (let i = 0; i < 20; i++) {
      const p = await seedProduct(t, { category: cat, status: 'active', images: 1 });
      const [a, b] = await Promise.all([archive(p), archive(p, admin2.cookie)]);
      expect([a.status, b.status].sort()).toEqual([200, 409]);
      expect((await outbox(t, 'ProductArchived')).filter((e) => e.aggregate_id === p)).toHaveLength(1);
    }
  }, 120_000);

  it('PRD-TC-20261006-120604307: ProductActivated và ProductArchived không mất khi tiến trình chết (SIGKILL) ngay sau commit; relay phát đúng một lần hiệu lực; giao dịch hủy thì không có trạng thái lẫn outbox', async () => {
    const p1 = await seedProduct(t, { category: cat, status: 'draft', images: 1 }), p2 = await seedProduct(t, { category: cat, status: 'active', images: 1 });
    const child = spawn(process.execPath, ['-r', 'ts-node/register/transpile-only', 'test/fixtures/product-then-die.ts'], {
      cwd: API_DIR, env: { PATH: process.env.PATH ?? '', APP_ENV: 'dev', DATABASE_URL: testDbUrl(), CORS_ALLOWED_ORIGINS: ORIGIN, PRD_PUBLISH_ID: p1, PRD_ARCHIVE_ID: p2 }, stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    child.stdout.on('data', (d) => { out += d; });
    const [code, signal] = await new Promise<[number | null, string | null]>((r) => child.on('exit', (c, s) => r([c, s])));
    expect([code, signal]).toEqual([null, 'SIGKILL']);
    expect(out).not.toContain('SURVIVED');
    expect([(await productRow(t, p1)).status, (await productRow(t, p2)).status]).toEqual(['active', 'archived']); // commit đã xong trước khi chết
    const rows = await t.prisma.$queryRaw<{ type: string; aggregate_id: string; dispatched_at: Date | null }[]>`SELECT type, aggregate_id, dispatched_at FROM outbox_events ORDER BY type`;
    expect(rows.map((r) => [r.type, r.aggregate_id, r.dispatched_at])).toEqual([['ProductActivated', p1, null], ['ProductArchived', p2, null]]);
    const seen = consumers(); await relay(); // sau khởi động lại: relay phát mỗi event, kể cả chạy lặp
    expect(seen.INV.map((e) => e.type).sort()).toEqual(['ProductActivated', 'ProductArchived']);
    expect(seen.CRT.map((e) => e.type)).toEqual(['ProductArchived']);
    // giao dịch bị hủy sau khi ghi outbox: sản phẩm vẫn draft và không có dòng outbox
    const p3 = await seedProduct(t, { category: cat, status: 'draft', images: 1 });
    const spy = jest.spyOn(t.app.get(AuditService), 'record').mockRejectedValueOnce(new Error('audit hỏng sau khi ghi outbox'));
    try { expect((await publish(p3)).status).toBe(500); } finally { spy.mockRestore(); }
    expect((await productRow(t, p3)).status).toBe('draft');
    expect((await outbox(t, 'ProductActivated')).filter((e) => e.aggregate_id === p3)).toHaveLength(0);
  }, 90_000);
});
