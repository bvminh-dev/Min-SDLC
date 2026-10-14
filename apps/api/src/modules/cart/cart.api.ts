import { Injectable } from '@nestjs/common';
import { AppLogger, DomainError, PrismaService, type Tx } from '../platform';
import { SUBTOTAL_MAX } from './config';
import { HEAD_COLS, UUID_RE, type CartHead, type ItemRow, type RawCart } from './db';
import { ReadService, loadRaw } from './read.service';
import { num, type PricedLine } from './pricing';

export interface CheckoutLine { product_id: string; quantity: number; unit_price: number; line_total: number; name: string }
export interface CheckoutIssue { product_id: string; reason: 'unavailable' | 'insufficient_stock'; available?: number }
export type CheckoutSnapshot =
  | { ok: true; cart_id: string; cart_version: number; lines: CheckoutLine[]; items_subtotal: number; coupon_code: string | null; shipping_method_id: string | null; shipping_city: string | null; can_checkout: boolean; issues: CheckoutIssue[] }
  | { ok: false; reason: 'cart_empty' };

/**
 * Giao diện nội bộ CRT phơi ra cho CHK (ADR-012, bảng "Giao diện module" của architecture.md, hai hàng CHK -> CRT; CRT-API mục Giao tiếp giữa module): phương thức trong tiến trình, không có endpoint HTTP.
 * Tên lớp theo quy ước `<Tên>Api` của các module khác; CRT-API và CRT-REQ-20261006-103226562 dùng cùng tên `CartApi`. `unit_price` luôn là giá hiện hành đọc ở server; kết quả KHÔNG có
 * tiền giảm, phí hay tổng (CHK tự tính lại mã bằng `reserve` và phí bằng `quote` với `city` của địa chỉ thật). `lines` chỉ gồm dòng CÒN BÁN (khớp `items_subtotal`); dòng ngừng bán hay thiếu hàng nằm ở `issues`.
 * PRD không trả lời được thì ném `DomainError('service-unavailable')` (không đoán giá); INV lỗi thì không có `insufficient_stock` (khớp `unknown` không chặn, CRT-REQ-20261006-103226588 BR7).
 */
@Injectable()
export class CartApi {
  private readonly log: AppLogger;
  constructor(private readonly prisma: PrismaService, private readonly reads: ReadService, logger: AppLogger) {
    this.log = logger.for('cart');
  }

  private async build(head: CartHead, items: ItemRow[]): Promise<CheckoutSnapshot> {
    const { lines } = await this.reads.price({ head, items } satisfies RawCart);
    const sellable = lines.filter((l) => l.sellable);
    const issues: CheckoutIssue[] = [];
    for (const l of lines as PricedLine[]) {
      if (l.availability.status === 'unavailable') issues.push({ product_id: l.item.product_id, reason: 'unavailable' });
      else if (l.availability.status === 'insufficient') issues.push({ product_id: l.item.product_id, reason: 'insufficient_stock', available: l.availability.available });
      else if (l.availability.status === 'out_of_stock') issues.push({ product_id: l.item.product_id, reason: 'insufficient_stock', available: 0 });
    }
    const subtotal = sellable.reduce((s, l) => s + l.price * BigInt(l.item.quantity), 0n);
    return {
      ok: true, cart_id: head.id, cart_version: head.version,
      lines: sellable.map((l) => ({ product_id: l.item.product_id, quantity: l.item.quantity, unit_price: num(l.price), line_total: num(l.price * BigInt(l.item.quantity)), name: l.product?.name ?? '' })),
      items_subtotal: num(subtotal), coupon_code: head.coupon_code, shipping_method_id: head.shipping_method_id, shipping_city: head.shipping_city, can_checkout: issues.length === 0 && subtotal <= SUBTOTAL_MAX, issues,
    };
  }

  /** Chỉ đọc: giỏ active đã định giá cho CHK. Giỏ trống hay chưa có giỏ: `{ ok: false, reason: 'cart_empty' }`. */
  async snapshotForCheckout(userId: string): Promise<CheckoutSnapshot> {
    if (typeof userId !== 'string' || !UUID_RE.test(userId)) throw new RangeError('snapshotForCheckout: user_id phải là uuid');
    const raw = await loadRaw(this.prisma, userId);
    return raw ? this.build(raw.head, raw.items) : { ok: false, reason: 'cart_empty' };
  }

  /**
   * Trong giao dịch `tx` của CHK (ADR-009, ADR-012): khóa dòng giỏ active (`SELECT ... FOR UPDATE`, giữ tới commit của CHK; thứ tự khóa cố định CheckoutSession, Cart, Order, StockItem, Coupon, CRT chỉ khóa MỘT dòng giỏ),
   * rồi đọc dòng trong chính `tx` và trả như `snapshotForCheckout`. Mọi thao tác sửa giỏ của khách phải chờ nên giỏ không đổi giữa lúc CHK kiểm và lúc tạo đơn. Giỏ trống hay chưa có giỏ: không khóa dòng nào
   * (điều kiện có dòng nằm trong câu khóa). Lời gọi PRD, INV dùng kết nối khác của pool trong khi `tx` còn mở, nên `DB_POOL_MAX` phải từ 2 (cấu hình của platform đã đòi).
   */
  async lockForCheckout(userId: string, tx: Tx): Promise<CheckoutSnapshot> {
    if (typeof userId !== 'string' || !UUID_RE.test(userId)) throw new RangeError('lockForCheckout: user_id phải là uuid');
    const [head] = await tx.$queryRaw<CartHead[]>`
      SELECT ${HEAD_COLS} FROM carts c WHERE c.user_id = ${userId}::uuid AND c.status = 'active' AND EXISTS (SELECT 1 FROM cart_items i WHERE i.cart_id = c.id) FOR UPDATE OF c`;
    if (!head) return { ok: false, reason: 'cart_empty' };
    const items = await tx.$queryRaw<ItemRow[]>`SELECT id, product_id, quantity, unit_price, unavailable_reason FROM cart_items WHERE cart_id = ${head.id}::uuid ORDER BY created_at, id`;
    if (!items.length) return { ok: false, reason: 'cart_empty' };
    this.log.debug('khóa giỏ cho checkout', { cart_id: head.id });
    const snap = await this.build(head, items);
    if (snap.ok && snap.items_subtotal > SUBTOTAL_MAX) throw new DomainError('cart-limit-exceeded', { extra: { max_subtotal: SUBTOTAL_MAX } }); // giá tăng sau khi thêm: SHP không nhận tạm tính này; đặt hàng hoàn tác với 409 thay vì 503
    return snap;
  }
}

