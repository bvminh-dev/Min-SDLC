import { Injectable } from '@nestjs/common';
import { AppLogger, DomainError, PrismaService, type Tx } from '../platform';
import { SUBTOTAL_MAX } from './config';
import { type CartHead, type ItemRow, type RawCart } from './db';
import { DependencyError, DepsService } from './deps.service';
import { EMPTY_VIEW, assemble, num, priceLines, subtotalOf, type CartView, type CouponView, type PricedLine, type ShippingView } from './pricing';

type Db = PrismaService | Tx;

/** Giỏ active của người dùng cùng các dòng theo thứ tự thêm (sớm nhất trước, CRT-REQ-20261006-103226486 BR3); một câu truy vấn nên đọc nhất quán. Giỏ không có dòng nào coi như không có giỏ. */
export async function loadRaw(db: Db, userId: string): Promise<RawCart | null> {
  const rows = await db.$queryRaw<(CartHead & { item_id: string | null; product_id: string | null; quantity: number | null; unit_price: bigint | null; unavailable_reason: string | null })[]>`
    SELECT c.id, c.user_id, c.coupon_code, c.shipping_method_id, c.shipping_city, c.version,
           i.id AS item_id, i.product_id, i.quantity, i.unit_price, i.unavailable_reason
    FROM carts c LEFT JOIN cart_items i ON i.cart_id = c.id
    WHERE c.user_id = ${userId}::uuid AND c.status = 'active'
    ORDER BY i.created_at, i.id`;
  if (!rows.length) return null;
  const { item_id: _a, product_id: _b, quantity: _c, unit_price: _d, unavailable_reason: _e, ...head } = rows[0];
  const items: ItemRow[] = rows.filter((r) => r.item_id !== null).map((r) => ({ id: r.item_id!, product_id: r.product_id!, quantity: r.quantity!, unit_price: r.unit_price!, unavailable_reason: r.unavailable_reason }));
  return items.length ? { head, items } : null;
}

/**
 * Xem giỏ (CRT-REQ-20261006-103226486, ...511, ...537, ...562, ...588): CHỈ ĐỌC, không khóa, không ghi, không đổi `last_activity_at` (BR7). Giá hiện hành từ PRD (một lời gọi theo lô; PRD lỗi thì cả giỏ 503,
 * không đoán giá), tồn từ INV (một lời gọi theo lô; lỗi thì `unknown`, không chặn), mã kiểm lại ở PRM với `count_attempt` = false (không tính lượt sai), phí tính lại ở SHP (mỗi nơi tối đa một lời gọi).
 */
@Injectable()
export class ReadService {
  private readonly log: AppLogger;
  constructor(private readonly prisma: PrismaService, private readonly deps: DepsService, logger: AppLogger) {
    this.log = logger.for('cart');
  }

  /** PRD và INV song song, mỗi nơi một lời gọi theo lô. PRD lỗi thì 503 `service-unavailable`; INV lỗi thì `inv` = null (dòng `unknown`). */
  async price(raw: RawCart): Promise<{ lines: PricedLine[]; invOk: boolean }> {
    const ids = [...new Set(raw.items.map((i) => i.product_id))];
    const [products, inv] = await Promise.all([
      this.deps.products(ids).catch((e) => { throw e instanceof DependencyError ? new DomainError('service-unavailable') : e; }),
      this.deps.availability(ids).catch((e) => { if (e instanceof DependencyError) return null; throw e; }),
    ]);
    return { lines: priceLines(raw.items, products, inv), invOk: inv !== null };
  }

