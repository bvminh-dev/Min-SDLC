import { alignWindow, call, createSalApp, postOrder, resetSal, salWorld, salesGet, setMethodActive, stdBody, type SalApp, type SalWorld } from '../support/sal';

// SAL báo phí vận chuyển khi lập đơn hộ (SAL-REQ-20261015-092711037): GET /sales/shipping-options, gọi ShippingApi.listActiveMethods và ShippingApi.quote.
const SEC = 'SAL-SEC-20261015-093121500';
const opts = (t: SalApp, u: { cookie: string } | undefined, query: Record<string, string>) => salesGet(t, u, '/shipping-options', query);

describe('SAL báo phí vận chuyển', () => {
  let t: SalApp;
  let w: SalWorld;
  beforeAll(async () => { t = await createSalApp(); });
  afterAll(() => t.close());
  beforeEach(async () => { jest.restoreAllMocks(); await resetSal(t); alignWindow(t); w = await salWorld(t); });

  it('SAL-TC-20261015-093910737: báo phí các phương thức đang bật, rẻ nhất trước, không lộ base_fee hay rule; gọi listActiveMethods và quote', async () => {
    const list = jest.spyOn(t.shp, 'listActiveMethods'), quote = jest.spyOn(t.shp, 'quote');
    const r = await opts(t, w.s1, { city: 'Hồ Chí Minh', items_subtotal: '330000' });
    expect(r.status).toBe(200);
    expect(r.headers['cache-control']).toBe('no-store');
    expect(r.body).toEqual({ city: 'Hồ Chí Minh', items_subtotal: 330000, options: [{ method_id: w.sm1, name: 'Giao tiêu chuẩn', fee: 30000, free_shipping: false }, { method_id: w.sm2, name: 'Giao nhanh', fee: 50000, free_shipping: false }] });
    expect(JSON.stringify(r.body)).not.toMatch(/base_fee|rule/);
    expect([list.mock.calls.length, quote.mock.calls.length]).toEqual([1, 2]);
  });

  it('SAL-TC-20261015-093910770: miễn phí vận chuyển khi đủ ngưỡng; phương thức không có ngưỡng vẫn tính phí', async () => {
    const r = await opts(t, w.s1, { city: 'Hồ Chí Minh', items_subtotal: '500000' });
    expect(r.body.options.map((o: any) => [o.method_id, o.fee, o.free_shipping])).toEqual([[w.sm1, 0, true], [w.sm2, 50000, false]]);
  });

  it('SAL-TC-20261015-093910803: tham số sai thì 400; tạm tính gấp một triệu lần trần bị từ chối nhanh và không gọi quote', async () => {
    const quote = jest.spyOn(t.shp, 'quote');
    const bad: Record<string, string>[] = [{ items_subtotal: '330000' }, { city: 'HCM', items_subtotal: '0' }, { city: 'HCM', items_subtotal: '10000000001' }, { city: 'HCM', items_subtotal: '10000000000000000' }, { city: 'HCM', items_subtotal: '1000', method_id: w.sm1 }];
    for (const q2 of bad) {
      const started = Date.now();
      const r = await opts(t, w.s1, q2);
      expect([JSON.stringify(q2), r.status, r.body.options]).toEqual([JSON.stringify(q2), 400, undefined]);
      expect(Date.now() - started).toBeLessThan(2000);
    }
    expect(quote).not.toHaveBeenCalled();
  });

  it('SAL-TC-20261015-093910835: không có phương thức nào đang bật thì 409 no-shipping-methods', async () => {
    await setMethodActive(t as never, w.sm1, false);
    await setMethodActive(t as never, w.sm2, false);
    const r = await opts(t, w.s1, { city: 'HCM', items_subtotal: '1000' });
    expect([r.status, r.body.type, r.body.options]).toEqual([409, 'urn:ecom:error:no-shipping-methods', undefined]);
  });

  it(`SAL-TC-20261015-093910868 ${'SAL-SEC-20261015-093121500'} T1: customer, staff và guest không gọi được: 403, 403, 401`, async () => {
    const out = [await opts(t, w.u1, { city: 'HCM', items_subtotal: '1000' }), await opts(t, w.st, { city: 'HCM', items_subtotal: '1000' }), await opts(t, undefined, { city: 'HCM', items_subtotal: '1000' })];
    expect(out.map((r) => r.status)).toEqual([403, 403, 401]);
  });

  it(`SAL-TC-20261015-093910933 ${SEC} T3: vượt 120 lần báo phí mỗi phút thì 429; quote nội bộ khi tạo đơn không bị tính vào giới hạn này`, async () => {
    for (let i = 0; i < 120; i++) expect((await opts(t, w.s1, { city: 'HCM', items_subtotal: '1000' })).status).toBe(200);
    const r = await opts(t, w.s1, { city: 'HCM', items_subtotal: '1000' });
    expect([r.status, r.body.type]).toEqual([429, 'urn:ecom:error:rate-limited']);
    expect(Number(r.headers['retry-after'])).toBeGreaterThan(0);
    expect((await postOrder(t, w.s1, stdBody(w))).status).toBe(201);
  });

  it('SAL-TC-20261015-093910970: phụ thu theo thành phố khớp không phân biệt hoa thường, dấu và khoảng trắng', async () => {
    const r = await opts(t, w.s1, { city: '  hà  GIANG ', items_subtotal: '100000' });
    expect(r.body.options.find((o: any) => o.method_id === w.sm1).fee).toBe(50000);
  });

  it('SAL-TC-20261015-093911008: tạm tính đúng trần 10.000.000.000 vẫn hợp lệ (200 có options)', async () => {
    const r = await opts(t, w.s1, { city: 'HCM', items_subtotal: '10000000000' });
    expect([r.status, r.body.options.length]).toEqual([200, 2]);
    expect(r.body.options.every((o: any) => o.fee >= 0)).toBe(true);
    expect(await call(t, 'get', '/sales/shipping-options', { cookie: w.s1.cookie }).query({ city: 'HCM' })).toMatchObject({ status: 400 });
  });
});
