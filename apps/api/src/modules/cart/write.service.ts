import { Injectable } from '@nestjs/common';
import { AppLogger, DomainError, PrismaService, TransactionService, type Tx } from '../platform';
import { AVAILABLE_CAP, MAX_LINES, MAX_QUANTITY, SUBTOTAL_MAX } from './config';
import { HEAD_COLS, UUID_RE, hashId, type CartHead, type ItemRow } from './db';
import { DependencyError, DepsService } from './deps.service';
import { num, priceLines, subtotalOf, type CartView } from './pricing';
import { ReadService, loadRaw } from './read.service';
import type { AddBody, CouponBody, ShippingBody } from './policy';

const unavailable = (e: unknown): unknown => (e instanceof DependencyError ? new DomainError('service-unavailable') : e);
const productGone = () => new DomainError('product-unavailable'); // 404 khi thêm: cùng nội dung cho draft, archived, không có, sai định dạng (SB-06)
const productGoneConflict = () => new DomainError('product-unavailable', { status: 409 }); // 409 khi TĂNG số lượng dòng đã ngừng bán (CRT-API PATCH): cùng `type`, status theo spec
const itemGone = () => new DomainError('cart-item-not-found'); // cùng nội dung cho dòng của người khác, không có, giỏ không còn active, sai định dạng
const cap = (n: number): number => Math.min(n, AVAILABLE_CAP);
const overCap = () => new DomainError('cart-limit-exceeded', { extra: { max_subtotal: SUBTOTAL_MAX } }); // 409: tạm tính vượt trần của SHP (SHP-REQ-20261006-101103806 BR1)

/**
 * Mọi thao tác SỬA giỏ của khách (CRT-DB mục Giao dịch và khóa, SB-38): gọi PRD, INV, PRM, SHP TRƯỚC khi mở giao dịch (không giữ khóa trong lúc chờ mô-đun khác; kết quả có thể cũ vài mili giây, chấp nhận vì
 * kiểm tồn là kiểm mềm và CHK kiểm lại), rồi MỘT giao dịch ngắn bắt đầu bằng `SELECT ... FOR UPDATE` dòng giỏ `active` của người dùng. Khóa này xếp hàng các thao tác trên cùng giỏ với nhau, với
 * `lockForCheckout`, handler CheckoutCompleted và job bỏ dở. Dòng luôn tìm qua giỏ của chính người dùng (SB-06). Thao tác không đổi gì không tăng `version` và không đổi `last_activity_at`.
 */
@Injectable()
export class WriteService {
  private readonly log: AppLogger;
  constructor(private readonly prisma: PrismaService, private readonly transactions: TransactionService, private readonly deps: DepsService, private readonly reads: ReadService, logger: AppLogger) {
    this.log = logger.for('cart');
  }

  private lockActive(tx: Tx, userId: string): Promise<CartHead | undefined> {
    return tx.$queryRaw<CartHead[]>`SELECT ${HEAD_COLS} FROM carts WHERE user_id = ${userId}::uuid AND status = 'active' FOR UPDATE`.then((r) => r[0]);
  }
  /** Khóa giỏ active, tạo nếu chưa có (`ON CONFLICT DO NOTHING` trên chỉ mục duy nhất một phần: hai yêu cầu thêm đầu tiên cùng lúc chỉ ra một giỏ, T9). Giỏ vừa bị job đánh dấu bỏ dở trong lúc chờ thì tạo giỏ mới. */
  private async lockOrCreate(tx: Tx, userId: string): Promise<{ head: CartHead; created: boolean }> {
    let created = false;
    for (let i = 0; i < 3; i++) {
      const c = await this.lockActive(tx, userId);
      if (c) return { head: c, created };
      created = (await tx.$executeRaw`INSERT INTO carts (user_id) VALUES (${userId}::uuid) ON CONFLICT (user_id) WHERE status = 'active' DO NOTHING`) > 0 || created;
    }
    throw new DomainError('internal-error');
  }
  private bump(tx: Tx, cartId: string): Promise<number> {
    return tx.$executeRaw`UPDATE carts SET version = version + 1, last_activity_at = now(), updated_at = now() WHERE id = ${cartId}::uuid`;
  }
  private async summaryOf(tx: Tx, cartId: string): Promise<{ line_count: number; item_count: number }> {
    const [r] = await tx.$queryRaw<{ line_count: number; item_count: number }[]>`SELECT count(*)::int AS line_count, COALESCE(sum(quantity), 0)::int AS item_count FROM cart_items WHERE cart_id = ${cartId}::uuid`;
    return r;
  }
  /** Dòng của giỏ active của người dùng (join `carts`, không bao giờ tìm chỉ theo `item_id`); không khóa. */
  private async findItem(userId: string, itemId: string): Promise<(ItemRow & { cart_id: string }) | undefined> {
    if (!UUID_RE.test(itemId)) return undefined;
    const [r] = await this.prisma.$queryRaw<(ItemRow & { cart_id: string })[]>`
      SELECT i.id, i.cart_id, i.product_id, i.quantity, i.unit_price, i.unavailable_reason FROM cart_items i JOIN carts c ON c.id = i.cart_id
      WHERE i.id = ${itemId.toLowerCase()}::uuid AND c.user_id = ${userId}::uuid AND c.status = 'active'`;
    return r;
  }
  /** Tạm tính hiện hành chỉ cần PRD (một lời gọi theo lô); PRD lỗi thì 503. */
  private async subtotalFor(items: ItemRow[]): Promise<bigint> {
    const products = await this.deps.products([...new Set(items.map((i) => i.product_id))]).catch((e) => { throw unavailable(e); });
    return subtotalOf(priceLines(items, products, {}));
  }

