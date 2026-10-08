import { randomUUID } from 'node:crypto';
import { PlatformModule, EventsService, JobRunner, TransactionService, runWithCorrelation, type EventEnvelope, type Tx } from '../../src/modules/platform';
import { AuthModule } from '../../src/modules/auth/auth.module';
import { PromotionApi, PromotionModule } from '../../src/modules/promotion';
import { EvaluateService, type ReserveInput } from '../../src/modules/promotion/evaluate.service';
import { JobsService } from '../../src/modules/promotion/jobs.service';
import { LifecycleService } from '../../src/modules/promotion/lifecycle.service';
import { createAuthApp, q, seedSession, seedUser, type AuthApp } from './auth';
import { call } from './usr';

export interface PrmApp extends AuthApp { prm: PromotionApi; evaluator: EvaluateService; life: LifecycleService; jobs: JobsService; tx: TransactionService; runner: JobRunner }

/**
 * Ứng dụng thật (PlatformModule + AuthModule + PromotionModule), PostgreSQL thật; pool lớn hơn mặc định test để chạy giao dịch song song thật.
 * Đồng hồ giả đặt về GIỜ THẬT lúc dựng (không mốc ngày cố định) để đồng hồ của ứng dụng và `now()` của CSDL không lệch nhau khi ngày trôi qua.
 */
export async function createPrmApp(o: { env?: Record<string, string>; level?: string } = {}): Promise<PrmApp> {
  const t = await createAuthApp({ imports: [PlatformModule, AuthModule, PromotionModule], controllers: [], level: o.level, env: { TRUST_PROXY_HOPS: '1', DB_POOL_MAX: '16', ...(o.env ?? {}) } });
  t.clock.set(new Date(Math.floor(Date.now() / 1000) * 1000));
  return Object.assign(t, { prm: t.app.get(PromotionApi), evaluator: t.app.get(EvaluateService), life: t.app.get(LifecycleService), jobs: t.app.get(JobsService), tx: t.app.get(TransactionService), runner: t.app.get(JobRunner) });
}

export interface SeedCoupon {
  code?: string; type?: 'percentage' | 'fixed'; value?: number; min?: number; max?: number | null; usageLimit?: number; perUser?: number | null;
  consumed?: number; reserved?: number; status?: 'active' | 'disabled' | 'expired' | 'exhausted' | 'deleted'; version?: number;
  /** Số giây tính từ GIỜ CSDL (âm là đã quá hạn); mặc định còn 7 ngày. Làm tròn tới mili giây (như ISO 8601 của API) để so ranh giới bằng Date của JS không mất vi giây. */
  expiresInSec?: number; createdAt?: Date;
}
let n = 0;
/** Coupon dựng thẳng trong CSDL (fixture, không qua API): hạn tính từ giờ CSDL để không lệch với đồng hồ giả. Trả `{ id, code }`. */
export async function seedCoupon(t: AuthApp, o: SeedCoupon = {}): Promise<{ id: string; code: string }> {
  const code = (o.code ?? `CP${String(++n).padStart(5, '0')}${Math.random().toString(36).slice(2, 5).toUpperCase()}`).toUpperCase();
  const type = o.type ?? 'percentage', status = o.status ?? 'active';
  const rows = await t.prisma.$queryRaw<{ id: string }[]>`
    INSERT INTO coupons (code, type, value, min_order_value, max_discount, expires_at, usage_limit, per_user_limit, consumed_count, reserved_count, status, version, deleted_at, created_by, created_at)
    VALUES (${code}, ${type}::coupon_type, ${o.value ?? 10}, ${o.min ?? 0}, ${type === 'percentage' ? (o.max ?? null) : null}, date_trunc('milliseconds', now() + make_interval(secs => ${o.expiresInSec ?? 7 * 86400})), ${o.usageLimit ?? 100}, ${o.perUser ?? null},
      ${o.consumed ?? 0}, ${o.reserved ?? 0}, ${status}::coupon_status, ${o.version ?? 1}, ${status === 'deleted' ? new Date() : null}::timestamptz, ${randomUUID()}::uuid, ${o.createdAt ?? new Date()}::timestamptz)
    RETURNING id`;
  return { id: rows[0].id, code };
}
/** Một lượt dựng thẳng (fixture); khớp bộ đếm của coupon là việc của bên gọi (seedCoupon consumed, reserved). */
export async function seedRedemption(t: AuthApp, couponId: string, o: { order?: string; user?: string; amount?: number; status?: 'reserved' | 'consumed' | 'released' } = {}): Promise<{ id: string; order: string; user: string }> {
  const order = o.order ?? randomUUID(), user = o.user ?? randomUUID(), status = o.status ?? 'reserved';
  const rows = await t.prisma.$queryRaw<{ id: string }[]>`
    INSERT INTO coupon_redemptions (coupon_id, order_id, user_id, amount, status, consumed_at, released_at)
    VALUES (${couponId}::uuid, ${order}::uuid, ${user}::uuid, ${o.amount ?? 30000}, ${status}::redemption_status,
      ${status === 'consumed' ? new Date() : null}::timestamptz, ${status === 'released' ? new Date() : null}::timestamptz) RETURNING id`;
  return { id: rows[0].id, order, user };
}

export const couponOf = async (t: AuthApp, code: string) =>
  (await q<{ id: string; code: string; status: string; version: number; consumed_count: number; reserved_count: number; usage_limit: number; per_user_limit: number | null; value: string; max_discount: string | null; min_order_value: string; deleted_at: Date | null; expires_at: Date; type: string }>(
    t, `SELECT id, code, status::text AS status, version, consumed_count, reserved_count, usage_limit, per_user_limit, value::text AS value, max_discount::text AS max_discount, min_order_value::text AS min_order_value, deleted_at, expires_at, type::text AS type FROM coupons WHERE code = '${code}'`))[0];
