import { Injectable } from '@nestjs/common';
import { CatalogApi } from '../catalog';
import { AppLogger, AuditService, EventsService, PrismaService, TransactionService } from '../platform';
import { EXPIRE_BATCH, EXPIRE_BUDGET_MS, OVERDUE_ALERT_MS, RECONCILE_MAX_PAGES, RECONCILE_MAX_REPORT, RECONCILE_PAGE } from './config';
import { LowStockService } from './low-stock.service';

type Line = { stock_item_id: string; quantity: number; order_id: string };
export interface ExpireOptions {
  /** Mốc "giờ CSDL" để so `expires_at`; bỏ trống là `now()` của CSDL (đường chạy thật). Chỉ để thử ranh giới 1 mili giây mà không đổi đồng hồ CSDL. */
  now?: Date;
  signal?: AbortSignal;
  /** Hạn thời gian cho cả lần chạy (SB-34): hết hạn thì thôi nhận lô mới, lượt sau làm tiếp. */
  budgetMs?: number;
}

/**
 * Hai job nền của INV (ADR-013): `inventory.expire-reservations` mỗi phút và `inventory.reconcile` hằng đêm. Lấy khóa tư vấn (một bản chạy trên toàn cụm) và đặt hạn thời gian
 * là việc của JobRunner (platform). Mỗi job idempotent (điều kiện trạng thái nằm trong câu UPDATE, tạo bù bằng ON CONFLICT DO NOTHING), có giới hạn lô và đóng khi không chắc.
 */
@Injectable()
export class JobsService {
  private readonly log: AppLogger;
  constructor(
    private readonly prisma: PrismaService, private readonly transactions: TransactionService, private readonly events: EventsService, private readonly audit: AuditService,
    private readonly lowStock: LowStockService, private readonly catalog: CatalogApi, logger: AppLogger,
  ) {
    this.log = logger.for('inventory');
  }

  /** Hết hạn giữ hàng: lặp theo lô (mỗi lô một giao dịch, tối đa EXPIRE_BATCH đơn) tới khi hết đơn quá hạn hoặc hết hạn thời gian. Trả số đơn đã chuyển `expired`. */
  async expireOnce(o: ExpireOptions = {}): Promise<{ orders: number; batches: number }> {
    const start = Date.now(), budget = o.budgetMs ?? EXPIRE_BUDGET_MS;
    let orders = 0, batches = 0;
    while (!o.signal?.aborted && Date.now() - start < budget) {
      const n = await this.expireBatch(o.now);
      if (n === 0) break;
      orders += n; batches++;
    }
    await this.alertOverdue(o.now);
    return { orders, batches };
  }

  private async expireBatch(now?: Date): Promise<number> {
    const at = now ?? null; // NULL: dùng now() của CSDL
    return this.transactions.run(async (tx) => {
      // không khóa dòng reservation ở bước chọn (không đảo thứ tự khóa so với chốt, T17): khóa dòng kho theo id tăng dần rồi mới đổi trạng thái
      const due = await tx.$queryRaw<{ order_id: string }[]>`
        SELECT DISTINCT order_id FROM stock_reservations WHERE status = 'held' AND expires_at <= COALESCE(${at}::timestamptz, now()) ORDER BY order_id LIMIT ${EXPIRE_BATCH}`;
      if (!due.length) return 0;
      const orders = due.map((d) => d.order_id);
      await tx.$queryRaw`
        SELECT id FROM stock_items WHERE id IN (
          SELECT stock_item_id FROM stock_reservations WHERE order_id = ANY(${orders}::uuid[]) AND status = 'held' AND expires_at <= COALESCE(${at}::timestamptz, now())
        ) ORDER BY id FOR UPDATE`;
      // điều kiện status = 'held' giữ idempotent và đúng một bên thắng khi đua với chốt hoặc nhả, kể cả khi khóa job không được tôn trọng (K-02)
      const lines = await tx.$queryRaw<Line[]>`
        UPDATE stock_reservations SET status = 'expired', updated_at = now()
        WHERE order_id = ANY(${orders}::uuid[]) AND status = 'held' AND expires_at <= COALESCE(${at}::timestamptz, now())
        RETURNING stock_item_id, quantity, order_id`;
      const perItem = new Map<string, number>();
      for (const l of lines) perItem.set(l.stock_item_id, (perItem.get(l.stock_item_id) ?? 0) + l.quantity);
      for (const [item, q] of [...perItem].sort(([a], [b]) => a.localeCompare(b))) {
        await tx.$executeRaw`UPDATE stock_items SET reserved = reserved - ${q}, updated_at = now() WHERE id = ${item}::uuid`;
      }
      const expired = [...new Set(lines.map((l) => l.order_id))].sort();
      for (const order of expired) await this.events.publish(tx, { type: 'StockReservationExpired', aggregate_type: 'order', aggregate_id: order, payload: { order_id: order } });
      await this.lowStock.evaluate(tx, [...perItem.keys()]);
      return expired.length;
    });
  }