  /**
   * Tạm tính của giỏ sau khi dòng `productId` có `quantity` x `price` không được vượt `SUBTOTAL_MAX` (CRT-REQ-20261006-103226537 BR3, BR9). Các dòng còn lại tính theo giá HIỆN HÀNH của PRD (một lời gọi theo lô,
   * trước khi mở giao dịch như mọi lời gọi ngoài); dòng ngừng bán không tính. Kiểm mềm ngoài khóa: hai thao tác đồng thời có thể cùng qua, khi đó xem giỏ báo `cart_limit_exceeded` thay vì 503 (read.service).
   */
  private async assertUnderCap(userId: string, productId: string, quantity: number, price: bigint): Promise<void> {
    const others = ((await loadRaw(this.prisma, userId))?.items ?? []).filter((i) => i.product_id !== productId);
    const rest = others.length ? subtotalOf(priceLines(others, await this.deps.products([...new Set(others.map((i) => i.product_id))]).catch((e) => { throw unavailable(e); }), {})) : 0n;
    if (rest + price * BigInt(quantity) > SUBTOTAL_MAX) throw overCap();
  }

  /** Thêm sản phẩm (CRT-REQ-20261006-103226376): PRD, INV trước; gộp vào dòng cũ bằng phép cộng trong câu `INSERT ... ON CONFLICT DO UPDATE` có điều kiện không vượt 99 (không đọc rồi ghi, BR10). */
  async add(userId: string, b: AddBody): Promise<{ created: boolean; body: unknown }> {
    if (!UUID_RE.test(b.product_id)) throw productGone();
    const pid = b.product_id.toLowerCase();
    const p = (await this.deps.products([pid]).catch((e) => { throw unavailable(e); })).get(pid);
    if (!p?.sellable) throw productGone();
    const inv = await this.deps.availability([pid]).catch((e) => { throw unavailable(e); }); // INV lỗi: không đoán tồn (CRT-REQ-20261006-103226588 BR7)
    const available = Object.prototype.hasOwnProperty.call(inv, pid) ? inv[pid] : 0;
    const [cur] = await this.prisma.$queryRaw<{ quantity: number }[]>`
      SELECT i.quantity FROM cart_items i JOIN carts c ON c.id = i.cart_id WHERE c.user_id = ${userId}::uuid AND c.status = 'active' AND i.product_id = ${pid}::uuid`;
    const inCart = cur?.quantity ?? 0;
    if (inCart + b.quantity > MAX_QUANTITY) throw new DomainError('quantity-limit-exceeded', { extra: { max: MAX_QUANTITY, in_cart: inCart } }); // giới hạn dòng trước kiểm tồn: không lộ tồn khi vượt 99
    if (inCart + b.quantity > available) throw new DomainError('insufficient-stock', { extra: { available: cap(available), in_cart: inCart } });
    await this.assertUnderCap(userId, pid, inCart + b.quantity, BigInt(p.price));
    return this.transactions.run(async (tx) => {
      const { head: cart, created } = await this.lockOrCreate(tx, userId);
      const [has] = await tx.$queryRaw<{ n: number }[]>`SELECT count(*)::int AS n FROM cart_items WHERE cart_id = ${cart.id}::uuid AND product_id = ${pid}::uuid`;
      if (!has.n) {
        const [{ n }] = await tx.$queryRaw<{ n: number }[]>`SELECT count(*)::int AS n FROM cart_items WHERE cart_id = ${cart.id}::uuid`;
        if (n >= MAX_LINES) throw new DomainError('cart-line-limit-reached', { extra: { max: MAX_LINES } });
      }
      const [row] = await tx.$queryRaw<{ id: string; quantity: number; unit_price: bigint; inserted: boolean }[]>`
        INSERT INTO cart_items (cart_id, product_id, quantity, unit_price) VALUES (${cart.id}::uuid, ${pid}::uuid, ${b.quantity}, ${p.price})
        ON CONFLICT (cart_id, product_id) DO UPDATE SET quantity = cart_items.quantity + EXCLUDED.quantity, unit_price = EXCLUDED.unit_price, unavailable_reason = NULL, updated_at = now()
        WHERE cart_items.quantity + EXCLUDED.quantity <= ${MAX_QUANTITY}
        RETURNING id, quantity, unit_price, (xmax = 0) AS inserted`;
      if (!row) {
        const [now] = await tx.$queryRaw<{ quantity: number }[]>`SELECT quantity FROM cart_items WHERE cart_id = ${cart.id}::uuid AND product_id = ${pid}::uuid`;
        throw new DomainError('quantity-limit-exceeded', { extra: { max: MAX_QUANTITY, in_cart: now?.quantity ?? 0 } });
      }
      if (!created) await this.bump(tx, cart.id); // giỏ mới tạo ở giao dịch này có `version` 1 và `last_activity_at` = bây giờ (CRT-TC-20261006-104451036)
      return { created: row.inserted, body: { item: { id: row.id, product_id: pid, name: p.name, unit_price: p.price, quantity: row.quantity, line_total: num(BigInt(p.price) * BigInt(row.quantity)) }, summary: await this.summaryOf(tx, cart.id) } };
    });
  }

