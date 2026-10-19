// Thêm dữ liệu mẫu lên DB đã có `db:seed:demo` (chỉ dev): `pnpm --filter @ecom/api db:seed:demo:more`. Chỉ chạy một lần: thấy khách đợt 2 thì bỏ qua.
// Dùng lại writeOrder của seed-demo (cùng luật trạng thái đơn/thanh toán/vận đơn/tồn kho). Ảnh sản phẩm và ảnh đánh giá sinh bằng sharp, đẩy lên MinIO nếu có STORAGE_*.
/* eslint-disable no-restricted-syntax -- điểm vào CLI của seed demo, không phải mã ứng dụng */
import 'reflect-metadata';
import { randomInt, randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { PrismaClient, Prisma } from '@prisma/client';
import { hashPassword } from './modules/auth/crypto';
import { S3Storage } from './modules/platform/storage/s3';
import { DEMO_PASSWORD, REVIEW_TEXT, ago, after, fold, hex, notifier, slug, writeOrder, type CRow, type Ctx, type OS, type OrderSpec, type PRow } from './seed-demo';

export const pick = <T>(xs: readonly T[]): T => xs[randomInt(xs.length)];
export const pickW = <T>(xs: [number, T][]): T => { let r = randomInt(xs.reduce((s, x) => s + x[0], 0)); for (const [w, v] of xs) if ((r -= w) < 0) return v; throw new Error('unreachable'); };
export const between = (lo: number, hi: number) => randomInt(lo, hi + 1);

export const LAST = ['Nguyễn', 'Trần', 'Lê', 'Phạm', 'Hoàng', 'Võ', 'Đặng', 'Bùi', 'Đỗ', 'Ngô', 'Dương', 'Lý', 'Phan', 'Vũ', 'Huỳnh'];
export const MALE = [['Văn', 'Minh', 'Quốc', 'Gia', 'Hoàng'], ['An', 'Bảo', 'Dũng', 'Hải', 'Khoa', 'Long', 'Nam', 'Phát', 'Quân', 'Sơn', 'Tuấn']];
export const FEMALE = [['Thị', 'Thu', 'Ngọc', 'Thanh', 'Mỹ'], ['Chi', 'Giang', 'Hạnh', 'Lan', 'Linh', 'Mai', 'Oanh', 'Thảo', 'Trang', 'Vy', 'Yến']];
export const PLACES: [string, string, string][] = [['21 Lê Duẩn', 'Bến Thành', 'Hồ Chí Minh'], ['76 Cầu Giấy', 'Dịch Vọng', 'Hà Nội'], ['14 Bạch Đằng', 'Hải Châu 1', 'Đà Nẵng'], ['3 Trần Hưng Đạo', 'Ninh Kiều', 'Cần Thơ'], ['58 Lê Lai', 'Máy Chai', 'Hải Phòng'],
  ['9 Phan Chu Trinh', 'Phú Hội', 'Huế'], ['102 Nguyễn Trãi', 'Thanh Xuân Trung', 'Hà Nội'], ['40 Võ Văn Tần', 'Phường 6', 'Hồ Chí Minh'], ['17 Yersin', 'Lộc Thọ', 'Nha Trang'], ['65 Quang Trung', 'Phường 3', 'Đà Lạt']];
const NEW_CATS: [string, string][] = [['Thể thao', 'Thời trang'], ['Máy tính bảng', 'Điện tử'], ['Trang trí', 'Nhà cửa']];

// [tên, sku, danh mục, giá, trạng thái, tồn đầu, ngưỡng thấp]
const NEW_P: [string, string, string, number, 'active' | 'draft' | 'archived', number, number][] = [
  ['Áo polo nam cá sấu', 'AP-POLO-31', 'Áo', 289000, 'active', 90, 10], ['Áo hoodie nỉ unisex', 'AH-HOODIE-32', 'Áo', 390000, 'active', 70, 8], ['Áo sơ mi linen nữ', 'SM-LINEN-33', 'Áo', 329000, 'active', 55, 8], ['Áo khoác jean', 'AK-JEAN-34', 'Áo', 549000, 'active', 4, 6],
  ['Giày lười da nam', 'GL-DANAM-35', 'Giày dép', 890000, 'active', 35, 5], ['Giày cao gót 7cm', 'GC-GOT7-36', 'Giày dép', 450000, 'active', 42, 6], ['Dép quai hậu thể thao', 'DQ-HAU-37', 'Giày dép', 259000, 'active', 100, 10],
  ['Ví da nam gập đôi', 'VD-GAP-38', 'Phụ kiện', 320000, 'active', 60, 8], ['Mũ lưỡi trai thêu logo', 'ML-TRAI-39', 'Phụ kiện', 129000, 'active', 150, 15], ['Kính mát chống UV400', 'KM-UV400-40', 'Phụ kiện', 350000, 'active', 48, 6], ['Túi tote canvas', 'TT-CANVAS-41', 'Phụ kiện', 149000, 'active', 120, 12],
  ['Điện thoại Nova 12 Pro', 'DT-NOVA12P-42', 'Điện thoại', 12990000, 'draft', 20, 4], ['Sạc nhanh 65W GaN', 'SN-GAN65-43', 'Điện thoại', 390000, 'active', 85, 10], ['Cáp USB-C bện dù 2m', 'CA-USBC-44', 'Điện thoại', 99000, 'active', 250, 25], ['Pin dự phòng 20000mAh', 'PD-20000-45', 'Điện thoại', 590000, 'active', 3, 6],
  ['Laptop Gaming X15', 'LT-GAMEX15-46', 'Laptop & phụ kiện', 24990000, 'active', 9, 3], ['Màn hình 27 inch 2K', 'MH-27-2K-47', 'Laptop & phụ kiện', 4590000, 'active', 22, 4], ['Webcam Full HD', 'WC-FHD-48', 'Laptop & phụ kiện', 490000, 'active', 64, 8], ['Hub USB-C 7 cổng', 'HB-USBC7-49', 'Laptop & phụ kiện', 650000, 'archived', 12, 5], ['Ổ cứng SSD 1TB', 'SS-1TB-50', 'Laptop & phụ kiện', 1890000, 'active', 38, 5],
  ['Tai nghe có dây Studio', 'TN-STUDIO-51', 'Âm thanh', 790000, 'active', 33, 5], ['Loa soundbar 2.1', 'LS-SB21-52', 'Âm thanh', 2190000, 'active', 16, 3], ['Micro thu âm USB', 'MC-USB-53', 'Âm thanh', 990000, 'active', 28, 5],
  ['Bàn làm việc chân sắt', 'BL-CHANSAT-54', 'Nội thất', 1690000, 'active', 14, 3], ['Tủ giày thông minh', 'TG-THONGMINH-55', 'Nội thất', 1250000, 'draft', 10, 3], ['Đèn ngủ cảm ứng', 'DN-CAMUNG-56', 'Nội thất', 210000, 'active', 95, 10],
  ['Ấm siêu tốc 1.8L', 'AS-18L-57', 'Nhà bếp', 350000, 'active', 72, 8], ['Chảo chống dính 28cm', 'CH-28-58', 'Nhà bếp', 420000, 'active', 5, 6], ['Máy ép chậm', 'ME-CHAM-59', 'Nhà bếp', 1990000, 'archived', 6, 3],
  ['Thảm tập yoga TPE', 'TY-TPE-60', 'Thể thao', 280000, 'active', 110, 10], ['Tạ tay điều chỉnh 20kg', 'TA-DC20-61', 'Thể thao', 990000, 'active', 26, 4], ['Bình nước thể thao 1L', 'BN-1L-62', 'Thể thao', 120000, 'draft', 140, 15],
  ['Máy tính bảng Tab 10', 'MT-TAB10-63', 'Máy tính bảng', 5490000, 'active', 18, 4], ['Bút cảm ứng Pen S', 'BC-PENS-64', 'Máy tính bảng', 690000, 'active', 44, 6],
  ['Tranh canvas phong cảnh', 'TC-PHONGCANH-65', 'Trang trí', 390000, 'active', 37, 5], ['Bình hoa gốm', 'BH-GOM-66', 'Trang trí', 230000, 'active', 58, 6],
];
const MORE_TEXT: [number, string][] = [[5, 'Đóng gói chắc chắn, shop tư vấn nhiệt tình, sẽ quay lại mua.'], [4, 'Sản phẩm đẹp, đúng như hình. Giao hơi chậm một chút.'], [5, 'Dùng thích lắm, giá hợp lý so với chất lượng.'], [3, 'Bình thường, không có gì nổi bật.'], [1, 'Hàng có lỗi nhỏ, đã liên hệ shop để đổi.'], [4, 'Chất liệu tốt, form chuẩn, đáng tiền.']];
const REVIEW_STATE: [number, 'published' | 'pending' | 'rejected' | 'hidden'][] = [[15, 'published'], [3, 'pending'], [1, 'rejected'], [1, 'hidden']];
// [trọng số, phương thức, trạng thái, cờ, khoảng ngày]: chỉ các tổ hợp seed-demo đã dùng, để mọi CHECK vẫn thỏa
const COMBOS: [number, OrderSpec['m'], OS, Partial<OrderSpec>, [number, number]][] = [
  [30, 'vnpay', 'delivered', {}, [5, 44]], [2, 'vnpay', 'returned', {}, [10, 44]], [3, 'vnpay', 'cancelled', { paidThenCancel: true }, [3, 44]], [3, 'vnpay', 'cancelled', { payFailed: true }, [3, 44]], [3, 'vnpay', 'expired', {}, [3, 44]], [5, 'vnpay', 'shipped', {}, [2, 5]], [4, 'vnpay', 'paid', {}, [1, 3]], [3, 'vnpay', 'pending', {}, [0, 0]],
  [30, 'cod', 'delivered', {}, [5, 44]], [4, 'cod', 'cancelled', {}, [3, 44]], [5, 'cod', 'shipped', {}, [2, 5]], [1, 'cod', 'shipped', { shipFailed: true }, [2, 5]], [5, 'cod', 'confirmed', {}, [1, 3]], [4, 'cod', 'pending', {}, [0, 0]],
];
const N_ORDERS = 100;
const PALETTE = [['#dbeafe', '#60a5fa'], ['#fce7f3', '#f472b6'], ['#dcfce7', '#4ade80'], ['#fef3c7', '#fbbf24'], ['#ede9fe', '#a78bfa'], ['#ffedd5', '#fb923c'], ['#cffafe', '#22d3ee'], ['#fee2e2', '#f87171']];
const tile = (label: string, size: number, i: number) => {
  const [bg, fg] = PALETTE[i % PALETTE.length];
  return sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}"><rect width="100%" height="100%" fill="${bg}"/><circle cx="50%" cy="45%" r="${size * 0.22}" fill="${fg}"/><text x="50%" y="${size * 0.88}" font-size="${size * 0.055}" text-anchor="middle" fill="#334155" font-family="sans-serif">${label.toUpperCase().slice(0, 28)}</text></svg>`));
};
const EMAIL_TYPES = new Set(['order_created', 'payment_succeeded', 'order_cancelled', 'refund_succeeded', 'order_shipped', 'shipment_failed', 'order_delivered', 'order_returned', 'password_changed']);

