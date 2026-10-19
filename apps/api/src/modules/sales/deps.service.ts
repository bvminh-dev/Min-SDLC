import { Injectable } from '@nestjs/common';
import { CatalogApi, type SaleProduct } from '../catalog';
import { InventoryApi, type ReserveItem, type ReserveResult } from '../inventory';
import { OrderApi, OrderBusinessError, type CreateHoInput, type SourceView } from '../order';
import { AppLogger, DomainError, type Tx } from '../platform';
import { ShippingApi, type ActiveMethod, type QuoteInput, type QuoteResult } from '../shipping';
import { UserApi, type SaleCustomer } from '../user';
import { DEPENDENCY_TIMEOUT_MS } from './config';

/** Module khác không trả lời đúng hạn hay ném lỗi (kể cả `RangeError`, lỗi lập trình của SAL): bên gọi đổi sang 503 `dependency-unavailable` và hoàn tác (SAL-REQ-20261015-092711128 BR6). */
export class DependencyError extends Error {
  constructor(readonly dep: 'catalog' | 'inventory' | 'shipping' | 'order' | 'user', readonly cause2?: unknown) { super(`${dep} unavailable`); this.name = 'DependencyError'; }
}

/**
 * Cổng gọi năm module phụ thuộc (PRD, INV, SHP, ORD, USR; cột Phụ thuộc của SAL ở architecture.md, ADR-026): phương thức trong tiến trình, mỗi lời gọi có hạn 2 giây. Quá hạn hay ngoại lệ bất kỳ
 * thành `DependencyError`, ghi log `error` không kèm dữ liệu cá nhân (thông điệp lỗi của bên kia có thể chứa chúng). Lời gọi không nhận `tx` chạy TRƯỚC khi mở giao dịch ghi (không hold-and-wait, SB-31).
 * `DomainError` và `OrderBusinessError` có mã của bên kia (ví dụ `method-unavailable` của SHP, `source_unavailable` của ORD) đi qua nguyên vẹn để bên gọi xử lý theo mã.
 */
@Injectable()
export class DepsService {
  /** Hạn thời gian mỗi lời gọi; chỉ test đổi để thử nhánh quá hạn nhanh. */
  timeoutMs = DEPENDENCY_TIMEOUT_MS;
  private readonly log: AppLogger;
  constructor(
    private readonly catalog: CatalogApi, private readonly inventory: InventoryApi, private readonly shipping: ShippingApi, private readonly orders: OrderApi, private readonly users: UserApi, logger: AppLogger,
  ) { this.log = logger.for('sales'); }

  private async call<T>(dep: DependencyError['dep'], what: string, fn: () => Promise<T>): Promise<T> {
    let timer: NodeJS.Timeout | undefined;
    try {
      const timeout = new Promise<never>((_, rej) => { timer = setTimeout(() => rej(new Error('timeout')), this.timeoutMs); });
      return await Promise.race([fn(), timeout]);
    } catch (e) {
      if (e instanceof DomainError || e instanceof OrderBusinessError) throw e; // lỗi nghiệp vụ có mã của bên kia (`source_unavailable` của ORD): bên gọi tự xử lý theo mã; `invalid_input` là lỗi lập trình của SAL (500)
      this.log.error('mô-đun phụ thuộc không trả lời', { dep, op: what, code: 'dependency-failed', err_name: (e as Error)?.name ?? 'unknown', timeout: (e as Error)?.message === 'timeout' });
      throw new DependencyError(dep, e);
    } finally { if (timer) clearTimeout(timer); }
  }

  sources(): Promise<SourceView[]> { return this.call('order', 'listSources', () => this.orders.listSources()); }
  isCustomer(id: string): Promise<boolean> { return this.call('user', 'isCustomer', () => this.users.isCustomer(id)); }
  products(ids: string[]): Promise<SaleProduct[]> { return this.call('catalog', 'getForSale', () => this.catalog.getForSale(ids)); }
  methods(): Promise<ActiveMethod[]> { return this.call('shipping', 'listActiveMethods', () => this.shipping.listActiveMethods()); }
  /** `quote` ném `DomainError('method-unavailable')` khi phương thức không có, đã tắt hay sai định dạng: đi qua nguyên vẹn để bên gọi đổi sang 409 `shipping-method-unavailable`. */
  quote(input: QuoteInput): Promise<QuoteResult> { return this.call('shipping', 'quote', () => this.shipping.quote(input)); }
  createHo(input: CreateHoInput, tx: Tx): Promise<{ order_id: string; code: string }> { return this.call('order', 'createHo', () => this.orders.createHo(input, tx)); }
  reserve(orderId: string, items: ReserveItem[], tx: Tx): Promise<ReserveResult> { return this.call('inventory', 'reserve', () => this.inventory.reserve(orderId, items, null, tx)); }
  listOrders(o: Parameters<OrderApi['listForSale']>[0]) { return this.call('order', 'listForSale', () => this.orders.listForSale(o)); }
  getOrder(code: string, o: { created_by: string | null }) { return this.call('order', 'getForSale', () => this.orders.getForSale(code, o)); }
  /** Tra khách KHÔNG qua `call`: USR ghi audit trước khi trả, lỗi ghi audit phải ra 500 chứ không phải 503 (SAL-REQ-20261015-092710942 BR5); không giữ giao dịch nào của SAL. */
  lookup(actor: { actor_id: string; actor_role: 'sale' | 'admin' }, key: { phone?: string; email?: string }): Promise<{ items: SaleCustomer[] }> { return this.users.lookupForSale(actor, key); }
}
