import { randomUUID } from 'node:crypto';
import { call } from '../support/usr';
import { count, createNtfApp, emit, logsOf, mkUser, notesOf, q, seedNote, truncateAll, type NtfApp } from '../support/ntf';
import { race } from '../support/ord';

// Cảnh báo vận hành cho staff, admin (NTF-REQ-20261006-103209168): người nhận chọn theo role đọc từ AUTH lúc xử lý, không bao giờ customer.
const P = '0f8e1a2b-3c4d-4e5f-8a9b-0c1d2e3f4a5b';
const R = '9c4d7e60-1111-4222-8333-444455556666';
const low = (extra: Record<string, unknown> = {}) => ({ product_id: P, product_name: 'Áo thun cotton', on_hand: 4, available: 3, threshold: 5, ...extra });
const refundFailed = (extra: Record<string, unknown> = {}) => ({ refund_id: R, payment_id: randomUUID(), order_id: randomUUID(), order_code: '7K3M9Q2XH4TB', user_id: randomUUID(), amount: 350000, reason: 'order_cancelled', failure_reason: 'VNPay 91: lỗi hệ thống', ...extra });

describe('NTF cảnh báo tồn thấp và hoàn tiền thất bại', () => {
  let t: NtfApp;
  beforeAll(async () => { t = await createNtfApp(); });
  afterAll(() => t.close());
  beforeEach(async () => { await truncateAll(t.prisma); t.logs.clear(); t.mail.reset(); jest.restoreAllMocks(); });
  const typesOf = async (id: string) => (await notesOf(t, id)).map((n) => n.type);

  it('NTF-TC-20261006-104226204 (T10): LowStockDetected gửi cho staff và admin đang active, không gửi cho customer, không email; dùng available; tên được làm sạch', async () => {
    const [s1, s2, a1, c1] = [await mkUser(t, { role: 'staff' }), await mkUser(t, { role: 'staff' }), await mkUser(t, { role: 'admin' }), await mkUser(t)];
    await emit(t, 'LowStockDetected', low());
    for (const u of [s1, s2, a1]) expect(await notesOf(t, u.id)).toMatchObject([{ type: 'low_stock', title: 'Sản phẩm sắp hết hàng', body: 'Sản phẩm Áo thun cotton có tồn kho thấp: còn 3, ngưỡng cảnh báo 5.', link: '/admin/inventory', data: { product_id: P } }]);
    expect(await notesOf(t, c1.id)).toEqual([]);
    expect(await count(t, 'email_deliveries')).toBe(0);
    // tên: thiếu thì 8 ký tự đầu của product_id; xuống dòng và dài 200 ký tự bị cắt 80; thẻ giữ nguyên dạng văn bản thuần
    const body = async (extra: Record<string, unknown>, product = randomUUID()) => { await emit(t, 'LowStockDetected', low({ product_id: product, ...extra })); return (await notesOf(t, s1.id)).at(-1)!.body; };
    const pid = randomUUID();
    expect(await body({ product_name: undefined }, pid)).toBe(`Sản phẩm ${pid.slice(0, 8)} có tồn kho thấp: còn 3, ngưỡng cảnh báo 5.`);
    const long = await body({ product_name: `Áo\n${'x'.repeat(200)}\r\n` });
    const name = long.slice('Sản phẩm '.length, long.indexOf(' có tồn kho'));
    expect([...name]).toHaveLength(80);
    expect(name).not.toMatch(/[\r\n]/);
    expect(await body({ product_name: '<b>x</b>' })).toBe('Sản phẩm <b>x</b> có tồn kho thấp: còn 3, ngưỡng cảnh báo 5.');
    // đổi s2 thành customer trước khi chạy: chỉ còn hai người nhận (role đọc từ AUTH lúc xử lý)
    await q(t, `UPDATE users SET role = 'customer' WHERE id = '${s2.id}'`);
    const p2 = randomUUID();
    await emit(t, 'LowStockDetected', low({ product_id: p2 }));
    expect([(await q(t, `SELECT 1 FROM notifications WHERE data->>'product_id' = '${p2}'`)).length, (await notesOf(t, s2.id)).filter((n) => n.data.product_id === p2).length]).toEqual([2, 0]);
  });

  it('NTF-TC-20261006-104226272 (T10, T18): RefundFailed chỉ gửi cho admin active, không cho staff hay chủ đơn, không lộ lý do của cổng; thiếu order_code dùng 8 ký tự đầu của refund_id', async () => {
    const [a1, a2, s1, owner] = [await mkUser(t, { role: 'admin' }), await mkUser(t, { role: 'admin' }), await mkUser(t, { role: 'staff' }), await mkUser(t)];
    await emit(t, 'RefundFailed', refundFailed({ user_id: owner.id }));
    for (const a of [a1, a2]) expect(await notesOf(t, a.id)).toMatchObject([{ type: 'refund_failed', title: 'Hoàn tiền thất bại', body: 'Hoàn tiền của đơn #7K3M9Q2XH4TB bị lỗi và cần xử lý thủ công.', link: null, data: { refund_id: R } }]);
    expect([await notesOf(t, s1.id), await notesOf(t, owner.id)]).toEqual([[], []]);
    expect(JSON.stringify(await q(t, 'SELECT * FROM notifications')) + t.logs.lines.join('')).not.toContain('VNPay');
    await emit(t, 'RefundFailed', refundFailed({ refund_id: randomUUID(), order_code: undefined }));
    expect((await notesOf(t, a1.id)).at(-1)!.body).toMatch(/^Hoàn tiền [0-9a-f]{8} bị lỗi và cần xử lý thủ công\.$/);
  });

  it('NTF-TC-20261006-104226338: không có người nhận hợp lệ (không staff, admin active; chỉ staff bị khóa) thì không tạo gì và có đúng 1 log warn', async () => {
    await mkUser(t, { role: 'customer' });
    await emit(t, 'LowStockDetected', low());
    expect(await count(t, 'notifications')).toBe(0);
    expect(logsOf(t, 'warn')).toHaveLength(1);
    t.logs.clear();
    await mkUser(t, { role: 'staff', status: 'locked' });
    await emit(t, 'LowStockDetected', low());
    expect(await count(t, 'notifications')).toBe(0);
    expect(logsOf(t, 'warn')).toHaveLength(1);
  });

  it('NTF-TC-20261006-104301546: LowStockDetected sai kiểu (on_hand -1, available -1, threshold chuỗi, product_id sai, thiếu on_hand) bị bỏ qua với đúng 1 log error', async () => {
    const s1 = await mkUser(t, { role: 'staff' });
    const bad: Record<string, unknown>[] = [{ on_hand: -1 }, { available: -1 }, { threshold: '5' }, { product_id: 'abc' }, { on_hand: undefined }, { available: 3.5 }];
    for (const extra of bad) {
      t.logs.clear();
      await emit(t, 'LowStockDetected', low(extra));
      expect(t.logs.records.filter((r) => r.level === 'error')).toHaveLength(1);
      expect(await notesOf(t, s1.id)).toEqual([]);
    }
    await emit(t, 'LowStockDetected', low({ on_hand: 0, available: 0, threshold: 0, product_id: randomUUID() })); // 0 là hợp lệ
    expect((await notesOf(t, s1.id))[0].body).toContain('còn 0, ngưỡng cảnh báo 0');
  });

  it('NTF-TC-20261006-104301655 (BR4): mỗi người nhận chỉ một thông báo chưa đọc cho mỗi sản phẩm hay mỗi hoàn tiền; đã đọc thì event sau tạo mới; chạy song song 20 vòng không lỗi chưa bắt', async () => {
    const [s1, s2, a1] = [await mkUser(t, { role: 'staff' }), await mkUser(t, { role: 'staff' }), await mkUser(t, { role: 'admin' })];
    await seedNote(t, s1.id, { type: 'low_stock', data: { product_id: P }, status: 'unread' });
    await seedNote(t, s2.id, { type: 'low_stock', data: { product_id: P }, status: 'read' });
    await seedNote(t, a1.id, { type: 'refund_failed', data: { refund_id: R }, status: 'unread', link: null });
    await emit(t, 'LowStockDetected', low()); await emit(t, 'RefundFailed', refundFailed());
    expect((await notesOf(t, s1.id)).filter((n) => n.type === 'low_stock')).toHaveLength(1);
    expect((await notesOf(t, s2.id)).filter((n) => n.type === 'low_stock').map((n) => n.status).sort()).toEqual(['read', 'unread']);
    expect((await notesOf(t, a1.id)).filter((n) => n.type === 'refund_failed')).toHaveLength(1);
    for (let i = 0; i < 20; i++) {
      const p = randomUUID();
      const res = await race(() => emit(t, 'LowStockDetected', low({ product_id: p })).then(() => 'ok', (e) => String(e)), () => emit(t, 'LowStockDetected', low({ product_id: p })).then(() => 'ok', (e) => String(e)));
      expect(res).toEqual(['ok', 'ok']);
      expect(await count(t, 'notifications', `data->>'product_id' = '${p}' AND status = 'unread'`)).toBe(3);
    }
    // chốt chặn ở CSDL: dòng thứ hai chưa đọc cùng sản phẩm bị unique một phần từ chối
    await expect(q(t, `INSERT INTO notifications (user_id, type, title, body, data, event_id, dedupe_key) VALUES ('${s1.id}', 'low_stock', 't', 'b', '{"product_id":"${P}"}', '${randomUUID()}', '${randomUUID()}')`)).rejects.toThrow();
  }, 120_000);

  it('NTF-TC-20261006-104301770 (BR6, BR3): người dùng bị khóa không nhận; tối đa 200 người nhận mỗi event (200 id nhỏ nhất, xác định) và 1 log warn', async () => {
    const [s3, s1] = [await mkUser(t, { role: 'staff', status: 'locked' }), await mkUser(t, { role: 'staff' })];
    await emit(t, 'LowStockDetected', low());
    expect([(await notesOf(t, s3.id)).length, (await notesOf(t, s1.id)).length]).toEqual([0, 1]);
    await truncateAll(t.prisma); t.logs.clear();
    const staff = [];
    for (let i = 0; i < 250; i++) staff.push(await mkUser(t, { role: 'staff' }));
    await emit(t, 'LowStockDetected', low());
    const smallest = staff.map((s) => s.id).sort().slice(0, 200);
    const got = (await q<{ user_id: string }>(t, `SELECT user_id FROM notifications ORDER BY user_id`)).map((r) => r.user_id);
    expect(got).toEqual(smallest);
    expect(logsOf(t, 'warn').filter((r) => r.code === 'recipients-capped')).toHaveLength(1);
    // lặp lại ra cùng 200 người
    await q(t, 'DELETE FROM notifications'); await q(t, 'DELETE FROM processed_events');
    await emit(t, 'LowStockDetected', low());
    expect((await q<{ user_id: string }>(t, `SELECT user_id FROM notifications ORDER BY user_id`)).map((r) => r.user_id)).toEqual(smallest);
    expect(typeof (await call(t, 'get', '/notifications', { cookie: staff[0].cookie })).status).toBe('number');
    expect(await typesOf(smallest[0])).toEqual(['low_stock']);
  }, 120_000);
});
