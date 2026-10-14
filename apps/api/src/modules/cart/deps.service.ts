import { Injectable } from '@nestjs/common';
import { CatalogApi, type CartProduct } from '../catalog';
import { InventoryApi } from '../inventory';
import { PromotionApi, type EvaluateResult } from '../promotion';
import { AppLogger, DomainError } from '../platform';
import { ShippingApi, type QuoteResult } from '../shipping';
import { DEP_TIMEOUT_MS } from './config';

/** Mô-đun khác không trả lời đúng hạn hay ném lỗi: bên gọi chọn đổi sang 503 hay ghi lỗi tạm thời vào phần của nó (CRT-API Giao tiếp giữa module). */
export class DependencyError extends Error {
  constructor(readonly dep: 'catalog' | 'inventory' | 'promotion' | 'shipping', readonly cause2?: unknown) { super(`${dep} unavailable`); this.name = 'DependencyError'; }
}

/**
 * Cổng gọi sang PRD, INV, PRM, SHP (CRT-API Giao tiếp giữa module): phương thức trong tiến trình, mỗi lời gọi có hạn 2 giây (không giữ khóa của giỏ trong lúc chờ: gọi TRƯỚC khi mở giao dịch).
 * Quá hạn hay ngoại lệ bất kỳ (kể cả `RangeError` khi dữ liệu vượt miền của bên kia) thành `DependencyError`, ghi log `error` không kèm dữ liệu cá nhân hay mã giảm giá. Lời gọi đang chạy
 * không hủy được (phương thức trong tiến trình) nhưng kết quả muộn bị bỏ.
 */
@Injectable()
export class DepsService {
  /** Hạn thời gian mỗi lời gọi; chỉ test đổi để thử nhánh quá hạn nhanh. */
  timeoutMs = DEP_TIMEOUT_MS;
  private readonly log: AppLogger;
  constructor(private readonly catalog: CatalogApi, private readonly inventory: InventoryApi, private readonly promotion: PromotionApi, private readonly shipping: ShippingApi, logger: AppLogger) {
    this.log = logger.for('cart');
  }

  private async call<T>(dep: DependencyError['dep'], fn: () => Promise<T>): Promise<T> {
    let timer: NodeJS.Timeout | undefined;
    try {
      const timeout = new Promise<never>((_, rej) => { timer = setTimeout(() => rej(new Error('timeout')), this.timeoutMs); });
      return await Promise.race([fn(), timeout]);
    } catch (e) {
      if (e instanceof DomainError) throw e; // lỗi nghiệp vụ có mã của bên kia (ví dụ `method-unavailable`): bên gọi tự xử lý theo mã
      this.log.error('mô-đun phụ thuộc không trả lời', { dep, code: 'dependency-failed', err_name: (e as Error)?.name ?? 'unknown', timeout: (e as Error)?.message === 'timeout' }); // không ghi thông điệp lỗi của bên kia: có thể chứa mã giảm giá, email (T14)
      throw new DependencyError(dep, e);
    } finally { if (timer) clearTimeout(timer); }
  }

  /** PRD: tên, sku, giá hiện hành, ảnh, `sellable` theo lô; id không có hoặc sai định dạng không nằm trong kết quả. Một lời gọi theo lô (tối đa 50 id). */
  async products(ids: string[]): Promise<Map<string, CartProduct>> {
    if (!ids.length) return new Map();
    const rows = await this.call('catalog', () => this.catalog.getForCart(ids));
    return new Map(rows.map((r) => [r.product_id, r]));
  }

  /** INV: `{ product_id: available }` theo lô; 0 khi không có bản ghi hoặc sản phẩm ngừng bán. */
  availability(ids: string[]): Promise<Record<string, number>> {
    if (!ids.length) return Promise.resolve({});
    return this.call('inventory', () => this.inventory.getAvailability(ids));
  }

  /** PRM: `evaluate` trả `{ ok: false, reason }` cho mọi lỗi nghiệp vụ (không ném); ngoại lệ hay quá hạn thành `DependencyError('promotion')`. */
  evaluate(input: { code: string; user_id: string; items_subtotal: number; count_attempt: boolean }): Promise<EvaluateResult> {
    return this.call('promotion', () => this.promotion.evaluate(input));
  }

  /** SHP: `quote` ném `DomainError('method-unavailable')` khi phương thức không có, đã tắt hay sai định dạng; lỗi khác (kể cả `RangeError`) thành `DependencyError('shipping')`. */
  quote(input: { method_id: string; city: string; subtotal: number }): Promise<QuoteResult> {
    return this.call('shipping', () => this.shipping.quote(input));
  }
}
