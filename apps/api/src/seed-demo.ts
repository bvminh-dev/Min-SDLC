// Dữ liệu mẫu để xem giao diện (chỉ dev): `pnpm --filter @ecom/api db:seed:demo`. Chạy lại thì bỏ qua nếu đã có khách mẫu.
// Ghi thẳng bằng MIGRATE_DATABASE_URL (vai trò ecom_app bị hạn chế); mọi dòng thỏa các CHECK của migration. Mật khẩu mọi tài khoản mẫu: DEMO_PASSWORD.
import 'reflect-metadata';
import { randomBytes, randomInt, randomUUID } from 'node:crypto';
import { PrismaClient, Prisma } from '@prisma/client';
import { hashPassword } from './modules/auth/crypto';

export const DEMO_PASSWORD = 'Demo-Pass-2026!';
const ALPHA = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const code = () => Array.from({ length: 12 }, () => ALPHA[randomInt(ALPHA.length)]).join('');
const hex = (n: number) => randomBytes(n / 2).toString('hex');
const ago = (days: number, hours = 0) => new Date(Date.now() - days * 864e5 - hours * 36e5);
const after = (d: Date, mins: number) => new Date(d.getTime() + mins * 6e4);
const slug = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const fold = (s: string) => slug(s).replace(/-/g, ' ');

type OS = 'pending' | 'confirmed' | 'paid' | 'shipped' | 'delivered' | 'cancelled' | 'expired' | 'returned';
interface OrderSpec { c: number; d: number; items: [number, number][]; m: 'cod' | 'vnpay'; ship: number; s: OS; paidThenCancel?: boolean; payFailed?: boolean; shipFailed?: boolean; coupon?: string }

