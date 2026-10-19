import { AuthApi } from '../../src/modules/auth';
import { csvText } from '../../src/modules/dashboard/csv';
import { bulkUsers, createDshApp, exportRows, get, hoOrder, later, NOW15, parseCsv, q, REPORT, resetSales, saleUser, webOrder, withTimeout, type DshApp, type People } from '../support/dsh';

// DSH-REQ-20261015-092608849 (báo cáo theo sale kèm dòng "Khách tự đặt (website)", xuất CSV): OrderApi.getSalesReport thật (ORD tra tên theo lô qua AuthApi.getDisplayNames) trên PostgreSQL thật.
const SEC = 'DSH-SEC-20261015-092608917';
describe('DSH báo cáo theo sale (DSH-REQ-20261015-092608849)', () => {
  let t: DshApp;
  let p: People;
  beforeAll(async () => { t = await createDshApp(); });
  afterAll(() => t.close());
  beforeEach(async () => { p = await resetSales(t); });
  const R = '?from=2026-10-01&to=2026-10-05';
  const report = (qs = R, cookie: string | null = p.admin.cookie) => get(t, cookie ?? undefined, `${REPORT.sales}${qs}`);
  const csv = (qs = R, cookie: string | null = p.admin.cookie) => report(`${qs}${qs ? '&' : '?'}format=csv`, cookie);
  const spy = () => jest.spyOn(t.ord, 'getSalesReport');
  const day = (d: number) => new Date(Date.UTC(2026, 9, d, 3));
  type Row = { user_id: string; name: string; orders: number; revenue: number };
  /** An 2 đơn confirmed 100.000 + 200.000; Bình 1 đơn delivered 500.000; khách tự đặt 3 đơn paid 50.000, 60.000, 70.000. */
  async function seedMain(): Promise<{ an: string; binh: string }> {
    const an = await saleUser(t, 'An'), binh = await saleUser(t, 'Bình');
    await hoOrder(t, an, { total: 100_000, at: day(2) }); await hoOrder(t, an, { total: 200_000, at: day(2) });
    await hoOrder(t, binh, { total: 500_000, status: 'delivered', at: day(3) });
    for (const n of [50_000, 60_000, 70_000]) await webOrder(t, { total: n, status: 'paid', at: day(2) });
    return { an, binh };
  }

  it('DSH-TC-20261015-093259634: báo cáo theo sale: dòng từng người theo doanh thu, dòng website riêng ở cuối, totals đúng, không trường cá nhân', async () => {
    const { an, binh } = await seedMain();
    const s = spy();
    const r = await report();
    expect(r.status).toBe(200);
    expect(r.body.items).toEqual([{ user_id: binh, name: 'Bình', orders: 1, revenue: 500000 }, { user_id: an, name: 'An', orders: 2, revenue: 300000 }]);
    expect(r.body.website).toEqual({ name: 'Khách tự đặt (website)', orders: 3, revenue: 180000 });
    expect(r.body.totals).toEqual({ orders: 6, revenue: 980000, excluded_orders: 0 });
    expect(r.text).not.toMatch(/email|phone|address|cost|@shop\.vn|0900000000|Khách lẻ/);
    expect(s).toHaveBeenCalledTimes(1);
  });

  it('DSH-TC-20261015-093259813: xuất CSV theo sale: thứ tự dòng, dòng website, dòng Tổng, tên tệp, một dòng audit export', async () => {
    const { an, binh } = await seedMain();
    const r = await csv();
    expect(r.status).toBe(200);
    expect(r.headers['content-type']).toBe('text/csv; charset=utf-8');
    expect(r.headers['content-disposition']).toBe('attachment; filename="bao-cao-sale_2026-10-01_2026-10-05.csv"');
    expect(r.headers['cache-control']).toBe('private, no-store');
    expect(r.text.charCodeAt(0)).toBe(0xfeff);
    expect(parseCsv(r.text)).toEqual([['Người tạo đơn', 'Mã người dùng', 'Số đơn', 'Doanh thu'], ['Bình', binh, '1', '500000'], ['An', an, '2', '300000'], ['Khách tự đặt (website)', '', '3', '180000'], ['Tổng', '', '6', '980000']]);
    const ex = await exportRows(t);
    expect(ex).toHaveLength(1);
    expect(ex[0]).toMatchObject({ actor_id: p.admin.id, after: { report: 'sales', from: '2026-10-01', to: '2026-10-05', rows: 3 } });
    expect(JSON.stringify(ex[0])).not.toMatch(/Bình|980000/);
  });

  it('DSH-TC-20261015-093300101: sale (kể cả sale có đơn), staff, customer gọi báo cáo theo sale bị 403, không số liệu, không tệp, không audit', async () => {
    const { binh } = await seedMain();
    await q(t, `UPDATE users SET email = 'binh@shop.vn' WHERE id = '${binh}'`);
    const bw = await (await import('../support/auth')).seedSession(t, binh);
    const s = spy();
    for (const cookie of [bw.cookie, p.staff.cookie, p.customer.cookie]) {
      for (const r of [await report(R, cookie), await csv(R, cookie)]) {
        expect([r.status, r.body.type]).toEqual([403, 'urn:ecom:error:forbidden']);
        expect(r.text).not.toMatch(/items|website|totals|Người tạo đơn/);
        expect(r.headers['content-type']).not.toContain('text/csv');
      }
    }
    expect(s).not.toHaveBeenCalled();
    expect(await q(t, "SELECT 1 FROM audit_logs WHERE action LIKE 'dashboard.%'")).toHaveLength(0);
  });

  it('DSH-TC-20261015-093300386: chưa đăng nhập hoặc phiên bị thu hồi gọi báo cáo theo sale bị 401, không gọi ORD', async () => {
    const s = spy();
    expect((await report(R, null)).status).toBe(401);
    const old = await (await import('../support/auth')).seedSession(t, p.admin.id, { createdAt: new Date(NOW15.getTime() - 45 * 60_000) });
    expect((await report(R, old.cookie)).status).toBe(401);
    expect(s).not.toHaveBeenCalled();
  });

  it('DSH-TC-20261015-093300553: tham số sai của báo cáo theo sale đều 400, kể cả created_by và format lạ, không chèn header, không lặp lại giá trị client', async () => {
    const s = spy();
    const cases: [string, string][] = [['?from=2025-10-01&to=2026-10-05', 'range_too_long'], ['?from=2026-10-1', 'invalid_format'], ['?format=pdf', 'invalid_value'], ['?format=csv%0d%0aX-Evil:1', 'invalid_value'],
      ['?created_by=11111111-1111-4111-8111-111111111111', 'unknown_parameter']];
    for (const [qs, reason] of cases) {
      const r = await report(qs);
      expect([qs, r.status, r.body.type, r.body.errors[0].reason]).toEqual([qs, 400, 'urn:ecom:error:invalid-parameter', reason]);
      expect(r.headers['x-evil']).toBeUndefined();
      expect(r.text).not.toMatch(/Evil|pdf|11111111/);
    }
    expect(s).not.toHaveBeenCalled();
  });

  it('DSH-TC-20261015-093300733: ORD quá hạn hoặc tra tên từ AUTH lỗi: báo cáo theo sale 503 nguồn ORD, không danh sách thiếu tên, không lưu đệm lỗi', async () => {
    const an = await saleUser(t, 'An');
    await hoOrder(t, an, { total: 100_000, at: day(2) });
    const bySource = jest.spyOn(t.ord, 'getSourcesReport');
    expect((await get(t, p.admin.cookie, `${REPORT.sources}${R}`)).status).toBe(200); // báo cáo theo nguồn cùng khoảng đã nằm trong đệm
    withTimeout(t, 300);
    jest.spyOn(t.ord, 'getSalesReport').mockImplementation(() => later(1500, { items: [], excluded_orders: 0 }));
    const r = await report();
    expect([r.status, r.body.type, r.body.source]).toEqual([503, 'urn:ecom:error:dashboard-source-unavailable', 'ORD']);
    expect((await get(t, p.admin.cookie, `${REPORT.sources}${R}`)).status).toBe(200);
    expect(bySource).toHaveBeenCalledTimes(1); // vẫn 200 từ đệm
    jest.restoreAllMocks();
    const bad = jest.spyOn(t.app.get(AuthApi), 'getDisplayNames').mockRejectedValue(new Error('db down'));
    const e = await report();
    expect([e.status, e.body.source]).toEqual([503, 'ORD']);
    expect(e.text).not.toMatch(/items|"name"|website/); // không danh sách thiếu tên, không toàn 0
    bad.mockRestore();
    const again = jest.spyOn(t.ord, 'getSalesReport');
    const ok = await report();
    expect([ok.status, ok.body.items[0].name, again.mock.calls.length]).toEqual([200, 'An', 1]); // 503 không bị lưu đệm
  });

  it('DSH-TC-20261015-093300869: đơn cancelled, expired, returned của sale bị loại; sale chỉ có đơn bị loại không có dòng', async () => {
    const an = await saleUser(t, 'An'), binh = await saleUser(t, 'Bình');
    await hoOrder(t, an, { total: 100_000, status: 'confirmed', at: day(2) }); await hoOrder(t, an, { total: 200_000, status: 'delivered', at: day(2) });
    await hoOrder(t, an, { total: 300_000, status: 'cancelled', at: day(2) }); await hoOrder(t, an, { total: 400_000, status: 'returned', at: day(2) });
    await hoOrder(t, binh, { total: 500_000, status: 'expired', at: day(2) });
    const r = await report();
    expect(r.body.items).toEqual([{ user_id: an, name: 'An', orders: 2, revenue: 300000 }]);
    expect(r.body.totals).toEqual({ orders: 2, revenue: 300000, excluded_orders: 3 });
  });

  it('DSH-TC-20261015-093301038: sale đã đổi role (customer, staff) hoặc bị khóa vẫn hiện đúng tên, đơn không chuyển sang website, totals không đổi', async () => {
    const cuong = await saleUser(t, 'Cường');
    for (const n of [100_000, 150_000, 200_000]) await hoOrder(t, cuong, { total: n, at: day(2) });
    const before = (await report()).body;
    expect(before.items).toEqual([{ user_id: cuong, name: 'Cường', orders: 3, revenue: 450000 }]);
    for (const sql of [`role = 'customer'`, `role = 'staff'`, `role = 'sale', status = 'locked', locked_reason = 'admin'`]) {
      await q(t, `UPDATE users SET ${sql} WHERE id = '${cuong}'`);
      t.cache.clear();
      const r = (await report()).body;
      expect([sql, r.items, r.website.orders, r.totals]).toEqual([sql, before.items, 0, before.totals]);
    }
  });

  it('DSH-TC-20261015-093301220: tài khoản người tạo không còn tra được: dòng vẫn có với nhãn thay tên, tiền vẫn vào tổng, không gộp vào website', async () => {
    const dung = await saleUser(t, 'Dũng');
    await hoOrder(t, dung, { total: 60_000, at: day(2) }); await hoOrder(t, dung, { total: 60_000, at: day(2) });
    const real = t.app.get(AuthApi).getDisplayNames.bind(t.app.get(AuthApi));
    jest.spyOn(t.app.get(AuthApi), 'getDisplayNames').mockImplementation(async (ids) => (await real(ids)).filter((n) => n.user_id !== dung));
    const r = await report();
    expect(r.body.items).toEqual([{ user_id: dung, name: '(tài khoản đã xóa)', orders: 2, revenue: 120000 }]);
    expect([r.body.website.orders, r.body.totals.revenue]).toEqual([0, 120000]);
    const f = await csv();
    expect(parseCsv(f.text)[1]).toEqual(['(tài khoản đã xóa)', dung, '2', '120000']);
  });

  it('DSH-TC-20261015-093301332: admin tạo hộ một đơn thì admin là một dòng người tạo, không vào website', async () => {
    await hoOrder(t, p.admin.id, { total: 250_000, role: 'admin', at: day(2) });
    const r = await report();
    expect(r.body.items).toEqual([{ user_id: p.admin.id, name: 'Người Dùng', orders: 1, revenue: 250000 }]);
    expect(r.body.website.orders).toBe(0);
  });

  it('DSH-TC-20261015-093301448: khoảng không có đơn được tính: items rỗng, website 0, totals 0 kèm excluded_orders', async () => {
    const an = await saleUser(t, 'An');
    await hoOrder(t, an, { total: 100_000, status: 'cancelled', at: day(2) });
    const r = await report();
    expect([r.status, r.body.items, r.body.website, r.body.totals]).toEqual([200, [], { name: 'Khách tự đặt (website)', orders: 0, revenue: 0 }, { orders: 0, revenue: 0, excluded_orders: 1 }]);
    const f = await csv();
    expect(parseCsv(f.text)).toEqual([['Người tạo đơn', 'Mã người dùng', 'Số đơn', 'Doanh thu'], ['Khách tự đặt (website)', '', '0', '0'], ['Tổng', '', '0', '0']]);
  });

  it(`${SEC} T16: cùng doanh thu thì xếp theo tên tăng dần rồi theo user_id, không theo thứ tự ORD trả`, async () => {
    const binh = await saleUser(t, 'Bình'), an = await saleUser(t, 'An'), hai = [await saleUser(t, 'Hải'), await saleUser(t, 'Hải')];
    for (const id of [binh, an, ...hai]) await hoOrder(t, id, { total: 100_000, at: day(2) });
    const r = await report();
    expect(r.body.items.map((i: Row) => i.name)).toEqual(['An', 'Bình', 'Hải', 'Hải']);
    expect(r.body.items.slice(2).map((i: Row) => i.user_id)).toEqual([...hai].sort());
    // khóa phụ user_id thật sự quyết định thứ tự: ORD trả theo thứ tự nào (xuôi hay ngược) kết quả cũng như nhau (REV-DSH-14: cmp đổi `>` thành `>=` làm mất khóa phụ)
    const real = t.ord.getSalesReport.bind(t.ord);
    for (const [i, flip] of [false, true].entries()) { // khoảng khác nhau mỗi lần để không trúng bộ nhớ đệm 60 giây của DSH
      jest.spyOn(t.ord, 'getSalesReport').mockImplementation(async (rg) => { const x = await real(rg); return { ...x, items: flip ? [...x.items].reverse() : x.items }; });
      const f = await report(`?from=2026-10-01&to=2026-10-0${6 + i}`);
      expect([flip, f.body.items.map((i: Row) => `${i.name}:${i.user_id}`)]).toEqual([flip, r.body.items.map((i: Row) => `${i.name}:${i.user_id}`)]);
      jest.restoreAllMocks();
    }
  });

  it('DSH-TC-20261015-093301534: hai sale trùng tên là hai dòng, tách theo user_id; CSV có Mã người dùng khác nhau', async () => {
    const a = await saleUser(t, 'Nguyễn Văn An'), b = await saleUser(t, 'Nguyễn Văn An');
    await hoOrder(t, a, { total: 100_000, at: day(2) }); await hoOrder(t, b, { total: 200_000, at: day(2) });
    const r = await report();
    expect(r.body.items).toEqual([{ user_id: b, name: 'Nguyễn Văn An', orders: 1, revenue: 200000 }, { user_id: a, name: 'Nguyễn Văn An', orders: 1, revenue: 100000 }]);
    const rows = parseCsv((await csv()).text).slice(1, 3);
    expect(rows).toEqual([['Nguyễn Văn An', b, '1', '200000'], ['Nguyễn Văn An', a, '1', '100000']]);
  });

  it(`DSH-TC-20261015-093301648: tên sale bắt đầu bằng công thức, ký tự điều khiển, emoji được xử lý an toàn trong CSV (${SEC} T16)`, async () => {
    const names = ['=cmd|\' /C calc\'!A0', '-Hùng', '@SUM(1+1)', '\tTab', '\rCR', 'Lê, "Mai"', 'An\nBình', 'Hoa 🌸'];
    const ids = new Map<string, string>();
    for (const [i, n] of names.entries()) { const id = await saleUser(t, n); ids.set(id, n); await hoOrder(t, id, { total: 50_000 + i * 1_000, at: day(2) }); }
    await webOrder(t, { total: 55_000, at: day(2) });
    const r = await csv();
    expect(r.status).toBe(200);
    const parsed = parseCsv(r.text);
    expect(parsed).toHaveLength(1 + names.length + 2); // đủ số dòng: tên có xuống dòng không làm tách dòng
    for (const row of parsed.slice(1, 1 + names.length)) {
      const orig = ids.get(row[1])!;
      expect(row[0]).toBe(/^[=+\-@\t\r]/.test(orig) ? `'${orig}` : orig);
    }
    expect(r.text).toContain('"An\nBình",'); // xuống dòng trong tên: bao nháy kép để không tách dòng (bộ phân tích của test chỉ tách ở CRLF nên so cả chuỗi thô)
    expect(r.text).toContain('"\'\rCR",');
    expect(parsed.flat().filter((c) => /^[=+\-@\t\r]/.test(c))).toEqual([]);
    expect(parsed.at(-2)![0]).toBe('Khách tự đặt (website)'); // không bị thêm '
    expect(parsed.at(-1)![0]).toBe('Tổng');
    expect(r.text).toContain('Hoa 🌸'); // emoji giữ nguyên, UTF-8 hợp lệ
    // ký tự mà cơ sở dữ liệu không lưu được nhưng ORD có thể trả: bỏ NUL, nửa cặp thay thế lẻ thành U+FFFD, tệp luôn UTF-8 hợp lệ
    expect([csvText('X\u0000Y'), csvText('\ud800'), csvText('a\udc00b'), csvText('😀'), csvText('')]).toEqual(['XY', '�', 'a�b', '😀', '']);
    expect(Buffer.from(csvText('\ud800'), 'utf8').toString('utf8')).toBe('�');
  });

  it(`DSH-TC-20261015-093301784: trần 366 ngày của báo cáo theo sale và khoảng gấp triệu lần bị từ chối nhanh (${SEC} T18)`, async () => {
    const s = spy();
    expect((await report('?from=2025-10-15&to=2026-10-15')).status).toBe(200);
    s.mockClear();
    const a = await report('?from=2025-10-14&to=2026-10-15');
    const t0 = Date.now();
    const b = await report('?from=0001-01-01');
    expect(Date.now() - t0).toBeLessThan(2000);
    expect([a.status, a.body.errors[0].reason, b.status, b.body.errors[0].reason]).toEqual([400, 'range_too_long', 400, 'too_early']);
    expect(s).not.toHaveBeenCalled();
  });

  it('DSH-TC-20261015-093302063: báo cáo theo sale chỉ có `from` hoặc chỉ có `to`: khoảng mặc định lặp lại trong phản hồi', async () => {
    const a = await report('?from=2026-10-01'), b = await report('?to=2026-10-10');
    expect([a.status, a.body.from, a.body.to, b.status, b.body.from, b.body.to]).toEqual([200, '2026-10-01', '2026-10-15', 200, '2026-09-11', '2026-10-10']);
  });

  it(`DSH-TC-20261015-093302229: báo cáo theo sale lấy tên theo lô (không N+1) và dùng bộ nhớ đệm 60 giây cho JSON lẫn CSV (${SEC} T18)`, async () => {
    await bulkUsers(t, { role: 'staff', n: 50, createdAt: NOW15, tag: 'creator' });
    const ids = (await q<{ id: string }>(t, "SELECT id FROM users WHERE email LIKE 'creator-%@bulk.test'")).map((x) => x.id);
    expect(ids).toHaveLength(50);
    for (const id of ids) await hoOrder(t, id, { total: 50_000, at: day(2) });
    const names = jest.spyOn(t.app.get(AuthApi), 'getDisplayNames');
    const s = spy();
    const a = await report();
    t.clock.advance(30_000);
    const b = await report();
    const f = await csv();
    expect(a.body.items).toHaveLength(50);
    expect([s.mock.calls.length, names.mock.calls.length]).toEqual([1, 1]); // một lô, không 50 lần
    expect(names.mock.calls[0][0]).toHaveLength(50);
    expect([b.body.as_of, f.status]).toEqual([a.body.as_of, 200]);
    expect(parseCsv(f.text)).toHaveLength(1 + 50 + 2);
  });

  it(`${SEC} T15: ORD trả thừa trường cá nhân thì danh sách trắng của DSH cắt bỏ, báo cáo theo sale không để lọt`, async () => {
    const an = await saleUser(t, 'An');
    await hoOrder(t, an, { total: 100_000, at: day(2) });
    const real = t.ord.getSalesReport.bind(t.ord);
    jest.spyOn(t.ord, 'getSalesReport').mockImplementation(async (range) => { const r = await real(range); return { ...r, items: r.items.map((i) => ({ ...i, email: 'an@shop.vn', phone: '0912345678', customer_snapshot: { full_name: 'Khách' } })) } as never; });
    const r = await report();
    expect(r.text).not.toMatch(/an@shop\.vn|0912345678|customer_snapshot|phone/);
    expect((await csv()).text).not.toMatch(/an@shop\.vn|0912345678/);
  });
});
