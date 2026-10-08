import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AuditService, Clock, DomainError, TransactionService, type SessionContext } from '../platform';
import { CANCELLABLE, CODE_RE, upperCode } from './config';
import { lockByCode } from './row';
import { TransitionService } from './transition.service';

/**
 * Hủy đơn của customer (đơn của mình) và admin (mọi đơn), ORD-REQ ...834; ORD-DB mục Giao dịch và khóa 2. Thứ tự: mã sai định dạng hay đơn không thấy (đơn người khác với customer)
 * là cùng 404 (SB-06); trạng thái ngoài pending, confirmed, paid hoặc đơn đã bị SHP khóa bàn giao là cùng 409 `order-not-cancellable` (R-04, không lộ lý do).
 * Một giao dịch: khóa dòng, UPDATE có điều kiện `status` cũ và cờ bàn giao, lịch sử, OutboxEvent OrderCancelled và audit (lỗi audit rollback cả hủy, SB-19).
 */
@Injectable()
export class CancelService {
  constructor(private readonly transactions: TransactionService, private readonly transitions: TransitionService, private readonly audit: AuditService, private readonly clock: Clock) {}

  cancel(s: SessionContext, rawCode: string, reason: string | undefined): Promise<{ code: string; status: 'cancelled' }> {
    const code = upperCode(rawCode);
    if (!CODE_RE.test(code)) throw new DomainError('not-found');
    const role = s.role === 'admin' ? 'admin' : 'customer'; // staff đã bị @Roles chặn ở guard; không có nhánh nào khác
    return this.transactions.run(async (tx) => {
      const o = await lockByCode(tx, code, role === 'customer' ? s.user_id : undefined);
      if (!o) throw new DomainError('not-found');
      if (!CANCELLABLE.includes(o.status)) throw new DomainError('order-not-cancellable');
      const now = this.clock.now();
      const moved = await this.transitions.move(tx, o, 'cancelled', {
        actor: { id: s.user_id, role }, now, reason,
        // `payment_status` tự đặt (không có event PaymentCancelled, K-04); `succeeded` giữ cho tới PaymentRefunded. Cờ bàn giao chặn hủy của người dùng (R-04): không cập nhật được dòng nào thì 409.
        set: Prisma.sql`, cancel_reason = ${role === 'admin' ? 'admin' : 'customer_request'}::order_cancel_reason, cancelled_by_role = ${role}::order_actor_role,
          payment_status = CASE WHEN payment_status IN ('pending', 'processing', 'failed') THEN 'cancelled'::order_payment_status ELSE payment_status END`,
        guard: Prisma.sql` AND handoff_locked_at IS NULL`,
        event: { type: 'OrderCancelled', payload: { order_id: o.id, order_code: o.code, user_id: o.user_id, reason: role === 'admin' ? 'admin' : 'customer_request', was_paid: o.status === 'paid' } },
      });
      if (!moved) throw new DomainError('order-not-cancellable');
      await this.audit.record(tx, { actor_id: s.user_id, actor_role: role, action: 'order.cancel', target_type: 'order', target_id: o.id, before: { status: o.status }, after: { status: 'cancelled' }, reason });
      return { code: o.code, status: 'cancelled' as const };
    });
  }
}
