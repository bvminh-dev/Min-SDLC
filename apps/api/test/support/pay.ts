import { randomBytes, randomUUID } from 'node:crypto';
import { PlatformModule, TransactionService, JobRunner, type Tx } from '../../src/modules/platform';
import { AuthModule } from '../../src/modules/auth/auth.module';
import { OrderApi, OrderModule } from '../../src/modules/order';
import { CancelService } from '../../src/modules/order/cancel.service';
import { LifecycleService as OrderLifecycle } from '../../src/modules/order/lifecycle.service';
import { PaymentApi, PaymentModule } from '../../src/modules/payment';
import { CodService } from '../../src/modules/payment/cod.service';
import { LifecycleService as PayLifecycle } from '../../src/modules/payment/lifecycle.service';
import { ReadService } from '../../src/modules/payment/read.service';
import { ReconcileService } from '../../src/modules/payment/reconcile.service';
import { RefundService } from '../../src/modules/payment/refund.service';
import { StartService } from '../../src/modules/payment/start.service';
import { WebhookService } from '../../src/modules/payment/webhook.service';
import { VNPAY_GATEWAY, type QueryInput, type QueryResult, type RefundInput, type RefundResult, type VnpayGateway } from '../../src/modules/payment/gateway';
import { sign } from '../../src/modules/payment/vnpay';
import { ORIGIN } from './app';
import { createAuthApp, http, q, type AuthApp } from './auth';
import { insertOrder, type PayStatus, type Status as OrderStatus } from './order-fixture';
import { call, who, type Who } from './prd';

/** Khóa ký của test (dev, giá trị giả; tiền tố `test` nên máy quét bí mật bỏ qua). Prod bị cấu hình từ chối giá trị giữ chỗ (PAY-TC-20261007-085337388). */
export const SECRET = 'test-vnpay-hash-secret-jest-0123456789abcdef';
export const TMN = 'TESTTMN1';
export const RETURN_URL = 'https://shop.example/orders/{order_code}/payment';
export const PAY_ENV = { VNPAY_TMN_CODE: TMN, VNPAY_HASH_SECRET: SECRET, VNPAY_RETURN_URL: RETURN_URL, TRUST_PROXY_HOPS: '1', DB_POOL_MAX: '16' };

/** Bộ giả lập cổng VNPay dựng theo tài liệu (querydr, refund): lập trình được kết quả từng lời gọi, ghi lại mọi lệnh nhận được; có chế độ treo (hết hạn gọi 10 giây) và chế độ chậm. CHƯA thử với sandbox thật. */
export class FakeGateway implements VnpayGateway {
  queries: QueryInput[] = [];
  refundCalls: RefundInput[] = [];
  queryImpl: (i: QueryInput) => QueryResult | Promise<QueryResult> = () => ({ kind: 'not_found' });
  refundImpl: (i: RefundInput, n: number) => RefundResult | Promise<RefundResult> = () => ({ kind: 'succeeded', code: '00' });
  /** Khi đặt, mọi lời gọi hoàn tiền chờ promise này (chậm hoặc treo) trước khi trả lời. */
  refundGate: Promise<void> | null = null;
  private releases: (() => void)[] = [];
  /** Treo mọi lời gọi hoàn tiền (cổng chậm hay hết hạn gọi) cho tới khi gọi hàm trả về; `reset` luôn nhả để không treo ứng dụng khi tắt. */
  hold(): () => void {
    let r!: () => void;
    this.refundGate = new Promise<void>((res) => { r = res; });
    this.releases.push(r);
    return () => { this.refundGate = null; r(); };
  }
  /** Số lệnh hoàn khác nhau (theo mã yêu cầu): cổng thật chỉ hoàn một lần cho mỗi mã. */
  get distinctRefundRequests(): number { return new Set(this.refundCalls.map((c) => c.requestId)).size; }
  async queryTransaction(i: QueryInput): Promise<QueryResult> { this.queries.push(i); return this.queryImpl(i); }
  async refund(i: RefundInput): Promise<RefundResult> {
    this.refundCalls.push(i);
    if (this.refundGate) await this.refundGate;
    return this.refundImpl(i, this.refundCalls.length);
  }
  reset(): void { for (const r of this.releases.splice(0)) r(); this.queries = []; this.refundCalls = []; this.queryImpl = () => ({ kind: 'not_found' }); this.refundImpl = () => ({ kind: 'succeeded', code: '00' }); this.refundGate = null; }
}

