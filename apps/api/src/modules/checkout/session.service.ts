import { Injectable } from '@nestjs/common';
import { AppLogger, ConfigService, DomainError, EventsService, PrismaService, TransactionService, type Tx } from '../platform';
import { COLS, UUID_RE, type AddressSnap, type SessionRow } from './db';
import { RESEND_ENDPOINT, type ChkConfig, type PaymentMethod, type SessionStatus } from './config';
import { DependencyError, DepsService } from './deps.service';
import type { AddressForCheckout } from '../user';
import type { CheckoutSnapshot } from '../cart';

export const gone = () => new DomainError('checkout-session-not-found'); // cùng nội dung cho phiên của người khác, không có, id sai định dạng (SB-06)
/** `status` của phiên (expired, cancelled) đi ở trường `session_status`: khóa `status` của problem+json là mã HTTP nên `extra` không được ghi đè nó (xem report, Lệch spec: CHK-API và TC ghi tên `status`). */
export const closed = (status: SessionStatus) => new DomainError('checkout-session-closed', { extra: { session_status: status } });
export const unavailable = (e: unknown): unknown => (e instanceof DependencyError ? new DomainError('dependency-unavailable') : e);

/** Bản chụp địa chỉ từ địa chỉ hiện tại của USR (sáu trường nội dung và `updated_at` gốc dạng ISO 8601). */
export const snapOf = (a: AddressForCheckout): AddressSnap => ({ receiver: a.receiver, phone: a.phone, line1: a.line1, ward: a.ward, district: a.district, city: a.city, updated_at: a.updated_at.toISOString() });
/** Địa chỉ đã sửa kể từ lúc chọn: so `updated_at` của địa chỉ gốc với bản chụp (USR chỉ đổi `updated_at` khi nội dung đổi, USR-REQ ...767 BR1). */
export const addressChanged = (snap: AddressSnap | null, a: AddressForCheckout): boolean => !snap || new Date(snap.updated_at).getTime() !== a.updated_at.getTime();

export interface Brief {
  id: string; status: SessionStatus; expires_at: string; address: { address_id: string; changed: boolean } | null; shipping_method_id: string | null; payment_method: PaymentMethod | null; coupon_code: string | null;
}
/** Phiên rút gọn trả về sau tạo và sau mỗi thao tác chọn (CHK-API): không có `user_id`, `cart_id`, bản chụp địa chỉ hay `price_snapshot`. */
export const briefOf = (r: SessionRow, changed = false): Brief => ({
  id: r.id, status: r.status, expires_at: r.expires_at.toISOString(), address: r.address_id ? { address_id: r.address_id, changed } : null, shipping_method_id: r.shipping_method_id, payment_method: r.payment_method, coupon_code: r.coupon_code,
});

type Lockable = { kind: 'missing' } | { kind: 'closed'; status: SessionStatus } | { kind: 'ok'; row: SessionRow };

/**
 * Vòng đời phiên checkout (CHK-DB mục Giao dịch và khóa; bảng chuyển trạng thái là nguồn duy nhất, SB-24): tạo, khóa dòng, gia hạn, hết hạn, hủy. Mọi thao tác ghi lên một phiên bắt đầu bằng
 * `SELECT ... WHERE id = $1 AND user_id = $2 FOR UPDATE` (SB-06: phiên của người khác cùng 404 với không có), kiểm `status = 'open'` rồi `expires_at` theo đồng hồ CSDL (không đợi job). Mỗi thao tác ghi thành công gia hạn
 * phiên thêm `CHK_SESSION_TTL_MINUTES`; xem lại đơn (GET) không ghi và không gia hạn. Hết hạn phát CheckoutExpired CÙNG giao dịch (ADR-011).
 */
@Injectable()
export class SessionService {
  private readonly log: AppLogger;
  private readonly ttl: number;
  constructor(
    private readonly prisma: PrismaService, private readonly transactions: TransactionService, private readonly events: EventsService, private readonly deps: DepsService, config: ConfigService, logger: AppLogger,
  ) {
    this.log = logger.for('checkout');
    this.ttl = config.get<ChkConfig['CHK_SESSION_TTL_MINUTES']>('CHK_SESSION_TTL_MINUTES');
  }

  /** Đọc không khóa (xem lại, kiểm sơ bộ). Id sai định dạng thì không có. */
  async find(userId: string, id: string): Promise<SessionRow | null> {
    if (!UUID_RE.test(id)) return null;
    const [r] = await this.prisma.$queryRaw<SessionRow[]>`SELECT ${COLS} FROM checkout_sessions WHERE id = ${id.toLowerCase()}::uuid AND user_id = ${userId}::uuid`;
    return r ?? null;
  }
  async lock(tx: Tx, userId: string, id: string): Promise<SessionRow | null> {
    if (!UUID_RE.test(id)) return null;
    const [r] = await tx.$queryRaw<SessionRow[]>`SELECT ${COLS} FROM checkout_sessions WHERE id = ${id.toLowerCase()}::uuid AND user_id = ${userId}::uuid FOR UPDATE`;
    return r ?? null;
  }