async function main() {
  if (process.env.APP_ENV !== 'dev') { process.stderr.write('seed-demo-more bị từ chối: chỉ chạy khi APP_ENV=dev\n'); process.exit(1); }
  const url = process.env.MIGRATE_DATABASE_URL;
  if (!url || !/localhost|127\.0\.0\.1/.test(url)) { process.stderr.write('seed-demo-more cần MIGRATE_DATABASE_URL trỏ localhost\n'); process.exit(1); }
  const client = new PrismaClient({ datasources: { db: { url } } });

  const rnd = <T>(xs: T[]) => xs[randomInt(xs.length)];
  const names = Array.from({ length: 30 }, (_, i) => { const [mid, first] = i % 2 ? FEMALE : MALE; return `${LAST[i % LAST.length]} ${mid[i % mid.length]} ${first[(i * 7) % first.length]}`; });
  const emails = names.map((n, i) => `${slug(n)}.${i + 1}@example.com`);
  if (await client.user.findUnique({ where: { email: emails[0] } })) { process.stdout.write('đã có dữ liệu đợt 2, bỏ qua\n'); await client.$disconnect(); return; }
  const admin = await client.user.findFirstOrThrow({ where: { role: 'admin' } });
  const staff = (await client.user.findUnique({ where: { email: 'staff@example.com' } })) ?? admin;
  const pw = await hashPassword(DEMO_PASSWORD, { memory: 19456, passes: 2, parallelism: 1 });

  const env = process.env;
  const store = env.STORAGE_ENDPOINT && env.STORAGE_ACCESS_KEY && env.STORAGE_SECRET_KEY ? new S3Storage({ endpoint: env.STORAGE_ENDPOINT, bucket: env.STORAGE_BUCKET ?? 'ecom-test', region: env.STORAGE_REGION ?? 'us-east-1', accessKey: env.STORAGE_ACCESS_KEY, secretKey: env.STORAGE_SECRET_KEY }) : null;
  if (!store) process.stdout.write('không có STORAGE_*: bỏ qua ảnh sản phẩm và ảnh đánh giá\n');
  // Ảnh sản phẩm: 1 ảnh mỗi sản phẩm, thêm ảnh thứ 2 cho 1/3; đẩy lên trước giao dịch (lỗi thì chỉ mồ côi vài object ở dev)
  const productImages: Prisma.ProductImageCreateManyInput[] = [];
  const newPid = NEW_P.map(() => randomUUID());
  if (store) for (const [i, p] of NEW_P.entries()) {
    for (let pos = 1; pos <= (i % 3 === 0 ? 2 : 1); pos++) {
      const buf = await tile(fold(p[0]), 800, i + pos).png().toBuffer(); const key = `products/${randomUUID()}.png`;
      await store.put(key, buf, { contentType: 'image/png' });
      productImages.push({ productId: newPid[i], storageKey: key, contentType: 'png', width: 800, height: 800, bytes: buf.length, position: pos, createdAt: ago(60) });
    }
  }

  const summary = await client.$transaction(async (db) => {
    // Người dùng: 30 khách (2 chưa xác minh email, 1 bị khóa), 1 nhân viên bán hàng
    if (!(await db.user.findUnique({ where: { email: 'sale@example.com' } }))) await db.user.create({ data: { email: 'sale@example.com', passwordHash: pw, role: 'sale', fullName: 'Nhân viên Bán hàng', phone: '0902345678', emailVerifiedAt: ago(60), createdAt: ago(60) } });
    const cust = names.map(() => randomUUID());
    await db.user.createMany({ data: names.map((name, i) => ({ id: cust[i], email: emails[i], passwordHash: pw, fullName: name, phone: `0${rnd([3, 5, 7, 8, 9])}${randomInt(1e7, 1e8)}`, createdAt: ago(60 - i), emailVerifiedAt: i >= 28 ? null : ago(60 - i), ...(i === 27 ? { status: 'locked' as const, lockedReason: 'admin' as const } : {}) })) as Prisma.UserCreateManyInput[] });
    const addrOf: string[] = [];
    await db.address.createMany({ data: names.flatMap((name, i) => {
      const phone = `0${rnd([3, 5, 7, 8, 9])}${randomInt(1e7, 1e8)}`; const pl = PLACES[i % PLACES.length]; addrOf[i] = randomUUID();
      return [{ id: addrOf[i], userId: cust[i], receiver: name, phone, line1: pl[0], ward: pl[1], district: null, city: pl[2], isDefault: true, createdAt: ago(55) },
        ...(i % 4 === 0 ? [{ userId: cust[i], receiver: name, phone, line1: PLACES[(i + 3) % PLACES.length][0], ward: PLACES[(i + 3) % PLACES.length][1], district: null, city: PLACES[(i + 3) % PLACES.length][2], isDefault: false, createdAt: ago(40) }] : [])];
    }) });

    // Danh mục, sản phẩm, tồn kho, ảnh
    const catId = new Map((await db.category.findMany()).map((c) => [c.name, c.id]));
    for (const [name, parent] of NEW_CATS) { const id = randomUUID(); catId.set(name, id); await db.category.create({ data: { id, name, slug: slug(name), parentId: catId.get(parent)!, depth: 2, createdAt: ago(60) } }); }
    const old = (await db.product.findMany({ include: { stockItem: true }, orderBy: { sku: 'asc' } })).filter((p) => p.stockItem);
    const P: PRow[] = old.map((p) => [p.name, p.sku, '', Number(p.price), p.status, p.stockItem!.onHand, p.stockItem!.lowStockThreshold, '']);
    const pid = old.map((p) => p.id); const sid = old.map((p) => p.stockItem!.id);
    const onHand = old.map((p) => p.stockItem!.onHand); const reserved = old.map((p) => p.stockItem!.reserved);
    const origOnHand = [...onHand]; const origReserved = [...reserved];
    const mv: Prisma.StockMovementCreateManyInput[] = [];
    for (const [i, [name, sku, cat, price, status, stock, thr]] of NEW_P.entries()) {
      const s = randomUUID();
      await db.product.create({ data: { id: newPid[i], categoryId: catId.get(cat)!, name, sku, description: `${name}, hàng chính hãng, bảo hành đầy đủ, đổi trả trong 7 ngày.`, price: BigInt(price), costPrice: BigInt(Math.round((price * (0.55 + randomInt(21) / 100)) / 1000) * 1000), status, publishedAt: status === 'draft' ? null : ago(58 - (i % 20)), searchText: fold(`${name} ${sku}`), createdAt: ago(60 - (i % 15)), updatedAt: ago(i % 9) } });
      await db.stockItem.create({ data: { id: s, productId: newPid[i], onHand: stock, reserved: 0, lowStockThreshold: thr, archivedAt: status === 'archived' ? ago(10) : null, createdAt: ago(60) } });
      mv.push({ stockItemId: s, type: 'in', quantity: stock, onHandAfter: stock, reason: 'purchase', note: 'Nhập kho ban đầu', actorId: staff.id, actorName: 'Nhân viên Kho', createdAt: ago(60) });
      P.push([name, sku, cat, price, status, stock, thr, '']); pid.push(newPid[i]); sid.push(s); onHand.push(stock); reserved.push(0);
    }
    await db.productImage.createMany({ data: productImages });
    await db.$executeRaw`UPDATE products SET cost_price = round(price * 0.7 / 1000) * 1000 WHERE cost_price IS NULL`; // sản phẩm seed cũ chưa có giá vốn: để báo cáo lợi nhuận có số

    // Coupon mới (đơn mới chỉ dùng WELCOME10 và FREESHIP, theo luật tính giảm giá của writeOrder)
    const mk = (c: string, o: Record<string, unknown>) => ({ id: randomUUID(), code: c, createdBy: admin.id, createdAt: ago(50), ...o });
    await db.coupon.createMany({ data: [
      mk('TET2027', { type: 'percentage', value: 12n, minOrderValue: 400000n, maxDiscount: 120000n, expiresAt: ago(-120), usageLimit: 300, perUserLimit: 2 }),
      mk('GIAM30K', { type: 'fixed', value: 30000n, minOrderValue: 250000n, expiresAt: ago(-45), usageLimit: 1000 }),
      mk('BLACKFRIDAY', { type: 'percentage', value: 25n, maxDiscount: 500000n, expiresAt: ago(20), usageLimit: 200, status: 'expired', consumedCount: 164 }),
      mk('NEWUSER50', { type: 'fixed', value: 50000n, minOrderValue: 300000n, expiresAt: ago(-15), usageLimit: 100, perUserLimit: 1, status: 'disabled' }),
    ] as Prisma.CouponCreateManyInput[] });
    const couponBy = Object.fromEntries((await db.coupon.findMany({ where: { code: { in: ['WELCOME10', 'FREESHIP'] } } })).map((c) => [c.code, c]));
    const ship = (await db.shippingMethod.findMany({ orderBy: { baseFee: 'asc' }, take: 2 })).map((s) => s.id); // 30k tiêu chuẩn, 55k nhanh: khớp bảng phí trong writeOrder

    // Đơn: khách hợp lệ = có địa chỉ mặc định, đang active, email @example.com
    const users = (await db.user.findMany({ where: { role: 'customer', status: 'active', emailVerifiedAt: { not: null }, email: { endsWith: '@example.com' }, addresses: { some: { isDefault: true, deletedAt: null } } }, include: { addresses: { where: { isDefault: true, deletedAt: null } } }, orderBy: { createdAt: 'asc' } }));
    const custIds = users.map((u) => u.id);
    const CUSTOMERS: CRow[] = users.map((u) => [u.fullName, u.email, u.addresses[0].phone, u.addresses[0].line1, u.addresses[0].ward, u.addresses[0].city]);
    const welcomeUsed = new Set((await db.couponRedemption.findMany({ where: { couponId: couponBy.WELCOME10.id }, select: { userId: true } })).map((r) => r.userId));
    const avail = onHand.map((h, i) => h - reserved[i]); const sellable = P.map((_, i) => i).filter((i) => P[i][4] === 'active');
    const specs: OrderSpec[] = [];
    for (let n = 0; n < N_ORDERS; n++) {
      const [m, s, flags, [lo, hi]] = pickW(COMBOS.map(([w, ...rest]) => [w, rest] as [number, typeof rest]));
      const items: [number, number][] = [];
      for (let k = between(1, 3); k > 0; k--) {
        const q = pickW<number>([[6, 1], [3, 2], [1, 3]]); const cand = sellable.filter((i) => avail[i] >= q + 5 && !items.some((it) => it[0] === i));
        if (!cand.length) break; const p = pick(cand); const qty = P[p][3] > 5e6 ? 1 : q; avail[p] -= qty; items.push([p, qty]);
      }
      if (!items.length) continue;
      const c = randomInt(custIds.length); const total = items.reduce((t, [p, q]) => t + P[p][3] * q, 0);
      let coupon: string | undefined;
      if (randomInt(100) < 15 && !['cancelled', 'expired'].includes(s)) {
        if (!welcomeUsed.has(custIds[c]) && total >= 200000) { coupon = 'WELCOME10'; welcomeUsed.add(custIds[c]); } else if (total >= 300000) coupon = 'FREESHIP';
      }
      specs.push({ c, d: between(lo, hi), items, m, ship: randomInt(10) < 3 ? 1 : 0, s, coupon, ...flags });
    }
    specs.sort((a, b) => b.d - a.d);

    const notis: Prisma.NotificationCreateManyInput[] = []; const noti = notifier(notis);
    const delivered: Ctx['delivered'] = [];
    const ctx: Ctx = { admin, cust: custIds, P, CUSTOMERS, pid, sid, ship, couponBy, onHand, reserved, mv, noti, delivered };
    const orderIds: string[] = [];
    for (const o of specs) orderIds.push(await writeOrder(db, o, ctx));
    await db.$executeRaw`UPDATE coupons c SET consumed_count = s.cc, reserved_count = s.rc FROM (SELECT coupon_id, count(*) FILTER (WHERE status = 'consumed') cc, count(*) FILTER (WHERE status = 'reserved') rc FROM coupon_redemptions GROUP BY coupon_id) s WHERE s.coupon_id = c.id AND c.code IN ('WELCOME10', 'FREESHIP')`;
    await db.$executeRaw`UPDATE order_items oi SET cost_snapshot = p.cost_price FROM products p WHERE p.id = oi.product_id AND oi.cost_snapshot IS NULL AND p.cost_price IS NOT NULL`;

    // Tồn kho: nhập thêm vài mã mới, điều chỉnh kiểm kho, rồi ghi số cuối
    const restockAt = ago(0, 5);
    for (const i of P.map((_, k) => k).filter((k) => k >= old.length && P[k][4] === 'active' && onHand[k] - reserved[k] > P[k][6]).slice(0, 4)) { onHand[i] += 40; mv.push({ stockItemId: sid[i], type: 'restock', quantity: 40, onHandAfter: onHand[i], reason: 'purchase', note: 'Nhập thêm hàng', actorId: staff.id, actorName: 'Nhân viên Kho', createdAt: restockAt }); }
    for (const [i, q, reason] of [[old.length + 1, -1, 'damaged'], [old.length + 7, -2, 'lost']] as [number, number, string][]) if (onHand[i] + q >= reserved[i]) { onHand[i] += q; mv.push({ stockItemId: sid[i], type: 'adjust', quantity: q, onHandAfter: onHand[i], reason, note: 'Kiểm kho', actorId: staff.id, actorName: 'Nhân viên Kho', createdAt: ago(0, 4) }); }
    await db.stockMovement.createMany({ data: mv });
    for (const [i, p] of P.entries()) if (onHand[i] !== (origOnHand[i] ?? -1) || reserved[i] !== (origReserved[i] ?? -1)) await db.stockItem.update({ where: { id: sid[i] }, data: { onHand: onHand[i], reserved: reserved[i], lowStockNotified: onHand[i] - reserved[i] <= p[6] } });
    for (const [i, p] of P.entries()) if (i >= old.length && p[4] === 'active' && onHand[i] - reserved[i] <= p[6]) noti(admin.id, 'low_stock', 'Sắp hết hàng', `${p[0]} còn ${onHand[i] - reserved[i]}, dưới ngưỡng ${p[6]}.`, `/admin/inventory/${pid[i]}`, ago(1), `low:${pid[i]}`, false);
    cust.forEach((u, i) => noti(u, 'welcome', 'Chào mừng đến Ecom', 'Cảm ơn bạn đã đăng ký, chúc bạn mua sắm vui vẻ.', '/products', ago(60 - i), `welcome:${u}`));

    // Đánh giá cho ~70% dòng hàng đã giao (mỗi khách chỉ 1 đánh giá cho 1 sản phẩm), một phần có ảnh
    const taken = new Set((await db.review.findMany({ where: { status: { not: 'deleted' } }, select: { userId: true, productId: true } })).map((r) => `${r.userId}:${r.productId}`));
    const agg = new Map<number, [number, number]>(); let nReviews = 0; let nReviewImages = 0;
    const texts = [...REVIEW_TEXT, ...MORE_TEXT];
    for (const d of delivered) {
      const key = `${custIds[d.user]}:${pid[d.product]}`;
      if (randomInt(10) >= 7 || taken.has(key)) continue; taken.add(key);
      const [rating, comment] = pick(texts); const status = pickW(REVIEW_STATE); const rid = randomUUID(); const at = after(d.at, 60 * between(6, 96));
      await db.review.create({ data: { id: rid, userId: custIds[d.user], productId: pid[d.product], orderItemId: d.itemId, status, rating, comment, createdAt: at, updatedAt: at,
        ...(status === 'published' || status === 'hidden' ? { publishedAt: at } : {}), ...(status === 'rejected' ? { moderatedBy: admin.id, moderatedAt: after(at, 120), moderationReason: 'Nội dung không phù hợp' } : {}), ...(status === 'hidden' ? { moderatedBy: admin.id, moderatedAt: after(at, 600), moderationReason: 'Ẩn theo yêu cầu' } : {}) } });
      await db.productReviewRating.create({ data: { reviewId: rid, productId: pid[d.product], rating, counted: status === 'published', createdAt: at, updatedAt: at } });
      nReviews++;
      if (status === 'published') { const a = agg.get(d.product) ?? [0, 0]; agg.set(d.product, [a[0] + 1, a[1] + rating]); }
      if (store && status === 'published' && randomInt(4) === 0) {
        const buf = await tile(fold(P[d.product][0]), 600, nReviews).webp().toBuffer(); const k = `reviews/${randomUUID()}.webp`;
        await store.put(k, buf, { contentType: 'image/webp' });
        await db.reviewImage.create({ data: { userId: custIds[d.user], reviewId: rid, position: 1, storageKey: k, width: 600, height: 600, bytes: buf.length, createdAt: at, updatedAt: at } }); nReviewImages++;
      }
    }
    for (const [p, [n, sum]] of agg) await db.product.update({ where: { id: pid[p] }, data: { ratingCount: { increment: n }, ratingSum: { increment: sum } } });

    // Giỏ hàng: 10 giỏ đang dùng (4 có phiên thanh toán đang mở), 3 giỏ bỏ dở (phiên hết hạn / đã hủy). Chỉ cho khách mới chưa có giỏ active.
    const hasCart = new Set((await db.cart.findMany({ where: { status: 'active' }, select: { userId: true } })).map((c) => c.userId));
    const cartUsers = cust.map((_, i) => i).filter((i) => i < 27 && !hasCart.has(cust[i])).slice(0, 13); let nCheckout = 0;
    for (const [n, u] of cartUsers.entries()) {
      const abandoned = n >= 10; const cartId = randomUUID(); const act = abandoned ? ago(between(15, 30)) : ago(0, between(1, 70));
      const its = Array.from(new Set(Array.from({ length: between(1, 3) }, () => pick(sellable)))); const total = its.reduce((t, p) => t + P[p][3], 0);
      await db.cart.create({ data: { id: cartId, userId: cust[u], status: abandoned ? 'abandoned' : 'active', lastActivityAt: act, createdAt: act, updatedAt: act, items: { create: its.map((p) => ({ productId: pid[p], quantity: between(1, 2), unitPrice: BigInt(P[p][3]) })) } } });
      if (n < 4 || abandoned) {
        const pl = PLACES[u % PLACES.length]; const fee = total >= 500000 ? 0 : 30000; nCheckout++;
        await db.checkoutSession.create({ data: { userId: cust[u], cartId, addressId: addrOf[u], shippingMethodId: ship[0], paymentMethod: n % 2 ? 'cod' : 'vnpay', addressSnapshot: { receiver: names[u], line1: pl[0], ward: pl[1], district: null, city: pl[2] }, priceSnapshot: { items_total: total, discount: 0, shipping_fee: fee, grand_total: total + fee },
          status: abandoned ? (n === 12 ? 'cancelled' : 'expired') : 'open', expiresAt: abandoned ? after(act, 30) : ago(0, -1), lastActivityAt: act, createdAt: act, updatedAt: act } });
      }
    }

    await db.notification.createMany({ data: notis });
    // Email: mỗi thông báo có kênh email thì có một bản ghi gửi (phần lớn đã gửi, vài lỗi/bỏ qua, đơn mới nhất còn chờ)
    const emails2: Prisma.EmailDeliveryCreateManyInput[] = notis.filter((x) => EMAIL_TYPES.has(x.type)).map((x) => {
      const fresh = (x.createdAt as Date) > ago(0, 12); const st = fresh ? 'pending' : pickW<'sent' | 'failed' | 'skipped'>([[93, 'sent'], [4, 'failed'], [3, 'skipped']]);
      return { userId: x.userId, type: x.type as Prisma.EmailDeliveryCreateManyInput['type'], deliveryStatus: st, deliveryReason: st === 'failed' ? 'smtp_timeout' : st === 'skipped' ? 'opted_out' : null, attempts: st === 'failed' ? 3 : st === 'sent' ? 1 : 0, nextAttemptAt: st === 'pending' ? x.createdAt : null,
        sentAt: st === 'sent' ? after(x.createdAt as Date, 1) : null, eventId: x.eventId, dedupeKey: x.dedupeKey, data: { order_code: String(x.link).split('/').pop() }, createdAt: x.createdAt, updatedAt: x.createdAt };
    });
    await db.emailDelivery.createMany({ data: emails2 });
    // Token: 2 khách chưa xác minh (1 còn hạn, 1 đã hết hạn kèm bản mới), 3 yêu cầu đặt lại mật khẩu (đã dùng / hết hạn / còn hạn)
    const tok = (user: string, status: 'issued' | 'used' | 'expired', at: Date, ttlH: number) => ({ userId: user, tokenHash: hex(64), status, expiresAt: after(at, 60 * ttlH), createdAt: at, usedAt: status === 'used' ? after(at, 20) : null, updatedAt: at });
    await db.emailVerificationToken.createMany({ data: [tok(cust[28], 'issued', ago(0, 3), 24), tok(cust[29], 'expired', ago(5), 24), tok(cust[29], 'issued', ago(0, 8), 24)] });
    await db.passwordResetToken.createMany({ data: [tok(cust[3], 'used', ago(12), 1), tok(cust[8], 'expired', ago(9), 1), tok(cust[14], 'issued', ago(0, 0.5), 1)] });
    await db.emailDelivery.createMany({ data: [28, 29].map((i) => ({ userId: cust[i], type: 'email_verification' as const, deliveryStatus: 'sent' as const, attempts: 1, sentAt: ago(0, 3), eventId: randomUUID(), dedupeKey: `verify:${cust[i]}`, data: {}, createdAt: ago(0, 3), updatedAt: ago(0, 3) })) });

    // Nhật ký webhook VNPay theo từng lượt thanh toán của đơn mới, thêm vài IPN sai chữ ký và IPN trùng
    const atts = await db.paymentAttempt.findMany({ where: { payment: { orderId: { in: orderIds } }, status: { in: ['succeeded', 'failed'] } }, include: { payment: true } });
    const hooks: Prisma.PaymentWebhookLogCreateManyInput[] = atts.flatMap((a, i) => {
      const ok = a.status === 'succeeded'; const at = a.resolvedAt ?? a.createdAt;
      const payload = { vnp_TmnCode: 'DEMO', vnp_TxnRef: a.txnRef, vnp_Amount: String(Number(a.payment.amount) * 100), vnp_ResponseCode: a.gatewayCode ?? '24', vnp_TransactionStatus: ok ? '00' : '02', vnp_TransactionNo: a.providerTxnNo ?? '0', vnp_BankCode: 'NCB', vnp_PayDate: a.createDate.toISOString().replace(/\D/g, '').slice(0, 14) };
      return [{ paymentId: a.paymentId, txnRef: a.txnRef, payload, signatureValid: true, rspCode: '00', result: ok ? 'confirmed' : 'payment_failed', createdAt: at },
        ...(ok && i % 9 === 0 ? [{ paymentId: a.paymentId, txnRef: a.txnRef, payload, signatureValid: true, rspCode: '02', result: 'already_confirmed', createdAt: after(at, 1) }] : [])];
    });
    for (let k = 0; k < 3; k++) hooks.push({ paymentId: null, txnRef: `${hex(16)}01`, payload: { vnp_TmnCode: 'DEMO', vnp_ResponseCode: '00', vnp_SecureHash: hex(32) }, signatureValid: false, rspCode: '97', result: 'bad_signature', createdAt: ago(k * 3 + 1) });
    await db.paymentWebhookLog.createMany({ data: hooks });

    // Nhật ký kiểm toán: đăng nhập, xem dashboard, tạo sản phẩm/coupon, điều chỉnh kho, duyệt đánh giá
    const au = (role: string, actor: string | null, action: string, targetType: string, targetId: string, at: Date, extra: Partial<Prisma.AuditLogCreateManyInput> = {}): Prisma.AuditLogCreateManyInput => ({ actorId: actor, actorRole: role, action, targetType, targetId, correlationId: randomUUID(), createdAt: at, ...extra });
    const audits: Prisma.AuditLogCreateManyInput[] = [];
    cust.forEach((u, i) => { for (let k = between(1, 3); k > 0; k--) audits.push(au('customer', u, 'auth.login', 'user', u, ago(between(0, 59 - i)))); });
    for (let k = 0; k < 25; k++) audits.push(au('admin', admin.id, 'auth.login', 'user', admin.id, ago(between(0, 44), between(0, 12))), au('admin', admin.id, 'dashboard.view', 'dashboard', 'sales', ago(between(0, 44), between(0, 12))));
    for (let k = 0; k < 10; k++) audits.push(au('staff', staff.id, 'auth.login', 'user', staff.id, ago(between(0, 44), between(0, 12))));
    NEW_P.forEach((p, i) => audits.push(au('admin', admin.id, 'catalog.product.create', 'product', newPid[i], ago(60 - (i % 15)), { after: { sku: p[1], name: p[0], price: p[3], status: p[4] } })));
    for (const m of mv.filter((x) => x.type !== 'in' && x.type !== 'sale' && x.type !== 'return')) audits.push(au('staff', staff.id, 'inventory.stock.adjust', 'stock_item', m.stockItemId, m.createdAt as Date, { after: { type: m.type, quantity: m.quantity, on_hand_after: m.onHandAfter }, reason: m.note }));
    for (const c of ['TET2027', 'GIAM30K', 'BLACKFRIDAY', 'NEWUSER50']) audits.push(au('admin', admin.id, 'promotion.coupon.create', 'coupon', c, ago(50), { after: { code: c } }));
    await db.auditLog.createMany({ data: audits });

    return `${cust.length} khách + 1 nhân viên bán hàng, ${NEW_CATS.length} danh mục, ${NEW_P.length} sản phẩm (${productImages.length} ảnh), 4 coupon, ${specs.length} đơn, ${nReviews} đánh giá (${nReviewImages} ảnh), ${cartUsers.length} giỏ, ${nCheckout} phiên thanh toán, ${notis.length} thông báo, ${emails2.length + 2} email, ${hooks.length} webhook, ${audits.length} audit log`;
  }, { timeout: 600000, maxWait: 10000 });
  process.stdout.write(`seed-demo-more xong: ${summary} (mật khẩu khách mới: ${DEMO_PASSWORD})\n`);
  await client.$disconnect();
}
if (require.main === module) void main().catch((e) => { process.stderr.write(`${e instanceof Error ? e.stack : e}\n`); process.exit(1); });
