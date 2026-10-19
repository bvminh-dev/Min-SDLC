// Thêm đơn bán hộ (SAL) để báo cáo theo nguồn đơn và theo sale có số liệu đa dạng (chỉ dev): `pnpm --filter @ecom/api db:seed:demo:sales`, chạy sau db:seed:demo:more. Chỉ chạy một lần.
// Đơn hộ theo createHo của ORD: không tài khoản hoặc cash/bank_transfer nên PAY không tạo Payment; pending -> confirmed ngay, có vận đơn, giữ/trừ tồn, mã HD<yymmdd>-<5 số> kèm bộ đếm ngày.
/* eslint-disable no-restricted-syntax -- điểm vào CLI của seed demo, không phải mã ứng dụng */
import 'reflect-metadata';
import { randomInt, randomUUID } from 'node:crypto';
import { PrismaClient, Prisma } from '@prisma/client';
import { hashPassword } from './modules/auth/crypto';
import { DEMO_PASSWORD, ago, after } from './seed-demo';
import { FEMALE, LAST, MALE, PLACES, between, pick, pickW } from './seed-demo-more';

type St = 'delivered' | 'shipped' | 'confirmed' | 'cancelled';
type Method = 'cod' | 'cash' | 'bank_transfer';
const CODES = ['facebook', 'tiktok', 'hotline', 'zalo', 'instagram', 'shopee', 'daily', 'sendo'];
const NEW_SOURCES: [string, string, boolean][] = [['zalo', 'Zalo', true], ['instagram', 'Instagram', true], ['shopee', 'Shopee', true], ['daily', 'Đại lý', true], ['sendo', 'Sendo (đã ngừng)', false]];
// [tên, email, trọng số số đơn, gu sản phẩm, trọng số theo CODES]: mỗi sale một mạnh riêng để báo cáo không đều
const SALES: [string, string, number, 'mid' | 'high' | 'low', number[]][] = [
  ['Nhân viên Bán hàng', 'sale@example.com', 18, 'mid', [40, 5, 30, 20, 0, 5, 0, 0]],
  ['Trần Thu Hà', 'sale.2@example.com', 32, 'high', [35, 10, 10, 15, 25, 0, 5, 0]],
  ['Lê Quốc Bảo', 'sale.3@example.com', 24, 'low', [5, 50, 5, 5, 5, 30, 0, 0]],
  ['Phạm Ngọc Linh', 'sale.4@example.com', 14, 'mid', [10, 10, 45, 30, 0, 0, 5, 0]],
  ['Võ Minh Tuấn', 'sale.5@example.com', 8, 'high', [10, 5, 10, 10, 5, 10, 50, 0]],
  ['Đặng Thanh Mai', 'sale.6@example.com', 4, 'low', [5, 10, 10, 5, 5, 15, 10, 40]],
];
const ADMIN_SRC = [30, 0, 40, 0, 0, 0, 30, 0];
const STATUS: [number, St][] = [[55, 'delivered'], [8, 'shipped'], [12, 'confirmed'], [13, 'cancelled']];
const NOTES = ['Khách hẹn giao giờ hành chính', 'Gọi trước khi giao', 'Khách quen, tặng kèm quà nhỏ', 'Đóng gói kỹ, hàng dễ vỡ', 'Xuất hóa đơn công ty'];
const N_ORDERS = 160;
const vnDay = (d: Date) => new Date(d.getTime() + 7 * 36e5).toISOString().slice(0, 10); // ngày theo Asia/Ho_Chi_Minh (ADR-024)