export interface PayApp extends AuthApp {
  ord: OrderApi; pay: PaymentApi; tx: TransactionService; gw: FakeGateway; orderLife: OrderLifecycle; cancels: CancelService;
  refunds: RefundService; reconcile: ReconcileService; webhook: WebhookService; starts: StartService; cods: CodService; reads: ReadService; payLife: PayLifecycle; jobs: JobRunner;
}

/**
 * Ứng dụng thật (PlatformModule + AuthModule + OrderModule + PaymentModule), PostgreSQL thật, cổng VNPay là bộ giả lập `FakeGateway`; pool lớn hơn mặc định test để chạy giao dịch song song thật.
 * Đồng hồ giả đặt về GIỜ THẬT lúc dựng (không mốc ngày cố định): `created_at` ghi theo đồng hồ của ứng dụng, hạn so với đồng hồ đó.
 */
export async function createPayApp(o: { env?: Record<string, string>; level?: string } = {}): Promise<PayApp> {
  const gw = new FakeGateway();
  const t = await createAuthApp({ imports: [PlatformModule, AuthModule, OrderModule, PaymentModule], controllers: [], level: o.level, env: { ...PAY_ENV, ...(o.env ?? {}) }, overrides: [{ provide: VNPAY_GATEWAY, useValue: gw }] });
  t.clock.set(new Date(Math.floor(Date.now() / 1000) * 1000));
  const a = t.app;
  const base = t.close;
  return Object.assign(t, {
    ord: a.get(OrderApi), pay: a.get(PaymentApi), tx: a.get(TransactionService), gw, orderLife: a.get(OrderLifecycle), cancels: a.get(CancelService), refunds: a.get(RefundService),
    reconcile: a.get(ReconcileService), webhook: a.get(WebhookService), starts: a.get(StartService), cods: a.get(CodService), reads: a.get(ReadService), payLife: a.get(PayLifecycle), jobs: a.get(JobRunner),
    close: async () => { await a.get(RefundService).idle(); await base(); },
  });
}
export { call, q, who, http, ORIGIN, type Who };

export type Method = 'vnpay' | 'cod';
export type AttemptStatus = 'processing' | 'succeeded' | 'failed' | 'superseded';
export type Reason = 'cancelled_by_user' | 'declined' | 'timeout' | 'other';
export const MINUTE = 60_000;

/** Mã tham chiếu hợp lệ của lượt thử (16 hex và số lượt hai chữ số). */
export const txnRefOf = (no = 1): string => `${randomBytes(8).toString('hex')}${String(no).padStart(2, '0')}`;
let transactionSeq = 14_000_000;
/** Mã giao dịch của cổng (vnp_TransactionNo), duy nhất trong một lần chạy. */
export const txNoOf = (): string => String(++transactionSeq);

export interface SeedAttempt { no?: number; status?: AttemptStatus; reason?: Reason | null; txnRef?: string; createdAt?: Date; expiresAt?: Date; txNo?: string | null; code?: string | null }
export interface SeedPayment {
  user?: string; method?: Method; amount?: number; status?: PayStatus; attemptNo?: number; expiresAt?: Date | null; paidAt?: Date | null; providerRef?: string | null; createdAt?: Date;
  orderStatus?: OrderStatus; orderCode?: string; order?: { id: string; code: string; user: string }; attempts?: SeedAttempt[] | 'auto'; version?: number;
}
export interface SeededPayment { id: string; order: { id: string; code: string; user: string }; attempts: { id: string; txnRef: string; no: number; txNo: string | null }[]; providerRef: string | null }

const ORDER_OF: Record<PayStatus, OrderStatus> = { pending: 'pending', processing: 'pending', failed: 'pending', succeeded: 'paid', expired: 'expired', cancelled: 'cancelled', refunded: 'paid' };
/**
 * Payment dựng thẳng trong CSDL (fixture, không qua event): đơn khớp (nếu chưa có) cùng cột kèm theo cho khớp CHECK; `attempts: 'auto'` dựng lượt thử theo `attemptNo` và trạng thái (lượt cuối `processing` khi Payment
 * `processing`, `succeeded` khi `succeeded` hay `refunded`, các lượt trước `failed`). Mặc định online 350000, hạn sau 15 phút, chủ là customer mới.
 */