  /** Còn reservation quá hạn hơn 5 phút mà job chưa xử lý (job dừng hay chậm): log error để vận hành thấy (INV-SEC T8). */
  private async alertOverdue(now?: Date): Promise<void> {
    const [{ n }] = await this.prisma.$queryRaw<{ n: bigint }[]>`
      SELECT count(*) AS n FROM stock_reservations
      WHERE status = 'held' AND expires_at < COALESCE(${now ?? null}::timestamptz, now()) - make_interval(secs => ${OVERDUE_ALERT_MS / 1000})`;
    if (Number(n) > 0) this.log.error('reservation quá hạn hơn 5 phút chưa được xử lý', { overdue: Number(n) });
  }

  /**
   * Đối soát hằng đêm (INV-REQ ...661 BR5, ...685 BR7): hai truy vấn chỉ đọc (lệch chỉ ghi log `error`, KHÔNG sửa) và tạo bù bản ghi cho sản phẩm `active` của PRD chưa có.
   * Tạo bù đóng khi không chắc: PRD lỗi thì dừng, không tạo gì; mỗi lần chạy có trần số trang (SB-34).
   */
  async reconcileOnce(o: { signal?: AbortSignal } = {}): Promise<{ reserved_mismatch: number; on_hand_mismatch: number; backfilled: number }> {
    const reserved = await this.prisma.$queryRaw<{ product_id: string; reserved: number; held: number }[]>`
      SELECT s.product_id, s.reserved, COALESCE(h.total, 0)::int AS held FROM stock_items s
      LEFT JOIN (SELECT stock_item_id, sum(quantity) AS total FROM stock_reservations WHERE status = 'held' GROUP BY stock_item_id) h ON h.stock_item_id = s.id
      WHERE s.reserved <> COALESCE(h.total, 0) ORDER BY s.id LIMIT ${RECONCILE_MAX_REPORT}`;
    for (const r of reserved) this.log.error('đối soát: reserved lệch tổng reservation held', { product_id: r.product_id, reserved: r.reserved, held_total: r.held });
    const onHand = await this.prisma.$queryRaw<{ product_id: string; on_hand: number; after: number }[]>`
      SELECT s.product_id, s.on_hand, COALESCE(m.on_hand_after, 0) AS after FROM stock_items s
      LEFT JOIN LATERAL (SELECT on_hand_after FROM stock_movements WHERE stock_item_id = s.id ORDER BY created_at DESC, id DESC LIMIT 1) m ON true
      WHERE s.on_hand <> COALESCE(m.on_hand_after, 0) ORDER BY s.id LIMIT ${RECONCILE_MAX_REPORT}`;
    for (const r of onHand) this.log.error('đối soát: on_hand lệch on_hand_after của dòng lịch sử mới nhất', { product_id: r.product_id, on_hand: r.on_hand, on_hand_after: r.after });
    return { reserved_mismatch: reserved.length, on_hand_mismatch: onHand.length, backfilled: await this.backfill(o.signal) };
  }

  private async backfill(signal?: AbortSignal): Promise<number> {
    let after: string | undefined, total = 0;
    try {
      for (let page = 0; page < RECONCILE_MAX_PAGES && !signal?.aborted; page++) {
        const ids = await this.catalog.listActiveProductIds(after, RECONCILE_PAGE);
        if (!ids.length) break;
        const made = await this.transactions.run(async (tx) => {
          const rows = await tx.$queryRaw<{ product_id: string }[]>`INSERT INTO stock_items (product_id) SELECT unnest(${ids}::uuid[]) ON CONFLICT (product_id) DO NOTHING RETURNING product_id`;
          for (const r of rows) await this.audit.record(tx, { actor_role: 'system', action: 'inventory.stock_item_create', target_type: 'stock_item', target_id: r.product_id, after: { on_hand: 0, backfill: true } });
          return rows;
        });
        for (const r of made) this.log.info('stock_item_backfilled', { product_id: r.product_id });
        total += made.length;
        after = ids[ids.length - 1];
        if (ids.length < RECONCILE_PAGE) break;
      }
    } catch (err) {
      this.log.error('tạo bù bản ghi kho dừng vì lỗi (không tạo thêm gì)', { err });
    }
    return total;
  }
}