  /** `open -> expired` kèm CheckoutExpired (`checkout_id`, `user_id`, `cart_id`, không có `order_id`; consumers `-`), cùng giao dịch. Idempotent: chỉ phiên còn `open` mới đổi và mới có event. */
  async expire(tx: Tx, r: Pick<SessionRow, 'id' | 'user_id' | 'cart_id'>): Promise<boolean> {
    const n = await tx.$executeRaw`UPDATE checkout_sessions SET status = 'expired'::checkout_status, updated_at = clock_timestamp() WHERE id = ${r.id}::uuid AND status = 'open'::checkout_status`;
    if (n === 0) return false;
    await this.events.publish(tx, { type: 'CheckoutExpired', aggregate_type: 'CheckoutSession', aggregate_id: r.id, payload: { checkout_id: r.id, user_id: r.user_id, cart_id: r.cart_id } });
    return true;
  }
  /** `open -> cancelled` (khách hủy, mở phiên cho giỏ khác, giỏ không còn hiện hành): không phát event. */
  async cancel(tx: Tx, id: string): Promise<boolean> {
    return (await tx.$executeRaw`UPDATE checkout_sessions SET status = 'cancelled'::checkout_status, updated_at = clock_timestamp() WHERE id = ${id}::uuid AND status = 'open'::checkout_status`) > 0;
  }
  /** Gia hạn sau thao tác ghi: 30 phút kể từ BÂY GIỜ (giờ CSDL). */
  async touch(tx: Tx, id: string): Promise<SessionRow> {
    const [r] = await tx.$queryRaw<SessionRow[]>`
      UPDATE checkout_sessions SET last_activity_at = clock_timestamp(), expires_at = clock_timestamp() + make_interval(mins => ${this.ttl}::int), updated_at = clock_timestamp()
      WHERE id = ${id}::uuid AND status = 'open'::checkout_status RETURNING ${COLS}`;
    return r;
  }

  /** Phát hiện quá hạn lúc có yêu cầu tới (không đợi job): đổi `expired` kèm event trong giao dịch riêng, rồi bên gọi trả 409 hay trạng thái. Nếu job đã đổi trước thì không làm gì thêm. */
  async settleExpired(userId: string, id: string): Promise<void> {
    await this.transactions.run(async (tx) => {
      const r = await this.lock(tx, userId, id);
      if (r && r.status === 'open' && r.overdue) await this.expire(tx, r);
    });
  }
  /** Giỏ của phiên không còn là giỏ hiện hành: đóng `cancelled`, không event. */
  async settleCancelled(userId: string, id: string): Promise<void> {
    await this.transactions.run(async (tx) => {
      const r = await this.lock(tx, userId, id);
      if (r && r.status === 'open') await this.cancel(tx, r.id);
    });
  }

  /**
   * Thao tác ghi lên một phiên: một giao dịch ngắn khóa dòng phiên, kiểm trạng thái, chạy `fn`, gia hạn. Phiên không thuộc người dùng hay không có là 404; đã đóng là 409 `checkout-session-closed`;
   * quá hạn (theo giờ CSDL) thì cùng giao dịch chuyển `expired` rồi 409 (phần ghi `expired` được cam kết, kết quả báo lỗi sau khi cam kết).
   */
  async mutate<T>(userId: string, id: string, fn: (tx: Tx, row: SessionRow) => Promise<T>): Promise<{ value: T; row: SessionRow }> {
    const out = await this.transactions.run<Lockable & { value?: T }>(async (tx) => {
      const row = await this.lock(tx, userId, id);
      if (!row) return { kind: 'missing' };
      if (row.status !== 'open') return { kind: 'closed', status: row.status };
      if (row.overdue) { await this.expire(tx, row); return { kind: 'closed', status: 'expired' }; }
      const value = await fn(tx, row);
      return { kind: 'ok', row: await this.touch(tx, row.id), value };
    });
    if (out.kind === 'missing') throw gone();
    if (out.kind === 'closed') throw closed(out.status);
    return { value: out.value as T, row: out.row };
  }

  async reload(db: Tx | PrismaService, id: string): Promise<SessionRow> {
    const [r] = await db.$queryRaw<SessionRow[]>`SELECT ${COLS} FROM checkout_sessions WHERE id = ${id}::uuid`;
    return r;
  }

