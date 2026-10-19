import { randomUUID } from 'node:crypto';
import { AuditService } from '../../src/modules/platform';
import { DepsService } from '../../src/modules/sales/deps.service';
import { noTrace } from '../support/chk';
import { alignWindow, count, createSalApp, orderRow, postOrder, prod, q, reservedOf, resetSal, salWorld, setMethodActive, setSource, stdBody, traces, type SalApp, type SalWorld } from '../support/sal';
import { stock } from '../support/crt';

// SAL từ chối đơn hộ không hợp lệ (SAL-REQ-20261015-092711128) và phương thức vận chuyển đã tắt (SAL-REQ-20261015-092711037 BR3): POST /sales/orders trên AppModule thật.
const ZERO = [0, 0, 0, 0, 0, 0];
const SEC = 'SAL-SEC-20261015-093121500';
const type = (r: { body: any }): string => r.body.type;

describe('SAL từ chối đơn hộ và hoàn tác', () => {
  let t: SalApp;
  let w: SalWorld;
  beforeAll(async () => { t = await createSalApp(); });
  afterAll(() => t.close());
  beforeEach(async () => { jest.restoreAllMocks(); await resetSal(t); alignWindow(t); w = await salWorld(t); });
  const line = (product: string, quantity = 1) => ({ product_id: product, quantity });

  it(`SAL-TC-20261015-093910900 ${SEC} T10: phương thức vận chuyển đã tắt, không có hay sai định dạng cùng 409 shipping-method-unavailable; không tạo gì; chọn phương thức khác thì tạo được`, async () => {
    await setMethodActive(t as never, w.sm2, false);
    const out = [];
    for (const id of [w.sm2, randomUUID(), 'abc']) out.push(await postOrder(t, w.s1, stdBody(w, { shipping_method_id: id })));
    expect(out.map((r) => [r.status, type(r)])).toEqual(Array(3).fill([409, 'urn:ecom:error:shipping-method-unavailable']));
    expect(new Set(out.map((r) => JSON.stringify(noTrace(r.body)))).size).toBe(1);
    expect(await traces(t)).toEqual(ZERO);
    expect(await reservedOf(t, w.p1)).toBe(0);
    expect((await postOrder(t, w.s1, stdBody(w))).status).toBe(201);
  });

  it(`SAL-TC-20261015-093911042 ${SEC} T10: hết hàng thì 409 insufficient-stock chỉ nêu dòng thiếu (số cần, số còn) và không để lại gì kể cả event`, async () => {
    const r = await postOrder(t, w.s1, stdBody(w, { source_code: 'tiktok', items: [line(w.p2, 5), line(w.p1, 1)], expected_grand_total: 430000 }));
    expect(r.status).toBe(409);
    expect(r.body).toMatchObject({ type: 'urn:ecom:error:insufficient-stock', items: [{ product_id: w.p2, name: 'Tất cổ cao', requested: 5, available: 3, reason: 'insufficient_stock' }] });
    expect(r.body.items).toHaveLength(1); // không có dòng đủ hàng (BR8)
    expect(await traces(t)).toEqual(ZERO);
    expect([await reservedOf(t, w.p1), await reservedOf(t, w.p2)]).toEqual([0, 0]);
  });

  it(`SAL-TC-20261015-093911074 ${SEC} T2: nguồn đã tắt, không có hay sai định dạng cùng 409 order-source-unavailable; nguồn bị tắt giữa hai lần kiểm cũng 409 và hoàn tác`, async () => {
    await setSource(t, 'tiktok', false);
    const out = [];
    for (const code of ['tiktok', 'khong-co', 'TikTok!']) out.push(await postOrder(t, w.s1, stdBody(w, { source_code: code })));
    expect(out.map((r) => [r.status, type(r)])).toEqual(Array(3).fill([409, 'urn:ecom:error:order-source-unavailable']));
    expect(new Set(out.map((r) => JSON.stringify(noTrace(r.body)))).size).toBe(1);
    expect(await traces(t)).toEqual(ZERO);
    await setSource(t, 'tiktok', true);
    const list = t.ord.listSources.bind(t.ord);
    jest.spyOn(t.ord, 'listSources').mockImplementationOnce(async (o) => { const r = await list(o); await setSource(t, 'tiktok', false); return r; }); // tắt SAU lần kiểm của SAL, TRƯỚC createHo
    const race = await postOrder(t, w.s1, stdBody(w, { source_code: 'tiktok' }));
    expect([race.status, type(race)]).toEqual([409, 'urn:ecom:error:order-source-unavailable']);
    expect(await traces(t)).toEqual(ZERO);
    await setSource(t, 'tiktok', true);
    expect((await postOrder(t, w.s1, stdBody(w, { source_code: 'tiktok' }))).status).toBe(201);
  });

  it('SAL-TC-20261015-093911106: sản phẩm ngừng bán, nháp, không tồn tại cùng 409 product-unavailable, liệt kê MỌI dòng lỗi, không phân biệt draft với không có', async () => {
    const c = await prod(t, { name: 'C', status: 'archived' }), d = await prod(t, { name: 'D', status: 'draft' }), e = await prod(t, { name: 'E', price: 50000, onHand: 5 }), f = randomUUID();
    const r = await postOrder(t, w.s1, stdBody(w, { items: [line(c), line(d), line(e), line(f)], expected_grand_total: 80000 }));
    expect([r.status, type(r)]).toEqual([409, 'urn:ecom:error:product-unavailable']);
    expect(r.body.items).toEqual([{ product_id: c, reason: 'unavailable' }, { product_id: d, reason: 'unavailable' }, { product_id: f, reason: 'unavailable' }]);
    const bad = await postOrder(t, w.s1, stdBody(w, { items: [line('khong-phai-uuid')] }));
    expect([bad.status, bad.body.items]).toEqual([409, [{ product_id: 'khong-phai-uuid', reason: 'unavailable' }]]);
    expect(await traces(t)).toEqual(ZERO);
  });

  it('SAL-TC-20261015-093911140: nguồn tắt và sản phẩm ngừng bán cùng lúc thì báo nguồn trước và không gọi PRD', async () => {
    await setSource(t, 'tiktok', false);
    const c = await prod(t, { status: 'archived' });
    const getForSale = jest.spyOn(t.catalog, 'getForSale');
    const r = await postOrder(t, w.s1, stdBody(w, { source_code: 'tiktok', items: [line(c)] }));
    expect([r.status, type(r)]).toEqual([409, 'urn:ecom:error:order-source-unavailable']);
    expect(getForSale).not.toHaveBeenCalled();
  });

  it('SAL-TC-20261015-093911174: sản phẩm ngừng bán và hết hàng cùng lúc thì báo ngừng bán trước, chỉ liệt kê dòng ngừng bán, không gọi reserve', async () => {
    const c = await prod(t, { status: 'archived' }), a = await prod(t, { name: 'A', price: 100000, onHand: 0 });
    const reserve = jest.spyOn(t.inv, 'reserve');
    const r = await postOrder(t, w.s1, stdBody(w, { items: [line(c), line(a)], expected_grand_total: 130000 }));
    expect([r.status, type(r), r.body.items]).toEqual([409, 'urn:ecom:error:product-unavailable', [{ product_id: c, reason: 'unavailable' }]]);
    expect(reserve).not.toHaveBeenCalled();
  });

  it('SAL-TC-20261015-093911207: giá đổi và hết hàng cùng lúc thì báo price-changed trước (không gọi reserve); gửi lại tổng mới mới gặp insufficient-stock', async () => {
    const a = await prod(t, { name: 'A', price: 100000, onHand: 0 });
    await q(t, `UPDATE products SET price = 120000 WHERE id = '${a}'`);
    const reserve = jest.spyOn(t.inv, 'reserve');
    const first = await postOrder(t, w.s1, stdBody(w, { items: [line(a)], expected_grand_total: 130000 }));
    expect([first.status, type(first), first.body.review.grand_total]).toEqual([409, 'urn:ecom:error:price-changed', 150000]);
    expect(reserve).not.toHaveBeenCalled();
    const second = await postOrder(t, w.s1, stdBody(w, { items: [line(a)], expected_grand_total: 150000 }));
    expect([second.status, type(second)]).toEqual([409, 'urn:ecom:error:insufficient-stock']);
  });

  it(`SAL-TC-20261015-093911240 ${SEC} T10: PRD không trả lời hay chậm quá hạn, hoặc INV lỗi giữa giao dịch thì 503 dependency-unavailable, đã hoàn tác, khóa idempotency chưa ghi nên gửi lại được`, async () => {
    const key = 'ho-503-abcd';
    const spy = jest.spyOn(t.catalog, 'getForSale').mockRejectedValue(new Error('PRD down'));
    const r = await postOrder(t, w.s1, stdBody(w), { key });
    expect([r.status, type(r)]).toEqual([503, 'urn:ecom:error:dependency-unavailable']);
    expect(await traces(t)).toEqual(ZERO);
    spy.mockRestore();
    const deps = t.app.get(DepsService);
    deps.timeoutMs = 50;
    const slow = jest.spyOn(t.catalog, 'getForSale').mockImplementation(() => new Promise((res) => setTimeout(() => res([]), 300)));
    expect((await postOrder(t, w.s1, stdBody(w))).status).toBe(503); // quá hạn
    slow.mockRestore();
    deps.timeoutMs = 2000;
    jest.spyOn(t.inv, 'reserve').mockRejectedValueOnce(new Error('INV lỗi tạm thời'));
    const mid = await postOrder(t, w.s1, stdBody(w), { key });
    expect([mid.status, type(mid)]).toEqual([503, 'urn:ecom:error:dependency-unavailable']);
    expect(await traces(t)).toEqual(ZERO); // Order đã tạo bị hoàn tác
    expect((await postOrder(t, w.s1, stdBody(w), { key })).status).toBe(201); // khóa chưa được ghi
  });

  it('SAL-TC-20261015-093911272: guest 401 và staff 403 không nhận danh sách hàng thiếu, tên sản phẩm hay số còn', async () => {
    const body = stdBody(w, { items: [line(w.p2, 5)], expected_grand_total: 280000 });
    for (const [u, status] of [[undefined, 401], [w.st, 403]] as const) {
      const r = await postOrder(t, u, body);
      expect(r.status).toBe(status);
      expect(JSON.stringify(r.body)).not.toMatch(/items|available|Tất cổ cao/);
    }
  });

  it('SAL-TC-20261015-093911306: giữ đúng số còn bán được rồi thiếu một: x4 thiếu (còn 3), x3 được, x1 thiếu (còn 0)', async () => {
    const a = await prod(t, { name: 'A', price: 100000, onHand: 0 });
    await stock(t as never, a, 5, 2);
    const go = (qty: number, total: number) => postOrder(t, w.s1, stdBody(w, { items: [line(a, qty)], expected_grand_total: total }));
    const r4 = await go(4, 430000);
    expect([r4.status, r4.body.items]).toEqual([409, [{ product_id: a, name: 'A', requested: 4, available: 3, reason: 'insufficient_stock' }]]);
    expect((await go(3, 330000)).status).toBe(201);
    const r1 = await go(1, 130000);
    expect([r1.status, r1.body.items[0].available]).toEqual([409, 0]);
  });

  it(`SAL-TC-20261015-093911343 ${SEC} T10: hai sale tranh hàng cuối cùng song song: đúng một đơn thành công, reserved bằng 3`, async () => {
    const a = await prod(t, { name: 'A', price: 100000, onHand: 3 });
    const body = stdBody(w, { items: [line(a, 3)], expected_grand_total: 330000 });
    const [x, y] = await Promise.all([postOrder(t, w.s1, body), postOrder(t, w.s2, body)]);
    expect([x.status, y.status].sort()).toEqual([201, 409]);
    expect([x, y].find((r) => r.status === 409)!.body.type).toBe('urn:ecom:error:insufficient-stock');
    expect(await reservedOf(t, a)).toBe(3);
    expect(await count(t, 'orders')).toBe(1);
  });

  it('SAL-TC-20261015-093911378: sản phẩm active chưa có bản ghi kho thì 409 insufficient-stock với reason unavailable, available 0', async () => {
    const g = await prod(t, { name: 'G', price: 100000, onHand: null });
    const r = await postOrder(t, w.s1, stdBody(w, { items: [line(g)], expected_grand_total: 130000 }));
    expect([r.status, r.body.items]).toEqual([409, [{ product_id: g, name: 'G', requested: 1, available: 0, reason: 'unavailable' }]]);
  });

  it('SAL-TC-20261015-093911412: nguồn bị tắt rồi bật lại thì dùng được, đơn cũ vẫn mang nguồn cũ', async () => {
    const old = [(await postOrder(t, w.s1, stdBody(w, { source_code: 'hotline' }))).body.order.code, (await postOrder(t, w.s1, stdBody(w, { source_code: 'hotline' }))).body.order.code];
    await setSource(t, 'hotline', false);
    expect((await postOrder(t, w.s1, stdBody(w, { source_code: 'hotline' }))).status).toBe(409);
    await setSource(t, 'hotline', true);
    expect((await postOrder(t, w.s1, stdBody(w, { source_code: 'hotline' }))).status).toBe(201);
    for (const c of old) expect((await orderRow(t, c)).source_code).toBe('hotline');
  });

  it(`SAL-TC-20261015-093911445 ${SEC} T10: lỗi giữa chừng (audit của createHo, reserve) hoàn tác cả giao dịch; gửi lại cùng khóa sau khi gỡ lỗi thì 201`, async () => {
    const key = 'ho-roll-abcd';
    const audit = jest.spyOn(t.app.get(AuditService), 'record').mockRejectedValueOnce(new Error('ghi audit lỗi'));
    const r = await postOrder(t, w.s1, stdBody(w), { key });
    expect(r.status).toBeGreaterThanOrEqual(500);
    expect(await traces(t)).toEqual(ZERO);
    expect(await reservedOf(t, w.p1)).toBe(0);
    audit.mockRestore();
    const ok = await postOrder(t, w.s1, stdBody(w), { key });
    expect([ok.status, ok.body.replayed]).toEqual([201, false]);
    expect(await count(t, 'orders')).toBe(1);
  });
});
