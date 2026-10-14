import { Injectable } from '@nestjs/common';
import { AppLogger, TransactionService } from '../platform';
import { ABANDON_BATCH, ABANDON_BUDGET_MS, ABANDON_DAYS } from './config';

export interface AbandonOptions {
  /** Mốc "giờ CSDL" để so `last_activity_at`; bỏ trống là `now()` của CSDL (đường chạy thật). Chỉ test dùng. */
  now?: Date;
  signal?: AbortSignal;
  /** Hạn thời gian cho cả lượt chạy (SB-34): hết hạn thì thôi nhận lô mới, lượt sau làm tiếp. */
  budgetMs?: number;
  /** Số giỏ tối đa mỗi lô (mặc định ABANDON_BATCH); chỉ test dùng để thử giới hạn lô. */
  batch?: number;
}

/**
 * Job `cart.abandon` mỗi giờ (CRT-REQ-20261006-103226614 BR3, BR8; ADR-013): giỏ `active` có `last_activity_at` cũ hơn 30 ngày chuyển `abandoned`. Khóa tư vấn (một bản chạy trên toàn cụm) và hạn thời gian là việc
 * của JobRunner (platform). Idempotent (điều kiện trạng thái trong câu UPDATE), giới hạn lô 1000 giỏ mỗi giao dịch, `FOR UPDATE SKIP LOCKED` nên giỏ đang bị khách hay CHK giữ khóa được bỏ qua tới lượt sau
 * và hai bản chạy cùng lúc vẫn không xử lý trùng. Điều kiện thời gian được kiểm lại sau khi khóa dòng (EvalPlanQual) nên thao tác của khách vừa commit làm giỏ không còn bị đánh dấu. Tác nhân `system`, không audit.
 */
@Injectable()
export class JobsService {
  private readonly log: AppLogger;
  constructor(private readonly transactions: TransactionService, logger: AppLogger) {
    this.log = logger.for('cart');
  }

  /** Trả số giỏ đã chuyển `abandoned` (ghi log mỗi lượt, BR8). */
  async abandonOnce(o: AbandonOptions = {}): Promise<{ carts: number; batches: number }> {
    const start = Date.now(), budget = o.budgetMs ?? ABANDON_BUDGET_MS;
    let carts = 0, batches = 0;
    while (!o.signal?.aborted && Date.now() - start < budget) {
      const n = await this.abandonBatch(o.now, o.batch ?? ABANDON_BATCH);
      if (n === 0) break;
      carts += n; batches++;
    }
    this.log.info('cart.abandon xong', { code: 'cart-abandon', carts, batches });
    return { carts, batches };
  }

  private abandonBatch(now: Date | undefined, batch: number): Promise<number> {
    return this.transactions.run((tx) => tx.$executeRaw`
      UPDATE carts SET status = 'abandoned'::cart_status, updated_at = now()
      WHERE id IN (
        SELECT id FROM carts WHERE status = 'active'::cart_status AND last_activity_at < COALESCE(${now ?? null}::timestamptz, now()) - make_interval(days => ${ABANDON_DAYS}::int)
        ORDER BY last_activity_at, id LIMIT ${batch} FOR UPDATE SKIP LOCKED
      )`);
  }
}
