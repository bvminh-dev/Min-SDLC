import { alignWindow, ALL_PATHS, createDshApp, DASH, exportRows, get, hoOrder, paid, q, REPORT, resetSales, saleUser, webOrder, type DshApp, type People } from '../support/dsh';

// Quy tắc chung áp cho 11 endpoint của DSH sau khi thêm hai báo cáo tính lương (DSH-REQ-20261006-105126549 và DSH-REQ-20261015-092608812, DSH-REQ-20261015-092608849): Cache-Control, quyền, hạn mức, audit export.
const SEC = 'DSH-SEC-20261015-092608917';
describe('DSH 11 endpoint: quy tắc chung và audit xuất CSV', () => {
  let t: DshApp;
  let p: People;
  beforeAll(async () => { t = await createDshApp(); });
  afterAll(() => t.close());
  beforeEach(async () => { p = await resetSales(t); });
  const R = '?from=2026-10-01&to=2026-10-05';
  const sales = `${REPORT.sales}${R}`, sources = `${REPORT.sources}${R}`;
  const CSV = [`${sources}&format=csv`, `${sales}&format=csv`];
  const day = (d: number) => new Date(Date.UTC(2026, 9, d, 3));

  it(`DSH-TC-20261015-093302350: mọi phản hồi 200 của cả 11 endpoint (kể cả CSV) có Cache-Control private, no-store, ở lần đọc nguồn lẫn lần từ đệm (${SEC} T19)`, async () => {
    expect(ALL_PATHS).toHaveLength(11);
    await hoOrder(t, await saleUser(t, 'An'), { total: 100_000, at: day(2) });
    for (const path of [...ALL_PATHS, ...CSV]) {
      for (const pass of ['nguồn', 'đệm']) {
        const r = await get(t, p.admin.cookie, path);
        expect([path, pass, r.status, r.headers['cache-control']]).toEqual([path, pass, 200, 'private, no-store']);
        if (path.includes('format=csv')) expect([r.headers['x-content-type-options'], r.headers['content-disposition']]).toEqual(['nosniff', expect.stringMatching(/^attachment; filename="bao-cao-(nguon-don|sale)_\d{4}-\d{2}-\d{2}_\d{4}-\d{2}-\d{2}\.csv"$/)]);
      }
      await q(t, 'TRUNCATE rate_limit_counters'); // 26 yêu cầu của một admin vượt trần 30 mỗi phút nếu không dọn bộ đếm
    }
  });

  it(`DSH-TC-20261015-093302456: sale, staff, customer gọi bất kỳ trong 11 endpoint (gồm hai báo cáo mới và hai CSV) đều 403, không số liệu, không tệp, không nguồn nào được gọi (${SEC} T14)`, async () => {
    const sale = await (await import('../support/prd')).who(t, 'sale', 'sale1@shop.vn');
    const spies = [jest.spyOn(t.ord, 'getSourcesReport'), jest.spyOn(t.ord, 'getSalesReport'), jest.spyOn(t.ord, 'countByStatus'), jest.spyOn(t.pay, 'getRevenue'), jest.spyOn(t.catalog, 'countByStatus'), jest.spyOn(t.usr, 'countCustomers')];
    for (const path of [...ALL_PATHS, ...CSV]) {
      for (const w of [sale, p.staff, p.customer]) {
        const r = await get(t, w.cookie, path);
        expect([path, r.status, r.body.type]).toEqual([path, 403, 'urn:ecom:error:forbidden']);
        expect(r.text).not.toMatch(/items|totals|buckets|gross|Mã nguồn|Người tạo/);
      }
    }
    expect(spies.map((s) => s.mock.calls.length)).toEqual([0, 0, 0, 0, 0, 0]);
    expect(await q(t, "SELECT 1 FROM audit_logs WHERE action LIKE 'dashboard.%'")).toHaveLength(0);
  });

  it('DSH-TC-20261015-093302576: hạn mức 30 yêu cầu mỗi phút dùng chung cho 11 endpoint gồm hai báo cáo mới, 429 kèm Retry-After, bộ đếm nguyên tử', async () => {
    alignWindow(t);
    for (let i = 0; i < 28; i++) expect((await get(t, p.admin.cookie, DASH.products)).status).toBe(200);
    expect((await get(t, p.admin.cookie, sources)).status).toBe(200);
    expect((await get(t, p.admin.cookie, `${sources}&format=csv`)).status).toBe(200);
    // yêu cầu 401 và 403 không làm tăng bộ đếm của admin
    expect((await get(t, undefined, sales)).status).toBe(401);
    expect((await get(t, p.staff.cookie, sales)).status).toBe(403);
    const over = await get(t, p.admin.cookie, sales);
    expect([over.status, over.body.type, over.body.status]).toEqual([429, 'urn:ecom:error:rate-limited', 429]);
    expect(Number(over.headers['retry-after'])).toBeGreaterThanOrEqual(1);
    expect(over.text).not.toMatch(/items|totals/);
    expect(over.headers['content-type']).not.toContain('text/csv');
    t.clock.advance(61_000);
    expect((await get(t, p.admin.cookie, sales)).status).toBe(200);
    t.clock.advance(61_000);
    const rs = await Promise.all(Array.from({ length: 40 }, (_, i) => get(t, p.admin.cookie, i % 2 ? sources : sales)));
    expect([rs.filter((r) => r.status === 200).length, rs.filter((r) => r.status === 429).length]).toEqual([30, 10]);
  });

  it('DSH-TC-20261015-093302708: xuất CSV ghi dashboard.export mỗi lần, không gộp; xem JSON vẫn gộp dashboard.view; yêu cầu bị từ chối không ghi export', async () => {
    await hoOrder(t, await saleUser(t, 'An'), { total: 100_000, at: day(2) });
    t.clock.set(new Date('2026-10-15T03:00:05Z')); // fixed-clock: mốc đồng hồ giả của test, cùng nguồn thời gian với DSH và kho audit
    expect((await get(t, p.admin.cookie, sources)).status).toBe(200);
    t.clock.set(new Date('2026-10-15T03:00:20Z')); // fixed-clock: mốc đồng hồ giả của test, cùng nguồn thời gian với DSH và kho audit
    expect((await get(t, p.admin.cookie, `${sources}&format=csv`)).status).toBe(200);
    t.clock.set(new Date('2026-10-15T03:00:30Z')); // fixed-clock: mốc đồng hồ giả của test, cùng nguồn thời gian với DSH và kho audit
    expect((await get(t, p.admin.cookie, `${sources}&format=csv`)).status).toBe(200);
    const views = await q<{ action: string; created_at: Date }>(t, "SELECT action, created_at FROM audit_logs WHERE action = 'dashboard.view'");
    const ex = await exportRows(t);
    expect([views.length, ex.length]).toEqual([1, 2]);
    expect(ex.map((e) => e.created_at.toISOString())).toEqual(['2026-10-15T03:00:20.000Z', '2026-10-15T03:00:30.000Z']); // fixed-clock: mốc đồng hồ giả của test, cùng nguồn thời gian với DSH và kho audit
    for (const e of ex) expect(e).toMatchObject({ actor_id: p.admin.id, after: { report: 'sources', from: '2026-10-01', to: '2026-10-05', rows: 4 } });
    // 403 (staff), 400 (format=xlsx), 503 (ORD lỗi): không dòng export mới
    expect((await get(t, p.staff.cookie, `${sales}&format=csv`)).status).toBe(403);
    expect((await get(t, p.admin.cookie, `${sales}&format=xlsx`)).status).toBe(400);
    jest.spyOn(t.ord, 'getSalesReport').mockRejectedValue(new Error('boom'));
    expect((await get(t, p.admin.cookie, `${sales}&format=csv`)).status).toBe(503);
    expect(await exportRows(t)).toHaveLength(2);
  });

  it('DSH-TC-20261015-093302793: ghi audit export thất bại không chặn tải tệp, chỉ log error audit-write-failed kèm trace_id, không chứa số liệu hay tên sale', async () => {
    await hoOrder(t, await saleUser(t, 'Nguyễn Bí Mật'), { total: 123_457, at: day(2) });
    await q(t, "CREATE OR REPLACE FUNCTION tmp_fail_export() RETURNS trigger AS $$ BEGIN IF NEW.action = 'dashboard.export' THEN RAISE EXCEPTION 'tmp failure injected'; END IF; RETURN NEW; END; $$ LANGUAGE plpgsql");
    await q(t, 'CREATE TRIGGER tmp_fail_export BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION tmp_fail_export()');
    try {
      const r = await get(t, p.admin.cookie, `${sales}&format=csv`);
      expect([r.status, r.headers['content-type']]).toEqual([200, 'text/csv; charset=utf-8']);
      expect(r.text).toContain('Nguyễn Bí Mật,');
      expect(r.text).toContain(',1,123457\r\n');
    } finally { await q(t, 'DROP TRIGGER IF EXISTS tmp_fail_export ON audit_logs'); await q(t, 'DROP FUNCTION IF EXISTS tmp_fail_export()'); }
    const logs = t.logs.records.filter((l) => l.msg === 'audit-write-failed');
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({ level: 'error', action: 'dashboard.export', trace_id: expect.any(String) });
    expect(logs[0].trace_id).not.toBe('none');
    expect(JSON.stringify(logs[0])).not.toMatch(/123457|Bí Mật/);
  });

  it('DSH-TC-20261015-093302921: báo cáo doanh thu PAY không có chiều nguồn đơn hay người tạo, hai tham số thêm bị 400', async () => {
    await paid(t, new Date('2026-10-02T03:00:00Z'), { amount: 80_000 });
    await hoOrder(t, await saleUser(t, 'An'), { source: 'hotline', total: 80_000, at: day(2) });
    await webOrder(t, { total: 90_000, at: day(2) });
    const pay = jest.spyOn(t.pay, 'getRevenue'), ord = jest.spyOn(t.ord, 'getSalesReport');
    const r = await get(t, p.admin.cookie, `${REPORT.revenue}${R}`);
    expect(r.status).toBe(200);
    expect(r.body).not.toHaveProperty('source');
    expect(r.body).not.toHaveProperty('created_by');
    expect(r.body).not.toHaveProperty('items');
    expect(Object.keys(r.body.by_method).sort()).toEqual(['cod', 'vnpay']);
    expect(pay).toHaveBeenCalled();
    expect(ord).not.toHaveBeenCalled();
    for (const extra of ['source=hotline', 'created_by=11111111-1111-4111-8111-111111111111']) {
      const bad = await get(t, p.admin.cookie, `${REPORT.revenue}${R}&${extra}`);
      expect([extra, bad.status, bad.body.errors[0].reason]).toEqual([extra, 400, 'unknown_parameter']);
    }
  });
});
