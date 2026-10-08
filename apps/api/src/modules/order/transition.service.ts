import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AppLogger, EventsService, type DomainEventInput, type Tx } from '../platform';
import type { OrderStatus } from './config';
import type { Actor, OrderRow } from './row';

export interface MoveOptions {
  actor: Actor;
  now: Date;
  /** Văn bản hoặc mã lý do của dòng lịch sử (chỉ dòng `cancelled` hoặc dòng giao thất bại có, CHECK ở CSDL). */
  reason?: string;
  /** Cột kèm theo, mỗi mảnh bắt đầu bằng dấu phẩy (SQL tĩnh, giá trị đi qua tham số). */
  set?: Prisma.Sql;
  /** Điều kiện thêm của câu UPDATE (cờ bàn giao của hủy bởi người dùng, R-04). */
  guard?: Prisma.Sql;
  event?: Omit<DomainEventInput, 'aggregate_type' | 'aggregate_id'>;
}

/**
 * Lõi chuyển trạng thái đơn (ORD-DB mục Giao dịch và khóa 1): bên gọi đã khóa dòng (`FOR UPDATE`) và đã kiểm trạng thái hiện tại thuộc cột Từ của bảng chuyển;
 * ở đây `UPDATE ... WHERE status = :cũ` (lớp bảo vệ thứ hai), một dòng lịch sử và OutboxEvent cùng giao dịch (BR6, ADR-011). Trả false khi UPDATE không đổi dòng nào (không ghi gì thêm).
 */
@Injectable()
export class TransitionService {
  private readonly log: AppLogger;
  constructor(private readonly events: EventsService, logger: AppLogger) {
    this.log = logger.for('order');
  }

  async move(tx: Tx, o: OrderRow, to: OrderStatus, opts: MoveOptions): Promise<boolean> {
    const n = await tx.$executeRaw(Prisma.sql`
      UPDATE orders SET status = ${to}::order_status, updated_at = ${opts.now}::timestamptz${opts.set ?? Prisma.empty}
      WHERE id = ${o.id}::uuid AND status = ${o.status}::order_status${opts.guard ?? Prisma.empty}`);
    if (n === 0) return false;
    await this.history(tx, o.id, o.status, to, opts.actor, opts.now, opts.reason);
    if (opts.event) await this.events.publish(tx, { ...opts.event, aggregate_type: 'order', aggregate_id: o.id });
    return true;
  }

  /** Một dòng lịch sử chỉ thêm; `seq` (identity) là khóa thứ tự ghi. */
  history(tx: Tx, orderId: string, from: OrderStatus | null, to: OrderStatus, actor: Actor, now: Date, reason?: string): Promise<number> {
    return tx.$executeRaw`
      INSERT INTO order_status_history (order_id, from_status, to_status, actor_id, actor_role, reason, created_at)
      VALUES (${orderId}::uuid, ${from}::order_status, ${to}::order_status, ${actor.id}::uuid, ${actor.role}::order_actor_role, ${reason ?? null}, ${now}::timestamptz)`;
  }

  /** Chuyển bị từ chối vì trạng thái hiện tại không có trong cột Từ: no-op có log, chỉ mã đơn, trạng thái và mã lỗi (T15: không dữ liệu cá nhân, không lý do). */
  rejected(o: Pick<OrderRow, 'code' | 'status'>, source: string, to: string): void {
    this.log.warn('chuyển trạng thái bị từ chối', { code: 'transition-rejected', source, order_code: o.code, from: o.status, to });
  }
}