  /**
   * Tạo phiên từ giỏ (CHK-REQ-20261006-105050948): `snapshotForCheckout` (đọc) và địa chỉ mặc định, phương thức vận chuyển còn bật được đọc TRƯỚC khi mở giao dịch (không giữ kết nối trong lúc chờ module khác); rồi một
   * giao dịch có khóa tư vấn theo người dùng: phiên `open` cùng giỏ thì trả lại (200, gia hạn); khác giỏ thì đóng `cancelled` rồi tạo mới; giỏ đã có phiên `completed` thì 409 `cart-already-ordered`. Unique một phần
   * `(user_id) WHERE status = 'open'` là lớp hai khi hai yêu cầu đua nhau.
   */
  async create(s: { user_id: string; email_verified: boolean }): Promise<{ created: boolean; body: Brief }> {
    if (!s.email_verified) throw new DomainError('email-not-verified', { extra: { resend_endpoint: RESEND_ENDPOINT } });
    let snap: Extract<CheckoutSnapshot, { ok: true }>, def: AddressForCheckout | undefined, methods: { id: string }[];
    try {
      const got = await this.deps.snapshot(s.user_id);
      if (!got.ok) throw new DomainError('cart-empty');
      snap = got;
      const bad = snap.issues.filter((i) => i.reason === 'unavailable');
      if (bad.length) throw new DomainError('cart-has-unavailable-items', { extra: { issues: bad.map((i) => ({ product_id: i.product_id, reason: i.reason })) } });
      def = (await this.deps.listAddresses(s.user_id)).find((a) => a.is_default);
      methods = snap.shipping_method_id ? await this.deps.listMethods() : [];
    } catch (e) { throw unavailable(e); }
    const method = snap.shipping_method_id && methods.some((m) => m.id === snap.shipping_method_id) ? snap.shipping_method_id : null; // điền sẵn nhưng kiểm lại: phương thức đã tắt thì bỏ (BR5)
    const addr = def ? snapOf(def) : null;
    return this.transactions.run(async (tx) => {
      await tx.$queryRaw`SELECT 1 AS locked FROM (SELECT pg_advisory_xact_lock(hashtextextended(${`chk:user:${s.user_id}`}, 0))) l`; // cùng khóa với đặt hàng: tạo, đặt, hủy của một người nối tiếp nhau
      const [done] = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM checkout_sessions WHERE cart_id = ${snap.cart_id}::uuid AND status = 'completed'::checkout_status LIMIT 1`;
      if (done) throw new DomainError('cart-already-ordered');
      const [open] = await tx.$queryRaw<SessionRow[]>`SELECT ${COLS} FROM checkout_sessions WHERE user_id = ${s.user_id}::uuid AND status = 'open'::checkout_status FOR UPDATE`;
      if (open && !open.overdue && open.cart_id === snap.cart_id) { // lần mở thứ hai (kể cả hai tab): trả lại đúng phiên cũ, thao tác ghi nên gia hạn
        return { created: false, body: briefOf(await this.touch(tx, open.id)) };
      }
      if (open) { if (open.overdue) await this.expire(tx, open); else await this.cancel(tx, open.id); } // giỏ đã đổi: đóng phiên cũ (không event); quá hạn: expired kèm event
      const [row] = await tx.$queryRaw<SessionRow[]>`
        INSERT INTO checkout_sessions (user_id, cart_id, address_id, shipping_method_id, coupon_code, address_snapshot, expires_at, last_activity_at, created_at, updated_at)
        VALUES (${s.user_id}::uuid, ${snap.cart_id}::uuid, ${def?.id ?? null}::uuid, ${method}::uuid, ${snap.coupon_code}, ${addr === null ? null : JSON.stringify(addr)}::jsonb,
                clock_timestamp() + make_interval(mins => ${this.ttl}::int), clock_timestamp(), clock_timestamp(), clock_timestamp())
        RETURNING ${COLS}`;
      this.log.info('tạo phiên checkout', { checkout_id: row.id });
      return { created: true, body: briefOf(row) };
    });
  }

  /** Hủy phiên (CHK-REQ-20261006-105052414 BR3): `open` thành `cancelled` (quá hạn mà job chưa chạy thì thành `expired` kèm event), đã `cancelled` hay `expired` vẫn 204; `completed` thì 409 kèm `order_code`. */
  async remove(userId: string, id: string): Promise<void> {
    const out = await this.transactions.run<{ kind: 'missing' } | { kind: 'done' } | { kind: 'completed'; order_id: string }>(async (tx) => {
      const r = await this.lock(tx, userId, id);
      if (!r) return { kind: 'missing' };
      if (r.status === 'completed') return { kind: 'completed', order_id: r.order_id! };
      if (r.status === 'open') { if (r.overdue) await this.expire(tx, r); else await this.cancel(tx, r.id); }
      return { kind: 'done' };
    });
    if (out.kind === 'missing') throw gone();
    if (out.kind === 'completed') {
      const o = await this.deps.summary(out.order_id).catch((e) => { throw unavailable(e); });
      throw new DomainError('checkout-session-completed', { extra: { order_code: o?.code ?? '' } });
    }
  }
}
