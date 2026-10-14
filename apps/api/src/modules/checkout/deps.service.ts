import { Injectable } from '@nestjs/common';
import { CartApi, type CheckoutSnapshot } from '../cart';
import { InventoryApi, type ReserveItem, type ReserveResult as InvReserveResult } from '../inventory';
import { OrderApi, type CreatePendingInput } from '../order';
import { PromotionApi, type EvaluateInput, type EvaluateResult, type ReserveInput, type ReserveResult as PrmReserveResult } from '../promotion';
import { AppLogger, ConfigService, DomainError, type Tx } from '../platform';
import { ShippingApi, type ActiveMethod, type QuoteInput, type QuoteResult } from '../shipping';
import { AddressService, type AddressForCheckout } from '../user';
import type { ChkConfig } from './config';

/** Module khác không trả lời đúng hạn hay ném lỗi (kể cả `RangeError`, lỗi lập trình của CHK): bên gọi đổi sang 503 `dependency-unavailable` và hoàn tác (CHK-API mục Giao tiếp giữa module, CHK-REQ ...105052127 BR7). */
export class DependencyError extends Error {
  constructor(readonly dep: 'cart' | 'user' | 'promotion' | 'inventory' | 'shipping' | 'order', readonly cause2?: unknown) { super(`${dep} unavailable`); this.name = 'DependencyError'; }
}
/** Mã lỗi nghiệp vụ có tên của module bên kia (không phải lỗi hạ tầng): bên gọi bắt theo `code`. */
const DOMAIN = (e: unknown): e is { code: string } => e instanceof DomainError;

/**
 * Cổng gọi sáu module phụ thuộc (CRT, USR, PRM, INV, SHP, ORD; cột Phụ thuộc của CHK ở architecture.md): phương thức trong tiến trình, mỗi lời gọi có hạn `CHK_DEPENDENCY_TIMEOUT_MS` (mặc định 2 giây). Quá hạn hay
 * ngoại lệ bất kỳ thành `DependencyError`, ghi log `error` không kèm dữ liệu cá nhân hay mã giảm giá (thông điệp lỗi của bên kia có thể chứa chúng). Lời gọi đang chạy không hủy được (trong tiến trình) nhưng
 * kết quả muộn bị bỏ; lời gọi nhận `tx` mà quá hạn thì bên gọi hoàn tác giao dịch của mình.
 */
@Injectable()
export class DepsService {
  /** Hạn thời gian mỗi lời gọi; mặc định theo cấu hình, chỉ test đổi để thử nhánh quá hạn nhanh. */
  timeoutMs: number;
  private readonly log: AppLogger;
  constructor(
    private readonly cart: CartApi, private readonly addresses: AddressService, private readonly promotion: PromotionApi, private readonly inventory: InventoryApi,
    private readonly shipping: ShippingApi, private readonly orders: OrderApi, config: ConfigService, logger: AppLogger,
  ) {
    this.log = logger.for('checkout');
    this.timeoutMs = config.get<ChkConfig['CHK_DEPENDENCY_TIMEOUT_MS']>('CHK_DEPENDENCY_TIMEOUT_MS');
  }

  private async call<T>(dep: DependencyError['dep'], what: string, fn: () => Promise<T>): Promise<T> {
    let timer: NodeJS.Timeout | undefined;
    try {
      const timeout = new Promise<never>((_, rej) => { timer = setTimeout(() => rej(new Error('timeout')), this.timeoutMs); });
      return await Promise.race([fn(), timeout]);
    } catch (e) {
      if (DOMAIN(e)) throw e; // lỗi nghiệp vụ có mã của bên kia (ví dụ `method-unavailable` của SHP): bên gọi tự xử lý theo mã
      this.log.error('mô-đun phụ thuộc không trả lời', { dep, op: what, code: 'dependency-failed', err_name: (e as Error)?.name ?? 'unknown', timeout: (e as Error)?.message === 'timeout' });
      throw new DependencyError(dep, e);
    } finally { if (timer) clearTimeout(timer); }
  }

  snapshot(userId: string): Promise<CheckoutSnapshot> { return this.call('cart', 'snapshotForCheckout', () => this.cart.snapshotForCheckout(userId)); }
  lockCart(userId: string, tx: Tx): Promise<CheckoutSnapshot> { return this.call('cart', 'lockForCheckout', () => this.cart.lockForCheckout(userId, tx)); }
  getAddress(userId: string, addressId: string): Promise<AddressForCheckout | null> { return this.call('user', 'getAddress', () => this.addresses.getAddress(userId, addressId)); }
  listAddresses(userId: string): Promise<AddressForCheckout[]> { return this.call('user', 'listAddresses', () => this.addresses.listAddresses(userId)); }
  listMethods(): Promise<ActiveMethod[]> { return this.call('shipping', 'listActiveMethods', () => this.shipping.listActiveMethods()); }
  /** `quote` ném `DomainError('method-unavailable')` khi phương thức không có, đã tắt hay sai định dạng: đi qua nguyên vẹn để bên gọi đổi sang 409 `shipping-method-unavailable`. */
  quote(input: QuoteInput): Promise<QuoteResult> { return this.call('shipping', 'quote', () => this.shipping.quote(input)); }
  evaluate(input: EvaluateInput): Promise<EvaluateResult> { return this.call('promotion', 'evaluate', () => this.promotion.evaluate(input)); }
  reservePromotion(input: ReserveInput, tx: Tx): Promise<PrmReserveResult> { return this.call('promotion', 'reserve', () => this.promotion.reserve(input, tx)); }
  reserveStock(orderId: string, items: ReserveItem[], expiresAt: Date | null, tx: Tx): Promise<InvReserveResult> { return this.call('inventory', 'reserve', () => this.inventory.reserve(orderId, items, expiresAt, tx)); }
  countOpenOrders(userId: string): Promise<{ online_pending: number; cod_open: number }> { return this.call('order', 'countOpenOrders', () => this.orders.countOpenOrders(userId)); }
  createPending(input: CreatePendingInput, tx: Tx): Promise<{ order_id: string; code: string }> { return this.call('order', 'createPending', () => this.orders.createPending(input, tx)); }
  confirmCod(orderId: string, tx: Tx): Promise<{ order_id: string; status: 'confirmed' }> { return this.call('order', 'confirmCod', () => this.orders.confirmCod(orderId, tx)); }
  summary(orderId: string) { return this.call('order', 'getSummary', () => this.orders.getSummary(orderId)); }
  paymentInfo(orderId: string) { return this.call('order', 'findForPayment', () => this.orders.findForPayment(orderId)); }
}
