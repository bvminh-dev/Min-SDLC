import { createDshApp, DASH, get, order, people, reset, withTimeout, later, type DshApp, type People, type Status } from '../support/dsh';

// DSH-REQ-20261006-105126180 (đơn gần đây): OrderApi.listRecent thật; danh sách trắng bảy khóa, không trường cá nhân.
describe('DSH đơn gần đây (DSH-REQ-20261006-105126180)', () => {
  let t: DshApp;
  let p: People;
  beforeAll(async () => { t = await createDshApp(); });
  afterAll(() => t.close());
  beforeEach(async () => { await reset(t); p = await people(t); });
  const recent = (cookie: string | null = p.admin.cookie) => get(t, cookie ?? undefined, DASH.recent);
  const KEYS = ['code', 'created_at', 'grand_total', 'item_count', 'payment_method', 'payment_status', 'status'];

  it('DSH-TC-20261006-110331071: mười đơn mới nhất, đúng bảy khóa danh sách trắng dù nguồn trả thừa email, receiver, phone, shipping_address', async () => {
    for (let i = 0; i < 24; i++) await order(t, { status: 'paid', createdAt: new Date(Date.parse('2026-10-05T03:00:00Z') + i * 60_000) });
    await order(t, { code: '7K3M9Q2XH4TB', status: 'paid', payment: 'succeeded', method: 'vnpay', createdAt: new Date('2026-10-06T02:00:00Z'), items: [{ price: 100_000, qty: 2 }, { price: 80_000, qty: 1 }, { price: 40_000, qty: 1 }], shipping: 30_000, discount: 0 });
    const real = t.ord.listRecent.bind(t.ord);
    jest.spyOn(t.ord, 'listRecent').mockImplementation(async (n: number) => (await real(n)).map((o) => ({ ...o, email: 'khach@shop.vn', receiver: 'Nguyễn Văn A', phone: '0901234567', shipping_address: { line1: '12 Lê Lợi' }, id: 'x', user_id: 'u' })) as never);
    const r = await recent();
    expect(r.status).toBe(200);
    expect(r.body.items).toHaveLength(10);
    expect(r.body.items[0]).toEqual({ code: '7K3M9Q2XH4TB', created_at: '2026-10-06T02:00:00Z', status: 'paid', grand_total: 350000, payment_method: 'vnpay', payment_status: 'succeeded', item_count: 3 });
    for (const i of r.body.items) expect(Object.keys(i).sort()).toEqual(KEYS);
    expect(r.text).not.toMatch(/email|receiver|phone|shipping_address|Nguyễn|0901234567|user_id|"id"/);
    expect(Object.keys(r.body).sort()).toEqual(['as_of', 'items']);
  });

  it('DSH-TC-20261006-110331101: staff và customer nhận 403, chưa đăng nhập 401 ở đơn gần đây, ORD được gọi 0 lần', async () => {
    const spy = jest.spyOn(t.ord, 'listRecent');
    for (const w of [p.staff, p.customer]) { const r = await recent(w.cookie); expect([r.status, r.text.includes('items')]).toEqual([403, false]); }
    expect((await recent(null)).status).toBe(401);
    expect(spy).not.toHaveBeenCalled();
  });

  it('DSH-TC-20261006-110331131: ORD quá hạn trả 503 nguồn ORD, không có items (không báo "chưa có đơn hàng nào")', async () => {
    withTimeout(t, 300);
    jest.spyOn(t.ord, 'listRecent').mockImplementation(() => later(1500, []));
    const r = await recent();
    expect([r.status, r.body.source]).toEqual([503, 'ORD']);
    expect(r.text).not.toContain('items');
  });

  it('DSH-TC-20261006-110331163: chỉ có 4 đơn thì trả 4 đơn, mới nhất trước', async () => {
    for (let i = 0; i < 4; i++) await order(t, { createdAt: new Date(Date.parse('2026-10-05T03:00:00Z') + i * 3600_000) });
    const r = await recent();
    expect(r.body.items).toHaveLength(4);
    const times = r.body.items.map((i: { created_at: string }) => i.created_at);
    expect(times).toEqual([...times].sort().reverse());
  });

  it('DSH-TC-20261006-110331194: chưa có đơn nào thì danh sách rỗng (200)', async () => {
    const r = await recent();
    expect([r.status, r.body.items]).toEqual([200, []]);
  });

  it('DSH-TC-20261006-110331259: hai đơn cùng thời điểm tạo, id lớn hơn đứng trước', async () => {
    const at = new Date('2026-10-06T02:00:00Z');
    await order(t, { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', code: 'AAAAAAAAAAAA', createdAt: at });
    await order(t, { id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', code: 'BBBBBBBBBBBB', createdAt: at });
    const r = await recent();
    expect(r.body.items.map((i: { code: string }) => i.code)).toEqual(['BBBBBBBBBBBB', 'AAAAAAAAAAAA']);
  });

  it('DSH-TC-20261006-110331290: đơn mới nhất đã hết hạn (expired) vẫn hiện với trạng thái expired, giá trị đơn 90.000', async () => {
    await order(t, { status: 'paid', createdAt: new Date('2026-10-05T03:00:00Z') });
    await order(t, { status: 'expired' as Status, createdAt: new Date('2026-10-06T02:30:00Z'), items: [{ price: 60_000, qty: 1 }], shipping: 30_000 });
    const r = await recent();
    expect([r.body.items[0].status, r.body.items[0].grand_total]).toEqual(['expired', 90000]);
  });
});
