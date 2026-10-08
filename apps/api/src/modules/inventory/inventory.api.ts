import { Injectable } from '@nestjs/common';
import type { Tx } from '../platform';
import { ReadService } from './read.service';
import { ReservationService, type ReserveItem, type ReserveResult } from './reservation.service';

/**
 * Giao diện nội bộ INV phơi ra cho module khác (ADR-012, bảng "Giao diện module" của architecture.md, INV-API mục Giao tiếp giữa module): phương thức trong tiến trình, không có endpoint HTTP.
 * Chữ ký là bản chốt của INV; bên gọi (CHK, CRT, DSH) dùng đúng chữ ký này.
 */
@Injectable()
export class InventoryApi {
  constructor(private readonly reservations: ReservationService, private readonly reads: ReadService) {}

  /**
   * CHK: giữ hàng của một đơn trong giao dịch `tx` của CHK. `expires_at` do CHK truyền (cùng giá trị với `ORD.createPending`), `null` là đơn COD.
   * Đầu vào sai (không phải uuid, quá 50 dòng, trùng sản phẩm, số lượng ngoài 1..100000, `expires_at` không sau giờ CSDL) ném `RangeError`;
   * cùng `order_id` khác số lượng ném `ReservationExistsError`; thiếu hàng thì trả `{ ok: false, shortages }` và KHÔNG ghi gì (SAVEPOINT đã quay lui), bên gọi nên hủy giao dịch đặt hàng.
   */
  reserve(orderId: string, items: ReserveItem[], expiresAt: Date | null, tx: Tx): Promise<ReserveResult> {
    return this.reservations.reserve(orderId, items, expiresAt, tx);
  }

  /** CRT: `{ product_id: available }` theo lô (tối đa 100 id, quá thì `RangeError`); chưa có bản ghi hay sản phẩm ngừng bán là 0. */
  getAvailability(productIds: string[]): Promise<Record<string, number>> {
    return this.reads.getAvailability(productIds);
  }

  /** DSH: số sản phẩm tồn thấp và `limit` (1 đến 50, ngoài khoảng ném `RangeError`) dòng có tên, sku (chỉ đọc). */
  getLowStockSummary(limit: number) {
    return this.reads.getLowStockSummary(limit);
  }
}
