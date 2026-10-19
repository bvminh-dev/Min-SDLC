import { randomUUID } from 'node:crypto';
import type { Test } from 'supertest';
import { AppModule } from '../../src/app.module';
import { CatalogApi } from '../../src/modules/catalog';
import { BlockCache } from '../../src/modules/dashboard/cache.service';
import { DashboardService } from '../../src/modules/dashboard/dashboard.service';
import { SourceGate } from '../../src/modules/dashboard/sources.service';
import { InventoryApi } from '../../src/modules/inventory';
import { OrderApi } from '../../src/modules/order';
import { VNPAY_GATEWAY } from '../../src/modules/payment/gateway';
import { PaymentApi } from '../../src/modules/payment';
import { UserApi } from '../../src/modules/user';
import { createAuthApp, q, seedUser, type AuthApp } from './auth';
import { FakeS3 } from './fake-s3';
import { FakeGateway, PAY_ENV, seedPayment, seedRefund } from './pay';
import { insertOrder, type PayStatus, type SeedOrder, type Status } from './order-fixture';
import { call as callJson, type CallOpts } from './usr';
import { seedCategory, seedProduct, who, type Who } from './prd';
import { seedStock } from './inv';

/** Hôm nay của mọi test DSH: 2026-10-06T03:00:00Z = 10:00 giờ Việt Nam (fixed-clock: DSH-TC ghi đồng hồ cố định, mọi mốc dữ liệu mồi tính quanh mốc này). */
export const NOW = new Date('2026-10-06T03:00:00Z'); // fixed-clock: mốc cố định của test DSH, đồng hồ giả cho MỌI nguồn thời gian (DSH, AUTH, kho đếm); dữ liệu mồi ghi mốc thật vào CSDL
export const MIN = 60_000;
export const DAY = 86_400_000;
/** Thời điểm theo giờ Việt Nam: `ict('2026-10-05', '10:00')`. */
export const ict = (date: string, hhmm = '00:00', ss = '00'): Date => new Date(`${date}T${hhmm}:${ss}+07:00`);

export interface DshApp extends AuthApp {
  cat: string; fake: FakeS3; gw: FakeGateway; pay: PaymentApi; ord: OrderApi; catalog: CatalogApi; inv: InventoryApi; usr: UserApi; svc: DashboardService; cache: BlockCache; gate: SourceGate;
}
export const ALL_SOURCES = ['pay', 'ord', 'catalog', 'inv', 'usr'] as const;

/**
 * Ứng dụng THẬT (AppModule: mọi module), PostgreSQL thật, kho ảnh S3 giả trong tiến trình, cổng VNPay là `FakeGateway`. DSH không có bản giả của nguồn nào: test đếm lời gọi hay gài lỗi, chậm,
 * treo bằng `jest.spyOn` trên chính các lớp `*Api` mà DSH dùng (OrderApi, PaymentApi, CatalogApi, InventoryApi, UserApi). Đồng hồ giả đặt về NOW (10:00 giờ Việt Nam ngày 06/10/2026).
 */
export async function createDshApp(o: { env?: Record<string, string>; level?: string } = {}): Promise<DshApp> {
  const fake = new FakeS3();
  await fake.start();
  const storage = { STORAGE_ENDPOINT: fake.url, STORAGE_BUCKET: fake.bucket, STORAGE_REGION: 'us-east-1', STORAGE_ACCESS_KEY: fake.accessKey, STORAGE_SECRET_KEY: fake.secretKey };
  const gw = new FakeGateway();
  const t = await createAuthApp({ imports: [AppModule], controllers: [], level: o.level, env: { ...PAY_ENV, ...storage, ...(o.env ?? {}) }, overrides: [{ provide: VNPAY_GATEWAY, useValue: gw }] });
  t.clock.set(NOW);
  const a = t.app;
  const closeBase = t.close;
  return Object.assign(t, {
    cat: '', fake, gw, pay: a.get(PaymentApi), ord: a.get(OrderApi), catalog: a.get(CatalogApi), inv: a.get(InventoryApi), usr: a.get(UserApi), svc: a.get(DashboardService), cache: a.get(BlockCache), gate: a.get(SourceGate),
    close: async () => { jest.restoreAllMocks(); await closeBase(); await fake.stop(); },
  }) as DshApp;
}

