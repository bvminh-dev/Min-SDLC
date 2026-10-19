import { baseHo, createHo, hoItems } from '../support/ho';
import { baseInput, createPending } from '../support/ord';
import { alignWindow, call, createSalApp, resetSal, salWorld, salesGet, setSource, type SalApp, type SalWorld } from '../support/sal';

// SAL "Đơn của tôi" (SAL-REQ-20261015-092711222 danh sách, SAL-REQ-20261015-092711321 chi tiết): GET /sales/orders và /sales/orders/{code} trên AppModule thật, dữ liệu dựng bằng OrderApi.createHo và createPending.
// fixed-clock: mỗi đơn dựng cách nhau một giây bằng Clock giả để thứ tự `created_at` xác định.
const SEC = 'SAL-SEC-20261015-093121500';
const LIST_KEYS = ['code', 'created_at', 'customer', 'grand_total', 'items_count', 'payment_method', 'payment_status', 'source', 'status'];
const DETAIL_KEYS = ['code', 'confirmed_at', 'created_at', 'customer', 'delivered_at', 'discount', 'grand_total', 'items', 'items_total', 'note', 'paid_at', 'payment_method', 'payment_status', 'shipping_address', 'shipping_fee', 'source', 'status'];
const bodyOf = (r: { body: any }): string => JSON.stringify({ ...r.body, trace_id: undefined });

