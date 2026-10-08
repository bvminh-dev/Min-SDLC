import { Injectable } from '@nestjs/common';
import { AuditService, DomainError, TransactionService, type SessionContext, type Tx } from '../platform';
import { MAX_ON_HAND } from './config';
import { UUID_RE, toItem, type ItemRow } from './item';
import { LowStockService } from './low-stock.service';
import { ReadService } from './read.service';
import type { Adjust, StockIn, StockOut, Threshold } from './policy';

type Movement = { id: string; created_at: Date };

/**
 * Thao tác kho thủ công (INV-DB mục Giao dịch 6; INV-REQ ...463, ...487, ...512, ...611): nhập, xuất, điều chỉnh, đổi ngưỡng. Mỗi thao tác là MỘT giao dịch gồm
 * khóa dòng kho, cập nhật có điều kiện MỘT câu (cộng hoặc trừ tương đối, không đọc rồi ghi), dòng lịch sử, đánh giá tồn thấp, audit (SB-07, SB-19).
 * Nhập, xuất, điều chỉnh chạy trong giao dịch `tx` của bước Idempotency-Key của platform (ADR-017): lỗi 409 quay lui cả khóa nên không "đốt" khóa.
 * Người thao tác (`actor_id`, `actor_name`) chỉ lấy từ phiên (SB-05); `actor_name` là bản chụp lúc ghi (R-10).
 */
@Injectable()
export class StockService {
  constructor(
    private readonly transactions: TransactionService, private readonly audit: AuditService, private readonly lowStock: LowStockService, private readonly reads: ReadService,
  ) {}

  /** Khóa và đọc dòng kho theo `product_id`; id sai định dạng hay chưa có bản ghi là cùng một 404 (INV-REQ ...435 BR5). */
  private async lock(tx: Tx, productId: string): Promise<ItemRow> {
    if (!UUID_RE.test(productId)) throw new DomainError('not-found');
    const [r] = await tx.$queryRaw<ItemRow[]>`SELECT id, product_id, on_hand, reserved, low_stock_threshold, archived_at, version, updated_at FROM stock_items WHERE product_id = ${productId.toLowerCase()}::uuid FOR UPDATE`;
    if (!r) throw new DomainError('not-found');
    return r;
  }

  // `created_at` = clock_timestamp() (lúc ghi, sau khi đã cầm khóa dòng kho), không phải now() của đầu giao dịch: giao dịch bắt đầu sớm nhưng lấy khóa sau không được đứng trước dòng ghi trước nó (thứ tự lịch sử, đối soát lấy dòng mới nhất).
  private async movement(tx: Tx, itemId: string, m: { type: 'in' | 'out' | 'adjust'; quantity: number; after: number; reason: string | null; note: string | null }, actor: SessionContext): Promise<Movement> {
    const [row] = await tx.$queryRaw<Movement[]>`
      INSERT INTO stock_movements (stock_item_id, type, quantity, on_hand_after, reason, note, actor_id, actor_name, created_at)
      VALUES (${itemId}::uuid, ${m.type}::movement_type, ${m.quantity}, ${m.after}, ${m.reason}, ${m.note}, ${actor.user_id}::uuid, ${actor.display_name ?? null}, clock_timestamp())
      RETURNING id, created_at`;
    return row;
  }

  private done(mv: Movement, m: { type: string; quantity: number; after: number; reason: string | null; note: string | null }, item: ReturnType<typeof toItem>) {
    return { movement: { id: mv.id, type: m.type, quantity: m.quantity, on_hand_after: m.after, reason: m.reason, note: m.note, created_at: mv.created_at }, item };
  }

  private async audited(tx: Tx, actor: SessionContext, action: string, productId: string, before: object, after: object): Promise<void> {
    await this.audit.record(tx, { actor_id: actor.user_id, actor_role: actor.role, action, target_type: 'stock_item', target_id: productId, before, after });
  }

