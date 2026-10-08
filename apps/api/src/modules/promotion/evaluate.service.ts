import { Injectable } from '@nestjs/common';
import { AppLogger, PrismaService, RateLimitService, type Tx } from '../platform';
import { WRONG_ATTEMPTS, WRONG_WINDOW_SECONDS } from './config';
import { COLS, UUID_RE, type CouponRow } from './db';
import { discountOf, isSubtotal } from './discount';
import { normalizeCode } from './policy';

export interface EvaluateInput { code: string; user_id: string; items_subtotal: number; count_attempt?: boolean }
export interface ReserveInput { order_id: string; user_id: string; code: string; items_subtotal: number }
/** Lý do lỗi của giao diện nội bộ (PRM-API mục Giao diện nội bộ), theo đúng thứ tự kiểm của PRM-REQ-20261006-101036327 BR4; `invalid_argument` là đầu vào sai hình dạng (khóa lạ, kiểu sai). */
export type Failure =
  | { ok: false; reason: 'invalid_subtotal' | 'invalid_argument' | 'coupon_not_found' | 'coupon_expired' | 'coupon_exhausted' | 'no_discount' | 'order_already_has_coupon' }
  | { ok: false; reason: 'too_many_attempts'; retry_after_seconds: number }
  | { ok: false; reason: 'per_user_limit_reached'; limit: number; used: number }
  | { ok: false; reason: 'min_order_not_met'; min_order_value: number; shortfall: number };
export type EvaluateResult = { ok: true; coupon_id: string; code: string; type: 'percentage' | 'fixed'; discount_amount: number } | Failure;
export type ReserveResult = { ok: true; redemption_id: string; coupon_id: string; amount: number } | Failure;
/** `now`: mốc "giờ CSDL" để so `expires_at`; bỏ trống là `now()` của CSDL (đường chạy thật). Chỉ test dùng, để thử ranh giới hạn dùng mà không đổi đồng hồ CSDL. */
export interface AtOptions { now?: Date }

type Locked = CouponRow & { overdue: boolean };
const fail = <R extends Failure['reason']>(reason: R): { ok: false; reason: R } => ({ ok: false, reason });
const attemptKey = (userId: string): string => `prm:notfound:${userId.toLowerCase()}`;

/**
 * Kiểm mã, tính tiền giảm và giữ lượt (PRM-API mục Giao diện nội bộ; PRM-DB mục Giao dịch và khóa 4). `evaluate` chỉ đọc (trừ bộ đếm thử sai ở kho đếm của platform, ADR-014);
 * `reserve` chạy trong giao dịch `tx` của CHK, khóa dòng coupon rồi giữ lượt nguyên tử. Hết hạn và hết chỗ kiểm theo giờ CSDL ngay trong câu UPDATE (SB-25, T10), không dựa trạng thái đã lưu hay job.
 * Tiền do máy chủ bên gọi tính (`items_subtotal`), PRM không nhận số tiền giảm (SB-23, T3). Mọi lỗi trả `{ ok: false, reason }`, không ném (đóng khi không chắc: đầu vào lạ là `invalid_argument`).
 */
@Injectable()
export class EvaluateService {
  private readonly log: AppLogger;
  constructor(private readonly prisma: PrismaService, private readonly limiter: RateLimitService, logger: AppLogger) {
    this.log = logger.for('promotion');
  }

  /** Thứ tự kiểm sau khi tìm thấy coupon (BR4 bước 3 đến 7): hết hạn, hết lượt, giới hạn mỗi người, tối thiểu, tiền giảm. `used` là số lượt của chính người này (null khi không có `per_user_limit`). */
  private verdict(c: Locked, used: number | null, subtotal: number): Failure | { ok: true; amount: number } {
    if (c.status === 'expired' || c.overdue) return fail('coupon_expired');
    if (c.status === 'exhausted' || c.consumed_count + c.reserved_count >= c.usage_limit) return fail('coupon_exhausted');
    if (c.per_user_limit !== null && used !== null && used >= c.per_user_limit) return { ok: false, reason: 'per_user_limit_reached', limit: c.per_user_limit, used };
    const min = Number(c.min_order_value);
    if (subtotal < min) return { ok: false, reason: 'min_order_not_met', min_order_value: min, shortfall: min - subtotal };
    const amount = discountOf({ type: c.type, value: Number(c.value), max_discount: c.max_discount === null ? null : Number(c.max_discount) }, subtotal);
    return amount < 1 ? fail('no_discount') : { ok: true, amount };
  }

