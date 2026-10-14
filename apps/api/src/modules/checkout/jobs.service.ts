import { Injectable } from '@nestjs/common';
import { AppLogger, EventsService, TransactionService } from '../platform';
import { EXPIRE_BATCH, EXPIRE_BUDGET_MS, PURGE_BATCH, PURGE_BUDGET_MS, PURGE_DAYS } from './config';

export interface JobOptions {
  /** Mốc "giờ CSDL" để so `expires_at` hay `updated_at`; bỏ trống là `now()` của CSDL (đường chạy thật). Chỉ test dùng. */
  now?: Date;
  signal?: AbortSignal;
  /** Hạn thời gian cho cả lượt chạy (SB-34): hết hạn thì thôi nhận lô mới, lượt sau làm tiếp. */
  budgetMs?: number;
  /** Số dòng tối đa mỗi lô; chỉ test dùng để thử giới hạn lô. */
  batch?: number;
}

/**
 * Hai job nền của CHK (ADR-013, SB-34): khóa tư vấn (một bản chạy trên toàn cụm) và hạn thời gian là việc của JobRunner (platform). Cả hai idempotent (điều kiện trạng thái nằm trong câu UPDATE), giới hạn lô 1000 dòng mỗi giao dịch,
 * `FOR UPDATE SKIP LOCKED` nên dòng đang bị khách giữ khóa được bỏ qua tới lượt sau và hai bản chạy cùng lúc không xử lý trùng một phiên. Tác nhân `system`, không audit (không có thao tác của người).
 */
@Injectable()
export class JobsService {
  private readonly log: AppLogger;
  constructor(private readonly transactions: TransactionService, private readonly events: EventsService, logger: AppLogger) { this.log = logger.for('checkout'); }

  /** Phiên `open` quá `expires_at` thành `expired`, mỗi phiên một CheckoutExpired (`checkout_id`, `user_id`, `cart_id`) CÙNG giao dịch chuyển trạng thái (ADR-011). Trả số phiên đã chuyển. */
  async expireOnce(o: JobOptions = {}): Promise<{ sessions: number; batches: number }> {
    const start = Date.now(), budget = o.budgetMs ?? EXPIRE_BUDGET_MS;
    let sessions = 0, batches = 0;
    while (!o.signal?.aborted && Date.now() - start < budget) {
      const n = await this.expireBatch(o.now, o.batch ?? EXPIRE_BATCH);
      if (n === 0) break;
      sessions += n; batches++;
    }
    this.log.info('chk.expire-sessions xong', { code: 'chk-expire', sessions, batches });
    return { sessions, batches };
  }

  private expireBatch(now: Date | undefined, batch: number): Promise<number> {
    return this.transactions.run(async (tx) => {
      const rows = await tx.$queryRaw<{ id: string; user_id: string; cart_id: string }[]>`
        UPDATE checkout_sessions SET status = 'expired'::checkout_status, updated_at = clock_timestamp()
        WHERE id IN (
          SELECT id FROM checkout_sessions WHERE status = 'open'::checkout_status AND expires_at <= COALESCE(${now ?? null}::timestamptz, clock_timestamp())
          ORDER BY expires_at, id LIMIT ${batch} FOR UPDATE SKIP LOCKED
        )
        RETURNING id, user_id, cart_id`;
      for (const r of rows) await this.events.publish(tx, { type: 'CheckoutExpired', aggregate_type: 'CheckoutSession', aggregate_id: r.id, payload: { checkout_id: r.id, user_id: r.user_id, cart_id: r.cart_id } });
      return rows.length;
    });
  }

  /** Bản chụp địa chỉ của phiên đã đóng (`completed`, `expired`, `cancelled`) quá 30 ngày thì đặt rỗng (SB-08, ADR-022); bản ghi phiên (`order_id`, `status`, thời điểm) giữ để đối chiếu. Phiên `open` không bị đụng. */
  async purgeOnce(o: JobOptions = {}): Promise<{ sessions: number; batches: number }> {
    const start = Date.now(), budget = o.budgetMs ?? PURGE_BUDGET_MS;
    let sessions = 0, batches = 0;
    while (!o.signal?.aborted && Date.now() - start < budget) {
      const n = await this.transactions.run((tx) => tx.$executeRaw`
        UPDATE checkout_sessions SET address_snapshot = NULL
        WHERE id IN (
          SELECT id FROM checkout_sessions WHERE status <> 'open'::checkout_status AND address_snapshot IS NOT NULL
            AND updated_at < COALESCE(${o.now ?? null}::timestamptz, clock_timestamp()) - make_interval(days => ${PURGE_DAYS}::int)
          ORDER BY updated_at, id LIMIT ${o.batch ?? PURGE_BATCH} FOR UPDATE SKIP LOCKED
        )`);
      if (n === 0) break;
      sessions += n; batches++;
    }
    this.log.info('chk.purge-address-snapshots xong', { code: 'chk-purge', sessions, batches });
    return { sessions, batches };
  }
}
