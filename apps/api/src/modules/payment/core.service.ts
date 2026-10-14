import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AppLogger, Clock, ConfigService, EventsService, type Tx } from '../platform';
import { TRANSITIONS, type PayConfig, type TransitionName } from './config';
import { PAYMENT_COLS, UUID_RE, type PaymentRow } from './db';

export const uuidOf = (v: unknown): string | null => (typeof v === 'string' && UUID_RE.test(v) ? v.toLowerCase() : null);

/** Phần dùng chung của lõi PAY: khóa dòng Payment, chuyển trạng thái theo bảng `TRANSITIONS` kèm event ghi cùng giao dịch (SB-24, SB-27), cấu hình. */
@Injectable()
export class PaymentCore {
  private readonly log: AppLogger;
  constructor(private readonly events: EventsService, private readonly clock: Clock, private readonly config: ConfigService, logger: AppLogger) {
    this.log = logger.for('payment');
  }

  cfg<K extends keyof PayConfig>(name: K): PayConfig[K] { return this.config.get<PayConfig[K]>(name); }
  now(): Date { return this.clock.now(); }

  /** `SELECT ... FOR UPDATE` theo id (bước đầu của mọi chuyển trạng thái; thứ tự khóa của PAY: Payment rồi Refund, PAY-DB mục 1). */
  async lockById(tx: Tx, id: string, userId?: string): Promise<PaymentRow | undefined> {
    const rows = userId === undefined
      ? await tx.$queryRaw<PaymentRow[]>`SELECT ${PAYMENT_COLS} FROM payments WHERE id = ${id}::uuid FOR UPDATE`
      : await tx.$queryRaw<PaymentRow[]>`SELECT ${PAYMENT_COLS} FROM payments WHERE id = ${id}::uuid AND user_id = ${userId}::uuid FOR UPDATE`;
    return rows[0];
  }
  async lockByOrder(tx: Tx, orderId: string): Promise<PaymentRow | undefined> {
    return (await tx.$queryRaw<PaymentRow[]>`SELECT ${PAYMENT_COLS} FROM payments WHERE order_id = ${orderId}::uuid FOR UPDATE`)[0];
  }
  /** Khóa nhưng bỏ qua dòng đang bị giữ (job đối soát: bên khác đang xử lý thì không làm lặp, SKIP LOCKED). */
  async lockSkip(tx: Tx, id: string): Promise<PaymentRow | undefined> {
    return (await tx.$queryRaw<PaymentRow[]>`SELECT ${PAYMENT_COLS} FROM payments WHERE id = ${id}::uuid FOR UPDATE SKIP LOCKED`)[0];
  }

  /**
   * Chuyển trạng thái Payment đúng một lần: trạng thái hiện tại phải thuộc cột Từ của bảng, rồi `UPDATE ... WHERE status = :cũ` (lớp bảo vệ thứ hai) tăng `version`; event chỉ ghi khi UPDATE thật sự đổi một dòng
   * (PaymentSucceeded chỉ một lần, PAY-DB mục 5). Bên gọi đã khóa dòng. Trả dòng mới hoặc `null` khi không đổi gì.
   */
  async move(tx: Tx, p: PaymentRow, name: TransitionName, o: { set?: Prisma.Sql; extra?: Record<string, unknown> } = {}): Promise<PaymentRow | null> {
    const t = TRANSITIONS[name];
    if (!(t.from as readonly string[]).includes(p.status)) return null;
    const [r] = await tx.$queryRaw<PaymentRow[]>(Prisma.sql`
      UPDATE payments SET status = ${t.to}::payment_status, version = version + 1, updated_at = ${this.clock.now()}::timestamptz${o.set ?? Prisma.empty}
      WHERE id = ${p.id}::uuid AND status = ${p.status}::payment_status RETURNING ${PAYMENT_COLS}`);
    if (!r) return null;
    const type = 'event' in t ? t.event : null;
    if (type) await this.events.publish(tx, { type, aggregate_type: 'payment', aggregate_id: r.id, payload: { ...this.base(type, r), ...o.extra } });
    return r;
  }

  /** Phần chung của payload event theo `events.md` (V-01, V-05). Số tiền là số nguyên đồng (an toàn trong JSON: lớn nhất 999.999.999 với online, đơn COD theo `grand_total` của ORD). */
  private base(type: string, r: PaymentRow): Record<string, unknown> {
    if (type === 'PaymentSucceeded') return { payment_id: r.id, order_id: r.order_id, order_code: r.order_code, user_id: r.user_id, amount: Number(r.amount), method: r.method, paid_at: r.paid_at?.toISOString() };
    if (type === 'PaymentFailed') return { payment_id: r.id, order_id: r.order_id, order_code: r.order_code, user_id: r.user_id };
    return { payment_id: r.id, order_id: r.order_id }; // PaymentExpired, PaymentRefunded
  }
}