export async function seedPayment(t: AuthApp, o: SeedPayment = {}): Promise<SeededPayment> {
  const method = o.method ?? 'vnpay', status = o.status ?? 'pending', amount = o.amount ?? (method === 'cod' ? 180_000 : 350_000);
  const now = t.clock.now();
  const created = o.createdAt ?? new Date(now.getTime() - 60_000);
  const order = o.order ?? await (async () => {
    const user = o.user ?? (await who(t, 'customer', `c-${randomUUID().slice(0, 8)}@x.vn`)).id;
    const os = o.orderStatus ?? (method === 'cod' && status === 'pending' ? 'confirmed' : ORDER_OF[status]);
    const shipping = 30_000, items = amount - shipping;
    return insertOrder(t.prisma, now, { user, status: os, method, code: o.orderCode, payment: status, shipping, items: [{ price: items > 0 ? items : amount, qty: 1 }], noHistory: false, expiresAt: method === 'vnpay' ? new Date(now.getTime() + 15 * MINUTE) : undefined });
  })();
  const attemptNo = o.attemptNo ?? (status === 'pending' ? 0 : 1);
  const online = method === 'vnpay';
  const expiresAt = o.expiresAt !== undefined ? o.expiresAt : online ? new Date(now.getTime() + 15 * MINUTE) : null;
  const succeeded = status === 'succeeded' || status === 'refunded';
  const providerRef = o.providerRef !== undefined ? o.providerRef : succeeded && online ? txNoOf() : null;
  const paidAt = o.paidAt !== undefined ? o.paidAt : succeeded ? new Date(created.getTime() + 60_000) : null;
  const [r] = await t.prisma.$queryRaw<{ id: string }[]>`
    INSERT INTO payments (order_id, order_code, user_id, amount, method, status, attempt_no, provider_ref, expires_at, paid_at, version, created_at, updated_at)
    VALUES (${order.id}::uuid, ${order.code}, ${order.user}::uuid, ${amount}, ${method}::payment_method, ${status}::payment_status, ${attemptNo}, ${providerRef}, ${expiresAt}::timestamptz, ${paidAt}::timestamptz, ${o.version ?? 0},
            ${created}::timestamptz, ${created}::timestamptz) RETURNING id`;
  const seeded: SeededPayment['attempts'] = [];
  let list: SeedAttempt[] = [];
  if (o.attempts === 'auto') {
    for (let n = 1; n <= attemptNo; n++) {
      const last = n === attemptNo;
      const st: AttemptStatus = last ? (status === 'processing' ? 'processing' : succeeded ? 'succeeded' : 'failed') : 'failed';
      list.push({ no: n, status: st, reason: st === 'failed' ? (n % 2 ? 'declined' : 'cancelled_by_user') : null, txNo: st === 'succeeded' ? providerRef : null });
    }
  } else list = o.attempts ?? [];
  for (const a of list) {
    const no = a.no ?? seeded.length + 1, st = a.status ?? 'processing';
    const at = a.createdAt ?? new Date(now.getTime() - 5 * MINUTE + no * 1000);
    const exp = a.expiresAt ?? new Date(at.getTime() + 10 * MINUTE);
    const txnRef = a.txnRef ?? txnRefOf(no);
    const txNo = a.txNo !== undefined ? a.txNo : st === 'succeeded' ? txNoOf() : null;
    const resolved = st === 'processing' ? null : new Date(at.getTime() + 30_000);
    const [row] = await t.prisma.$queryRaw<{ id: string }[]>`
      INSERT INTO payment_attempts (payment_id, attempt_no, txn_ref, status, reason, gateway_code, provider_txn_no, create_date, expires_at, resolved_at, created_at, updated_at)
      VALUES (${r.id}::uuid, ${no}, ${txnRef}, ${st}::attempt_status, ${st === 'failed' ? (a.reason === undefined ? 'declined' : a.reason) : null}::payment_fail_reason, ${a.code ?? null}, ${txNo}, ${at}::timestamptz, ${exp}::timestamptz,
              ${resolved}::timestamptz, ${at}::timestamptz, ${at}::timestamptz) RETURNING id`;
    seeded.push({ id: row.id, txnRef, no, txNo });
  }
  return { id: r.id, order, attempts: seeded, providerRef };
}