async function main() {
  if (process.env.APP_ENV !== 'dev') { process.stderr.write('seed-demo-sales bị từ chối: chỉ chạy khi APP_ENV=dev\n'); process.exit(1); }
  const url = process.env.MIGRATE_DATABASE_URL;
  if (!url || !/localhost|127\.0\.0\.1/.test(url)) { process.stderr.write('seed-demo-sales cần MIGRATE_DATABASE_URL trỏ localhost\n'); process.exit(1); }
  const client = new PrismaClient({ datasources: { db: { url } } });
  if (await client.user.findUnique({ where: { email: SALES[1][1] } })) { process.stdout.write('đã có dữ liệu bán hộ, bỏ qua\n'); await client.$disconnect(); return; }
  const admin = await client.user.findFirstOrThrow({ where: { role: 'admin' } });
  const pw = await hashPassword(DEMO_PASSWORD, { memory: 19456, passes: 2, parallelism: 1 });

  const summary = await client.$transaction(async (db) => {
    // Sale (sale@example.com có sẵn từ đợt 2) và nguồn đơn mới; nguồn Sendo đã tắt nhưng còn đơn cũ nên vẫn hiện trong báo cáo
    const saleId: string[] = [];
    for (const [i, [name, email]] of SALES.entries()) {
      const ex = await db.user.findUnique({ where: { email } });
      saleId[i] = ex?.id ?? randomUUID();
      if (!ex) await db.user.create({ data: { id: saleId[i], email, passwordHash: pw, role: 'sale', fullName: name, phone: `09${randomInt(1e7, 1e8)}`, emailVerifiedAt: ago(60), createdAt: ago(60 - i) } });
    }
    for (const [i, [code, name, isActive]] of NEW_SOURCES.entries()) await db.orderSource.create({ data: { code, name, isActive, position: 10 + i, createdAt: ago(50), updatedAt: ago(50) } });
    const srcId = new Map((await db.orderSource.findMany()).map((s) => [s.code, s.id]));
    const ship = (await db.shippingMethod.findMany({ orderBy: { baseFee: 'asc' }, take: 2 })).map((s) => s.id); // 30k tiêu chuẩn, 55k nhanh: cùng bảng phí với writeOrder

    const prods = (await db.product.findMany({ where: { status: 'active', stockItem: { isNot: null } }, include: { stockItem: true } }));
    const onHand = prods.map((p) => p.stockItem!.onHand); const reserved = prods.map((p) => p.stockItem!.reserved);
    const orig = prods.map((_, i) => [onHand[i], reserved[i]]);
    const avail = onHand.map((h, i) => h - reserved[i]);
    const accounts = (await db.user.findMany({ where: { role: 'customer', status: 'active', email: { endsWith: '@example.com' }, addresses: { some: { isDefault: true, deletedAt: null } } }, include: { addresses: { where: { isDefault: true, deletedAt: null } } } }));

    interface Spec { by: string; role: 'sale' | 'admin'; src: string; s: St; m: Method; d: number; items: [number, number][]; discount: number; ship: number; who: { name: string; phone: string; line1: string; ward: string; city: string }; user: string | null; note: string | null }
    const specs: Spec[] = [];
    for (let n = 0; n < N_ORDERS; n++) {
      const si = pickW<number>([...SALES.map((s, i) => [s[2], i] as [number, number]), [4, -1]]); // -1: admin tạo hộ
      const [role, by, tier, sw] = si < 0 ? ['admin' as const, admin.id, 'mid' as const, ADMIN_SRC] : ['sale' as const, saleId[si], SALES[si][3], SALES[si][4]];
      const src = pickW(CODES.map((c, k) => [sw[k], c] as [number, string]));
      const s = pickW(STATUS); const m = pickW<Method>([[40, 'cod'], [30, 'bank_transfer'], [30, 'cash']]);
      const r = Math.random() ** 1.5; // nghiêng về gần đây
      const d = s === 'delivered' ? 3 + Math.floor(41 * r) : s === 'shipped' ? between(1, 4) : s === 'confirmed' ? between(0, 3) : Math.floor(44 * r);
      const items: [number, number][] = [];
      for (let k = between(1, 4); k > 0; k--) {
        const cand = prods.map((_, i) => i).filter((i) => avail[i] >= 8 && !items.some((it) => it[0] === i));
        if (!cand.length) break;
        const p = pickW(cand.map((i) => [tier === 'high' ? (Number(prods[i].price) >= 1e6 ? 4 : 1) : tier === 'low' ? (Number(prods[i].price) < 5e5 ? 4 : 1) : 1, i] as [number, number]));
        const price = Number(prods[p].price);
        const q = price > 5e6 ? 1 : src === 'daily' ? between(3, price < 1e6 ? 8 : 4) : pickW<number>([[6, 1], [3, 2], [1, 3]]);
        const qty = Math.min(q, avail[p] - 5); avail[p] -= qty; items.push([p, qty]);
      }
      if (!items.length) continue;
      const link = m !== 'cod' && randomInt(10) < 2 ? pick(accounts) : null; // 20% khách có tài khoản (chỉ cash/bank_transfer: COD có user_id thì PAY sẽ tạo Payment)
      const pl = PLACES[randomInt(PLACES.length)]; const g = randomInt(2) ? FEMALE : MALE;
      const a = link?.addresses[0];
      const who = a ? { name: link!.fullName, phone: a.phone, line1: a.line1, ward: a.ward, city: a.city } : { name: `${pick(LAST)} ${pick(g[0])} ${pick(g[1])}`, phone: `0${pick([3, 5, 7, 8, 9])}${randomInt(1e7, 1e8)}`, line1: pl[0], ward: pl[1], city: pl[2] };
      const total = items.reduce((t, [p, q]) => t + Number(prods[p].price) * q, 0);
      specs.push({ by, role, src, s, m, d, items, discount: randomInt(10) < 3 ? Math.round((total * pick([0.05, 0.1])) / 1000) * 1000 : 0, ship: randomInt(10) < 3 ? 1 : 0, who, user: link?.id ?? null, note: randomInt(10) < 3 ? pick(NOTES) : null });
    }
    specs.sort((x, y) => y.d - x.d); // cũ trước: bộ đếm mã và onHandAfter theo đúng thứ tự thời gian

    const counters = new Map<string, number>(); const mv: Prisma.StockMovementCreateManyInput[] = []; const audits: Prisma.AuditLogCreateManyInput[] = [];
    for (const o of specs) {
      const id = randomUUID(); const at = ago(o.d, 2); const day = vnDay(at); const seq = (counters.get(day) ?? 0) + 1; counters.set(day, seq);
      const oc = `HD${day.slice(2, 4)}${day.slice(5, 7)}${day.slice(8, 10)}-${String(seq).padStart(5, '0')}`;
      const items = o.items.map(([p, q], pos) => ({ p, q, pos: pos + 1 }));
      const itemsTotal = items.reduce((t, it) => t + Number(prods[it.p].price) * it.q, 0);
      const sm = [{ b: 30000, f: 500000 }, { b: 55000, f: 2000000 }][o.ship];
      const fee = itemsTotal >= sm.f ? 0 : sm.b + (o.ship === 1 && ['Hà Nội', 'Hồ Chí Minh'].includes(o.who.city) ? 15000 : 0);
      const grand = itemsTotal - o.discount + fee;
      const confirmedAt = after(at, 1); const shippedAt = after(at, 360); const deliveredAt = after(at, 1800); const cancelledAt = after(at, 60);
      const out = o.s === 'shipped' || o.s === 'delivered'; const done = o.s === 'delivered';
      const tracking = out ? `VN${randomInt(1e9, 9e9)}` : null;
      const hist: { from: string | null; to: string; actor: string | null; role: 'sale' | 'admin' | 'system'; reason?: string; at: Date }[] = [{ from: null, to: 'pending', actor: o.by, role: o.role, at }, { from: 'pending', to: 'confirmed', actor: null, role: 'system', at: confirmedAt }];
      if (out) hist.push({ from: 'confirmed', to: 'shipped', actor: admin.id, role: 'admin', at: shippedAt });
      if (done) hist.push({ from: 'shipped', to: 'delivered', actor: null, role: 'system', at: deliveredAt });
      if (o.s === 'cancelled') hist.push({ from: 'confirmed', to: 'cancelled', actor: o.by, role: o.role, reason: pick(['Khách đổi ý', 'Khách không nghe máy', 'Nhập sai sản phẩm', 'Hết hàng thực tế']), at: cancelledAt });
      await db.order.create({ data: {
        id, userId: o.user, code: oc, status: o.s, paymentStatus: done ? 'succeeded' : o.s === 'cancelled' ? 'cancelled' : 'pending', itemsTotal: BigInt(itemsTotal), discount: BigInt(o.discount), shippingFee: BigInt(fee), grandTotal: BigInt(grand),
        shippingAddress: { receiver: o.who.name, phone: o.who.phone, line1: o.who.line1, ward: o.who.ward, district: null, city: o.who.city }, shippingMethodId: ship[o.ship], paymentMethod: o.m, trackingNumber: tracking,
        ...(o.s === 'cancelled' ? { cancelReason: 'admin' as const, cancelledByRole: o.role } : {}), handoffLockedAt: out ? shippedAt : null, confirmedAt, paidAt: done ? deliveredAt : null, deliveredAt: done ? deliveredAt : null,
        createdAt: at, updatedAt: hist[hist.length - 1].at, sourceId: srcId.get(o.src)!, createdBy: o.by, customerSnapshot: { full_name: o.who.name, phone: o.who.phone }, note: o.note,
        items: { create: items.map((it) => ({ productId: prods[it.p].id, nameSnapshot: prods[it.p].name, unitPrice: prods[it.p].price, quantity: it.q, position: it.pos, costSnapshot: prods[it.p].costPrice })) },
        history: { create: hist.map((h) => ({ fromStatus: h.from as 'pending' | null, toStatus: h.to as 'pending', actorId: h.actor, actorRole: h.role, reason: h.reason ?? null, createdAt: h.at })) },
      } });
      if (o.s !== 'cancelled') {
        const st = done ? 'delivered' : out ? 'shipped' : 'pending';
        await db.shipment.create({ data: { orderId: id, shippingMethodId: ship[o.ship], status: st, trackingNumber: tracking, orderCode: oc, codAmount: o.m === 'cod' ? BigInt(grand) : 0n, shippedAt: out ? shippedAt : null, deliveredAt: done ? deliveredAt : null, version: 1, createdAt: confirmedAt, updatedAt: done ? deliveredAt : out ? shippedAt : confirmedAt,
          history: { create: [{ event: 'status_changed', status: 'pending', createdAt: confirmedAt }, ...(out ? [{ event: 'status_changed' as const, status: 'shipped' as const, trackingNumber: tracking, createdAt: shippedAt }] : []), ...(done ? [{ event: 'status_changed' as const, status: 'delivered' as const, trackingNumber: tracking, createdAt: deliveredAt }] : [])] } } });
      }
      for (const it of items) {
        await db.stockReservation.create({ data: { stockItemId: prods[it.p].stockItem!.id, orderId: id, quantity: it.q, status: o.s === 'confirmed' ? 'held' : o.s === 'cancelled' ? 'released' : 'committed', createdAt: at, updatedAt: at } });
        if (o.s === 'confirmed') reserved[it.p] += it.q;
        if (out) { onHand[it.p] -= it.q; mv.push({ stockItemId: prods[it.p].stockItem!.id, type: 'sale', quantity: -it.q, onHandAfter: onHand[it.p], refType: 'order', refId: id, createdAt: shippedAt }); }
      }
      audits.push({ actorId: o.by, actorRole: o.role, action: 'order.created_ho', targetType: 'order', targetId: id, after: { order_code: oc, source: o.src, has_user_id: o.user !== null, items: items.length, grand_total: grand, payment_method: o.m }, correlationId: randomUUID(), createdAt: at });
    }
    await db.orderCodeCounter.createMany({ data: [...counters].map(([day, last]) => ({ day: new Date(day), last })) });
    await db.stockMovement.createMany({ data: mv });
    for (const [i, p] of prods.entries()) if (onHand[i] !== orig[i][0] || reserved[i] !== orig[i][1]) await db.stockItem.update({ where: { id: p.stockItem!.id }, data: { onHand: onHand[i], reserved: reserved[i], lowStockNotified: onHand[i] - reserved[i] <= p.stockItem!.lowStockThreshold } });
    await db.auditLog.createMany({ data: audits });
    return `${SALES.length - 1} sale mới, ${NEW_SOURCES.length} nguồn đơn mới, ${specs.length} đơn bán hộ, ${counters.size} bộ đếm mã ngày, ${audits.length} audit log`;
  }, { timeout: 600000, maxWait: 10000 });
  process.stdout.write(`seed-demo-sales xong: ${summary} (mật khẩu sale: ${DEMO_PASSWORD})\n`);
  await client.$disconnect();
}
void main().catch((e) => { process.stderr.write(`${e instanceof Error ? e.stack : e}\n`); process.exit(1); });