  private usedBy(db: Tx | PrismaService, couponId: string, userId: string): Promise<number> {
    return db.$queryRaw<{ n: number }[]>`
      SELECT count(*)::int AS n FROM coupon_redemptions WHERE coupon_id = ${couponId}::uuid AND user_id = ${userId.toLowerCase()}::uuid AND status IN ('reserved'::redemption_status, 'consumed'::redemption_status)`
      .then((r) => r[0].n);
  }

  async evaluate(input: EvaluateInput, o: AtOptions = {}): Promise<EvaluateResult> {
    const i = input as unknown as Record<string, unknown> | null;
    if (!i || typeof i !== 'object' || !isSubtotal(i.items_subtotal)) return fail('invalid_subtotal'); // trước mọi kiểm tra khác, không tra coupon (BR2)
    if (!shapeOk(i, ['code', 'user_id', 'items_subtotal', 'count_attempt']) || typeof i.code !== 'string' || typeof i.user_id !== 'string' || !UUID_RE.test(i.user_id)
      || (i.count_attempt !== undefined && typeof i.count_attempt !== 'boolean')) return fail('invalid_argument');
    const count = i.count_attempt !== false; // mặc định true; false chỉ để kiểm lại mã đã lưu ở giỏ hoặc phiên (BR11)
    const key = attemptKey(i.user_id);
    if (count) {
      // đếm nguyên tử TRƯỚC khi tra (ADR-014 `take`): các lời gọi sai song song cũng chỉ qua tối đa WRONG_ATTEMPTS lần (REV-PRM-03)
      const gate = await this.limiter.take(key, WRONG_ATTEMPTS, WRONG_WINDOW_SECONDS);
      if (!gate.allowed) return { ok: false, reason: 'too_many_attempts', retry_after_seconds: gate.retryAfter };
    }
    const code = normalizeCode(i.code);
    const c = code ? await this.find(code, o.now) : null;
    // một lỗi chung cho không tồn tại, đang tắt và đã xóa (T4): cùng đường mã
    if (!c || c.status === 'disabled') return fail('coupon_not_found'); // lượt đã `take` ở trên giữ nguyên làm một lần sai
    if (count) await this.limiter.refund(key, WRONG_WINDOW_SECONDS); // tìm thấy: không phải lần sai
    const used = c.per_user_limit === null ? null : await this.usedBy(this.prisma, c.id, i.user_id);
    const v = this.verdict(c, used, i.items_subtotal);
    return v.ok ? { ok: true, coupon_id: c.id, code: c.code, type: c.type, discount_amount: v.amount } : v;
  }

  private async find(code: string, now?: Date): Promise<Locked | null> {
    const [c] = await this.prisma.$queryRaw<Locked[]>`
      SELECT ${COLS}, (expires_at <= COALESCE(${now ?? null}::timestamptz, now())) AS overdue FROM coupons WHERE code = ${code} AND status <> 'deleted'::coupon_status`;
    return c ?? null;
  }

  /** Lượt đã có của đơn (PRM-DB mục 4a): cùng mã và cùng người thì trả lại lượt cũ; mã khác, người khác hay lượt đã nhả là `order_already_has_coupon`. */
  private async existing(tx: Tx, orderId: string, code: string | null, userId: string): Promise<ReserveResult | null> {
    const [r] = await tx.$queryRaw<{ id: string; coupon_id: string; user_id: string; amount: bigint; status: string; code: string }[]>`
      SELECT r.id, r.coupon_id, r.user_id, r.amount, r.status::text AS status, c.code FROM coupon_redemptions r JOIN coupons c ON c.id = r.coupon_id WHERE r.order_id = ${orderId}::uuid`;
    if (!r) return null;
    if (r.code !== code || r.user_id !== userId.toLowerCase() || r.status === 'released') return fail('order_already_has_coupon');
    return { ok: true, redemption_id: r.id, coupon_id: r.coupon_id, amount: Number(r.amount) };
  }