export interface SeedRefund {
  paymentId: string; attemptId: string; amount?: number; reason?: 'order_cancelled' | 'order_expired' | 'late_payment' | 'duplicate_payment' | 'admin_manual'; status?: 'requested' | 'succeeded' | 'failed'; note?: string | null;
  requestedBy?: string | null; autoAttemptNo?: number | null; nextRetryAt?: Date | null; createdAt?: Date; resolvedAt?: Date | null; failureReason?: string | null; gatewayRequestId?: string; updatedAt?: Date; requestedAt?: Date;
}
/** Refund dựng thẳng trong CSDL (fixture); cột kèm theo tự khớp CHECK theo trạng thái. */
export async function seedRefund(t: AuthApp, o: SeedRefund): Promise<string> {
  const status = o.status ?? 'requested', reason = o.reason ?? 'order_cancelled';
  const [p] = await t.prisma.$queryRaw<{ amount: bigint }[]>`SELECT amount FROM payments WHERE id = ${o.paymentId}::uuid`;
  const created = o.createdAt ?? new Date(t.clock.now().getTime() - 60_000);
  const note = reason === 'admin_manual' ? (o.note ?? 'Khách trả hàng lỗi') : null;
  const resolved = status === 'requested' ? null : (o.resolvedAt ?? new Date(created.getTime() + 30_000));
  const [r] = await t.prisma.$queryRaw<{ id: string }[]>`
    INSERT INTO refunds (payment_id, attempt_id, amount, reason, note, requested_by, status, failure_reason, gateway_request_id, auto_attempt_no, next_retry_at, requested_at, created_at, updated_at, resolved_at)
    VALUES (${o.paymentId}::uuid, ${o.attemptId}::uuid, ${o.amount ?? Number(p.amount)}, ${reason}::refund_reason, ${note}, ${reason === 'admin_manual' ? (o.requestedBy ?? null) : null}::uuid, ${status}::refund_status,
            ${status === 'failed' ? (o.failureReason ?? 'gateway-declined') : null}, ${o.gatewayRequestId ?? randomBytes(16).toString('hex')}, ${o.autoAttemptNo === undefined ? (reason === 'admin_manual' ? null : 1) : o.autoAttemptNo},
            ${status === 'failed' ? (o.nextRetryAt ?? null) : null}::timestamptz, ${o.requestedAt ?? created}::timestamptz, ${created}::timestamptz, ${o.updatedAt ?? created}::timestamptz, ${resolved}::timestamptz) RETURNING id`;
  return r.id;
}

export const payRow = async (t: AuthApp, id: string) =>
  (await q<{ id: string; order_id: string; order_code: string; user_id: string; amount: string; method: Method; status: PayStatus; attempt_no: number; provider_ref: string | null; expires_at: Date | null; paid_at: Date | null; version: number; created_at: Date; updated_at: Date }>(
    t, `SELECT id, order_id, order_code, user_id, amount::text AS amount, method::text AS method, status::text AS status, attempt_no, provider_ref, expires_at, paid_at, version, created_at, updated_at FROM payments WHERE id = '${id}'`))[0];
export const payOfOrder = async (t: AuthApp, orderId: string) =>
  (await q<{ id: string; status: PayStatus; amount: string; method: Method; attempt_no: number; expires_at: Date | null; paid_at: Date | null; provider_ref: string | null; user_id: string; order_code: string; version: number }>(
    t, `SELECT id, status::text AS status, amount::text AS amount, method::text AS method, attempt_no, expires_at, paid_at, provider_ref, user_id, order_code, version FROM payments WHERE order_id = '${orderId}'`))[0];
export const attemptsOf = (t: AuthApp, paymentId: string) =>
  q<{ id: string; attempt_no: number; txn_ref: string; status: AttemptStatus; reason: Reason | null; gateway_code: string | null; provider_txn_no: string | null; create_date: Date; expires_at: Date; resolved_at: Date | null; updated_at: Date }>(
    t, `SELECT id, attempt_no, txn_ref, status::text AS status, reason::text AS reason, gateway_code, provider_txn_no, create_date, expires_at, resolved_at, updated_at FROM payment_attempts WHERE payment_id = '${paymentId}' ORDER BY attempt_no`);