/** Sổ sạch cho mỗi test: dữ liệu, bộ nhớ đệm, kho đếm (đồng hồ về NOW). */
export async function reset(t: DshApp): Promise<void> {
  const { truncateAll } = await import('./db');
  jest.restoreAllMocks();
  await truncateAll(t.prisma);
  await t.prisma.$executeRaw`TRUNCATE rate_limit_counters`;
  t.cache.clear();
  (t.svc as unknown as { marks: Map<string, number> }).marks.clear();
  t.cat = ''; // seedStock giữ id danh mục giữa các lần gọi: truncate đã xóa danh mục
  t.clock.set(NOW);
  t.logs.clear();
}

export interface People { admin: Who; staff: Who; customer: Who; admin2: Who }
export async function people(t: DshApp): Promise<People> {
  return { admin: await who(t, 'admin', 'admin@shop.vn'), staff: await who(t, 'staff', 'staff@shop.vn'), customer: await who(t, 'customer', 'khach@shop.vn'), admin2: await who(t, 'admin', 'admin2@shop.vn') };
}

export const get = (t: AuthApp, cookie: string | undefined, path: string, o: CallOpts = {}): Test => callJson(t, 'get', path, { cookie, ...o });
export const DASH = { revenue: '/admin/dashboard/revenue', orders: '/admin/dashboard/orders', customers: '/admin/dashboard/customers', products: '/admin/dashboard/products', lowStock: '/admin/dashboard/low-stock', recent: '/admin/dashboard/recent-orders' };
export const REPORT = { revenue: '/admin/reports/revenue', orders: '/admin/reports/orders', products: '/admin/reports/products', sources: '/admin/reports/sources', sales: '/admin/reports/sales' };
export const ALL_PATHS = [...Object.values(DASH), ...Object.values(REPORT)];
export const RANGE_Q = '?from=2026-10-01&to=2026-10-06';
/** Hàng đợi sự kiện khỏi việc: bỏ `trace_id` khi so sánh thân phản hồi. */
export const noTrace = (b: Record<string, unknown>): Record<string, unknown> => { const { trace_id: _t, ...rest } = b; return rest; };

/** Căn đồng hồ giả tới giây thứ 1 của phút kế (cửa sổ cố định 60 giây của kho đếm: tránh một loạt yêu cầu bị chia đôi ở ranh giới phút, L104). */
export const alignWindow = (t: AuthApp, seconds = 60): void => t.clock.set(new Date(Math.ceil(t.clock.now().getTime() / (seconds * 1000)) * seconds * 1000 + 1000));

// --- Dữ liệu mồi dựng thẳng trong CSDL (fixture); nguồn thật là PAY, ORD, PRD, INV, AUTH: DSH đọc lại qua giao diện đọc.
export interface PaidOpts { amount?: number; method?: 'vnpay' | 'cod'; status?: PayStatus; refund?: { at: Date; amount?: number; reason?: 'order_cancelled' | 'order_expired' | 'late_payment' | 'duplicate_payment' | 'admin_manual'; status?: 'succeeded' | 'failed' | 'requested' } | 'failed' | 'requested' }
/** Payment với `paid_at` (và Refund tùy chọn) dựng như api.spec của PAY: Payment hoàn thành công thì sang `refunded`. */
export async function paid(t: DshApp, at: Date | null, o: PaidOpts = {}) {
  const method = o.method ?? 'vnpay';
  const refundDone = typeof o.refund === 'object' && (o.refund.status ?? 'succeeded') === 'succeeded';
  const status: PayStatus = o.status ?? (refundDone ? 'refunded' : 'succeeded');
  const user = (await seedUser(t)).id;
  const online = method === 'vnpay';
  const pay = await seedPayment(t, { user, method, amount: o.amount ?? 100_000, status, paidAt: at, attemptNo: online ? 1 : 0, attempts: online ? 'auto' : [], orderStatus: method === 'cod' && status === 'succeeded' ? 'delivered' : undefined });
  if (o.refund && online) {
    const r = typeof o.refund === 'object' ? o.refund : { at: at ?? NOW, status: o.refund };
    await seedRefund(t, { paymentId: pay.id, attemptId: pay.attempts[0].id, amount: r.amount, reason: r.reason ?? 'order_cancelled', status: r.status ?? 'succeeded', resolvedAt: 'at' in r ? r.at : undefined });
  }
  return pay;
}

