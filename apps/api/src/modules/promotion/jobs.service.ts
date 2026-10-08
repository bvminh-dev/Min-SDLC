import { Injectable } from '@nestjs/common';
import { AppLogger, EventsService, PrismaService, TransactionService } from '../platform';
import { EXPIRE_BATCH, EXPIRE_BUDGET_MS, RECONCILE_MAX_REPORT } from './config';

export interface ExpireOptions {
  /** Mốc "giờ CSDL" để so `expires_at`; bỏ trống là `now()` của CSDL (đường chạy thật). Chỉ test dùng. */
  now?: Date;
  signal?: AbortSignal;
  /** Hạn thời gian cho cả lần chạy (SB-34): hết hạn thì thôi nhận lô mới, lượt sau làm tiếp. */
  budgetMs?: number;
  /** Số coupon tối đa mỗi lô (mặc định EXPIRE_BATCH); chỉ test dùng để thử giới hạn lô. */
  batch?: number;
}

/**
 * Hai job nền của PRM (ADR-013): `promotion.expire-coupons` mỗi phút và `promotion.reconcile` chu kỳ 24 giờ. Khóa tư vấn (một bản chạy trên toàn cụm) và hạn thời gian là việc của JobRunner (platform).
 * Mỗi job idempotent (điều kiện trạng thái nằm trong câu UPDATE), có giới hạn lô và đóng khi không chắc (SB-34). Job hết hạn và đối soát là tác nhân `system`, không audit (ADR-021: hết hạn không audit).
 */
@Injectable()
export class JobsService {
  private readonly log: AppLogger;
  constructor(private readonly prisma: PrismaService, private readonly transactions: TransactionService, private readonly events: EventsService, logger: AppLogger) {
    this.log = logger.for('promotion');
  }

  /** Hết hạn coupon: lặp theo lô (mỗi lô một giao dịch, `FOR UPDATE SKIP LOCKED`) tới khi hết coupon quá hạn hoặc hết hạn thời gian. Trả số coupon đã chuyển `expired`. */
  async expireOnce(o: ExpireOptions = {}): Promise<{ coupons: number; batches: number }> {
    const start = Date.now(), budget = o.budgetMs ?? EXPIRE_BUDGET_MS;
    let coupons = 0, batches = 0;
    while (!o.signal?.aborted && Date.now() - start < budget) {
      const n = await this.expireBatch(o.now, o.batch ?? EXPIRE_BATCH);
      if (n === 0) break;
      coupons += n; batches++;
    }
    return { coupons, batches };
  }

  private expireBatch(now: Date | undefined, batch: number): Promise<number> {
    return this.transactions.run(async (tx) => {
      // chỉ chọn `active` và `disabled` nên chạy lại không phát lại (idempotent); `exhausted` không nằm trong điều kiện (PRM-REQ ...424 BR4)
      const rows = await tx.$queryRaw<{ id: string }[]>`
        WITH due AS (
          SELECT id FROM coupons WHERE status IN ('active'::coupon_status, 'disabled'::coupon_status) AND expires_at <= COALESCE(${now ?? null}::timestamptz, now())
          ORDER BY expires_at, id LIMIT ${batch} FOR UPDATE SKIP LOCKED
        )
        UPDATE coupons c SET status = 'expired'::coupon_status, updated_at = now() FROM due WHERE c.id = due.id RETURNING c.id`;
      for (const r of rows.sort((a, b) => a.id.localeCompare(b.id))) await this.events.publish(tx, { type: 'CouponExpired', aggregate_type: 'coupon', aggregate_id: r.id, payload: { coupon_id: r.id } });
      return rows.length;
    });
  }

  /** Đối soát bộ đếm (PRM-DB mục 8): `consumed_count` và `reserved_count` so với số dòng `coupon_redemptions`; lệch thì chỉ ghi log `error` (KHÔNG tự sửa), tối đa RECONCILE_MAX_REPORT dòng mỗi lần chạy. */
  async reconcileOnce(): Promise<{ mismatched: number }> {
    const rows = await this.prisma.$queryRaw<{ id: string; consumed_count: number; reserved_count: number; consumed: number; reserved: number }[]>`
      SELECT c.id, c.consumed_count, c.reserved_count, COALESCE(r.consumed, 0)::int AS consumed, COALESCE(r.reserved, 0)::int AS reserved FROM coupons c
      LEFT JOIN (SELECT coupon_id, count(*) FILTER (WHERE status = 'consumed') AS consumed, count(*) FILTER (WHERE status = 'reserved') AS reserved FROM coupon_redemptions GROUP BY coupon_id) r ON r.coupon_id = c.id
      WHERE c.consumed_count <> COALESCE(r.consumed, 0) OR c.reserved_count <> COALESCE(r.reserved, 0) ORDER BY c.id LIMIT ${RECONCILE_MAX_REPORT}`;
    for (const r of rows) this.log.error('đối soát: bộ đếm coupon lệch số lượt', { coupon_id: r.id, consumed_count: r.consumed_count, consumed: r.consumed, reserved_count: r.reserved_count, reserved: r.reserved });
    return { mismatched: rows.length };
  }
}