export const redemptionsOf = (t: AuthApp, couponId: string) =>
  q<{ id: string; order_id: string; user_id: string; amount: string; status: string; consumed_at: Date | null; released_at: Date | null }>(
    t, `SELECT id, order_id, user_id, amount::text AS amount, status::text AS status, consumed_at, released_at FROM coupon_redemptions WHERE coupon_id = '${couponId}' ORDER BY created_at, id`);
export const redemptionOfOrder = async (t: AuthApp, order: string) =>
  (await q<{ id: string; coupon_id: string; status: string; amount: string; consumed_at: Date | null; released_at: Date | null }>(t, `SELECT id, coupon_id, status::text AS status, amount::text AS amount, consumed_at, released_at FROM coupon_redemptions WHERE order_id = '${order}'`))[0];
export const snapshotTables = async (t: AuthApp): Promise<string> =>
  JSON.stringify([await q(t, 'SELECT * FROM coupons ORDER BY id'), await q(t, 'SELECT * FROM coupon_redemptions ORDER BY id')], (_k, v) => (typeof v === 'bigint' ? v.toString() : v));
export const eventsOf = (t: AuthApp, type?: string) =>
  q<{ type: string; aggregate_id: string; payload: any; id: string }>(t, `SELECT id, type, aggregate_id, payload FROM outbox_events ${type ? `WHERE type = '${type}'` : `WHERE type LIKE 'Coupon%'`} ORDER BY occurred_at, id`);
export const auditOf = (t: AuthApp, action: string) =>
  q<{ actor_id: string; actor_role: string; target_id: string; before: any; after: any }>(t, `SELECT actor_id, actor_role, target_id, before, after FROM audit_logs WHERE action = '${action}' ORDER BY created_at, id`);
export const auditCount = async (t: AuthApp, like = 'promotion.%'): Promise<number> => (await q<{ n: number }>(t, `SELECT count(*)::int AS n FROM audit_logs WHERE action LIKE '${like}'`))[0].n;
export const countOf = async (t: AuthApp, table: string, where = 'TRUE'): Promise<number> => (await q<{ n: number }>(t, `SELECT count(*)::int AS n FROM ${table} WHERE ${where}`))[0].n;

/** Người dùng có phiên (cookie dựng thẳng trong CSDL). */
export async function actor(t: AuthApp, role: 'customer' | 'staff' | 'admin', email = `${role}@shop.vn`): Promise<{ id: string; cookie: string }> {
  const u = await seedUser(t, { email, role });
  return { id: u.id, cookie: (await seedSession(t, u.id)).cookie };
}

/** Giữ lượt qua giao diện nội bộ, trong MỘT giao dịch như CHK (cam kết khi xong; ném lỗi thì quay lui). */
export const reserve = (t: PrmApp, input: Partial<ReserveInput> & { code: string }, o: { now?: Date } = {}) =>
  t.tx.run((tx: Tx) => t.evaluator.reserve({ order_id: randomUUID(), user_id: randomUUID(), items_subtotal: 300000, ...input }, tx, o));
export const rid = (): string => randomUUID();

/** Giao một event cho mọi consumer đã đăng ký (như relay, nhưng không chờ lịch); `event_id` tùy chọn để thử giao lại cùng event. Dựng theo đúng phong bì và payload của events.md vì ORD, PAY chưa có code. */
export async function deliver(t: AuthApp, type: string, payload: Record<string, unknown>, eventId: string = randomUUID()): Promise<void> {
  const env: EventEnvelope = { event_id: eventId, type, aggregate_type: 'x', aggregate_id: String(payload.order_id ?? 'x'), payload, occurred_at: new Date().toISOString(), correlation_id: 'test-corr' };
  await runWithCorrelation(env.correlation_id, async () => { for (const sub of t.app.get(EventsService).consumersFor(type)) await t.app.get(EventsService).deliver(sub, env); });
}
export const paid = (order: string, user = rid()) => ({ payment_id: rid(), order_id: order, order_code: 'ORD-X', user_id: user, amount: 270000, method: 'vnpay', paid_at: new Date().toISOString() });
export const confirmed = (order: string, user = rid()) => ({ order_id: order, order_code: 'ORD-X', user_id: user, confirmed_at: new Date().toISOString() });
export const cancelled = (order: string, o: { reason?: string; was_paid?: boolean; user?: string } = {}) => ({ order_id: order, order_code: 'ORD-X', user_id: o.user ?? rid(), reason: o.reason ?? 'customer_request', was_paid: o.was_paid ?? false });
export const expiredOrder = (order: string, user = rid()) => ({ order_id: order, order_code: 'ORD-X', user_id: user });

/** Chạy relay outbox thật hai lượt (event cách nhau hạn thuê và backoff được bỏ qua bằng mốc giờ tương lai). */
export async function relay(t: AuthApp, rounds = 2): Promise<void> {
  const base = Date.now() + 10_000;
  for (let i = 0; i < rounds; i++) await t.relay.runOnce(new Date(base + i * 120_000));
}
export { call, seedSession, seedUser, q };

/** Dọn bộ đếm giới hạn tần suất (bậc D của endpoint quản trị là 30 mỗi phút mỗi người: test gọi nhiều lần dọn giữa chừng thay vì tua đồng hồ làm hết phiên). */
export const resetLimits = (t: AuthApp) => t.prisma.$executeRaw`TRUNCATE rate_limit_counters`;
