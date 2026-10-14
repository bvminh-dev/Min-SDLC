import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AuditService, DomainError, PrismaService, TransactionService, type SessionContext } from '../platform';
import { OrderApi } from '../order';
import { PaymentCore, uuidOf } from './core.service';

/**
 * Ghi nhận tay đã thu tiền COD (PAY-REQ ...597 BR4): đường dự phòng của thu COD tự động (OrderDelivered), chỉ staff và admin. Cùng chuyển `pending -> succeeded` của đường tự động; tính duy nhất do khóa dòng Payment
 * và `UPDATE ... WHERE status = 'pending'` (hai nhân viên cùng lúc, hay chạy chồng với handler OrderDelivered: đúng một bên thắng, bên còn lại 409). Đơn đọc từ ORD ngoài giao dịch (L87).
 */
@Injectable()
export class CodService {
  constructor(private readonly prisma: PrismaService, private readonly transactions: TransactionService, private readonly core: PaymentCore, private readonly orders: OrderApi, private readonly audit: AuditService) {}

  async collect(s: SessionContext, rawId: string, collected: number, note: string | undefined): Promise<{ payment_id: string; status: 'succeeded'; paid_at: string }> {
    const id = uuidOf(rawId);
    const pre = id ? (await this.prisma.$queryRaw<{ order_id: string }[]>`SELECT order_id FROM payments WHERE id = ${id}::uuid`)[0] : undefined;
    if (!id || !pre) throw new DomainError('not-found');
    const order = await this.orders.findForPayment(pre.order_id);
    return this.transactions.run(async (tx) => {
      const p = await this.core.lockById(tx, id);
      if (!p) throw new DomainError('not-found');
      if (p.method !== 'cod') throw new DomainError('payment-not-cod');
      if (p.status === 'succeeded') throw new DomainError('payment-already-succeeded');
      if (order?.status !== 'delivered' || p.status !== 'pending') throw new DomainError('order-not-delivered');
      if (BigInt(collected) !== p.amount) throw new DomainError('amount-mismatch');
      const now = this.core.now();
      const moved = await this.core.move(tx, p, 'collect', { set: Prisma.sql`, paid_at = ${now}::timestamptz` });
      if (!moved) throw new DomainError('payment-already-succeeded');
      await this.audit.record(tx, {
        actor_id: s.user_id, actor_role: s.role, action: 'payment.cod.collect', target_type: 'payment', target_id: p.id, before: { status: p.status },
        after: { status: 'succeeded', amount: Number(p.amount), ...(note ? { note } : {}) }, reason: note,
      });
      return { payment_id: moved.id, status: 'succeeded' as const, paid_at: (moved.paid_at as Date).toISOString() };
    });
  }
}
