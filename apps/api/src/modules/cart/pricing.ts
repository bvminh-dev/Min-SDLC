import type { CartProduct } from '../catalog';
import { AVAILABLE_CAP, SUBTOTAL_MAX } from './config';
import type { ItemRow } from './db';

// Phần tính tiền thuần (không I/O): giá hiện hành từ PRD, tồn từ INV, tổng bằng BigInt (CRT-REQ-20261006-103226562 BR10: 50 dòng x 1.000.000.000 x 99 = 4.950.000.000.000 chỉ là số nguyên an toàn của JS, nhưng tính bằng bigint để
// không phụ thuộc vào đó). Mọi số ra khỏi module là số nguyên đồng VND, không có số thực, không có phép chia.

export type Availability =
  | { status: 'ok' } | { status: 'insufficient'; available: number } | { status: 'out_of_stock' } | { status: 'unavailable' } | { status: 'unknown' };

export interface PricedLine {
  item: ItemRow;
  product: CartProduct | undefined;
  /** Còn bán: PRD báo `sellable` và dòng chưa bị đánh dấu `product_archived` (CRT-REQ-20261006-103226614 BR2). */
  sellable: boolean;
  /** Giá hiện hành (PRD); sản phẩm không có ở PRD thì giá đã lưu (dòng đó không tính vào tạm tính). */
  price: bigint;
  availability: Availability;
}

export const num = (b: bigint): number => {
  const n = Number(b);
  if (!Number.isSafeInteger(n)) throw new RangeError('số tiền vượt miền số nguyên an toàn');
  return n;
};

/** Trạng thái tồn của một dòng (CRT-REQ-20261006-103226588 BR5, BR6): `available` chỉ có ở `insufficient` và luôn nhỏ hơn số lượng trong giỏ nên không vượt 99; dòng đủ hàng không có số. `inv` null là INV không trả lời. */
export function availabilityOf(sellable: boolean, quantity: number, productId: string, inv: Record<string, number> | null): Availability {
  if (!sellable) return { status: 'unavailable' };
  if (inv === null) return { status: 'unknown' };
  const a = Object.prototype.hasOwnProperty.call(inv, productId) ? inv[productId] : 0;
  if (quantity <= a) return { status: 'ok' };
  return a > 0 ? { status: 'insufficient', available: Math.min(a, AVAILABLE_CAP) } : { status: 'out_of_stock' };
}

export function priceLines(items: ItemRow[], products: Map<string, CartProduct>, inv: Record<string, number> | null): PricedLine[] {
  return items.map((item) => {
    const product = products.get(item.product_id);
    const sellable = !!product?.sellable && item.unavailable_reason === null;
    return { item, product, sellable, price: product ? BigInt(product.price) : item.unit_price, availability: availabilityOf(sellable, item.quantity, item.product_id, inv) };
  });
}

/** Tạm tính: tổng giá hiện hành x số lượng của các dòng CÒN BÁN, trước giảm giá, không gồm phí vận chuyển (CRT-REQ-20261006-103226486 BR2). */
export const subtotalOf = (lines: PricedLine[]): bigint => lines.reduce((s, l) => (l.sellable ? s + l.price * BigInt(l.item.quantity) : s), 0n);

export type Blocker = 'insufficient_stock' | 'unavailable_item' | 'cart_limit_exceeded';
export function blockersOf(lines: PricedLine[]): Blocker[] {
  const out: Blocker[] = [];
  if (subtotalOf(lines) > SUBTOTAL_MAX) out.push('cart_limit_exceeded'); // giá tăng sau khi thêm làm giỏ vượt trần: không đặt được tới khi khách bớt hàng
  if (lines.some((l) => l.availability.status === 'insufficient' || l.availability.status === 'out_of_stock')) out.push('insufficient_stock');
  if (lines.some((l) => l.availability.status === 'unavailable')) out.push('unavailable_item');
  return out;
}

export interface LineView {
  id: string; product_id: string; name: string; sku: string; image_url: string | null; unit_price: number; previous_unit_price?: number; price_changed: boolean; quantity: number; line_total: number; availability: Availability;
}
/** Một dòng của phản hồi giỏ: `unit_price` là giá HIỆN HÀNH, `previous_unit_price` (giá lúc thêm) chỉ có khi dòng còn bán và giá đã đổi (BR5). */
export function lineView(l: PricedLine): LineView {
  const changed = l.sellable && l.price !== l.item.unit_price;
  return {
    id: l.item.id, product_id: l.item.product_id, name: l.product?.name ?? '', sku: l.product?.sku ?? '', image_url: l.product?.image_url ?? null,
    unit_price: num(l.price), ...(changed ? { previous_unit_price: num(l.item.unit_price) } : {}), price_changed: changed,
    quantity: l.item.quantity, line_total: num(l.price * BigInt(l.item.quantity)), availability: l.availability,
  };
}

export type CouponView =
  | { code: string; applied: true; discount: number }
  | { code: string; applied: false; reason: string; shortfall?: number; limit?: number; used?: number };
export type ShippingView =
  | { method_id: string; city: string; fee: number; free_shipping: boolean }
  | { method_id: string; city: string; fee: null; error: 'method_unavailable' | 'service_unavailable' | 'cart_limit_exceeded' };

export interface CartView {
  cart_id: string | null; items: LineView[]; line_count: number; item_count: number; price_changed: boolean; subtotal: number;
  coupon: CouponView | null; shipping: ShippingView | null; discount: number; shipping_fee: number | null; total: number; total_is_estimate: boolean;
  checkout_blockers: Blocker[]; can_checkout: boolean;
}
export const EMPTY_VIEW: CartView = {
  cart_id: null, items: [], line_count: 0, item_count: 0, price_changed: false, subtotal: 0, coupon: null, shipping: null, discount: 0, shipping_fee: null, total: 0, total_is_estimate: false, checkout_blockers: [], can_checkout: false,
};

/** Lắp phản hồi giỏ: `total` = tạm tính − giảm giá + phí (BR1); chưa có phí thì phí null, tính với 0 và `total_is_estimate` (BR2); giảm giá không vượt tạm tính nên tổng không âm. */
export function assemble(cartId: string, lines: PricedLine[], coupon: CouponView | null, shipping: ShippingView | null): CartView {
  const subtotal = subtotalOf(lines);
  const views = lines.map(lineView);
  const blockers = blockersOf(lines);
  let discount = coupon?.applied ? BigInt(coupon.discount) : 0n;
  if (discount > subtotal) discount = subtotal; // PRM bảo đảm không vượt; chặn thêm để tổng không bao giờ âm (đóng khi không chắc)
  const fee = shipping && shipping.fee !== null ? BigInt(shipping.fee) : null;
  return {
    cart_id: cartId, items: views, line_count: views.length, item_count: views.reduce((s, v) => s + v.quantity, 0), price_changed: views.some((v) => v.price_changed), subtotal: num(subtotal),
    coupon, shipping, discount: num(discount), shipping_fee: fee === null ? null : num(fee), total: num(subtotal - discount + (fee ?? 0n)), total_is_estimate: fee === null,
    checkout_blockers: blockers, can_checkout: views.length > 0 && blockers.length === 0,
  };
}
