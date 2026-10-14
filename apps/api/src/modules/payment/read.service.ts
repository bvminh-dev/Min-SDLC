import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { DomainError, PrismaService, paginate, toPage, type SessionContext } from '../platform';
import { OrderApi } from '../order';
import { PaymentCore, uuidOf } from './core.service';
import { PAYMENT_COLS, REFUND_COLS, type AttemptRow, type PaymentRow, type RefundRow } from './db';
import type { AdminListQuery, MyListQuery, RefundQueueQuery } from './policy';

/** Chỉ ASCII in được mới đổi chữ hoa (mã đơn chuẩn hóa chữ hoa ở bảng): `ſ`, `ı`, `K` (Kelvin) không được đổi thành chữ A-Z khác và khớp nhầm đơn khác (L90). */
const upperAscii = (s: string): string => s.replace(/[a-z]/g, (c) => c.toUpperCase());
const iso = (d: Date | null): string | null => (d ? d.toISOString() : null);

/**
 * Đọc thanh toán (PAY-REQ ...122, ...211; PAY-DB mục 10): phân trang offset `created_at DESC, id DESC`; điều kiện `user_id` từ phiên luôn nằm trong câu truy vấn của customer (SB-06), Payment của người khác và không tồn tại cùng 404.
 * Serializer theo role: customer không thấy `provider_ref`, `txn_ref`, `gateway_code`, `user_id`, nhật ký webhook, `note` của hoàn tiền (SB-20, T11); staff, admin có thêm dữ liệu đối soát nhưng không có dữ liệu cá nhân của khách (SB-08).
 * Chỉ đọc: không ghi audit (K-16).
 */
@Injectable()
export class ReadService {
  constructor(private readonly prisma: PrismaService, private readonly core: PaymentCore, private readonly orders: OrderApi) {}

  private row(p: PaymentRow) {
    return { id: p.id, order_code: p.order_code, method: p.method, amount: Number(p.amount), status: p.status, attempt_no: p.attempt_no, max_attempts: this.core.cfg('PAY_MAX_ATTEMPTS'), created_at: p.created_at.toISOString() };
  }

  private async page(where: Prisma.Sql, q: { page: number; limit: number }) {
    const { skip, take } = paginate(q);
    const [rows, [{ n }]] = await Promise.all([
      this.prisma.$queryRaw<PaymentRow[]>`SELECT ${PAYMENT_COLS} FROM payments WHERE ${where} ORDER BY created_at DESC, id DESC LIMIT ${take} OFFSET ${skip}`,
      this.prisma.$queryRaw<{ n: bigint }[]>`SELECT count(*) AS n FROM payments WHERE ${where}`,
    ]);
    return toPage(rows.map((r) => this.row(r)), Number(n), q);
  }
  private filters(base: Prisma.Sql[], q: Partial<AdminListQuery>): Prisma.Sql {
    if (q.status) base.push(Prisma.sql`status = ${q.status}::payment_status`);
    if (q.method) base.push(Prisma.sql`method = ${q.method}::payment_method`);
    if (q.order_code) base.push(Prisma.sql`order_code = ${upperAscii(q.order_code)}`); // khớp chính xác, không phân biệt hoa thường (không khớp một phần)
    return base.length ? Prisma.join(base, ' AND ') : Prisma.sql`TRUE`;
  }

  myList(s: SessionContext, q: MyListQuery) { return this.page(this.filters([Prisma.sql`user_id = ${s.user_id}::uuid`], q), q); }
  adminList(q: AdminListQuery) { return this.page(this.filters([], q), q); }

  private async load(id: string, userId?: string): Promise<PaymentRow> {
    const uid = uuidOf(id);
    const r = uid ? (userId ? await this.prisma.$queryRaw<PaymentRow[]>`SELECT ${PAYMENT_COLS} FROM payments WHERE id = ${uid}::uuid AND user_id = ${userId}::uuid` : await this.prisma.$queryRaw<PaymentRow[]>`SELECT ${PAYMENT_COLS} FROM payments WHERE id = ${uid}::uuid`)[0] : undefined;
    if (!r) throw new DomainError('not-found');
    return r;
  }
  private attempts(id: string) {
    return this.prisma.$queryRaw<AttemptRow[]>`
      SELECT id, payment_id, attempt_no, txn_ref, status::text AS status, reason::text AS reason, gateway_code, provider_txn_no, create_date, expires_at, resolved_at, created_at, updated_at
      FROM payment_attempts WHERE payment_id = ${id}::uuid ORDER BY attempt_no`;
  }
  private refundsOf(id: string) {
    return this.prisma.$queryRaw<RefundRow[]>`SELECT ${REFUND_COLS} FROM refunds WHERE payment_id = ${id}::uuid ORDER BY created_at, id`;
  }