describe('SAL Đơn của tôi: danh sách và chi tiết', () => {
  let t: SalApp;
  let w: SalWorld;
  beforeAll(async () => { t = await createSalApp(); });
  afterAll(() => t.close());
  beforeEach(async () => { jest.restoreAllMocks(); await resetSal(t); alignWindow(t); w = await salWorld(t); });
  const ho = async (by: { id: string }, o: Record<string, unknown> = {}): Promise<string> => { t.clock.advance(1000); return (await createHo(t as never, baseHo(by.id, o))).code; };
  const own = async (n: number, by: { id: string }, o: Record<string, unknown> = {}): Promise<string[]> => { const out: string[] = []; for (let i = 0; i < n; i++) out.push(await ho(by, o)); return out; };
  const selfPlaced = async (): Promise<string> => { t.clock.advance(1000); return (await createPending(t as never, baseInput(w.u1.id, { payment_method: 'cod', payment_expires_at: null }))).code; };
  const list = (u: { cookie: string } | undefined, query: Record<string, string> = {}) => salesGet(t, u, '/orders', query);
  const detail = (u: { cookie: string } | undefined, code: string) => salesGet(t, u, `/orders/${encodeURIComponent(code)}`);

  it(`SAL-TC-20261015-093911477 ${SEC} T3: sale chỉ thấy đơn hộ của mình, mới nhất trước, đủ trường được phép và không có created_by, địa chỉ, ghi chú, giá vốn`, async () => {
    const mine = await own(25, w.s1);
    await own(5, w.s2);
    await selfPlaced(); await selfPlaced(); await selfPlaced();
    const r = await list(w.s1, { page: '1', limit: '20' });
    expect(r.status).toBe(200);
    expect(r.headers['cache-control']).toBe('no-store');
    expect([r.body.items.length, r.body.total, r.body.page, r.body.limit]).toEqual([20, 25, 1, 20]);
    expect(r.body.items.map((o: { code: string }) => o.code)).toEqual(mine.slice(5).reverse()); // mới nhất trước
    const times = r.body.items.map((o: { created_at: string }) => o.created_at);
    expect([...times].sort().reverse()).toEqual(times);
    for (const o of r.body.items) {
      expect(Object.keys(o).sort()).toEqual(LIST_KEYS);
      expect(o.customer).toEqual({ name: 'Trần Thị Mai', phone: '0912345678' });
      expect(o.source).toEqual({ code: 'facebook', name: 'Facebook' });
    }
    expect(JSON.stringify(r.body)).not.toMatch(/cost|Nguyễn Huệ|Khách muốn giao|user_id|created_by/);
  });

  it('SAL-TC-20261015-093911510: admin thấy mọi đơn hộ (không gồm đơn khách tự đặt), mỗi dòng có created_by; lọc theo created_by của sale', async () => {
    await own(25, w.s1); const s2o = await own(5, w.s2);
    await selfPlaced(); await selfPlaced(); await selfPlaced();
    const all = await list(w.ad, { limit: '100' });
    expect([all.body.total, all.body.items.length]).toEqual([30, 30]);
    expect(all.body.items.every((o: any) => o.created_by && typeof o.created_by.id === 'string' && ['Trần Thu', 'Lê Hoa'].includes(o.created_by.name))).toBe(true);
    const only = await list(w.ad, { created_by: w.s2.id });
    expect(only.body.total).toBe(5);
    expect(only.body.items.map((o: { code: string }) => o.code).sort()).toEqual([...s2o].sort());
    expect(only.body.items.every((o: any) => o.created_by.id === w.s2.id)).toBe(true);
  });

  it('SAL-TC-20261015-093911545: lọc theo trạng thái và nguồn, kể cả nguồn đã tắt', async () => {
    const fb = await ho(w.s1, { source_code: 'facebook' }), tk = await ho(w.s1, { source_code: 'tiktok' });
    expect((await call(t, 'post', `/orders/${tk}/cancel`, { cookie: w.ad.cookie, body: {} })).status).toBe(200); // admin hủy ở ORD
    await setSource(t, 'tiktok', false);
    const a = await list(w.s1, { status: 'confirmed', source: 'facebook' });
    expect(a.body.items.map((o: { code: string }) => o.code)).toEqual([fb]);
    const b = await list(w.s1, { source: 'tiktok' });
    expect(b.body.items.map((o: { code: string; status: string }) => [o.code, o.status])).toEqual([[tk, 'cancelled']]);
  });

  it('SAL-TC-20261015-093911578: tìm theo mã đơn không phân biệt hoa thường (và khoảng trắng hai đầu), đúng một dòng', async () => {
    const codes = await own(3, w.s1);
    const r = await list(w.s1, { code: ` ${codes[1].toLowerCase()} ` });
    expect(r.body.items.map((o: { code: string }) => o.code)).toEqual([codes[1]]);
  });

  it(`SAL-TC-20261015-093911611 ${SEC} T1: customer, staff và guest không xem được danh sách: 403, 403, 401`, async () => {
    await own(1, w.s1);
    const out = [await list(w.u1), await list(w.st), await list(undefined)];
    expect(out.map((r) => r.status)).toEqual([403, 403, 401]);
    expect(JSON.stringify(out.map((r) => r.body))).not.toContain('Trần Thị Mai');
  });

  it('SAL-TC-20261015-093911648: tham số sai bị 400 kể cả created_by của sale; limit một triệu lần trần bị từ chối nhanh và không gọi listForSale', async () => {
    const spy = jest.spyOn(t.ord, 'listForSale');
    const bad: Record<string, string>[] = [{ created_by: w.s2.id }, { limit: '101' }, { limit: '100000000' }, { status: 'done' }, { page: '0' }, { phone: '0901234567' }];
    for (const q2 of bad) {
      const started = Date.now();
      const r = await list(w.s1, q2);
      expect([JSON.stringify(q2), r.status, r.body.type, r.body.items]).toEqual([JSON.stringify(q2), 400, 'urn:ecom:error:validation-failed', undefined]);
      expect(Date.now() - started).toBeLessThan(2000);
    }
    expect(spy).not.toHaveBeenCalled();
    expect((await list(w.ad, { created_by: w.s2.id })).status).toBe(200);
  });

  it(`SAL-TC-20261015-093911681 ${SEC} T3: vượt 120 lần xem danh sách mỗi phút thì 429 kèm Retry-After`, async () => {
    for (let i = 0; i < 120; i++) expect((await list(w.s1)).status).toBe(200);
    const r = await list(w.s1);
    expect([r.status, r.body.type]).toEqual([429, 'urn:ecom:error:rate-limited']);
    expect(Number(r.headers['retry-after'])).toBeGreaterThan(0);
  });

  it('SAL-TC-20261015-093911714: phân trang trang cuối còn lẻ (5 dòng) và trang vượt cuối rỗng, total đúng, vẫn 200', async () => {
    await own(25, w.s1);
    const p2 = await list(w.s1, { page: '2', limit: '20' }), p3 = await list(w.s1, { page: '3', limit: '20' });
    expect([p2.status, p2.body.items.length, p2.body.total, p3.status, p3.body.items, p3.body.total]).toEqual([200, 5, 25, 200, [], 25]);
  });

  it(`SAL-TC-20261015-093911746 ${SEC} T3: tìm mã của đơn người khác, đơn khách tự đặt hay không tồn tại đều ra rỗng, thân giống hệt nhau`, async () => {
    const other = await ho(w.s2), mine = await ho(w.s1), selfCode = await selfPlaced();
    expect(selfCode).toMatch(/^HD\d{6}-\d{5}$/); // đơn khách tự đặt mới cũng có mã HD, nhưng không có created_by
    const old = 'K7M2Q9XH4TB3';
    const out = [];
    for (const code of [other, old, 'HD999999-99999', selfCode]) out.push(await list(w.s1, { code }));
    expect(out.map((r) => [r.status, bodyOf(r)])).toEqual(Array(4).fill([200, '{"items":[],"page":1,"limit":20,"total":0}']));
    expect((await list(w.s1, { code: mine })).body.total).toBe(1);
  });

  it('SAL-TC-20261015-093911779: sale chưa có đơn nào thì 200 với items rỗng, total 0', async () => {
    const s3 = await (await import('../support/prd')).who(t, 'sale', 's3@shop.vn');
    const r = await list(s3);
    expect([r.status, r.body.items, r.body.total]).toEqual([200, [], 0]);
  });

  it(`SAL-TC-20261015-093911813 ${SEC} T5: sale xem chi tiết đơn của mình (mã viết thường): đủ trường BR3, không cost_snapshot, user_id, created_by`, async () => {
    const code = await ho(w.s1, { note: 'Giao giờ hành chính', customer_snapshot: { full_name: 'Nguyễn An', phone: '0901234567' } });
    const r = await detail(w.s1, code.toLowerCase());
    expect(r.status).toBe(200);
    expect(Object.keys(r.body).sort()).toEqual(DETAIL_KEYS);
    expect(r.body).toMatchObject({ code, status: 'confirmed', payment_method: 'cod', note: 'Giao giờ hành chính', customer: { name: 'Nguyễn An', phone: '0901234567', has_account: false }, source: { code: 'facebook', name: 'Facebook' }, items_total: 450000, shipping_fee: 30000, grand_total: 480000, discount: 0 });
    expect(Object.keys(r.body.shipping_address).sort()).toEqual(['city', 'district', 'line1', 'phone', 'receiver', 'ward']);
    expect(r.body.items[0]).toEqual({ product_id: expect.any(String), name: 'Áo thun', quantity: 2, unit_price: 100000, line_total: 200000, note: 'size M, màu đen' });
    expect(JSON.stringify(r.body)).not.toMatch(/cost|user_id|created_by|60000/);
  });

  it('SAL-TC-20261015-093911848: admin xem chi tiết đơn hộ của sale: thêm created_by { id, name }, vẫn không giá vốn', async () => {
    const code = await ho(w.s1);
    const r = await detail(w.ad, code);
    expect(r.status).toBe(200);
    expect(r.body.created_by).toEqual({ id: w.s1.id, name: 'Trần Thu' });
    expect(JSON.stringify(r.body)).not.toMatch(/cost|user_id/);
  });

  it(`SAL-TC-20261015-093911880 ${SEC} T3: đơn của người khác, không có, sai mã, mã đơn cũ 12 ký tự cùng 404 nội dung giống hệt, độ trễ trung bình chênh dưới 50 ms`, async () => {
    const theirs = await ho(w.s1);
    const types = [theirs, 'HD261015-99999', 'abc', '2N6R4T8W0KMA'];
    const getForSale = jest.spyOn(t.ord, 'getForSale');
    const first = [];
    for (const code of types) first.push(await detail(w.s2, code));
    expect(getForSale).toHaveBeenCalledTimes(4); // cả bốn loại mã đều đi qua cùng một lời gọi đọc của ORD (mã sai định dạng và mã cũ không bị chặn sớm hơn), nên thời gian xử lý xấp xỉ nhau
    expect(first.map((r) => [r.status, r.body.type])).toEqual(Array(4).fill([404, 'urn:ecom:error:not-found']));
    expect(new Set(first.map(bodyOf)).size).toBe(1);
    const sum = [0, 0, 0, 0], n = [0, 0, 0, 0];
    for (let batch = 0; batch < 7; batch++) { // xen kẽ bốn loại, mỗi lô 29 lần mỗi loại (116 yêu cầu, dưới trần 120 mỗi phút), tua đồng hồ sang cửa sổ mới giữa các lô
      for (let i = 0; i < 29; i++) for (const [k, code] of types.entries()) { const s = process.hrtime.bigint(); await detail(w.s2, code); sum[k] += Number(process.hrtime.bigint() - s) / 1e6; n[k]++; }
      t.clock.advance(61_000);
    }
    const mean = sum.map((s, k) => s / n[k]);
    expect(n[0]).toBeGreaterThanOrEqual(200);
    expect(Math.max(...mean) - Math.min(...mean)).toBeLessThan(50);
  }, 120_000);

  it('SAL-TC-20261015-093911913: admin mở mã đơn khách tự đặt ở SAL thì 404 (đơn khách tự đặt không thuộc SAL)', async () => {
    const selfCode = await selfPlaced();
    const r = await detail(w.ad, selfCode);
    expect([r.status, r.body.type]).toEqual([404, 'urn:ecom:error:not-found']);
    expect((await detail(w.ad, 'K7M2Q9XH4TB3')).status).toBe(404);
  });

  it(`SAL-TC-20261015-093911946 ${SEC} T1: customer chủ đơn, staff và guest không xem chi tiết đơn hộ: 403, 403, 401`, async () => {
    const code = (await createHo(t as never, baseHo(w.s1.id, { user_id: w.u1.id }))).code;
    const out = [await detail(w.u1, code), await detail(w.st, code), await detail(undefined, code)];
    expect(out.map((r) => r.status)).toEqual([403, 403, 401]);
    expect((await call(t, 'get', `/orders/${code}`, { cookie: w.u1.cookie })).status).toBe(200); // khách xem đơn của mình ở ORD
  });

  it(`SAL-TC-20261015-093911979 ${SEC} T3: vượt 120 lần xem chi tiết mỗi phút (kể cả mã sai, cùng bộ đếm) thì 429 kèm Retry-After`, async () => {
    const code = await ho(w.s1);
    for (let i = 0; i < 120; i++) expect((await detail(w.s1, i % 2 ? code : `HD261015-${String(i).padStart(5, '0')}`)).status).toBe(i % 2 ? 200 : 404);
    const r = await detail(w.s1, code);
    expect([r.status, r.body.type]).toEqual([429, 'urn:ecom:error:rate-limited']);
    expect(Number(r.headers['retry-after'])).toBeGreaterThan(0);
  });

  it('SAL-TC-20261015-093912011: đơn đã gắn tài khoản khách chỉ báo has_account, không user_id hay email', async () => {
    const code = await ho(w.s1, { user_id: w.u1.id });
    const r = await detail(w.s1, code);
    expect(r.body.customer.has_account).toBe(true);
    expect(JSON.stringify(r.body)).not.toMatch(new RegExp(`${w.u1.id}|u1@shop.vn`));
  });

  it('SAL-TC-20261015-093912044: đơn không ghi chú, dòng không ghi chú, quận rỗng thì null, không lỗi', async () => {
    const items = hoItems().map((i) => ({ ...i, note: null }));
    const code = await ho(w.s1, { note: null, items, shipping_address: { receiver: 'A', phone: '0901234567', line1: 'x', ward: 'y', district: null, city: 'z' } });
    const r = await detail(w.s1, code);
    expect([r.status, r.body.note, r.body.items.map((i: any) => i.note), r.body.shipping_address.district]).toEqual([200, null, [null, null], null]);
  });

  it('SAL-TC-20261015-093912079: đơn bị admin hủy vẫn xem được với status cancelled và cancel_reason admin', async () => {
    const code = await ho(w.s1);
    expect((await call(t, 'post', `/orders/${code}/cancel`, { cookie: w.ad.cookie, body: {} })).status).toBe(200); // admin hủy ở ORD
    const r = await detail(w.s1, code);
    expect([r.status, r.body.status, r.body.cancel_reason]).toEqual([200, 'cancelled', 'admin']);
  });

  it('SAL-TC-20261015-093912115: ghi chú HTML trả nguyên văn (không giải mã thực thể)', async () => {
    const code = await ho(w.s1, { note: '<b>x</b>&amp;' });
    const r = await detail(w.s1, code);
    expect(r.headers['content-type']).toMatch(/^application\/json/);
    expect(r.body.note).toBe('<b>x</b>&amp;');
  });
});
