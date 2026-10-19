import { addSource, createDshApp, exportRows, get, hoOrder, ict, later, NOW15, parseCsv, q, REPORT, resetSales, saleUser, withTimeout, webOrder, DASH, type DshApp, type People } from '../support/dsh';

// DSH-REQ-20261015-092608812 (báo cáo số đơn và doanh thu theo nguồn đơn, xuất CSV): OrderApi.getSourcesReport thật trên PostgreSQL thật; DSH sắp xếp, cộng totals, dựng CSV từ CÙNG bản đệm với JSON.
const SEC = 'DSH-SEC-20261015-092608917';
describe('DSH báo cáo theo nguồn đơn (DSH-REQ-20261015-092608812)', () => {
  let t: DshApp;
  let p: People;
  let an: string;
  beforeAll(async () => { t = await createDshApp(); });
  afterAll(() => t.close());
  beforeEach(async () => { p = await resetSales(t); an = await saleUser(t, 'An'); });
  const R = '?from=2026-10-01&to=2026-10-05';
  const report = (qs = R, cookie: string | null = p.admin.cookie) => get(t, cookie ?? undefined, `${REPORT.sources}${qs}`);
  const csv = (qs = R, cookie: string | null = p.admin.cookie) => report(`${qs}${qs ? '&' : '?'}format=csv`, cookie);
  const spy = () => jest.spyOn(t.ord, 'getSourcesReport');
  const day = (d: number, h = 3) => new Date(Date.UTC(2026, 9, d, h));
  /** Dữ liệu của luồng chính: ngày 02/10 ba đơn website, hai đơn facebook; 03/10 một đơn hotline; tiktok không đơn. */
  async function seedMain(): Promise<void> {
    await webOrder(t, { total: 100_000, status: 'delivered', at: day(2) });
    await webOrder(t, { total: 200_000, status: 'paid', at: day(2) });
    await webOrder(t, { total: 300_000, status: 'confirmed', at: day(2) });
    await hoOrder(t, an, { source: 'facebook', total: 400_000, status: 'shipped', at: day(2) });
    await hoOrder(t, an, { source: 'facebook', total: 150_000, status: 'pending', at: day(2) });
    await hoOrder(t, an, { source: 'hotline', total: 500_000, status: 'confirmed', at: day(3) });
  }
  const rows = (r: { body: { items: { code: string; orders: number; revenue: number }[] } }) => r.body.items.map((i) => [i.code, i.orders, i.revenue]);

  it('DSH-TC-20261015-093255510: báo cáo theo nguồn trả các nguồn đã sắp, 0 đơn vẫn có dòng, totals đúng', async () => {
    await seedMain();
    const s = spy();
    const r = await report();
    expect(r.status).toBe(200);
    expect(rows(r)).toEqual([['website', 3, 600000], ['facebook', 2, 550000], ['hotline', 1, 500000], ['tiktok', 0, 0]]);
    expect(r.body.totals).toEqual({ orders: 6, revenue: 1650000, excluded_orders: 0 });
    expect([r.body.from, r.body.to, r.body.as_of]).toEqual(['2026-10-01', '2026-10-05', '2026-10-15T03:00:00Z']);
    expect(r.body).not.toHaveProperty('buckets');
    expect(r.body).not.toHaveProperty('granularity');
    expect(r.body.items.reduce((n: number, i: { orders: number }) => n + i.orders, 0)).toBe(r.body.totals.orders);
    expect(Object.keys(r.body.items[0]).sort()).toEqual(['code', 'is_active', 'name', 'orders', 'revenue', 'source_id']); // danh sách trắng trường
    expect(s).toHaveBeenCalledTimes(1);
  });

  it('DSH-TC-20261015-093255763: xuất CSV theo nguồn có BOM, tiêu đề, thứ tự JSON, dòng Tổng, header tải về và một dòng audit export', async () => {
    await seedMain();
    const r = await csv();
    expect(r.status).toBe(200);
    expect(r.headers['content-type']).toBe('text/csv; charset=utf-8');
    expect(r.headers['content-disposition']).toBe('attachment; filename="bao-cao-nguon-don_2026-10-01_2026-10-05.csv"');
    expect(r.headers['cache-control']).toBe('private, no-store');
    expect(r.headers['x-content-type-options']).toBe('nosniff');
    expect(r.text.charCodeAt(0)).toBe(0xfeff); // BOM UTF-8 (EF BB BF)
    expect(r.text.endsWith('\r\n')).toBe(true);
    expect(r.text.replace(/\r\n/g, '').includes('\n')).toBe(false); // mọi kết thúc dòng là CRLF
    expect(parseCsv(r.text)).toEqual([['Mã nguồn', 'Tên nguồn', 'Số đơn', 'Doanh thu'], ['website', 'Website', '3', '600000'], ['facebook', 'Facebook', '2', '550000'], ['hotline', 'Hotline', '1', '500000'], ['tiktok', 'TikTok', '0', '0'], ['Tổng', '', '6', '1650000']]);
    expect(r.text).toContain('\r\nTổng,,6,1650000\r\n');
    const ex = await exportRows(t);
    expect(ex).toHaveLength(1);
    expect(ex[0]).toMatchObject({ actor_id: p.admin.id, actor_role: 'admin', target_type: 'dashboard', after: { report: 'sources', from: '2026-10-01', to: '2026-10-05', rows: 4 } });
    expect(JSON.stringify(ex[0])).not.toMatch(/600000|1650000|Facebook/); // không ghi nội dung số liệu (T17)
  });

  it('DSH-TC-20261015-093255879: sale, staff, customer gọi báo cáo theo nguồn (JSON và CSV) bị 403, không số liệu, không tệp, không audit', async () => {
    await seedMain();
    const sale = await (await import('../support/prd')).who(t, 'sale', 'sale1@shop.vn');
    const s = spy();
    for (const w of [sale, p.staff, p.customer]) {
      for (const r of [await report(R, w.cookie), await csv(R, w.cookie)]) {
        expect([r.status, r.body.type, r.headers['content-type']]).toEqual([403, 'urn:ecom:error:forbidden', expect.stringContaining('problem+json')]);
        expect(r.text).not.toMatch(/items|totals|Mã nguồn/);
      }
    }
    expect(s).not.toHaveBeenCalled();
    expect(await q(t, "SELECT 1 FROM audit_logs WHERE action LIKE 'dashboard.%'")).toHaveLength(0);
  });

  it('DSH-TC-20261015-093255993: chưa đăng nhập hoặc phiên hết hạn gọi báo cáo theo nguồn bị 401, không gọi ORD', async () => {
    const s = spy();
    expect((await report(undefined, null)).status).toBe(401);
    const old = await (await import('../support/auth')).seedSession(t, p.admin.id, { createdAt: new Date(NOW15.getTime() - 45 * 60_000) });
    expect((await report(R, old.cookie)).status).toBe(401);
    expect(s).not.toHaveBeenCalled();
  });

  it('DSH-TC-20261015-093256196: tham số sai của báo cáo theo nguồn đều 400 invalid-parameter, không lặp lại giá trị client, không gọi ORD', async () => {
    const s = spy();
    const cases: [string, string][] = [['?from=2025-10-01&to=2026-10-05', 'range_too_long'], ['?from=2026-10-05&to=2026-10-01', 'from_after_to'], ['?to=2026-10-16', 'after_today'], ['?format=xlsx', 'invalid_value'],
      ['?format=csv&format=csv', 'invalid_value'], ['?from=2026-10-1', 'invalid_format'], ['?granularity=day', 'unknown_parameter']];
    for (const [qs, reason] of cases) {
      const r = await report(qs);
      expect([qs, r.status, r.body.type, r.body.errors[0].reason]).toEqual([qs, 400, 'urn:ecom:error:invalid-parameter', reason]);
      expect(r.text).not.toMatch(/xlsx|granularity=day|2026-10-1\b/);
    }
    expect(s).not.toHaveBeenCalled();
  });

  it('DSH-TC-20261015-093256308: ORD quá hạn: báo cáo theo nguồn (và CSV) 503 nguồn ORD, không tệp, không lưu đệm lỗi, khối khác vẫn 200', async () => {
    withTimeout(t, 300);
    const s = jest.spyOn(t.ord, 'getSourcesReport').mockImplementation(() => later(1500, { items: [], excluded_orders: 0 }));
    for (const r of [await report(), await csv()]) {
      expect([r.status, r.body.type, r.body.source, typeof r.body.trace_id]).toEqual([503, 'urn:ecom:error:dashboard-source-unavailable', 'ORD', 'string']);
      expect(r.text).not.toMatch(/"items"|Mã nguồn/);
      expect(r.headers['content-type']).toContain('problem+json');
    }
    expect((await get(t, p.admin.cookie, DASH.products)).status).toBe(200);
    expect(await exportRows(t)).toHaveLength(0);
    s.mockRestore();
    const again = jest.spyOn(t.ord, 'getSourcesReport');
    expect((await report()).status).toBe(200);
    expect(again).toHaveBeenCalledTimes(1); // 503 không bị lưu đệm
  });

  it('DSH-TC-20261015-093256387: đơn cancelled, expired, returned bị loại khỏi số tính, excluded_orders đếm đúng và theo trạng thái đọc lúc truy vấn', async () => {
    await hoOrder(t, an, { source: 'facebook', total: 100_000, status: 'delivered', at: day(2) });
    const keep = await hoOrder(t, an, { source: 'facebook', total: 200_000, status: 'confirmed', at: day(2) });
    await hoOrder(t, an, { source: 'facebook', total: 999_000, status: 'cancelled', at: day(2) });
    await hoOrder(t, an, { source: 'facebook', total: 888_000, status: 'expired', at: day(2) });
    await hoOrder(t, an, { source: 'facebook', total: 777_000, status: 'returned', at: day(2) });
    const r = await report();
    expect(r.body.items.find((i: { code: string }) => i.code === 'facebook')).toMatchObject({ orders: 2, revenue: 300000 });
    expect([r.body.totals.excluded_orders, r.body.totals.revenue]).toEqual([3, 300000]);
    expect(r.text).not.toMatch(/999000|888000|777000/);
    await q(t, `UPDATE orders SET status = 'cancelled', cancel_reason = 'admin', cancelled_by_role = 'admin' WHERE id = '${keep}'`);
    t.clock.advance(61_000);
    const later1 = await report();
    expect(later1.body.items.find((i: { code: string }) => i.code === 'facebook')).toMatchObject({ orders: 1, revenue: 100000 });
    expect(later1.body.totals.excluded_orders).toBe(4);
  });

  it('DSH-TC-20261015-093256769: đơn khách tự đặt vào dòng website, đơn hộ vào nguồn đã chọn, không đơn nào ở hai dòng', async () => {
    await webOrder(t, { total: 120_000, status: 'paid' });
    await hoOrder(t, an, { source: 'hotline', total: 80_000, status: 'confirmed' });
    const r = await report();
    expect(rows(r)).toEqual([['website', 1, 120000], ['hotline', 1, 80000], ['facebook', 0, 0], ['tiktok', 0, 0]]);
    expect(r.body.totals.orders).toBe(2);
  });

  it('DSH-TC-20261015-093256965: nguồn đã tắt có đơn vẫn hiện, tắt không đơn thì ẩn, đang bật 0 đơn vẫn hiện', async () => {
    await addSource(t, 'zalo', 'Zalo', false);
    await addSource(t, 'youtube', 'YouTube', false);
    await hoOrder(t, an, { source: 'zalo', total: 60_000 });
    await hoOrder(t, an, { source: 'zalo', total: 60_000 });
    const r = await report();
    const by = Object.fromEntries(r.body.items.map((i: { code: string }) => [i.code, i]));
    expect(by.zalo).toMatchObject({ is_active: false, orders: 2, revenue: 120000 });
    expect(by.tiktok).toMatchObject({ is_active: true, orders: 0, revenue: 0 });
    expect(by.youtube).toBeUndefined();
    expect(by.website).toBeDefined();
  });

  it('DSH-TC-20261015-093257392: ngày của đơn theo giờ Việt Nam, 23:30 ngày 05/10 tính, 00:10 ngày 06/10 không tính vào khoảng 05/10; đúng 00:00 là đầu ngày (nửa mở)', async () => {
    await hoOrder(t, an, { source: 'hotline', total: 50_000, at: ict('2026-10-05', '23:30') });
    await hoOrder(t, an, { source: 'hotline', total: 70_000, at: ict('2026-10-06', '00:10') });
    await hoOrder(t, an, { source: 'hotline', total: 80_000, at: ict('2026-10-06', '00:00') }); // đúng mốc `to` của ngày 05/10: thuộc ngày 06/10
    await hoOrder(t, an, { source: 'hotline', total: 90_000, at: ict('2026-10-05', '00:00') }); // đúng mốc `from` của ngày 05/10: thuộc ngày 05/10
    const s = spy();
    const a = await report('?from=2026-10-05&to=2026-10-05');
    expect([a.body.totals.orders, a.body.totals.revenue]).toEqual([2, 140000]);
    expect(s.mock.calls[0][0]).toEqual({ from: new Date('2026-10-04T17:00:00Z'), to: new Date('2026-10-05T17:00:00Z') });
    const b = await report('?from=2026-10-06&to=2026-10-06');
    expect([b.body.totals.orders, b.body.totals.revenue]).toEqual([2, 150000]);
  });

  it('DSH-TC-20261015-093257900: khoảng không có đơn: 200, các nguồn đang bật 0, totals 0 (không phải lỗi, không null)', async () => {
    const all = await report();
    expect(rows(all).map((x) => x[0])).toEqual(['facebook', 'hotline', 'tiktok', 'website']); // cùng doanh thu 0: theo mã tăng dần, không theo thứ tự ORD trả
    await q(t, "ALTER TABLE order_sources DISABLE TRIGGER USER");
    await q(t, "DELETE FROM order_sources WHERE code IN ('tiktok', 'hotline')");
    await q(t, "ALTER TABLE order_sources ENABLE TRIGGER USER");
    t.cache.clear();
    const r = await report();
    expect([r.status, rows(r), r.body.totals]).toEqual([200, [['facebook', 0, 0], ['website', 0, 0]], { orders: 0, revenue: 0, excluded_orders: 0 }]);
  });

  it(`DSH-TC-20261015-093258155: tên nguồn bắt đầu bằng công thức hoặc có dấu phẩy, nháy kép được thoát trong CSV (${SEC} T16)`, async () => {
    const names = ['=HYPERLINK("http://evil","x")', '+84 Hotline', 'Zalo, OA "chính"', '\t@SUM(A1)', '-1+1'];
    for (const [i, n] of names.entries()) { await addSource(t, `src${i}`, n); await hoOrder(t, an, { source: `src${i}`, total: 50_000 + i * 10_000 }); }
    const r = await csv();
    expect(r.status).toBe(200);
    const body = r.text.slice(1);
    expect(body).toContain(`'=HYPERLINK`);
    expect(body).toContain(`,'+84 Hotline,`);
    expect(body).toContain(`,'\t@SUM(A1),`);
    expect(body).toContain(`,'-1+1,`);
    expect(body).toContain('"Zalo, OA ""chính"""'); // bao nháy kép, nháy trong ô nhân đôi
    const cells = parseCsv(r.text).flat();
    expect(cells.filter((c) => /^[=+\-@\t\r]/.test(c))).toEqual([]); // không ô chữ nào bắt đầu bằng ký tự nguy hiểm
    expect(parseCsv(r.text).find((row) => row[0] === 'src2')![1]).toBe('Zalo, OA "chính"');
    expect(parseCsv(r.text).at(-1)).toEqual(['Tổng', '', '5', '350000']); // ô số không bị thêm '
  });

  it('DSH-TC-20261015-093258342: bất biến giữa báo cáo theo nguồn, theo sale và báo cáo đơn cho cùng khoảng, trong cùng bản đệm', async () => {
    await seedMain();
    await webOrder(t, { total: 40_000, status: 'cancelled', at: day(3) });
    await webOrder(t, { total: 41_000, status: 'expired', at: day(3) });
    await hoOrder(t, an, { source: 'tiktok', total: 42_000, status: 'cancelled', at: day(4) });
    await hoOrder(t, an, { source: 'tiktok', total: 43_000, status: 'returned', at: day(4) });
    const a = await report(), b = await get(t, p.admin.cookie, `${REPORT.sales}${R}`), c = await get(t, p.admin.cookie, `${REPORT.orders}${R}`);
    expect(a.body.totals).toEqual({ orders: 6, revenue: 1650000, excluded_orders: 4 });
    expect(b.body.totals).toEqual(a.body.totals);
    expect(c.body.totals.total).toBe(10);
    expect(c.body.totals.total).toBe(a.body.totals.orders + a.body.totals.excluded_orders);
    expect(b.body.items.reduce((n: number, i: { orders: number }) => n + i.orders, 0) + b.body.website.orders).toBe(b.body.totals.orders);
  });

  it('DSH-TC-20261015-093258880: báo cáo theo nguồn dùng bộ nhớ đệm 60 giây, JSON và CSV chung một bản đệm, khóa đệm không chứa format', async () => {
    await hoOrder(t, an, { source: 'hotline', total: 100_000, at: day(3) });
    const s = spy();
    const first = await report();
    t.clock.advance(20_000);
    await hoOrder(t, an, { source: 'hotline', total: 90_000, at: day(3) }); // 10:00:20 đơn mới
    t.clock.advance(10_000);
    const again = await report();
    expect(again.body).toEqual(first.body);
    expect(again.body.as_of).toBe('2026-10-15T03:00:00Z'); // fixed-clock: đồng hồ giả `t.clock` ở NOW15, as_of tính từ đồng hồ này
    expect(s).toHaveBeenCalledTimes(1);
    t.clock.advance(10_000); // 10:00:40
    const file = await csv();
    expect(file.status).toBe(200);
    expect(parseCsv(file.text).find((x) => x[0] === 'hotline')).toEqual(['hotline', 'Hotline', '1', '100000']); // y hệt JSON cũ
    expect(s).toHaveBeenCalledTimes(1);
    expect([...t.cache['entries'].keys()].filter((k: string) => k.startsWith('report-sources'))).toHaveLength(1);
    expect([...t.cache['entries'].keys()].some((k: string) => k.includes('csv'))).toBe(false);
    t.clock.advance(21_000); // 10:01:01
    const fresh = await report();
    expect(s).toHaveBeenCalledTimes(2);
    expect([fresh.body.as_of, fresh.body.totals.orders]).toEqual(['2026-10-15T03:01:01Z', 2]); // fixed-clock: đồng hồ giả `t.clock` ở NOW15, as_of tính từ đồng hồ này
  });

  it(`DSH-TC-20261015-093259275: trần 366 ngày của báo cáo theo nguồn, 366 qua, 367 bị từ chối, khoảng gấp triệu lần bị từ chối nhanh trước khi gọi ORD (${SEC} T18)`, async () => {
    const s = spy();
    expect((await report('?from=2025-10-15&to=2026-10-15')).status).toBe(200); // đúng 366 ngày gồm hai đầu
    s.mockClear();
    const a = await report('?from=2025-10-14&to=2026-10-15');
    expect([a.status, a.body.errors[0].reason]).toEqual([400, 'range_too_long']);
    const t0 = Date.now();
    const b = await report('?from=1970-01-01&to=2026-10-15');
    const c = await report('?from=0001-01-01');
    expect(Date.now() - t0).toBeLessThan(2000);
    expect([b.status, b.body.errors[0].reason, c.status, c.body.errors[0].reason]).toEqual([400, 'range_too_long', 400, 'too_early']);
    expect(s).not.toHaveBeenCalled();
  });

  it('DSH-TC-20261015-093259461: báo cáo theo nguồn chỉ có `to`, chỉ có `from` hoặc không tham số: khoảng mặc định lặp lại trong phản hồi', async () => {
    const got = async (qs: string) => { const r = await report(qs); return [r.status, r.body.from, r.body.to]; };
    expect(await got('?to=2026-10-10')).toEqual([200, '2026-09-11', '2026-10-10']);
    expect(await got('?from=2026-10-01')).toEqual([200, '2026-10-01', '2026-10-15']);
    expect(await got('')).toEqual([200, '2026-09-16', '2026-10-15']);
  });

  it(`${SEC} T15: ORD trả thừa trường cá nhân thì danh sách trắng của DSH cắt bỏ, báo cáo theo nguồn không để lọt`, async () => {
    await hoOrder(t, an, { source: 'hotline', total: 100_000 });
    const real = t.ord.getSourcesReport.bind(t.ord);
    jest.spyOn(t.ord, 'getSourcesReport').mockImplementation(async (range) => { const r = await real(range); return { ...r, items: r.items.map((i) => ({ ...i, phone: '0912345678', cost_snapshot: 5, note: 'bí mật' })) } as never; });
    const r = await report();
    expect(r.text).not.toMatch(/0912345678|cost_snapshot|bí mật|phone/);
  });

  it('DSH-TC-20261015-093303064: báo cáo đơn vẫn đếm mọi trạng thái (kể cả đơn hộ) và khớp bất biến với báo cáo theo nguồn', async () => {
    await seedMain();
    await webOrder(t, { total: 40_000, status: 'cancelled', at: day(3) });
    await webOrder(t, { total: 41_000, status: 'expired', at: day(3) });
    await hoOrder(t, an, { source: 'tiktok', total: 42_000, status: 'cancelled', at: day(4) });
    await hoOrder(t, an, { source: 'tiktok', total: 43_000, status: 'returned', at: day(4) });
    const c = await get(t, p.admin.cookie, `${REPORT.orders}${R}`);
    const a = await report();
    expect(c.body.totals.total).toBe(10);
    expect(c.body.totals.by_status).toMatchObject({ cancelled: 2, expired: 1, returned: 1 });
    expect(Object.keys(c.body.totals.by_status)).toHaveLength(8);
    expect(c.body.totals.total).toBe(a.body.totals.orders + a.body.totals.excluded_orders);
    expect(c.text).not.toMatch(/source|created_by|"website"/);
    expect(c.body.totals.cancel_rate).toBe(20); // 2 trên 10, không đổi so với trước đợt này
  });
});