  /** Kiểm lại mã đã lưu (`count_attempt` = false, không tính lượt sai, không bị `too_many_attempts`): mã vẫn giữ trong giỏ khi không còn hợp lệ (BR7). */
  async couponView(code: string, userId: string, subtotal: bigint): Promise<CouponView> {
    if (subtotal <= 0n) return { code, applied: false, reason: 'no_discount' }; // chỉ còn dòng ngừng bán: không có gì để giảm (PRM đòi tạm tính >= 1)
    let r;
    try { r = await this.deps.evaluate({ code, user_id: userId, items_subtotal: num(subtotal), count_attempt: false }); } catch (e) {
      if (e instanceof DependencyError || e instanceof RangeError) return { code, applied: false, reason: 'service_unavailable' };
      throw e;
    }
    if (r.ok) return { code: r.code, applied: true, discount: r.discount_amount };
    switch (r.reason) {
      case 'min_order_not_met': return { code, applied: false, reason: r.reason, shortfall: r.shortfall };
      case 'per_user_limit_reached': return { code, applied: false, reason: r.reason, limit: r.limit, used: r.used };
      case 'coupon_not_found': case 'coupon_expired': case 'coupon_exhausted': case 'no_discount': case 'too_many_attempts': return { code, applied: false, reason: r.reason };
      case 'invalid_subtotal': return { code, applied: false, reason: 'no_discount' }; // tạm tính vượt miền của PRM (tối đa 1.000.000.000): không có mức giảm (xem report, Lệch spec)
      default: this.log.error('PRM trả lý do lạ khi kiểm lại mã', { code: 'coupon-reason-unknown', reason: r.reason }); return { code, applied: false, reason: 'service_unavailable' };
    }
  }

  /** Phí theo tạm tính hiện tại (CRT-REQ-20261006-103226537 BR6, BR7, BR9). Phương thức tắt: `fee` null kèm `method_unavailable`, không tự đổi sang phương thức khác. */
  async shippingView(methodId: string, city: string, subtotal: bigint): Promise<ShippingView> {
    if (subtotal > SUBTOTAL_MAX) return { method_id: methodId, city, fee: null, error: 'cart_limit_exceeded' }; // ngoài miền của SHP: không hỏi, không báo `service_unavailable` mãi dù SHP khỏe
    try {
      const q = await this.deps.quote({ method_id: methodId, city, subtotal: num(subtotal) });
      return { method_id: methodId, city, fee: q.fee, free_shipping: q.free_shipping };
    } catch (e) {
      if (e instanceof DomainError && e.code === 'method-unavailable') return { method_id: methodId, city, fee: null, error: 'method_unavailable' };
      if (e instanceof DependencyError || e instanceof RangeError) return { method_id: methodId, city, fee: null, error: 'service_unavailable' };
      throw e;
    }
  }

  /** Giỏ đầy đủ cho GET /cart và cho kết quả của mọi thao tác ghi. Chưa có giỏ hay giỏ trống: giỏ trống (`cart_id` null), không tạo gì (BR1). */
  async view(userId: string, db: Db = this.prisma): Promise<CartView> {
    const raw = await loadRaw(db, userId);
    if (!raw) return EMPTY_VIEW;
    const { lines } = await this.price(raw);
    const subtotal = subtotalOf(lines);
    const [coupon, shipping] = await Promise.all([
      raw.head.coupon_code ? this.couponView(raw.head.coupon_code, userId, subtotal) : null,
      raw.head.shipping_method_id && raw.head.shipping_city ? this.shippingView(raw.head.shipping_method_id, raw.head.shipping_city, subtotal) : null,
    ]);
    return assemble(raw.head.id, lines, coupon, shipping);
  }

  /** Huy hiệu giỏ (BR8): chỉ đọc CSDL của CRT, không gọi PRD, INV, PRM, SHP. */
  async summary(userId: string): Promise<{ line_count: number; item_count: number }> {
    const [r] = await this.prisma.$queryRaw<{ line_count: number; item_count: number }[]>`
      SELECT count(i.id)::int AS line_count, COALESCE(sum(i.quantity), 0)::int AS item_count
      FROM carts c JOIN cart_items i ON i.cart_id = c.id WHERE c.user_id = ${userId}::uuid AND c.status = 'active'`;
    return r;
  }
}