  /** Chi tiết của customer: lượt thử (số thứ tự, trạng thái, mã lý do cố định, thời điểm), hoàn tiền (số tiền, trạng thái, thời điểm), `can_retry`, `can_initiate`. */
  async myDetail(s: SessionContext, id: string) {
    const p = await this.load(id, s.user_id);
    const [attempts, refunds, order] = await Promise.all([this.attempts(p.id), this.refundsOf(p.id), this.orders.findForPayment(p.order_id)]);
    const now = this.core.now().getTime();
    const open = !!order && order.status === 'pending' && !!p.expires_at && p.expires_at.getTime() > now;
    return {
      ...this.row(p), expires_at: iso(p.expires_at),
      can_retry: p.method === 'vnpay' && p.status === 'failed' && p.attempt_no < this.core.cfg('PAY_MAX_ATTEMPTS') && open,
      can_initiate: p.method === 'vnpay' && p.status === 'pending' && open,
      attempts: attempts.map((a) => ({ attempt_no: a.attempt_no, status: a.status, reason: a.reason, created_at: a.created_at.toISOString() })),
      refunds: refunds.map((r) => ({ amount: Number(r.amount), status: r.status, created_at: r.created_at.toISOString() })),
    };
  }

  /** Chi tiết của staff, admin: thêm mã giao dịch cổng, mã gốc, `user_id`, nhật ký webhook tóm tắt (thời điểm, RspCode, kết quả), Refund kèm lý do mã; không khóa ký, không tham số webhook thô, không dữ liệu cá nhân. */
  async adminDetail(id: string) {
    const first = await this.load(id); // 404 sớm; Payment đọc LẠI sau các bảng con bên dưới (REV-NTF-16): đọc cha trước con thì hoàn tiền chốt ở giữa cho cha cũ (`succeeded`) kèm Refund mới (`succeeded`), màn không còn thấy Refund `requested` nên ngừng thăm dò và kẹt ở "Đã thanh toán"
    const [attempts, refunds, logs] = await Promise.all([
      this.attempts(first.id), this.refundsOf(first.id),
      this.prisma.$queryRaw<{ created_at: Date; rsp_code: string; result: string }[]>`SELECT created_at, rsp_code, result FROM payment_webhook_logs WHERE payment_id = ${first.id}::uuid ORDER BY created_at DESC, id DESC LIMIT 100`,
    ]); const p = await this.load(id); // cha đọc sau con: lệch chỉ có thể là con cũ (`requested`) với cha mới (`refunded`), màn tiếp tục thăm dò tới khi khớp
    return {
      ...this.row(p), expires_at: iso(p.expires_at), paid_at: iso(p.paid_at), provider_ref: p.provider_ref, user_id: p.user_id,
      attempts: attempts.map((a) => ({ attempt_no: a.attempt_no, status: a.status, reason: a.reason, txn_ref: a.txn_ref, gateway_code: a.gateway_code, created_at: a.created_at.toISOString() })),
      refunds: refunds.map((r) => ({ id: r.id, amount: Number(r.amount), status: r.status, reason: r.reason, note: r.note, failure_reason: r.failure_reason, auto_attempt_no: r.auto_attempt_no, created_at: r.created_at.toISOString(), resolved_at: iso(r.resolved_at) })),
      webhook_logs: logs.reverse().map((l) => ({ created_at: l.created_at.toISOString(), rsp_code: l.rsp_code, result: l.result })),
    };
  }

  /** Hàng đợi hoàn tiền: `failed` đứng trước (admin cần xử lý), rồi `requested`, rồi `succeeded`; trong nhóm mới nhất trước. */
  async refundQueue(q: RefundQueueQuery) {
    const { skip, take } = paginate(q);
    const where = q.status ? Prisma.sql`r.status = ${q.status}::refund_status` : Prisma.sql`TRUE`;
    const [rows, [{ n }]] = await Promise.all([
      this.prisma.$queryRaw<{ id: string; payment_id: string; order_code: string; amount: bigint; reason: string; status: string; failure_reason: string | null; auto_attempt_no: number | null; created_at: Date; resolved_at: Date | null }[]>`
        SELECT r.id, r.payment_id, p.order_code, r.amount, r.reason::text AS reason, r.status::text AS status, r.failure_reason, r.auto_attempt_no, r.created_at, r.resolved_at
        FROM refunds r JOIN payments p ON p.id = r.payment_id WHERE ${where}
        ORDER BY CASE r.status WHEN 'failed' THEN 0 WHEN 'requested' THEN 1 ELSE 2 END, r.created_at DESC, r.id DESC LIMIT ${take} OFFSET ${skip}`,
      this.prisma.$queryRaw<{ n: bigint }[]>`SELECT count(*) AS n FROM refunds r WHERE ${where}`,
    ]);
    return toPage(rows.map((r) => ({ ...r, amount: Number(r.amount), created_at: r.created_at.toISOString(), resolved_at: iso(r.resolved_at) })), Number(n), q);
  }
}