export const refundsOf = (t: AuthApp, paymentId: string) =>
  q<{ id: string; attempt_id: string; amount: string; reason: string; note: string | null; requested_by: string | null; status: 'requested' | 'succeeded' | 'failed'; failure_reason: string | null; gateway_code: string | null; gateway_request_id: string; auto_attempt_no: number | null; next_retry_at: Date | null; resolved_at: Date | null; created_at: Date; requested_at: Date }>(
    t, `SELECT id, attempt_id, amount::text AS amount, reason::text AS reason, note, requested_by, status::text AS status, failure_reason, gateway_code, gateway_request_id, auto_attempt_no, next_retry_at, resolved_at, created_at, requested_at FROM refunds WHERE payment_id = '${paymentId}' ORDER BY created_at, id`);
export const logsOf = (t: AuthApp, txnRef?: string) =>
  q<{ payment_id: string | null; txn_ref: string | null; payload: Record<string, string>; signature_valid: boolean; rsp_code: string; result: string; created_at: Date }>(
    t, `SELECT payment_id, txn_ref, payload, signature_valid, rsp_code, result, created_at FROM payment_webhook_logs ${txnRef ? `WHERE txn_ref = '${txnRef}'` : ''} ORDER BY created_at, id`);
/** Event của PAY trong outbox (theo thứ tự phát), tùy chọn lọc theo loại. */
export const payOutbox = (t: AuthApp, ...types: string[]) =>
  q<{ id: string; type: string; aggregate_type: string; aggregate_id: string; payload: any; dispatched_at: Date | null }>(
    t, `SELECT id, type, aggregate_type, aggregate_id, payload, dispatched_at FROM outbox_events WHERE type IN (${(types.length ? types : ['PaymentSucceeded', 'PaymentFailed', 'PaymentExpired', 'PaymentRefunded', 'RefundSucceeded', 'RefundFailed']).map((x) => `'${x}'`).join(',')}) ORDER BY occurred_at, id`);
export const outTypesOfPay = async (t: AuthApp, types?: string[]): Promise<string[]> => (await payOutbox(t, ...(types ?? []))).map((e) => e.type);
export const payAudits = (t: AuthApp, targetId?: string, like = 'payment.%') =>
  q<{ actor_id: string | null; actor_role: string; action: string; target_type: string; target_id: string; before: any; after: any; reason: string | null }>(
    t, `SELECT actor_id, actor_role, action, target_type, target_id, before, after, reason FROM audit_logs WHERE action LIKE '${like}' ${targetId ? `AND target_id = '${targetId}'` : ''} ORDER BY created_at, id`);
export const countOf = async (t: AuthApp, table: string, where = 'TRUE'): Promise<number> => (await q<{ n: number }>(t, `SELECT count(*)::int AS n FROM ${table} WHERE ${where}`))[0].n;
/** Ảnh chụp số dòng của mọi bảng PAY và outbox, audit (để khẳng định "không đổi gì"). */
export const snapshot = async (t: AuthApp): Promise<number[]> =>
  [await countOf(t, 'payments'), await countOf(t, 'payment_attempts'), await countOf(t, 'refunds'), await countOf(t, 'payment_webhook_logs'), await countOf(t, 'outbox_events'), await countOf(t, 'audit_logs'), await countOf(t, 'processed_events')];

/** Gói IPN ký đúng bằng khóa của cổng (mặc định thành công, đúng số tiền ×100). */
export function ipnQuery(o: { txnRef: string; amount: number | string; code?: string; status?: string; txNo?: string; bank?: string; payDate?: string; extra?: Record<string, string>; secret?: string; omitTxNo?: boolean }): Record<string, string> {
  const code = o.code ?? '00';
  const p: Record<string, string> = {
    vnp_TmnCode: TMN, vnp_Amount: typeof o.amount === 'number' ? String(o.amount * 100) : o.amount, vnp_BankCode: o.bank ?? 'NCB', vnp_OrderInfo: 'Thanh toan don', vnp_PayDate: o.payDate ?? '20261006160800',
    vnp_ResponseCode: code, vnp_TransactionStatus: o.status ?? (code === '00' ? '00' : '02'), vnp_TxnRef: o.txnRef, ...(o.omitTxNo ? {} : { vnp_TransactionNo: o.txNo ?? '14012345' }), ...(o.extra ?? {}),
  };
  return { ...p, vnp_SecureHashType: 'HmacSHA512', vnp_SecureHash: sign(p, o.secret ?? SECRET) };
}
/** Gọi IPN (GET, không phiên); `ip` đặt qua X-Forwarded-For (TRUST_PROXY_HOPS=1). */
export const ipn = (t: AuthApp, query: Record<string, string>, ip?: string) => {
  let r = http(t).get('/api/v1/webhooks/vnpay/ipn').query(query);
  if (ip) r = r.set('X-Forwarded-For', ip);
  return r;
};