  async reserve(input: ReserveInput, tx: Tx, o: AtOptions = {}): Promise<ReserveResult> {
    const i = input as unknown as Record<string, unknown> | null;
    if (!i || typeof i !== 'object' || !isSubtotal(i.items_subtotal)) return fail('invalid_subtotal');
    if (!shapeOk(i, ['order_id', 'user_id', 'code', 'items_subtotal']) || typeof i.code !== 'string' || typeof i.order_id !== 'string' || !UUID_RE.test(i.order_id)
      || typeof i.user_id !== 'string' || !UUID_RE.test(i.user_id)) return fail('invalid_argument'); // kể cả `amount`: PRM tự tính, không nhận tiền giảm từ bên gọi (T3)
    const [orderId, userId, subtotal, code] = [i.order_id.toLowerCase(), i.user_id.toLowerCase(), i.items_subtotal, normalizeCode(i.code)];
    const again = await this.existing(tx, orderId, code, userId);
    if (again) return again;
    if (!code) return fail('coupon_not_found');
    const [c] = await tx.$queryRaw<Locked[]>`
      SELECT ${COLS}, (expires_at <= COALESCE(${o.now ?? null}::timestamptz, now())) AS overdue FROM coupons WHERE code = ${code} AND status <> 'deleted'::coupon_status FOR UPDATE`;
    if (!c || c.status === 'disabled') return fail('coupon_not_found');
    const used = c.per_user_limit === null ? null : await this.usedBy(tx, c.id, userId); // dưới khóa dòng coupon: hai đơn song song của một người không cùng vượt (SB-25, SB-33)
    const v = this.verdict(c, used, subtotal);
    if (!v.ok) return v;
    await tx.$executeRaw`SAVEPOINT prm_reserve`; // lỗi sau khi chèn thì quay lui phần của PRM: "có lỗi thì không ghi gì" kể cả khi CHK bắt kết quả và vẫn cam kết
    try {
      const made = await tx.$queryRaw<{ id: string }[]>`
        INSERT INTO coupon_redemptions (coupon_id, order_id, user_id, amount) VALUES (${c.id}::uuid, ${orderId}::uuid, ${userId}::uuid, ${v.amount}) ON CONFLICT (order_id) DO NOTHING RETURNING id`;
      const taken = made.length ? await tx.$executeRaw`
        UPDATE coupons SET reserved_count = reserved_count + 1, updated_at = now()
        WHERE id = ${c.id}::uuid AND status = 'active'::coupon_status AND expires_at > COALESCE(${o.now ?? null}::timestamptz, now()) AND consumed_count + reserved_count < usage_limit` : 0;
      if (!made.length || taken === 0) {
        await tx.$executeRaw`ROLLBACK TO SAVEPOINT prm_reserve`;
        await tx.$executeRaw`RELEASE SAVEPOINT prm_reserve`;
        return made.length ? fail('coupon_exhausted') : (await this.existing(tx, orderId, code, userId)) ?? fail('order_already_has_coupon'); // hai lời gọi cùng đơn đua nhau: unique(order_id) phân xử
      }
      await tx.$executeRaw`RELEASE SAVEPOINT prm_reserve`;
      return { ok: true, redemption_id: made[0].id, coupon_id: c.id, amount: v.amount };
    } catch (err) {
      await tx.$executeRaw`ROLLBACK TO SAVEPOINT prm_reserve`;
      await tx.$executeRaw`RELEASE SAVEPOINT prm_reserve`;
      this.log.error('giữ lượt coupon lỗi', { err });
      throw err;
    }
  }
}

const shapeOk = (o: Record<string, unknown>, keys: string[]): boolean => Object.keys(o).every((k) => keys.includes(k));
