import { randomUUID } from 'node:crypto';
import { q, seedSession, seedUser } from '../support/auth';
import { truncateAll } from '../support/db';
import { auditCount, call, createInvApp, deliver, idem, movementsOf, newId, reserve, seedReservation, seedStock, stockOf, type InvApp } from '../support/inv';

// Nhập, xuất, điều chỉnh kho (INV-REQ-20261006-101122463, ...487, ...512): PostgreSQL thật, ứng dụng thật (Platform, Auth, Catalog, Inventory).
describe('INV nhập, xuất, điều chỉnh kho', () => {
  let t: InvApp;
  let staff: { id: string; cookie: string }, staff2: { id: string; cookie: string }, customer: { id: string; cookie: string };
  const mk = async (role: 'customer' | 'staff' | 'admin', email: string, name: string) => { const u = await seedUser(t, { email, role, name }); return { id: u.id, cookie: (await seedSession(t, u.id)).cookie }; };
  beforeAll(async () => { t = await createInvApp(); });
  afterAll(() => t.close());
  beforeEach(async () => {
    await truncateAll(t.prisma); t.cat = '';
    staff = await mk('staff', 'staff@shop.vn', 'Nguyễn Văn An'); staff2 = await mk('staff', 'staff2@shop.vn', 'Trần Thị Bình');
    customer = await mk('customer', 'cust@shop.vn', 'Khách');
  });
  const op = (kind: 'stock-in' | 'stock-out' | 'adjustments', product: string, body: unknown, o: { cookie?: string | null; key?: string | null } = {}) => {
    let r = call(t, 'post', `/admin/inventory/${product}/${kind}`, { cookie: o.cookie === null ? undefined : (o.cookie ?? staff.cookie), body });
    if (o.key !== null) r = r.set('Idempotency-Key', o.key ?? idem());
    return r;
  };
  const fields = (r: { body: { errors?: { field: string }[] } }) => (r.body.errors ?? []).map((e) => e.field);

  it('INV-TC-20261006-101123021: nhập 40 vào bản ghi on_hand 10: on_hand 50, version 5, một dòng in có actor_id và actor_name từ phiên (không từ thân), đúng một audit; trường actor_* trong thân là 400', async () => {
    const { product } = await seedStock(t, { on_hand: 10, reserved: 3, version: 4 });
    const r = await op('stock-in', product, { quantity: 40, reason: 'purchase', note: 'PN-0912' });
    expect(r.status).toBe(200);
    expect(r.body.item).toEqual({ product_id: product, on_hand: 50, reserved: 3, available: 47, low_stock_threshold: 5, is_low_stock: false, archived: false, version: 5 });
    expect(r.body.movement).toMatchObject({ type: 'in', quantity: 40, on_hand_after: 50, reason: 'purchase', note: 'PN-0912' });
    expect(await movementsOf(t, product)).toEqual([{ type: 'in', quantity: 40, on_hand_after: 50, reason: 'purchase', note: 'PN-0912', actor_id: staff.id, actor_name: 'Nguyễn Văn An', ref_type: null, ref_id: null }]);
    expect(await auditCount(t, 'inventory.stock_in')).toBe(1);
    const a = (await q<any>(t, `SELECT actor_id, actor_role, before, after FROM audit_logs WHERE action = 'inventory.stock_in'`))[0];
    expect([a.actor_id, a.actor_role, a.before, a.after]).toEqual([staff.id, 'staff', { on_hand: 10 }, { on_hand: 50 }]);
    const bad = await op('stock-in', product, { quantity: 1, reason: 'purchase', actor_id: randomUUID(), actor_name: 'Giả' });
    expect([bad.status, fields(bad).sort()]).toEqual([400, ['actor_id', 'actor_name']]);
    expect((await stockOf(t, product)).on_hand).toBe(50);
  });

  it('INV-TC-20261006-101123047: nhập sai số lượng, lý do, header, sản phẩm ngừng bán và người không có quyền; on_hand không đổi, không có movement mới; lỗi 400 và 409 không đốt Idempotency-Key', async () => {
    const { product: p1 } = await seedStock(t, { on_hand: 10 }), { product: p2 } = await seedStock(t, { on_hand: 4, archived: true });
    const key = idem();
    for (const quantity of [0, 100001, 2.5, '10']) {
      const r = await op('stock-in', p1, { quantity, reason: 'purchase' }, { key });
      expect([quantity, r.status, fields(r)]).toEqual([quantity, 400, ['quantity']]);
    }
    const noNote = await op('stock-in', p1, { quantity: 1, reason: 'other' }, { key });
    expect([noNote.status, fields(noNote)]).toEqual([400, ['note']]);
    for (const k of [null, 'abc', 'x'.repeat(65), 'key khong hop le!']) {
      const r = await op('stock-in', p1, { quantity: 1, reason: 'purchase' }, { key: k });
      expect([k, r.status, r.body.type]).toEqual([k, 400, 'urn:ecom:error:idempotency-key-required']);
    }
    const arch = await op('stock-in', p2, { quantity: 1, reason: 'purchase' }, { key });
    expect([arch.status, arch.body.type]).toEqual([409, 'urn:ecom:error:product-archived']);
    expect((await op('stock-in', p1, { quantity: 1, reason: 'purchase' }, { cookie: customer.cookie })).status).toBe(403);
    expect((await op('stock-in', p1, { quantity: 1, reason: 'purchase' }, { cookie: null })).status).toBe(401);
    expect((await stockOf(t, p1)).on_hand).toBe(10);
    expect(await movementsOf(t, p1)).toHaveLength(0);
    // khóa chưa bị đốt: chính khóa đó dùng được cho yêu cầu đúng
    expect((await op('stock-in', p1, { quantity: 1, reason: 'purchase' }, { key })).status).toBe(200);
  });

  it('INV-TC-20261006-101123076: nhập chạm đúng trần 10.000.000 rồi vượt trần: 409 stock-limit-exceeded kèm max và on_hand, một dòng movement', async () => {
    const { product } = await seedStock(t, { on_hand: 9_900_000 });
    expect((await op('stock-in', product, { quantity: 100_000, reason: 'purchase' })).body.item.on_hand).toBe(10_000_000);
    const r = await op('stock-in', product, { quantity: 1, reason: 'purchase' });
    expect([r.status, r.body.type, r.body.max, r.body.on_hand]).toEqual([409, 'urn:ecom:error:stock-limit-exceeded', 10_000_000, 10_000_000]);
    expect(await movementsOf(t, product)).toHaveLength(1);
  });

  it('INV-TC-20261006-101123100: gửi lại cùng Idempotency-Key trả đúng phản hồi cũ, cùng khóa khác nội dung 422, khóa gắn user_id và hết hạn sau 24 giờ; hai lần nhập song song cộng đúng tổng (20 lần)', async () => {
    const { product } = await seedStock(t, { on_hand: 0 }), { product: other } = await seedStock(t, { on_hand: 0 });
    const K = 'nhap-0912-0001';
    const first = await op('stock-in', product, { quantity: 40, reason: 'purchase' }, { key: K });
    const again = await op('stock-in', product, { quantity: 40, reason: 'purchase' }, { key: K });
    expect([first.status, again.status, again.body, again.headers['idempotent-replayed']]).toEqual([200, 200, first.body, 'true']);
    expect((await stockOf(t, product)).on_hand).toBe(40);
    const reused = await op('stock-in', product, { quantity: 41, reason: 'purchase' }, { key: K });
    expect([reused.status, reused.body.type]).toEqual([422, 'urn:ecom:error:idempotency-key-reused']);
    // cùng khóa và cùng thân nhưng SẢN PHẨM khác là nội dung khác (sửa nền: request_hash gồm tham số đường dẫn)
    expect((await op('stock-in', other, { quantity: 40, reason: 'purchase' }, { key: K })).status).toBe(422);
    expect((await stockOf(t, other)).on_hand).toBe(0);
    expect(await q(t, `SELECT 1 FROM idempotency_keys WHERE scope = 'inventory.stock-in' AND user_id = '${staff.id}' AND key = '${K}'`)).toHaveLength(1);
    expect(await q(t, `SELECT column_name FROM information_schema.columns WHERE table_name = 'stock_movements' AND column_name ~ 'idempot|request_hash|response'`)).toHaveLength(0);
    // staff khác gửi cùng chuỗi K cho cùng nội dung là yêu cầu mới (khóa gắn user_id, SB-40)
    expect((await op('stock-in', product, { quantity: 40, reason: 'purchase' }, { key: K, cookie: staff2.cookie })).body.item.on_hand).toBe(80);
    // hết hạn 24 giờ: gửi lại K với 41 được coi là yêu cầu mới
    await t.prisma.$executeRaw`UPDATE idempotency_keys SET expires_at = ${new Date(t.clock.now().getTime() - 1000)}::timestamptz WHERE key = ${K} AND user_id = ${staff.id}::uuid`;
    expect((await op('stock-in', product, { quantity: 41, reason: 'purchase' }, { key: K })).body.item.on_hand).toBe(121);
    // hai staff nhập song song 5 và 7 trên P3 (20 lần): luôn cộng đúng 12, hai dòng movement với on_hand_after là {5,12} hoặc {7,12}
    const { product: p3 } = await seedStock(t, { on_hand: 0 });
    for (let i = 0; i < 20; i++) {
      t.clock.advance(61_000);
      await t.prisma.$executeRaw`DELETE FROM stock_reservations`; await t.prisma.$executeRaw`UPDATE stock_items SET on_hand = 0, reserved = 0 WHERE product_id = ${p3}::uuid`;
      const before = (await movementsOf(t, p3)).length;
      const [a, b] = await Promise.all([op('stock-in', p3, { quantity: 5, reason: 'purchase' }, { cookie: staff.cookie, key: `ka-${i}-${idem()}` }), op('stock-in', p3, { quantity: 7, reason: 'purchase' }, { cookie: staff2.cookie, key: `kb-${i}-${idem()}` })]);
      expect([i, a.status, b.status]).toEqual([i, 200, 200]);
      const added = (await movementsOf(t, p3)).slice(before).map((m) => m.on_hand_after).sort((x, y) => x - y);
      expect([i, (await stockOf(t, p3)).on_hand, added[1]]).toEqual([i, 12, 12]);
      expect([[5, 12], [7, 12]]).toContainEqual(added);
    }
  }, 120_000);

  it('INV-TC-20261006-101123124: xuất 30 hỏng từ on_hand 50, reserved 10: on_hand 20, available 10, movement out -30, một audit', async () => {
    const { product } = await seedStock(t, { on_hand: 50, reserved: 10 });
    const r = await op('stock-out', product, { quantity: 30, reason: 'damaged' });
    expect(r.status).toBe(200);
    expect(r.body.item).toMatchObject({ on_hand: 20, reserved: 10, available: 10 });
    expect(r.body.movement).toMatchObject({ type: 'out', quantity: -30, on_hand_after: 20, reason: 'damaged' });
    expect(await auditCount(t, 'inventory.stock_out')).toBe(1);
  });

  it('INV-TC-20261006-101123148: xuất 41 khi còn bán 40 là 409 insufficient-stock kèm available; lý do ngoài danh sách, số âm, số 0 là 400; customer 403', async () => {
    const { product } = await seedStock(t, { on_hand: 50, reserved: 10 });
    const r = await op('stock-out', product, { quantity: 41, reason: 'damaged' });
    expect([r.status, r.body.type, r.body.available, r.body.title]).toEqual([409, 'urn:ecom:error:insufficient-stock', 40, 'Requested quantity exceeds available stock']);
    for (const body of [{ quantity: 1, reason: 'theft' }, { quantity: -5, reason: 'lost' }, { quantity: 0, reason: 'lost' }]) expect((await op('stock-out', product, body)).status).toBe(400);
    expect((await op('stock-out', product, { quantity: 1, reason: 'lost' }, { cookie: customer.cookie })).status).toBe(403);
    expect((await stockOf(t, product)).on_hand).toBe(50);
    expect(await movementsOf(t, product)).toHaveLength(0);
  });

  it('INV-TC-20261006-101123171: xuất đúng bằng số còn bán được, xuất kho archived; xuất đua với giữ hàng món cuối (50 lần): đúng một bên thắng, available không bao giờ âm', async () => {
    const { product: p1 } = await seedStock(t, { on_hand: 50, reserved: 10 }), { product: p3 } = await seedStock(t, { on_hand: 12, archived: true });
    const r = await op('stock-out', p1, { quantity: 40, reason: 'internal_use' });
    expect([r.status, r.body.item.on_hand, r.body.item.available, r.body.item.reserved]).toEqual([200, 10, 0, 10]);
    expect((await op('stock-out', p3, { quantity: 12, reason: 'damaged' })).body.item.on_hand).toBe(0);
    const { product: p2 } = await seedStock(t, { on_hand: 1 });
    let outWins = 0;
    for (let i = 0; i < 50; i++) {
      t.clock.advance(61_000); // cửa sổ giới hạn tần suất mới (bậc D 30 mỗi phút)
      await t.prisma.$executeRaw`DELETE FROM stock_reservations`; await t.prisma.$executeRaw`UPDATE stock_items SET on_hand = 1, reserved = 0 WHERE product_id = ${p2}::uuid`;
      const [out, held] = await Promise.all([op('stock-out', p2, { quantity: 1, reason: 'lost' }), reserve(t, newId(), [{ product_id: p2, quantity: 1 }])]);
      const s = await stockOf(t, p2);
      expect([i, Number(out.status === 200) + Number(held.ok)]).toEqual([i, 1]); // đúng một việc thành công
      if (out.status === 200) { outWins++; expect([s.on_hand, s.reserved]).toEqual([0, 0]); expect([held.ok, out.status]).toEqual([false, 200]); }
      else { expect([out.status, out.body.type]).toEqual([409, 'urn:ecom:error:insufficient-stock']); expect([s.on_hand, s.reserved]).toEqual([1, 1]); }
      expect(s.on_hand - s.reserved).toBeGreaterThanOrEqual(0);
    }
    expect(outWins).toBeGreaterThanOrEqual(0); // cả hai kết cục hợp lệ; ràng buộc nằm ở khẳng định từng vòng
  }, 120_000);

  it('INV-TC-20261006-101123195: điều chỉnh về số đếm thực 15 khi đang có 18: on_hand 15, available 11, version 8, movement adjust -3, audit trước 18 sau 15', async () => {
    const { product } = await seedStock(t, { on_hand: 18, reserved: 4, version: 7 });
    const r = await op('adjustments', product, { new_on_hand: 15, version: 7, note: 'Kiểm kê 06/10: thiếu 3 hộp' });
    expect(r.status).toBe(200);
    expect(r.body.item).toMatchObject({ on_hand: 15, available: 11, version: 8 });
    expect(r.body.movement).toMatchObject({ type: 'adjust', quantity: -3, on_hand_after: 15, reason: null, note: 'Kiểm kê 06/10: thiếu 3 hộp' });
    expect((await movementsOf(t, product))[0]).toMatchObject({ actor_id: staff.id, actor_name: 'Nguyễn Văn An' });
    const a = (await q<any>(t, `SELECT before, after FROM audit_logs WHERE action = 'inventory.adjust'`))[0];
    expect([a.before, a.after]).toEqual([{ on_hand: 18 }, { on_hand: 15 }]);
  });

  it('INV-TC-20261006-101123218: điều chỉnh dưới số đang giữ 409 below-reserved, sai version 409 stock-version-conflict (version đổi do chốt một đơn), ghi chú ngắn hay thiếu và số âm 400', async () => {
    const { product, item } = await seedStock(t, { on_hand: 22, reserved: 8, version: 7 });
    const [o1, o2] = [newId(), newId()];
    await seedReservation(t, item, o1, 4); await seedReservation(t, item, o2, 4);
    await deliver(t, 'PaymentSucceeded', { order_id: o1, payment_id: newId() }); // chốt một đơn sau khi staff đã đọc ở version 7: on_hand 18, reserved 4, version 8
    expect(await stockOf(t, product)).toMatchObject({ on_hand: 18, reserved: 4, version: 8 });
    const below = await op('adjustments', product, { new_on_hand: 3, version: 8, note: 'Kiểm kê lại' });
    expect([below.status, below.body.type, below.body.reserved]).toEqual([409, 'urn:ecom:error:below-reserved', 4]);
    const stale = await op('adjustments', product, { new_on_hand: 15, version: 7, note: 'Kiểm kê lại' });
    expect([stale.status, stale.body.type, stale.body.version]).toEqual([409, 'urn:ecom:error:stock-version-conflict', 8]);
    for (const body of [{ new_on_hand: 15, version: 8, note: 'ok' }, { new_on_hand: 15, version: 8 }, { new_on_hand: -1, version: 8, note: 'Kiểm kê lại' }]) expect((await op('adjustments', product, body)).status).toBe(400);
    expect((await stockOf(t, product)).on_hand).toBe(18);
    expect(await movementsOf(t, product)).toHaveLength(1); // chỉ dòng sale của đơn đã chốt
  });

  it('INV-TC-20261006-101123241: điều chỉnh đúng bằng số đang giữ (available 0, adjust -14), không đổi 400 no-change, vượt trần 400, tăng từ 0 lên 25', async () => {
    const { product: p1 } = await seedStock(t, { on_hand: 18, reserved: 4, version: 9 }), { product: p2 } = await seedStock(t, { on_hand: 0 });
    const r = await op('adjustments', p1, { new_on_hand: 4, version: 9, note: 'Kiểm kê đếm lại' });
    expect([r.status, r.body.item.available, r.body.movement.quantity]).toEqual([200, 0, -14]);
    const { product: p3 } = await seedStock(t, { on_hand: 18, version: 2 });
    const same = await op('adjustments', p3, { new_on_hand: 18, version: 2, note: 'Kiểm kê đếm lại' });
    expect([same.status, same.body.type]).toEqual([400, 'urn:ecom:error:no-change']);
    expect(await movementsOf(t, p3)).toHaveLength(0);
    expect((await op('adjustments', p3, { new_on_hand: 10_000_001, version: 2, note: 'Kiểm kê đếm lại' })).status).toBe(400);
    const up = await op('adjustments', p2, { new_on_hand: 25, version: 1, note: 'Kiểm kê đầu kỳ' });
    expect([up.status, up.body.movement.quantity, up.body.item.on_hand]).toEqual([200, 25, 25]);
  });
});