// [tên, sku, danh mục, giá, trạng thái, tồn đầu, ngưỡng thấp, mô tả]
const P: [string, string, string, number, 'active' | 'draft' | 'archived', number, number, string][] = [
  ['Áo thun cotton basic', 'AT-COTTON-01', 'ao', 159000, 'active', 120, 10, 'Áo thun cotton 100%, form rộng, mềm mát, giặt không xù.'],
  ['Áo sơ mi oxford nam', 'SM-OXFORD-02', 'ao', 349000, 'active', 60, 8, 'Sơ mi oxford dài tay, chống nhăn, hợp đi làm.'],
  ['Áo khoác gió 2 lớp', 'AK-GIO-03', 'ao', 459000, 'active', 8, 6, 'Chống nước nhẹ, có mũ trùm, gấp gọn bỏ túi.'],
  ['Áo len cổ tròn', 'AL-COTRON-04', 'ao', 289000, 'draft', 40, 5, 'Len mịn giữ ấm, màu trung tính.'],
  ['Giày sneaker trắng', 'GS-TRANG-05', 'giay-dep', 790000, 'active', 45, 6, 'Đế êm, da tổng hợp, dễ phối đồ.'],
  ['Dép sandal quai ngang', 'DS-QUAI-06', 'giay-dep', 199000, 'active', 80, 10, 'Đế cao su chống trượt, nhẹ.'],
  ['Giày chạy bộ Air Lite', 'GC-AIRLITE-07', 'giay-dep', 1290000, 'active', 7, 5, 'Đệm khí, lưới thoáng, chạy đường dài.'],
  ['Balo laptop 15.6 inch', 'BL-LAPTOP-08', 'phu-kien', 420000, 'active', 55, 8, 'Chống nước, ngăn laptop lót mút, cổng sạc USB.'],
  ['Thắt lưng da bò', 'TL-DABO-09', 'phu-kien', 250000, 'archived', 15, 5, 'Da bò thật, khóa kim loại.'],
  ['Điện thoại Nova 12', 'DT-NOVA12-10', 'dien-thoai', 8990000, 'active', 25, 5, 'Màn 6.7 inch AMOLED 120Hz, pin 5000mAh, sạc nhanh 67W.'],
  ['Điện thoại Lite A5', 'DT-LITEA5-11', 'dien-thoai', 3490000, 'active', 4, 5, 'Màn 6.5 inch, pin trâu 2 ngày, giá mềm.'],
  ['Ốp lưng chống sốc', 'OP-CHONGSOC-12', 'dien-thoai', 89000, 'active', 200, 20, 'Viền cao bảo vệ camera, trong suốt không ố.'],
  ['Laptop Slim 14', 'LT-SLIM14-13', 'laptop', 15990000, 'active', 12, 3, 'Core i5, RAM 16GB, SSD 512GB, nặng 1.2kg.'],
  ['Chuột không dây Silent', 'CH-SILENT-14', 'laptop', 220000, 'active', 90, 10, 'Click êm, pin 12 tháng, kết nối 2.4G và Bluetooth.'],
  ['Bàn phím cơ TKL', 'BP-CO-TKL-15', 'laptop', 890000, 'active', 30, 5, 'Switch đỏ, đèn nền, kết nối có dây.'],
  ['Tai nghe Bluetooth Pro', 'TN-BTPRO-16', 'am-thanh', 1190000, 'active', 40, 6, 'Chống ồn chủ động, pin 30 giờ.'],
  ['Loa mini Boom', 'LO-BOOM-17', 'am-thanh', 650000, 'active', 3, 5, 'Chống nước IP67, bass mạnh, pin 12 giờ.'],
  ['Đèn bàn LED chống cận', 'DB-LED-18', 'noi-that', 320000, 'active', 70, 8, '3 chế độ sáng, cổng sạc điện thoại, gập gọn.'],
  ['Kệ sách gỗ 5 tầng', 'KS-GO5-19', 'noi-that', 1450000, 'active', 18, 4, 'Gỗ MDF chống ẩm, lắp ráp dễ.'],
  ['Ghế công thái học', 'GH-CTH-20', 'noi-that', 2790000, 'active', 9, 3, 'Tựa lưng lưới, tay vịn 3D, bảo hành 24 tháng.'],
  ['Nồi chiên không dầu 5L', 'NC-KHONGDAU-21', 'nha-bep', 1590000, 'active', 35, 5, 'Công suất 1500W, 8 chế độ nấu, lòng nồi chống dính.'],
  ['Bộ dao bếp 6 món', 'BD-DAO6-22', 'nha-bep', 540000, 'active', 50, 6, 'Thép không gỉ, kèm đế gỗ.'],
  ['Máy xay sinh tố mini', 'MX-MINI-23', 'nha-bep', 390000, 'draft', 25, 5, 'Cối thủy tinh 600ml, dùng sạc USB.'],
  ['Bình giữ nhiệt 750ml', 'BG-NHIET-24', 'nha-bep', 180000, 'active', 110, 12, 'Inox 304, giữ nóng 12 giờ, giữ lạnh 24 giờ.'],
];
const CATS: [string, string | null][] = [['Thời trang', null], ['Điện tử', null], ['Nhà cửa', null], ['Áo', 'Thời trang'], ['Giày dép', 'Thời trang'], ['Phụ kiện', 'Thời trang'], ['Điện thoại', 'Điện tử'], ['Laptop & phụ kiện', 'Điện tử'], ['Âm thanh', 'Điện tử'], ['Nội thất', 'Nhà cửa'], ['Nhà bếp', 'Nhà cửa']];
const CAT_KEY: Record<string, string> = { ao: 'Áo', 'giay-dep': 'Giày dép', 'phu-kien': 'Phụ kiện', 'dien-thoai': 'Điện thoại', laptop: 'Laptop & phụ kiện', 'am-thanh': 'Âm thanh', 'noi-that': 'Nội thất', 'nha-bep': 'Nhà bếp' };

const CUSTOMERS: [string, string, string, string, string, string][] = [ // tên, email, sđt, đường, phường, thành phố
  ['Nguyễn Văn An', 'an.nguyen@example.com', '0912345678', '12 Nguyễn Huệ', 'Bến Nghé', 'Hồ Chí Minh'],
  ['Trần Thị Bình', 'binh.tran@example.com', '0987654321', '45 Lê Lợi', 'Hải Châu 1', 'Đà Nẵng'],
  ['Lê Hoàng Cường', 'cuong.le@example.com', '0935111222', '8 Phố Huế', 'Phạm Đình Hổ', 'Hà Nội'],
  ['Phạm Minh Dung', 'dung.pham@example.com', '0903777888', '99 Trần Phú', 'Lộc Thọ', 'Nha Trang'],
  ['Hoàng Gia Huy', 'huy.hoang@example.com', '0868999000', '27 Điện Biên Phủ', 'Phường 6', 'Hồ Chí Minh'],
  ['Võ Thu Hà', 'ha.vo@example.com', '0777123456', '5 Hùng Vương', 'Xuân Hòa', 'Cần Thơ'],
  ['Đặng Quốc Khánh', 'khanh.dang@example.com', '0944556677', '150 Kim Mã', 'Ngọc Khánh', 'Hà Nội'],
  ['Bùi Lan Phương', 'phuong.bui@example.com', '0966888999', '33 Bạch Đằng', 'Hải Châu 2', 'Đà Nẵng'],
];