/** Đơn dựng thẳng (fixture); trả `{ id, code, user }`. */
export async function order(t: DshApp, o: SeedOrder = {}): Promise<{ id: string; code: string; user: string }> {
  return insertOrder(t.prisma, t.clock.now(), { ...o, user: o.user ?? (await seedUser(t)).id });
}
export const ORDER_KEYS = ['pending', 'confirmed', 'paid', 'shipped', 'delivered', 'returned', 'cancelled', 'expired'] as const;
export const zeroStatus = (over: Partial<Record<(typeof ORDER_KEYS)[number], number>> = {}) => ({ ...Object.fromEntries(ORDER_KEYS.map((k) => [k, 0])), ...over });

let seq = 0;
/** Danh mục dùng chung của test (cùng `t.cat` mà `seedStock` dùng, để không tạo trùng tên). */
export const category0 = async (t: DshApp): Promise<string> => t.cat || (t.cat = await seedCategory(t, 'Áo'));
export async function product(t: DshApp, o: { name?: string; sku?: string; price?: number; status?: 'draft' | 'active' | 'archived' } = {}): Promise<string> {
  const category = await category0(t);
  const i = ++seq;
  return seedProduct(t as never, { category, name: o.name ?? `Sản phẩm DSH ${i}`, sku: o.sku ?? `DSH-${String(i).padStart(4, '0')}`, price: o.price ?? 100_000, status: o.status ?? 'active', images: 0 });
}
export { seedStock, who, q, seedUser, randomUUID };
export type { Status, PayStatus };

/** Đặt hạn nguồn (mili giây) cho một test: gate đọc cấu hình ở mỗi lời gọi. */
export function withTimeout(t: AuthApp, ms: number): void {
  const orig = t.config.get.bind(t.config) as (n: string) => unknown;
  jest.spyOn(t.config, 'get').mockImplementation(((n: string) => (n === 'DASHBOARD_SOURCE_TIMEOUT_MS' ? ms : orig(n))) as never);
}
/** Nguồn treo (không bao giờ trả lời) hoặc trả lời sau `ms`: dùng với `jest.spyOn(...).mockImplementation`. */
export const hang = <T>(): Promise<T> => new Promise<T>(() => {});
export const later = <T>(ms: number, v: T): Promise<T> => new Promise<T>((r) => setTimeout(() => r(v), ms));
export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
export const SECRET_SQL = 'SELECT * FROM payments WHERE db-prod-1';

/** Người dùng hàng loạt dựng thẳng bằng một câu INSERT ... SELECT generate_series (không băm mật khẩu thật): `n` người role `role`, `locked` trong số đó bị khóa, tạo lúc `createdAt`. */
export async function bulkUsers(t: AuthApp, o: { role?: 'customer' | 'staff' | 'admin'; n: number; locked?: number; createdAt: Date; tag?: string }): Promise<void> {
  const tag = o.tag ?? `bulk${++seq}`;
  await t.prisma.$executeRaw`
    INSERT INTO users (email, password_hash, full_name, role, email_verified_at, status, locked_reason, created_at, updated_at)
    SELECT ${tag} || '-' || g || '@bulk.test', 'x', 'Người ' || g, ${o.role ?? 'customer'}::user_role, ${o.createdAt}::timestamptz,
           CASE WHEN g <= ${o.locked ?? 0} THEN 'locked'::user_status ELSE 'active'::user_status END, CASE WHEN g <= ${o.locked ?? 0} THEN 'admin'::lock_reason ELSE NULL END,
           ${o.createdAt}::timestamptz, ${o.createdAt}::timestamptz
    FROM generate_series(1, ${o.n}) g`;
}