  async stockIn(tx: Tx, actor: SessionContext, productId: string, b: StockIn) {
    const cur = await this.lock(tx, productId);
    if (cur.archived_at) throw new DomainError('product-archived');
    // cộng tương đối bằng một câu UPDATE kèm điều kiện trần (T3, BR8): hai lần nhập song song cộng đúng tổng
    const [row] = await tx.$queryRaw<ItemRow[]>`
      UPDATE stock_items SET on_hand = on_hand + ${b.quantity}, version = version + 1, updated_at = now()
      WHERE id = ${cur.id}::uuid AND archived_at IS NULL AND on_hand + ${b.quantity} <= ${MAX_ON_HAND}
      RETURNING id, product_id, on_hand, reserved, low_stock_threshold, archived_at, version, updated_at`;
    if (!row) throw new DomainError('stock-limit-exceeded', { extra: { max: MAX_ON_HAND, on_hand: cur.on_hand } });
    const m = { type: 'in' as const, quantity: b.quantity, after: row.on_hand, reason: b.reason, note: b.note || null };
    const mv = await this.movement(tx, cur.id, m, actor);
    await this.lowStock.evaluate(tx, [cur.id]);
    await this.audited(tx, actor, 'inventory.stock_in', cur.product_id, { on_hand: cur.on_hand }, { on_hand: row.on_hand });
    return this.done(mv, m, toItem(row));
  }

  async stockOut(tx: Tx, actor: SessionContext, productId: string, b: StockOut) {
    const cur = await this.lock(tx, productId);
    // không lấy phần đang giữ cho đơn: điều kiện nằm ngay trong câu UPDATE (BR3, BR6, SB-25), chạy đua với giữ hàng cũng không làm available âm
    const [row] = await tx.$queryRaw<ItemRow[]>`
      UPDATE stock_items SET on_hand = on_hand - ${b.quantity}, version = version + 1, updated_at = now()
      WHERE id = ${cur.id}::uuid AND on_hand - reserved >= ${b.quantity}
      RETURNING id, product_id, on_hand, reserved, low_stock_threshold, archived_at, version, updated_at`;
    if (!row) throw new DomainError('insufficient-stock', { extra: { available: Math.max(cur.on_hand - cur.reserved, 0) } });
    const m = { type: 'out' as const, quantity: -b.quantity, after: row.on_hand, reason: b.reason, note: b.note || null };
    const mv = await this.movement(tx, cur.id, m, actor);
    await this.lowStock.evaluate(tx, [cur.id]);
    await this.audited(tx, actor, 'inventory.stock_out', cur.product_id, { on_hand: cur.on_hand }, { on_hand: row.on_hand });
    return this.done(mv, m, toItem(row));
  }

  async adjust(tx: Tx, actor: SessionContext, productId: string, b: Adjust) {
    const cur = await this.lock(tx, productId);
    if (b.new_on_hand === cur.on_hand) throw new DomainError('no-change');
    if (b.version !== cur.version) throw new DomainError('stock-version-conflict', { extra: { version: cur.version } });
    const [row] = await tx.$queryRaw<ItemRow[]>`
      UPDATE stock_items SET on_hand = ${b.new_on_hand}, version = version + 1, updated_at = now()
      WHERE id = ${cur.id}::uuid AND version = ${b.version} AND ${b.new_on_hand} >= reserved
      RETURNING id, product_id, on_hand, reserved, low_stock_threshold, archived_at, version, updated_at`;
    if (!row) throw new DomainError('below-reserved', { extra: { reserved: cur.reserved } });
    const m = { type: 'adjust' as const, quantity: b.new_on_hand - cur.on_hand, after: row.on_hand, reason: null, note: b.note };
    const mv = await this.movement(tx, cur.id, m, actor);
    await this.lowStock.evaluate(tx, [cur.id]);
    await this.audited(tx, actor, 'inventory.adjust', cur.product_id, { on_hand: cur.on_hand }, { on_hand: row.on_hand });
    return this.done(mv, m, toItem(row));
  }

  /** Đổi ngưỡng kèm `version` đã xem (SB-30 đợt 3, R-46): tăng `version`, đánh giá lại cảnh báo ngay; sai version thì không đổi gì, không audit. Không cần Idempotency-Key (đặt giá trị tuyệt đối). */
  async setThreshold(actor: SessionContext, productId: string, b: Threshold) {
    await this.transactions.run(async (tx) => {
      const cur = await this.lock(tx, productId);
      const [row] = await tx.$queryRaw<{ id: string }[]>`
        UPDATE stock_items SET low_stock_threshold = ${b.low_stock_threshold}, version = version + 1, updated_at = now()
        WHERE id = ${cur.id}::uuid AND version = ${b.version} RETURNING id`;
      if (!row) throw new DomainError('stock-version-conflict', { extra: { version: cur.version } });
      await this.lowStock.evaluate(tx, [cur.id]);
      await this.audited(tx, actor, 'inventory.threshold', cur.product_id, { low_stock_threshold: cur.low_stock_threshold }, { low_stock_threshold: b.low_stock_threshold });
    });
    return this.reads.detail(productId);
  }
}