const ORDERS: OrderSpec[] = [
  { c: 0, d: 29, items: [[9, 1], [11, 2]], m: 'vnpay', ship: 1, s: 'delivered' },
  { c: 1, d: 27, items: [[0, 3], [4, 1]], m: 'cod', ship: 0, s: 'delivered', coupon: 'WELCOME10' },
  { c: 2, d: 25, items: [[12, 1]], m: 'vnpay', ship: 1, s: 'delivered' },
  { c: 3, d: 24, items: [[15, 1], [13, 1]], m: 'vnpay', ship: 0, s: 'delivered' },
  { c: 4, d: 22, items: [[19, 1]], m: 'cod', ship: 0, s: 'delivered' },
  { c: 5, d: 20, items: [[20, 1], [23, 2]], m: 'cod', ship: 0, s: 'delivered' },
  { c: 0, d: 18, items: [[7, 1], [5, 2]], m: 'vnpay', ship: 0, s: 'delivered', coupon: 'FREESHIP' },
  { c: 6, d: 16, items: [[17, 2]], m: 'vnpay', ship: 0, s: 'returned' },
  { c: 7, d: 14, items: [[1, 2], [0, 2]], m: 'cod', ship: 0, s: 'delivered' },
  { c: 1, d: 12, items: [[14, 1]], m: 'vnpay', ship: 1, s: 'cancelled', paidThenCancel: true },
  { c: 2, d: 11, items: [[21, 1]], m: 'cod', ship: 0, s: 'cancelled' },
  { c: 3, d: 9, items: [[2, 1]], m: 'vnpay', ship: 0, s: 'cancelled', payFailed: true },
  { c: 4, d: 8, items: [[16, 1]], m: 'vnpay', ship: 0, s: 'expired' },
  { c: 5, d: 6, items: [[9, 1]], m: 'vnpay', ship: 1, s: 'shipped' },
  { c: 6, d: 5, items: [[22, 2]], m: 'cod', ship: 0, s: 'shipped' },
  { c: 7, d: 5, items: [[3, 1], [10, 1]], m: 'cod', ship: 0, s: 'shipped', shipFailed: true },
  { c: 0, d: 3, items: [[12, 1], [14, 1]], m: 'vnpay', ship: 1, s: 'paid' },
  { c: 1, d: 2, items: [[4, 2]], m: 'vnpay', ship: 0, s: 'paid' },
  { c: 2, d: 2, items: [[18, 1]], m: 'cod', ship: 0, s: 'confirmed' },
  { c: 3, d: 1, items: [[6, 1]], m: 'cod', ship: 1, s: 'confirmed' },
  { c: 4, d: 0, items: [[11, 1], [7, 1]], m: 'vnpay', ship: 0, s: 'pending' },
  { c: 5, d: 0, items: [[23, 3]], m: 'cod', ship: 0, s: 'pending' },
  { c: 6, d: 0, items: [[0, 1]], m: 'cod', ship: 0, s: 'pending' },
];
const REVIEW_TEXT: [number, string][] = [
  [5, 'Hàng đúng mô tả, đóng gói cẩn thận, giao nhanh. Rất hài lòng!'], [5, 'Chất lượng tốt hơn mong đợi so với giá tiền.'], [4, 'Dùng ổn, chỉ hơi tiếc là màu thực tế nhạt hơn ảnh.'],
  [4, 'Giao hàng nhanh, sản phẩm dùng tốt, sẽ ủng hộ tiếp.'], [3, 'Tạm được, đúng giá. Hộp hơi móp khi nhận.'], [5, 'Mua lần thứ hai rồi, vẫn rất ưng.'], [2, 'Không giống kỳ vọng lắm, mong shop cải thiện.'],
];