let keySeq = 0;
/** Khóa Idempotency-Key hợp lệ, mới mỗi lần (8 đến 64 ký tự). */
export const newKey = (): string => `k${Date.now().toString(36)}${(++keySeq).toString(36)}${randomBytes(4).toString('hex')}`;
/** POST có Idempotency-Key (mới mỗi lần, hoặc `key` cho thử gửi lại; `null` là không gửi header). */
export function callKey(t: AuthApp, path: string, o: { cookie?: string; body?: unknown; raw?: string; key?: string | null; origin?: string | null; ip?: string } = {}) {
  let r = http(t).post(`/api/v1${path}`);
  if (o.cookie) r = r.set('Cookie', o.cookie);
  if (o.origin !== null) r = r.set('Origin', o.origin ?? ORIGIN);
  if (o.ip) r = r.set('X-Forwarded-For', o.ip);
  if (o.key !== null) r = r.set('Idempotency-Key', o.key ?? newKey());
  return r.set('Content-Type', 'application/json').send(o.raw ?? JSON.stringify(o.body ?? {}));
}
export const initiate = (t: AuthApp, cookie: string | undefined, id: string, o: { key?: string | null; body?: unknown; raw?: string; ip?: string } = {}) => callKey(t, `/payments/${id}/initiate`, { cookie, ...o });
export const retry = (t: AuthApp, cookie: string | undefined, id: string, o: { key?: string | null; body?: unknown; raw?: string; ip?: string } = {}) => callKey(t, `/payments/${id}/retry`, { cookie, ...o });
export const refund = (t: AuthApp, cookie: string | undefined, id: string, reason: unknown, o: { key?: string | null; extra?: Record<string, unknown> } = {}) => callKey(t, `/payments/${id}/refunds`, { cookie, key: o.key, body: { reason, ...(o.extra ?? {}) } });
export const refundRetry = (t: AuthApp, cookie: string | undefined, id: string, o: { key?: string | null } = {}) => callKey(t, `/refunds/${id}/retry`, { cookie, ...o });
export const collect = (t: AuthApp, cookie: string | undefined, id: string, body: unknown) => call(t, 'post', `/payments/${id}/cod-collect`, { cookie, body });
/** Ba người dùng có phiên: customer A, B, staff, admin. */
export async function people(t: AuthApp): Promise<{ a: Who; b: Who; staff: Who; admin: Who }> {
  return { a: await who(t, 'customer', 'a@x.vn'), b: await who(t, 'customer', 'b@x.vn'), staff: await who(t, 'staff', 'staff@shop.vn'), admin: await who(t, 'admin', 'admin@shop.vn') };
}
/** Giao một event cho mọi consumer đã đăng ký (như relay, nhưng không chờ lịch): `eventId` để thử giao lại cùng event. */
export { deliver, pgCode, failingInsert, race, sleep, sqlOf } from './ord';
export const inTx = <T>(t: PayApp, fn: (tx: Tx) => Promise<T>): Promise<T> => t.tx.run(fn);

/** Payload OrderCreated (events.md, V-02) của một đơn dựng sẵn; `over` ghi đè từng trường (số tiền, hạn, phương thức). */
export const createdPayload = (o: { id: string; code: string; user: string }, over: Record<string, unknown> = {}): Record<string, unknown> => ({
  order_id: o.id, order_code: o.code, user_id: o.user, grand_total: 350_000, payment_method: 'vnpay', payment_expires_at: new Date(Date.now() + 15 * MINUTE).toISOString(),
  items: [{ product_id: randomUUID(), name: 'Áo', unit_price: 350_000, quantity: 1 }], ...over,
});

/** Chạy relay outbox tới khi hết event đang chờ (PAY phát, ORD nhận và phát tiếp, PAY nhận lại...); trả số event đã phát. */
export async function drain(t: AuthApp, max = 12): Promise<number> {
  let total = 0;
  for (let i = 0; i < max; i++) {
    const r = await t.relay.runOnce(new Date(Date.now() + 3_600_000));
    if (r.picked === 0) break;
    total += r.dispatched;
  }
  return total;
}
export { orderOf as orderRow } from './ord';