  /** Đổi số lượng tuyệt đối (CRT-REQ-20261006-103226406). Tăng: PRD (còn bán) và INV (đủ hàng) trước; giảm hoặc giữ nguyên luôn được (CRT-REQ-20261006-103226588 BR4). `line_total` theo giá HIỆN HÀNH, `unit_price` đã lưu không đổi (BR6). */
  async update(userId: string, itemId: string, quantity: number): Promise<unknown> {
    const it = await this.findItem(userId, itemId);
    if (!it) throw itemGone();
    const increase = quantity > it.quantity;
    if (increase && it.unavailable_reason !== null) throw productGoneConflict(); // dòng ngừng bán chỉ giảm được (BR4)
    const p = (await this.deps.products([it.product_id]).catch((e) => { throw unavailable(e); })).get(it.product_id);
    if (increase) {
      if (!p?.sellable) throw productGoneConflict();
      const inv = await this.deps.availability([it.product_id]).catch((e) => { throw unavailable(e); });
      const available = Object.prototype.hasOwnProperty.call(inv, it.product_id) ? inv[it.product_id] : 0;
      if (quantity > available) throw new DomainError('insufficient-stock', { extra: { available: cap(available), in_cart: it.quantity } });
    }
    const price = p ? BigInt(p.price) : it.unit_price; // giá HIỆN HÀNH từ PRD (BR7); không có ở PRD (không xảy ra do FK) thì giá đã lưu
    if (increase) await this.assertUnderCap(userId, it.product_id, quantity, price);
    return this.transactions.run(async (tx) => {
      const [c] = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM carts WHERE id = ${it.cart_id}::uuid AND user_id = ${userId}::uuid AND status = 'active' FOR UPDATE`;
      if (!c) throw itemGone(); // giỏ vừa bị job đánh dấu bỏ dở hay chuyển converted: không bao giờ ghi vào dòng của giỏ không còn active
      const upd = await tx.$executeRaw`UPDATE cart_items SET quantity = ${quantity}, updated_at = now() WHERE id = ${it.id}::uuid AND cart_id = ${c.id}::uuid AND quantity <> ${quantity}`;
      if (upd) await this.bump(tx, c.id);
      else if (!(await tx.$queryRaw<{ id: string }[]>`SELECT id FROM cart_items WHERE id = ${it.id}::uuid AND cart_id = ${c.id}::uuid`).length) throw itemGone(); // bị xóa giữa lúc đọc và khóa
      return { item: { id: it.id, product_id: it.product_id, name: p?.name ?? '', unit_price: num(price), quantity, line_total: num(price * BigInt(quantity)) }, summary: await this.summaryOf(tx, c.id) };
    });
  }

  /** Xóa một dòng (CRT-REQ-20261006-103226434): xóa thật; dòng cuối thì bỏ luôn mã và lựa chọn vận chuyển (BR4); xóa lần hai 404 (BR3). */
  async removeItem(userId: string, itemId: string): Promise<void> {
    if (!UUID_RE.test(itemId)) throw itemGone();
    await this.transactions.run(async (tx) => {
      const [c] = await tx.$queryRaw<{ id: string }[]>`
        SELECT c.id FROM carts c JOIN cart_items i ON i.cart_id = c.id WHERE i.id = ${itemId.toLowerCase()}::uuid AND c.user_id = ${userId}::uuid AND c.status = 'active' FOR UPDATE OF c`;
      if (!c) throw itemGone();
      const del = await tx.$executeRaw`DELETE FROM cart_items WHERE id = ${itemId.toLowerCase()}::uuid AND cart_id = ${c.id}::uuid`;
      if (!del) throw itemGone(); // hai tab cùng xóa: đúng một bên thấy dòng sau khi giành được khóa
      const [{ n }] = await tx.$queryRaw<{ n: number }[]>`SELECT count(*)::int AS n FROM cart_items WHERE cart_id = ${c.id}::uuid`;
      if (n === 0) await tx.$executeRaw`UPDATE carts SET coupon_code = NULL, shipping_method_id = NULL, shipping_city = NULL WHERE id = ${c.id}::uuid`;
      await this.bump(tx, c.id);
    });
  }

  /** Làm trống giỏ (CRT-REQ-20261006-103226460): MỘT giao dịch xóa mọi dòng và bỏ mã, vận chuyển (BR5). Idempotent: giỏ trống hay chưa có giỏ thì không đổi gì và không tạo giỏ (BR3). */
  async clear(userId: string): Promise<void> {
    await this.transactions.run(async (tx) => {
      const c = await this.lockActive(tx, userId);
      if (!c) return;
      const del = await tx.$executeRaw`DELETE FROM cart_items WHERE cart_id = ${c.id}::uuid`;
      if (!del && c.coupon_code === null && c.shipping_method_id === null) return;
      await tx.$executeRaw`UPDATE carts SET coupon_code = NULL, shipping_method_id = NULL, shipping_city = NULL WHERE id = ${c.id}::uuid`;
      await this.bump(tx, c.id);
    });
  }

  /**
   * Cập nhật giá (CRT-REQ-20261006-103226486 BR6): đặt giá đã lưu của mọi dòng CÒN BÁN bằng giá hiện hành, không đổi số lượng. Không phải thao tác sửa nội dung giỏ (BR4 liệt kê các thao tác ghi
   * `last_activity_at`) và không đổi tiền (tiền luôn theo giá hiện hành) nên không tăng `version` (xem report, Lệch spec). Giỏ trống: trả giỏ trống.
   */
  async refreshPrices(userId: string): Promise<CartView> {
    const raw = await loadRaw(this.prisma, userId);
    if (raw) {
      const { lines } = await this.reads.price(raw);
      const changed = lines.filter((l) => l.sellable && l.price !== l.item.unit_price);
      if (changed.length) {
        await this.transactions.run(async (tx) => {
          const [c] = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM carts WHERE id = ${raw.head.id}::uuid AND status = 'active' FOR UPDATE`;
          if (!c) return;
          for (const l of changed) {
            await tx.$executeRaw`UPDATE cart_items SET unit_price = ${num(l.price)}, updated_at = now() WHERE id = ${l.item.id}::uuid AND cart_id = ${c.id}::uuid AND unavailable_reason IS NULL AND unit_price <> ${num(l.price)}`;
          }
        });
      }
    }
    return this.reads.view(userId);
  }

  private couponError(r: { ok: false; reason: string; [k: string]: unknown }): DomainError {
    switch (r.reason) {
      case 'coupon_not_found': return new DomainError('coupon-not-found');
      case 'coupon_expired': return new DomainError('coupon-expired');
      case 'coupon_exhausted': return new DomainError('coupon-exhausted');
      case 'no_discount': case 'invalid_subtotal': return new DomainError('no-discount');
      case 'min_order_not_met': return new DomainError('min-order-not-met', { extra: { min_order_value: Number(r.min_order_value), shortfall: Number(r.shortfall) } });
      case 'per_user_limit_reached': return new DomainError('per-user-limit-reached', { extra: { limit: Number(r.limit), used: Number(r.used) } });
      case 'too_many_attempts': { const s = String(Math.max(1, Math.ceil(Number(r.retry_after_seconds) || 1))); return new DomainError('too-many-attempts', { headers: { 'Retry-After': s }, extra: { retry_after_seconds: Number(s) } }); }
      default: this.log.error('PRM trả lý do lạ khi áp mã', { code: 'coupon-reason-unknown', reason: String(r.reason) }); return new DomainError('internal-error'); // `invalid_argument` là lỗi lập trình của CRT
    }
  }

  /** Áp mã (CRT-REQ-20261006-103226511): giỏ trống thì 409 `cart-empty` và không gọi PRM; mã mới lỗi thì mã cũ giữ nguyên; thành công lưu mã đã chuẩn hóa của PRM. Không giữ lượt dùng (chỉ CHK `reserve`). */
  async applyCoupon(userId: string, b: CouponBody): Promise<CartView> {
    const raw = await loadRaw(this.prisma, userId);
    if (!raw) throw new DomainError('cart-empty');
    const subtotal = await this.subtotalFor(raw.items);
    if (subtotal <= 0n) throw new DomainError('no-discount'); // chỉ còn dòng ngừng bán: không có gì để giảm
    const r = await this.deps.evaluate({ code: b.code, user_id: userId, items_subtotal: num(subtotal), count_attempt: true }).catch((e) => { throw unavailable(e); });
    if (!r.ok) throw this.couponError(r);
    await this.transactions.run(async (tx) => {
      const c = await this.lockActive(tx, userId);
      const [{ n }] = c ? await tx.$queryRaw<{ n: number }[]>`SELECT count(*)::int AS n FROM cart_items WHERE cart_id = ${c.id}::uuid` : [{ n: 0 }];
      if (!c || n === 0) throw new DomainError('cart-empty'); // giỏ vừa bị làm trống hay đã bỏ dở trong lúc gọi PRM
      await tx.$executeRaw`UPDATE carts SET coupon_code = ${r.code} WHERE id = ${c.id}::uuid`;
      await this.bump(tx, c.id);
    });
    return this.reads.view(userId);
  }

  /** Gỡ mã: 204, idempotent (không có mã thì không đổi gì, không tăng `version`). */
  async removeCoupon(userId: string): Promise<void> {
    await this.transactions.run(async (tx) => {
      const c = await this.lockActive(tx, userId);
      if (!c || c.coupon_code === null) return;
      await tx.$executeRaw`UPDATE carts SET coupon_code = NULL WHERE id = ${c.id}::uuid`;
      await this.bump(tx, c.id);
    });
  }

  /** Chọn vận chuyển (CRT-REQ-20261006-103226537): giỏ trống 409 `cart-empty` không gọi SHP; phương thức tắt hay không có 409 `method-unavailable` và lựa chọn cũ giữ nguyên; SHP lỗi 503. `city` lưu đúng như khách gõ (đã cắt khoảng trắng). */
  async selectShipping(userId: string, b: ShippingBody): Promise<CartView> {
    const raw = await loadRaw(this.prisma, userId);
    if (!raw) throw new DomainError('cart-empty');
    const subtotal = await this.subtotalFor(raw.items);
    if (subtotal > SUBTOTAL_MAX) throw overCap(); // giá tăng sau khi thêm: SHP không nhận, khách phải bớt hàng
    const methodId = b.method_id.toLowerCase();
    try { await this.deps.quote({ method_id: methodId, city: b.city, subtotal: num(subtotal) }); } catch (e) {
      if (e instanceof DomainError) throw e; // `method-unavailable` của SHP: cùng nội dung cho phương thức tắt, không có, sai định dạng
      if (e instanceof DependencyError) throw new DomainError('service-unavailable');
      throw e;
    }
    await this.transactions.run(async (tx) => {
      const c = await this.lockActive(tx, userId);
      const [{ n }] = c ? await tx.$queryRaw<{ n: number }[]>`SELECT count(*)::int AS n FROM cart_items WHERE cart_id = ${c.id}::uuid` : [{ n: 0 }];
      if (!c || n === 0) throw new DomainError('cart-empty');
      await tx.$executeRaw`UPDATE carts SET shipping_method_id = ${methodId}::uuid, shipping_city = ${b.city} WHERE id = ${c.id}::uuid`;
      await this.bump(tx, c.id);
    });
    this.log.info('chọn vận chuyển ở giỏ', { user: hashId(userId) });
    return this.reads.view(userId);
  }
}