async function main() {
  // eslint-disable-next-line no-restricted-syntax -- điểm vào CLI của seed demo, không phải mã ứng dụng
  if (process.env.APP_ENV !== 'dev') { process.stderr.write('seed-demo bị từ chối: chỉ chạy khi APP_ENV=dev\n'); process.exit(1); }
  // eslint-disable-next-line no-restricted-syntax -- như trên
  const url = process.env.MIGRATE_DATABASE_URL;
  if (!url || !/localhost|127\.0\.0\.1/.test(url)) { process.stderr.write('seed-demo cần MIGRATE_DATABASE_URL trỏ localhost\n'); process.exit(1); }
  const client = new PrismaClient({ datasources: { db: { url } } });
  if (await client.user.findUnique({ where: { email: CUSTOMERS[0][1] } })) { process.stdout.write('đã có dữ liệu mẫu, bỏ qua\n'); await client.$disconnect(); return; }

  const admin = await client.user.findFirstOrThrow({ where: { role: 'admin' } });
  const pw = await hashPassword(DEMO_PASSWORD, { memory: 19456, passes: 2, parallelism: 1 });
  const t0 = ago(45);
  await client.$transaction(async (db) => { // một giao dịch: lỗi giữa chừng thì không để lại dữ liệu nửa vời

  // Người dùng: 1 nhân viên, 8 khách (1 chưa xác minh email, 1 bị khóa)
  const staff = randomUUID();
  await db.user.create({ data: { id: staff, email: 'staff@example.com', passwordHash: pw, role: 'staff', fullName: 'Nhân viên Kho', phone: '0901234567', emailVerifiedAt: t0, createdAt: t0 } });
  const cust = CUSTOMERS.map(() => randomUUID());
  for (const [i, [name, email, phone]] of CUSTOMERS.entries()) {
    await db.user.create({ data: { id: cust[i], email, passwordHash: pw, fullName: name, phone, createdAt: ago(44 - i * 2), emailVerifiedAt: i === 7 ? null : ago(44 - i * 2), ...(i === 5 ? { status: 'locked', lockedReason: 'admin' } : {}) } });
  }
  const addr = cust.map(() => randomUUID());
  await db.address.createMany({ data: CUSTOMERS.map(([name, , phone, line1, ward, city], i) => ({ id: addr[i], userId: cust[i], receiver: name, phone, line1, ward, district: null, city, isDefault: true, createdAt: ago(40) })) });

  // Danh mục và sản phẩm
  const catId: Record<string, string> = {};
  for (const [name, parent] of CATS) {
    catId[name] = randomUUID();
    await db.category.create({ data: { id: catId[name], name, slug: slug(name), parentId: parent ? catId[parent] : null, depth: parent ? 2 : 1, createdAt: t0 } });
  }
  const pid = P.map(() => randomUUID());
  const sid = P.map(() => randomUUID());
  for (const [i, [name, sku, cat, price, status, onHand, thr, desc]] of P.entries()) {
    await db.product.create({ data: { id: pid[i], categoryId: catId[CAT_KEY[cat]], name, sku, description: desc, price: BigInt(price), status, publishedAt: status === 'draft' ? null : ago(40 - i), searchText: fold(`${name} ${sku}`), createdAt: ago(44 - (i % 20)), updatedAt: ago(i % 7) } });
    await db.stockItem.create({ data: { id: sid[i], productId: pid[i], onHand, reserved: 0, lowStockThreshold: thr, archivedAt: status === 'archived' ? ago(10) : null, createdAt: ago(44) } });
  }

  // Vận chuyển và coupon
  const ship = [randomUUID(), randomUUID(), randomUUID()];
  await db.shippingMethod.createMany({ data: [
    { id: ship[0], name: 'Giao tiêu chuẩn', baseFee: 30000n, rule: { free_over: 500000, surcharge: 0, surcharge_cities: [] }, createdAt: t0 },
    { id: ship[1], name: 'Giao nhanh 24h', baseFee: 55000n, rule: { free_over: 2000000, surcharge: 15000, surcharge_cities: ['Hà Nội', 'Hồ Chí Minh'] }, createdAt: t0 },
    { id: ship[2], name: 'Hỏa tốc 2 giờ', baseFee: 90000n, rule: { free_over: null, surcharge: 0, surcharge_cities: [] }, isActive: false, createdAt: t0 },
  ] });
  const mk = (codeStr: string, o: Record<string, unknown>) => ({ id: randomUUID(), code: codeStr, createdBy: admin.id, createdAt: ago(40), ...o });
  const coupons = [
    mk('WELCOME10', { type: 'percentage', value: 10n, minOrderValue: 200000n, maxDiscount: 50000n, expiresAt: ago(-60), usageLimit: 500, perUserLimit: 1 }),
    mk('FREESHIP', { type: 'fixed', value: 30000n, minOrderValue: 300000n, expiresAt: ago(-30), usageLimit: 200 }),
    mk('SALE50K', { type: 'fixed', value: 50000n, minOrderValue: 500000n, expiresAt: ago(5), usageLimit: 100, status: 'expired', consumedCount: 37 }),
    mk('FLASH20', { type: 'percentage', value: 20n, maxDiscount: 200000n, expiresAt: ago(-10), usageLimit: 50, status: 'exhausted', consumedCount: 50 }),
    mk('VIP15', { type: 'percentage', value: 15n, minOrderValue: 1000000n, maxDiscount: 300000n, expiresAt: ago(-90), usageLimit: 100, status: 'disabled' }),
  ];
  await db.coupon.createMany({ data: coupons as Prisma.CouponCreateManyInput[] });
  const couponBy = Object.fromEntries(coupons.map((c) => [c.code, c]));

  // Đơn hàng + thanh toán + vận đơn + lịch sử + tồn kho
  const onHand = P.map((p) => p[5]);
  const reserved = P.map(() => 0);
  const mv: Prisma.StockMovementCreateManyInput[] = P.map((p, i) => ({ stockItemId: sid[i], type: 'in', quantity: p[5], onHandAfter: p[5], reason: 'purchase', note: 'Nhập kho ban đầu', actorId: admin.id, actorName: 'Quản trị viên', createdAt: ago(44) }));
  const notis: Prisma.NotificationCreateManyInput[] = [];
  const noti = (user: string, type: Prisma.NotificationCreateManyInput['type'], title: string, body: string, link: string, at: Date, key: string, read = true) =>
    notis.push({ userId: user, type, title, body, link, status: read ? 'read' : 'unread', readAt: read ? after(at, 30) : null, eventId: randomUUID(), dedupeKey: key, createdAt: at, updatedAt: at, data: {} });
  const delivered: { orderId: string; itemId: string; product: number; user: number; at: Date }[] = [];
  const sold = new Map<number, number>();

  for (const o of ORDERS.sort((a, b) => b.d - a.d)) {
    const id = randomUUID(); const oc = code(); const at = ago(o.d, 2);
    const items = o.items.map(([p, q], pos) => ({ id: randomUUID(), p, q, pos: pos + 1 }));
    const itemsTotal = items.reduce((s, it) => s + P[it.p][3] * it.q, 0);
    const sm = [{ b: 30000, f: 500000 }, { b: 55000, f: 2000000 }][o.ship]; const city = CUSTOMERS[o.c][5];
    const sur = o.ship === 1 && ['Hà Nội', 'Hồ Chí Minh'].includes(city) ? 15000 : 0;
    const fee = itemsTotal >= sm.f ? 0 : sm.b + sur;
    let discount = 0;
    if (o.coupon === 'WELCOME10') discount = Math.min(Math.round(itemsTotal * 0.1), 50000);
    if (o.coupon === 'FREESHIP') discount = 30000;
    const grand = itemsTotal - discount + fee;
    const vn = o.m === 'vnpay';
    const paidStates: OS[] = ['paid', 'shipped', 'delivered', 'returned'];
    const paidOnline = vn && (paidStates.includes(o.s) || o.paidThenCancel);
    const codDone = !vn && (o.s === 'delivered');
    const payStatus = o.s === 'expired' ? 'expired' : o.s === 'cancelled' ? (o.paidThenCancel ? 'refunded' : o.payFailed ? 'failed' : 'cancelled') : o.s === 'returned' ? 'refunded' : paidOnline || codDone ? 'succeeded' : 'pending';
    const paidAt = paidOnline ? after(at, 12) : codDone ? ago(o.d - 4) : null;
    const confirmedAt = !vn && o.s !== 'pending' && o.s !== 'cancelled' && o.s !== 'expired' ? after(at, 90) : null;
    const hist: { from: OS | null; to: OS; role: 'customer' | 'admin' | 'system'; actor?: string; reason?: string; at: Date }[] = [{ from: null, to: 'pending', role: 'customer', actor: cust[o.c], at }];
    let cur: OS = 'pending'; let step = 1;
    const go = (to: OS, role: 'customer' | 'admin' | 'system', reason?: string) => { hist.push({ from: cur, to, role, actor: role === 'admin' ? admin.id : undefined, reason, at: after(at, 60 * 6 * step++) }); cur = to; };
    if (vn && paidOnline) go('paid', 'system');
    if (!vn && ['confirmed', 'shipped', 'delivered', 'returned'].includes(o.s)) go('confirmed', 'admin');
    if (o.s === 'shipped' || o.s === 'delivered' || o.s === 'returned') go('shipped', 'admin');
    if (o.s === 'delivered' || o.s === 'returned') go('delivered', 'system');
    if (o.s === 'returned') go('returned', 'admin');
    if (o.s === 'cancelled') go('cancelled', o.payFailed ? 'system' : o.paidThenCancel ? 'admin' : 'customer', o.payFailed ? 'Thanh toán thất bại' : o.paidThenCancel ? 'Khách đổi ý, hoàn tiền' : 'Khách yêu cầu hủy');
    if (o.s === 'expired') go('expired', 'system');
    const tracking = ['shipped', 'delivered', 'returned'].includes(o.s) ? `VN${randomInt(1e9, 9e9)}` : null;
    const deliveredAt = o.s === 'delivered' || o.s === 'returned' ? hist.find((h) => h.to === 'delivered')!.at : null;
    const cancelledBy = o.payFailed ? 'system' : o.paidThenCancel ? 'admin' : 'customer';
    await db.order.create({ data: {
      id, userId: cust[o.c], code: oc, status: o.s, paymentStatus: payStatus, itemsTotal: BigInt(itemsTotal), discount: BigInt(discount), shippingFee: BigInt(fee), grandTotal: BigInt(grand),
      shippingAddress: { receiver: CUSTOMERS[o.c][0], phone: CUSTOMERS[o.c][2], line1: CUSTOMERS[o.c][3], ward: CUSTOMERS[o.c][4], district: null, city }, shippingMethodId: ship[o.ship], paymentMethod: o.m,
      paymentExpiresAt: vn ? (o.s === 'pending' ? ago(0, -23) : after(at, 15)) : null, trackingNumber: tracking,
      ...(o.s === 'cancelled' ? { cancelReason: o.payFailed ? 'payment_failed' : o.paidThenCancel ? 'admin' : 'customer_request', cancelledByRole: cancelledBy } : {}),
      handoffLockedAt: ['shipped', 'delivered', 'returned'].includes(o.s) ? hist.find((h) => h.to === 'shipped')!.at : null,
      confirmedAt, paidAt, deliveredAt: o.s === 'delivered' ? deliveredAt : null, createdAt: at, updatedAt: hist[hist.length - 1].at,
      items: { create: items.map((it) => ({ id: it.id, productId: pid[it.p], nameSnapshot: P[it.p][0], unitPrice: BigInt(P[it.p][3]), quantity: it.q, position: it.pos })) },
      history: { create: hist.map((h) => ({ fromStatus: h.from, toStatus: h.to, actorId: h.actor ?? null, actorRole: h.role, reason: h.reason ?? null, createdAt: h.at })) },
    } });
    // Thanh toán
    const payId = randomUUID();
    await db.payment.create({ data: { id: payId, orderId: id, orderCode: oc, userId: cust[o.c], amount: BigInt(grand), method: o.m, status: payStatus, attemptNo: vn && payStatus !== 'pending' ? 1 : 0, providerRef: paidOnline || (payStatus === 'refunded' && vn) ? `VNP${randomInt(1e9, 9e9)}` : null, expiresAt: vn ? (o.s === 'pending' ? ago(0, -23) : after(at, 15)) : null, paidAt, version: 1, createdAt: at, updatedAt: paidAt ?? at } });
    if (vn && payStatus !== 'pending' && payStatus !== 'cancelled') {
      const attId = randomUUID(); const ok = paidOnline;
      await db.paymentAttempt.create({ data: { id: attId, paymentId: payId, attemptNo: 1, txnRef: `${hex(16)}01`, status: ok ? 'succeeded' : payStatus === 'expired' ? 'superseded' : 'failed', reason: o.payFailed ? 'declined' : null, gatewayCode: ok ? '00' : o.payFailed ? '51' : null, providerTxnNo: ok ? `${randomInt(1e8, 9e8)}` : null, createDate: at, expiresAt: after(at, 15), resolvedAt: after(at, 12), createdAt: at, updatedAt: after(at, 12) } });
      if (payStatus === 'refunded') await db.refund.create({ data: { paymentId: payId, attemptId: attId, amount: BigInt(grand), reason: 'admin_manual', note: o.s === 'returned' ? 'Hoàn tiền do khách trả hàng' : 'Hoàn tiền do khách hủy đơn', requestedBy: admin.id, status: 'succeeded', gatewayCode: '00', gatewayRequestId: hex(32), requestedAt: hist[hist.length - 1].at, resolvedAt: after(hist[hist.length - 1].at, 3), createdAt: hist[hist.length - 1].at } });
    }
    // Vận đơn
    const needShip = ['confirmed', 'paid', 'shipped', 'delivered', 'returned'].includes(o.s);
    if (needShip) {
      const shipped = hist.find((h) => h.to === 'shipped')?.at ?? null;
      const failed = o.shipFailed; const st = o.s === 'delivered' ? 'delivered' : o.s === 'returned' ? 'returned' : o.s === 'shipped' ? (failed ? 'failed' : 'shipped') : 'pending';
      const shId = randomUUID();
      await db.shipment.create({ data: { id: shId, orderId: id, shippingMethodId: ship[o.ship], status: st, trackingNumber: st === 'pending' ? null : tracking, orderCode: oc, codAmount: vn ? 0n : BigInt(grand), shippedAt: shipped, deliveredAt: st === 'delivered' || st === 'returned' ? deliveredAt : null, version: 1, createdAt: at, updatedAt: shipped ?? at,
        history: { create: [{ event: 'status_changed', status: 'pending', createdAt: at }, ...(shipped ? [{ event: 'status_changed' as const, status: 'shipped' as const, trackingNumber: tracking, createdAt: shipped }] : []),
          ...(st === 'delivered' || st === 'returned' ? [{ event: 'status_changed' as const, status: 'delivered' as const, trackingNumber: tracking, createdAt: deliveredAt! }] : []),
          ...(st === 'returned' ? [{ event: 'status_changed' as const, status: 'returned' as const, trackingNumber: tracking, createdAt: after(deliveredAt!, 600) }] : []),
          ...(st === 'failed' ? [{ event: 'status_changed' as const, status: 'failed' as const, trackingNumber: tracking, reasonCode: 'customer_unreachable' as const, note: 'Gọi 3 lần không liên lạc được', createdAt: after(shipped!, 300) }] : [])] } } });
    }
    // Tồn kho: đã giao đi thì trừ, đang giữ thì reserve, hủy/hết hạn thì nhả
    for (const it of items) {
      const kept = ['pending', 'confirmed', 'paid'].includes(o.s);
      const out = ['shipped', 'delivered', 'returned'].includes(o.s);
      await db.stockReservation.create({ data: { stockItemId: sid[it.p], orderId: id, quantity: it.q, status: kept ? 'held' : out ? 'committed' : o.s === 'expired' ? 'expired' : 'released', expiresAt: o.s === 'expired' ? after(at, 15) : kept && vn ? ago(0, -23) : null, createdAt: at, updatedAt: at } });
      if (kept) reserved[it.p] += it.q;
      if (out) {
        onHand[it.p] -= it.q; sold.set(it.p, (sold.get(it.p) ?? 0) + it.q);
        mv.push({ stockItemId: sid[it.p], type: 'sale', quantity: -it.q, onHandAfter: onHand[it.p], refType: 'order', refId: id, createdAt: hist.find((h) => h.to === 'shipped')!.at });
        if (o.s === 'returned') { onHand[it.p] += it.q; mv.push({ stockItemId: sid[it.p], type: 'return', quantity: it.q, onHandAfter: onHand[it.p], refType: 'order', refId: id, createdAt: after(deliveredAt!, 600) }); }
      }
    }
    // Coupon
    if (o.coupon && !['cancelled', 'expired'].includes(o.s)) {
      const c = couponBy[o.coupon]; const cons = ['delivered', 'shipped', 'paid', 'confirmed', 'returned'].includes(o.s);
      await db.couponRedemption.create({ data: { couponId: c.id, orderId: id, userId: cust[o.c], amount: BigInt(discount), status: cons ? 'consumed' : 'reserved', reservedAt: at, consumedAt: cons ? after(at, 5) : null, createdAt: at } });
    }
    // Thông báo cho khách
    noti(cust[o.c], 'order_created', 'Đã đặt đơn', `Đơn ${oc} đã được tạo, tổng ${grand.toLocaleString('vi-VN')} đ.`, `/orders/${oc}`, at, `order:${id}:created`);
    for (const h of hist.slice(1)) {
      const map: Partial<Record<OS, [Prisma.NotificationCreateManyInput['type'], string, string]>> = { confirmed: ['order_confirmed', 'Đơn đã xác nhận', 'đang được chuẩn bị'], paid: ['payment_succeeded', 'Thanh toán thành công', 'đã được thanh toán'], shipped: ['order_shipped', 'Đơn đang giao', 'đã giao cho đơn vị vận chuyển'], delivered: ['order_delivered', 'Đã giao hàng', 'đã giao thành công'], cancelled: ['order_cancelled', 'Đơn đã hủy', 'đã bị hủy'], expired: ['order_expired', 'Đơn hết hạn', 'đã hết hạn thanh toán'], returned: ['order_returned', 'Đơn đã trả', 'đã được hoàn trả'] };
      const m = map[h.to]; if (m) noti(cust[o.c], m[0], m[1], `Đơn ${oc} ${m[2]}.`, `/orders/${oc}`, h.at, `order:${id}:${h.to}`, o.d > 3);
    }
    if (o.s === 'delivered') items.forEach((it) => delivered.push({ orderId: id, itemId: it.id, product: it.p, user: o.c, at: deliveredAt! }));
  }

  // Cập nhật tồn kho cuối, nhập thêm hàng cho vài mã
  for (const i of [2, 10, 16]) { onHand[i] += 0; }
  for (const [i] of P.entries()) await db.stockItem.update({ where: { id: sid[i] }, data: { onHand: onHand[i], reserved: reserved[i], lowStockNotified: onHand[i] - reserved[i] <= P[i][6] } });
  mv.push({ stockItemId: sid[7], type: 'adjust', quantity: -2, onHandAfter: onHand[7], reason: 'damaged', note: 'Hỏng khi kiểm kho', actorId: staff, actorName: 'Nhân viên Kho', createdAt: ago(7) } as Prisma.StockMovementCreateManyInput);
  onHand[7] -= 2; await db.stockItem.update({ where: { id: sid[7] }, data: { onHand: onHand[7] } });
  await db.stockMovement.createMany({ data: mv });
  for (const [i, p] of P.entries()) if (p[4] === 'active' && onHand[i] - reserved[i] <= p[6]) noti(admin.id, 'low_stock', 'Sắp hết hàng', `${p[0]} còn ${onHand[i] - reserved[i]}, dưới ngưỡng ${p[6]}.`, `/admin/inventory/${pid[i]}`, ago(1), `low:${pid[i]}`, false);
  CUSTOMERS.forEach((c, i) => noti(cust[i], 'welcome', 'Chào mừng đến Ecom', 'Cảm ơn bạn đã đăng ký, chúc bạn mua sắm vui vẻ.', '/products', ago(44 - i * 2), `welcome:${cust[i]}`));

  // Đánh giá cho các đơn đã giao: đa số published, vài cái chờ duyệt, từ chối, ẩn
  const states = ['published', 'published', 'published', 'published', 'pending', 'published', 'rejected', 'published', 'hidden', 'pending', 'published', 'published'] as const;
  const agg = new Map<number, [number, number]>();
  for (const [i, d] of delivered.entries()) {
    const [rating, comment] = REVIEW_TEXT[i % REVIEW_TEXT.length]; const status = states[i % states.length]; const rid = randomUUID();
    const at = after(d.at, 60 * 24 * 2);
    await db.review.create({ data: { id: rid, userId: cust[d.user], productId: pid[d.product], orderItemId: d.itemId, status, rating, comment, createdAt: at, updatedAt: at,
      ...(status === 'published' || status === 'hidden' ? { publishedAt: at } : {}), ...(status === 'rejected' ? { moderatedBy: admin.id, moderatedAt: after(at, 120), moderationReason: 'Nội dung không phù hợp' } : {}), ...(status === 'hidden' ? { moderatedBy: admin.id, moderatedAt: after(at, 600), moderationReason: 'Ẩn theo yêu cầu' } : {}) } });
    const counted = status === 'published';
    await db.productReviewRating.create({ data: { reviewId: rid, productId: pid[d.product], rating, counted, createdAt: at, updatedAt: at } });
    if (counted) { const a = agg.get(d.product) ?? [0, 0]; agg.set(d.product, [a[0] + 1, a[1] + rating]); }
  }
  for (const [p, [n, sum]] of agg) await db.product.update({ where: { id: pid[p] }, data: { ratingCount: n, ratingSum: sum } });

  // Giỏ hàng đang dùng
  for (const [u, its] of [[4, [[0, 2], [5, 1]]], [7, [[15, 1]]]] as [number, [number, number][]][]) {
    await db.cart.create({ data: { userId: cust[u], lastActivityAt: ago(0, 3), items: { create: its.map(([p, q]) => ({ productId: pid[p], quantity: q, unitPrice: BigInt(P[p][3]) })) } } });
  }
  process.stdout.write(`seed-demo xong: ${P.length} sản phẩm, ${ORDERS.length} đơn, ${delivered.length} đánh giá, ${CUSTOMERS.length} khách + 1 nhân viên (mật khẩu ${DEMO_PASSWORD})\n`);
  }, { timeout: 300000, maxWait: 10000 });
  await client.$disconnect();
}
void main().catch((e) => { process.stderr.write(`${e instanceof Error ? e.stack : e}\n`); process.exit(1); });
