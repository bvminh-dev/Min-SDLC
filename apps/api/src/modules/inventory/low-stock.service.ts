import { Injectable } from '@nestjs/common';
import { AppLogger, EventsService, type Tx } from '../platform';
import { CatalogApi } from '../catalog';
import { NAME_LOOKUP_MS } from './config';

/**
 * Đánh giá tồn thấp (INV-DB mục Giao dịch 7, INV-REQ ...611 BR4): gọi trong cùng giao dịch của MỌI thay đổi `on_hand`, `reserved`, ngưỡng hay `archived_at`.
 * Một câu cập nhật cờ `low_stock_notified` kèm giá trị cũ (khóa dòng): chỉ khi cờ chuyển false -> true mới ghi LowStockDetected vào outbox,
 * nên hai thay đổi song song không phát hai lần (cùng khóa dòng, cờ đổi đúng một lần).
 */
@Injectable()
export class LowStockService {
  private readonly log: AppLogger;
  constructor(private readonly events: EventsService, private readonly catalog: CatalogApi, logger: AppLogger) {
    this.log = logger.for('inventory');
  }

  async evaluate(tx: Tx, itemIds: string[]): Promise<void> {
    for (const id of [...new Set(itemIds)].sort()) {
      const [r] = await tx.$queryRaw<{ was: boolean; now: boolean; product_id: string; on_hand: number; available: number; threshold: number }[]>`
        WITH old AS (SELECT low_stock_notified AS was FROM stock_items WHERE id = ${id}::uuid FOR UPDATE)
        UPDATE stock_items s SET low_stock_notified = (s.on_hand - s.reserved <= s.low_stock_threshold AND s.archived_at IS NULL)
        FROM old WHERE s.id = ${id}::uuid
        RETURNING old.was, s.low_stock_notified AS now, s.product_id, s.on_hand, s.on_hand - s.reserved AS available, s.low_stock_threshold AS threshold`;
      if (!r || r.was || !r.now) continue;
      await this.events.publish(tx, {
        type: 'LowStockDetected', aggregate_type: 'product', aggregate_id: r.product_id,
        payload: { product_id: r.product_id, product_name: await this.nameOf(r.product_id), on_hand: r.on_hand, available: r.available, threshold: r.threshold },
      });
    }
  }

  /** Tên từ giao diện đọc của PRD (cùng tiến trình, SB-31); quá hạn hoặc lỗi thì rỗng và log warn, không chặn thao tác kho. */
  private async nameOf(productId: string): Promise<string> {
    let timer: NodeJS.Timeout | undefined;
    try {
      const [p] = await Promise.race([
        this.catalog.getSummaries([productId]),
        new Promise<never>((_, rej) => { timer = setTimeout(() => rej(new Error('quá hạn đọc tên sản phẩm')), NAME_LOOKUP_MS); timer.unref(); }),
      ]);
      return p?.name ?? '';
    } catch (err) {
      this.log.warn('không đọc được tên sản phẩm cho LowStockDetected', { product_id: productId, err });
      return '';
    } finally {
      clearTimeout(timer);
    }
  }
}
