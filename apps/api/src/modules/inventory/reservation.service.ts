import { Injectable } from '@nestjs/common';
import { EventsService, type Tx } from '../platform';
import { MAX_QTY, MAX_RESERVE_LINES } from './config';
import { UUID_RE } from './item';
import { LowStockService } from './low-stock.service';

export interface ReserveItem { product_id: string; quantity: number }
export interface Shortage { product_id: string; requested: number; available: number; reason: 'insufficient_stock' | 'unavailable' }
export interface Reservation { product_id: string; quantity: number; expires_at: Date | null }
export type ReserveResult = { ok: true; reservations: Reservation[] } | { ok: false; shortages: Shortage[] };

/** Gọi lại cùng `order_id` với số lượng khác (INV-REQ ...538 BR6). */
export class ReservationExistsError extends Error {
  readonly code = 'reservation-exists';
  constructor(readonly order_id: string) { super(`reservation-exists: đơn ${order_id} đã giữ hàng với số lượng khác`); this.name = 'ReservationExistsError'; }
}

/**
 * Giữ hàng cho đơn (INV-REQ ...538, INV-DB mục Giao dịch 1): chạy trong giao dịch `tx` của CHK (ADR-012), không mở giao dịch riêng, không gọi hệ thống ngoài khi cầm khóa (SB-31).
 * Khóa trước mọi dòng kho của đơn theo `stock_items.id` tăng dần (cùng thứ tự với chốt, nhả, job hết hạn nên không bế tắc, T17), rồi mỗi dòng đúng một câu
 * `UPDATE ... WHERE on_hand - reserved >= n` (SB-25) kèm CHECK reserved <= on_hand ở CSDL làm lớp thứ hai. Tất cả hoặc không gì cả: SAVEPOINT bảo đảm không để lại dòng nửa vời
 * kể cả khi bên gọi bắt lỗi và vẫn cam kết giao dịch của mình.
 */
@Injectable()
export class ReservationService {
  constructor(private readonly events: EventsService, private readonly lowStock: LowStockService) {}

  private check(orderId: string, items: ReserveItem[], expiresAt: Date | null): void {
    if (typeof orderId !== 'string' || !UUID_RE.test(orderId)) throw new RangeError('reserve: order_id phải là uuid');
    if (!Array.isArray(items) || items.length < 1 || items.length > MAX_RESERVE_LINES) throw new RangeError(`reserve: items phải có 1 đến ${MAX_RESERVE_LINES} dòng`);
    const seen = new Set<string>();
    for (const i of items) {
      if (!i || typeof i.product_id !== 'string' || !UUID_RE.test(i.product_id)) throw new RangeError('reserve: product_id phải là uuid');
      if (!Number.isInteger(i.quantity) || i.quantity < 1 || i.quantity > MAX_QTY) throw new RangeError(`reserve: quantity phải là số nguyên từ 1 đến ${MAX_QTY}`);
      const id = i.product_id.toLowerCase();
      if (seen.has(id)) throw new RangeError('reserve: product_id không được trùng nhau');
      seen.add(id);
    }
    if (expiresAt !== null && !(expiresAt instanceof Date && !Number.isNaN(expiresAt.getTime()))) throw new RangeError('reserve: expires_at phải là Date hoặc null (COD)');
  }

  async reserve(orderId: string, items: ReserveItem[], expiresAt: Date | null, tx: Tx): Promise<ReserveResult> {
    this.check(orderId, items, expiresAt);
    const order = orderId.toLowerCase();
    if (expiresAt !== null) {
      const [{ past }] = await tx.$queryRaw<{ past: boolean }[]>`SELECT ${expiresAt}::timestamptz <= now() AS past`; // giờ CSDL, không giờ máy (K-01)
      if (past) throw new RangeError('reserve: expires_at phải sau giờ hiện tại của CSDL');
    }
    const want = new Map(items.map((i) => [i.product_id.toLowerCase(), i.quantity]));
    await tx.$executeRaw`SAVEPOINT inv_reserve`;
    try {
      const rows = await tx.$queryRaw<{ id: string; product_id: string; archived_at: Date | null }[]>`
        SELECT id, product_id, archived_at FROM stock_items WHERE product_id = ANY(${[...want.keys()]}::uuid[]) ORDER BY id FOR UPDATE`;
      const byProduct = new Map(rows.map((r) => [r.product_id, r]));
      const held = await tx.$queryRaw<{ stock_item_id: string; quantity: number; expires_at: Date | null }[]>`
        SELECT stock_item_id, quantity, expires_at FROM stock_reservations WHERE order_id = ${order}::uuid AND stock_item_id = ANY(${rows.map((r) => r.id)}::uuid[])`;
      const existing = new Map(held.map((h) => [h.stock_item_id, h]));
      const shortages: Shortage[] = [], fresh: ReserveItem[] = [], done = new Map<string, Reservation>(), touched: string[] = [];
      const lines = [...want].map(([product_id, quantity]) => ({ product_id, quantity, row: byProduct.get(product_id) })).sort((a, b) => (a.row?.id ?? '').localeCompare(b.row?.id ?? ''));
      for (const { product_id, quantity, row } of lines) {
        const ex = row && existing.get(row.id);
        if (ex) { // gọi lại cùng đơn: cùng số lượng thì trả lại, khác thì reservation-exists
          if (ex.quantity !== quantity) throw new ReservationExistsError(order);
          done.set(product_id, { product_id, quantity, expires_at: ex.expires_at });
          continue;
        }
        if (!row || row.archived_at) { shortages.push({ product_id, requested: quantity, available: 0, reason: 'unavailable' }); continue; }
        await tx.$executeRaw`
          INSERT INTO stock_reservations (stock_item_id, order_id, quantity, expires_at) VALUES (${row.id}::uuid, ${order}::uuid, ${quantity}, ${expiresAt}::timestamptz)
          ON CONFLICT (stock_item_id, order_id) DO NOTHING`;
        const n = await tx.$executeRaw`
          UPDATE stock_items SET reserved = reserved + ${quantity}, updated_at = now()
          WHERE id = ${row.id}::uuid AND archived_at IS NULL AND on_hand - reserved >= ${quantity}`;
        if (n === 0) {
          const [cur] = await tx.$queryRaw<{ available: number }[]>`SELECT on_hand - reserved AS available FROM stock_items WHERE id = ${row.id}::uuid`;
          shortages.push({ product_id, requested: quantity, available: cur?.available ?? 0, reason: 'insufficient_stock' });
          continue;
        }
        fresh.push({ product_id, quantity });
        touched.push(row.id);
        done.set(product_id, { product_id, quantity, expires_at: expiresAt });
      }
      if (shortages.length) {
        await tx.$executeRaw`ROLLBACK TO SAVEPOINT inv_reserve`;
        await tx.$executeRaw`RELEASE SAVEPOINT inv_reserve`;
        return { ok: false, shortages };
      }
      if (fresh.length) {
        await this.events.publish(tx, { type: 'StockReserved', aggregate_type: 'order', aggregate_id: order, payload: { order_id: order, items: fresh, expires_at: expiresAt?.toISOString() ?? null } });
        await this.lowStock.evaluate(tx, touched);
      }
      await tx.$executeRaw`RELEASE SAVEPOINT inv_reserve`;
      return { ok: true, reservations: items.map((i) => done.get(i.product_id.toLowerCase())!) };
    } catch (e) {
      await tx.$executeRaw`ROLLBACK TO SAVEPOINT inv_reserve`.catch(() => undefined);
      throw e;
    }
  }
}