// --- Hai báo cáo tính lương (đợt bán hộ): đơn dựng thẳng bằng fixture `insertOrder` (đơn hộ có `ho`, đơn khách tự đặt không có), nguồn dữ liệu vẫn là `OrderApi` thật; hôm nay là 15/10/2026.
/** Hôm nay của hai báo cáo mới (fixed-clock: DSH-TC-20261015-* ghi đồng hồ cố định 2026-10-15T03:00:00Z = 10:00 giờ Việt Nam). */
export const NOW15 = new Date('2026-10-15T03:00:00Z'); // fixed-clock: mốc cố định của test hai báo cáo bán hộ
/** Sổ sạch, đồng hồ về 15/10/2026 TRƯỚC khi tạo người dùng (phiên tính theo đồng hồ), danh mục nguồn về dữ liệu mồi. */
export async function resetSales(t: DshApp): Promise<People> {
  await reset(t);
  t.clock.set(NOW15);
  for (const sql of ['ALTER TABLE order_sources DISABLE TRIGGER USER', "DELETE FROM order_sources WHERE code NOT IN ('website', 'facebook', 'tiktok', 'hotline')",
    "INSERT INTO order_sources (code, name) VALUES ('facebook', 'Facebook'), ('tiktok', 'TikTok'), ('hotline', 'Hotline') ON CONFLICT (code) DO NOTHING", // test trước có thể đã xóa bớt nguồn
    "UPDATE order_sources SET is_active = true, position = 0, name = CASE code WHEN 'tiktok' THEN 'TikTok' ELSE initcap(code) END", 'ALTER TABLE order_sources ENABLE TRIGGER USER']) await q(t, sql);
  return people(t);
}
/** Nguồn đơn do admin thêm (`active` mặc định bật). */
export async function addSource(t: DshApp, code: string, name: string, active = true): Promise<void> {
  await t.prisma.$executeRaw`INSERT INTO order_sources (code, name, is_active) VALUES (${code}, ${name}, ${active})`;
}
/** Đơn hộ của `by` (id người tạo) vào nguồn `source` (mã), mặc định `confirmed`, 100.000 + 30.000 vận chuyển bị thay bằng `total` (một dòng hàng `total - 30000`). */
export async function hoOrder(t: DshApp, by: string, o: { source?: string; total: number; status?: Status; at?: Date; role?: 'sale' | 'admin' }): Promise<string> {
  const r = await insertOrder(t.prisma, t.clock.now(), {
    user: null, status: o.status ?? 'confirmed', createdAt: o.at ?? new Date('2026-10-02T03:00:00Z'), items: [{ price: o.total - 30_000, qty: 1 }], shipping: 30_000,
    ho: { createdBy: by, role: o.role, source: o.source ?? 'hotline', customer: { full_name: 'Khách lẻ', phone: '0900000000' } },
  });
  return r.id;
}
/** Đơn khách tự đặt (`created_by` rỗng, nguồn `website`) của một khách có tài khoản. */
export async function webOrder(t: DshApp, o: { total: number; status?: Status; at?: Date }): Promise<string> {
  return (await order(t, { status: o.status ?? 'paid', createdAt: o.at ?? new Date('2026-10-02T03:00:00Z'), items: [{ price: o.total - 30_000, qty: 1 }], shipping: 30_000 })).id;
}
/** Người dùng role `sale` có tên. */
export async function saleUser(t: DshApp, name: string, role: 'sale' | 'staff' | 'customer' | 'admin' = 'sale'): Promise<string> {
  return (await seedUser(t, { role, name, email: `${name.normalize('NFD').replace(/[^a-z0-9]/gi, '').toLowerCase()}${++seq}@shop.vn` })).id;
}

/** Bộ phân tích CSV RFC 4180 tối thiểu (dấu phẩy, nháy kép nhân đôi, xuống dòng trong ô được bao nháy): chính tệp CSV được đọc lại, không so chuỗi. Bỏ BOM đầu nếu có. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], cell = '', quoted = false;
  const s = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quoted) { if (c === '"') { if (s[i + 1] === '"') { cell += '"'; i++; } else quoted = false; } else cell += c; continue; }
    if (c === '"') quoted = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\r' && s[i + 1] === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; i++; }
    else cell += c;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows;
}
/** Dòng `dashboard.export` trong kho audit, theo thứ tự thời gian. */
export const exportRows = (t: AuthApp) => q<{ actor_id: string; actor_role: string; action: string; target_type: string; target_id: string; after: { report: string; from: string; to: string; rows: number }; created_at: Date }>(t, "SELECT actor_id, actor_role, action, target_type, target_id, after, created_at FROM audit_logs WHERE action = 'dashboard.export' ORDER BY created_at, id");
