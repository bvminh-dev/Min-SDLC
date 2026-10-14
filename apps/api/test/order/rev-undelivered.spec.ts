import { randomUUID } from 'node:crypto';
import { q } from '../support/auth';
import { truncateAll } from '../support/db';
import { createOrdApp, people, seedOrder, type OrdApp, type Status } from '../support/ord';

// Sửa nền kèm theo của REV: `OrderApi.hasUndeliveredItems(user_id, product_id)` (REV-REQ-20261006-103135296 BR3 bước 4: not_delivered khác not_purchased).
// Bảng Giao diện module chỉ có `getDeliveredItems` (đơn đã giao) nên REV không phân biệt được "chưa giao" với "chưa mua"; xem report REV, Lệch spec.
describe('ORD hasUndeliveredItems cho REV', () => {
  let t: OrdApp;
  beforeAll(async () => { t = await createOrdApp(); });
  afterAll(() => t.close());
  beforeEach(async () => { await truncateAll(t.prisma); t.logs.clear(); });

  it('ORD-TC-20261013-223014153 REV-TC-20261006-104525491: chỉ đơn pending, confirmed, paid, shipped của CHÍNH người dùng chứa sản phẩm mới tính; hủy, hết hạn, hoàn, đã giao và đơn của người khác thì không; chỉ đọc', async () => {
    const { a, b } = await people(t);
    const P = randomUUID();
    const none = [randomUUID(), randomUUID()];
    const statuses: Status[] = ['pending', 'confirmed', 'paid', 'shipped', 'delivered', 'cancelled', 'expired', 'returned'];
    const want: Record<string, boolean> = { pending: true, confirmed: true, paid: true, shipped: true, delivered: false, cancelled: false, expired: false, returned: false };
    for (const st of statuses) {
      const product = randomUUID();
      await seedOrder(t, { user: a.id, status: st, method: st === 'confirmed' ? 'cod' : 'vnpay', items: [{ product }, { price: 5 }] });
      expect([st, await t.ord.hasUndeliveredItems(a.id, product)]).toEqual([st, want[st]]);
      expect([st, 'other-user', await t.ord.hasUndeliveredItems(b.id, product)]).toEqual([st, 'other-user', false]);
    }
    await seedOrder(t, { user: b.id, status: 'shipped', items: [{ product: P }] });
    expect(await t.ord.hasUndeliveredItems(a.id, P)).toBe(false); // đơn của người khác không giúp A
    expect(await t.ord.hasUndeliveredItems(b.id, P)).toBe(true);
    for (const bad of ['abc', '', none[0]]) expect([bad, await t.ord.hasUndeliveredItems(bad, P), await t.ord.hasUndeliveredItems(a.id, bad)]).toEqual([bad, false, false]);
    const before = JSON.stringify([await q(t, 'SELECT count(*)::int FROM orders'), await q(t, 'SELECT count(*)::int FROM outbox_events'), await q(t, 'SELECT count(*)::int FROM audit_logs')]);
    await t.ord.hasUndeliveredItems(a.id, P);
    expect(JSON.stringify([await q(t, 'SELECT count(*)::int FROM orders'), await q(t, 'SELECT count(*)::int FROM outbox_events'), await q(t, 'SELECT count(*)::int FROM audit_logs')])).toBe(before);
  });
});
