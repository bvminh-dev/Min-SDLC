import { Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import type { Request } from 'express';
import { OrderBusinessError } from '../order';
import { AppLogger, Clock, DomainError, IdempotencyService, type SessionContext, type Tx } from '../platform';
import { IDEMPOTENCY_KEY_RE, ROUTE, SCOPE, TOTAL_MAX, type PaymentMethod } from './config';
import { DependencyError, DepsService } from './deps.service';
import type { OrderBody } from './policy';

export interface CreateOut {
  replayed: boolean; order: { code: string; status: 'confirmed'; grand_total: number; payment_method: PaymentMethod; source_code: string }; next: { url: string };
}
/** Một dòng đã định giá từ PRD: `cost` (giá vốn) chỉ đi sang `createHo`, không bao giờ vào phản hồi, log hay lỗi (SB-42). */
interface Line { product_id: string; name: string; price: number; cost: number | null; quantity: number; note: string | null }
interface Plan { lines: Line[]; userId: string | null; itemsTotal: number; shippingFee: number; grandTotal: number }

/** Idempotency-Key của tạo đơn (ADR-017, SB-40): 8 đến 64 ký tự [A-Za-z0-9_-]; thiếu hay sai định dạng là 400 `idempotency-key-required` (không phải `validation-failed`). */
export function keyOf(req: Request): string {
  const h = req.headers['idempotency-key'];
  const k = Array.isArray(h) ? h[0] : h;
  if (!k || !IDEMPOTENCY_KEY_RE.test(k)) throw new DomainError('idempotency-key-required');
  return k;
}
const canonical = (v: unknown): unknown =>
  Array.isArray(v) ? v.map(canonical)
    : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, canonical((v as Record<string, unknown>)[k])]))
      : v;
/** Băm yêu cầu (method, mẫu route, thân đã chuẩn hóa): cùng khóa khác nội dung thì 422 `idempotency-key-reused` (SAL-REQ-20261015-092710847 BR13). */
const hashOf = (body: unknown): string => createHash('sha256').update(`POST\n${ROUTE}\n${JSON.stringify(canonical(body ?? null))}`).digest('hex');

/**
 * Tạo đơn hộ (SAL-REQ-20261015-092710847, ...092711128, ...092711037; SAL-API mục Thứ tự gọi khi tạo đơn). Mọi số tiền, tên hàng, phí do server lấy từ PRD và SHP (SB-23); `expected_grand_total`
 * của client chỉ để so sánh. Thứ tự kiểm (SAL-REQ ...092711128 BR5), dừng ở lỗi đầu tiên: nguồn, khách có sẵn, sản phẩm không còn bán, tổng vượt trần, phương thức vận chuyển, `price-changed`
 * (giai đoạn đọc, NGOÀI giao dịch ghi: mọi lời gọi module khác không nhận `tx` chạy trước khi mở giao dịch nên không có hold-and-wait, SB-31), rồi MỘT giao dịch ghi (ADR-003, ADR-012):
 * `OrderApi.createHo` (đơn `confirmed`, mã `HDyymmdd-NNNNN`, audit `order.created_ho` do ORD ghi) rồi `InventoryApi.reserve` (giữ tất cả hoặc không gì) rồi khóa idempotency. Lỗi bất kỳ hoàn tác tất cả.
 * SAL không ghi audit, không tạo Payment, không phát event (ORD phát OrderCreated và OrderConfirmed).
 */
@Injectable()
export class CreateService {
  private readonly log: AppLogger;
  constructor(private readonly deps: DepsService, private readonly idem: IdempotencyService, private readonly clock: Clock, logger: AppLogger) { this.log = logger.for('sales'); }

  async create(s: SessionContext, key: string, body: OrderBody): Promise<{ status: number; body: CreateOut }> {
    // Giai đoạn đọc chạy TRƯỚC, kết quả (kế hoạch hoặc lỗi) vào bên trong lời gọi idempotency: phát lại phản hồi đã lưu đứng trước mọi kiểm khác nên không bị đổi kết quả
    // vì nguồn vừa tắt hay giá vừa đổi (SAL-API); lỗi của giai đoạn đọc được ném trong giao dịch của khóa nên khóa không được ghi (khóa chỉ ghi khi thành công, BR13).
    const prep: { plan: Plan } | { error: unknown } = await this.prepare(body).then((plan) => ({ plan }), (error: unknown) => ({ error }));
    try {
      const out = await this.idem.run<CreateOut>({ scope: SCOPE, userId: s.user_id, key, requestHash: hashOf(body) }, (tx) => {
        if ('error' in prep) throw prep.error;
        return this.write(tx, s, body, prep.plan);
      });
      return out.replayed ? { status: 200, body: { ...out.body, replayed: true } } : { status: out.status, body: out.body };
    } catch (e) {
      if (e instanceof DependencyError || (e instanceof DomainError && e.code === 'internal-error')) throw new DomainError('dependency-unavailable'); // module lỗi hay quá hạn, bế tắc hết lượt thử của nền: đã hoàn tác
      throw e;
    }
  }

  /** BR5 của SAL-REQ-20261015-092711128, bước (2) tới (7), chỉ đọc. */
  private async prepare(body: OrderBody): Promise<Plan> {
    const sources = await this.deps.sources();
    if (!sources.some((x) => x.code === body.source_code)) throw new DomainError('order-source-unavailable'); // không có, đã tắt, sai định dạng: một mã, một nội dung (SB-45)
    const claimed = body.customer.user_id ?? null;
    if (claimed !== null && !(await this.deps.isCustomer(claimed))) throw new DomainError('customer-not-found'); // staff, sale, admin, không có, sai định dạng: cùng 422 (SB-06)
    const found = new Map((await this.deps.products(body.items.map((i) => i.product_id))).map((p) => [p.product_id.toLowerCase(), p]));
    const bad = body.items.filter((i) => !found.get(i.product_id.toLowerCase())?.sellable);
    if (bad.length) throw new DomainError('product-unavailable', { status: 409, extra: { items: bad.map((i) => ({ product_id: i.product_id, reason: 'unavailable' })) } }); // mọi dòng lỗi, không phân biệt draft với không có
    const lines: Line[] = body.items.map((i) => {
      const p = found.get(i.product_id.toLowerCase())!;
      return { product_id: p.product_id, name: p.name, price: p.price, cost: p.cost_price, quantity: i.quantity, note: i.note };
    });
    const itemsTotal = lines.reduce((sum, l) => sum + l.price * l.quantity, 0);
    if (itemsTotal > TOTAL_MAX) throw new DomainError('order-total-out-of-range', { extra: { max: TOTAL_MAX } });
    let fee: number;
    try { fee = (await this.deps.quote({ method_id: body.shipping_method_id, city: body.shipping_address.city, subtotal: itemsTotal })).fee; } catch (e) {
      if (e instanceof DomainError && e.code === 'method-unavailable') throw new DomainError('shipping-method-unavailable'); // không có, đã tắt, sai định dạng: cùng một nội dung
      throw e;
    }
    const grandTotal = itemsTotal + fee;
    if (body.expected_grand_total !== grandTotal) {
      throw new DomainError('price-changed', { extra: { previous_grand_total: body.expected_grand_total, review: { items_subtotal: itemsTotal, shipping_fee: fee, grand_total: grandTotal, expected_grand_total: grandTotal } } });
    }
    return { lines, userId: claimed, itemsTotal, shippingFee: fee, grandTotal };
  }

  /** Bước (b): một giao dịch ghi. `createHo` trước `reserve` theo thứ tự khóa của ADR-012 (Order rồi StockItem theo `id` tăng dần). */
  private async write(tx: Tx, s: SessionContext, body: OrderBody, plan: Plan): Promise<{ status: number; body: CreateOut }> {
    let order: { order_id: string; code: string };
    try {
      order = await this.deps.createHo({
        created_by: s.user_id, created_by_role: s.role as 'sale' | 'admin', user_id: plan.userId, customer_snapshot: { full_name: body.customer.full_name, phone: body.customer.phone }, source_code: body.source_code,
        items: plan.lines.map((l) => ({ product_id: l.product_id, name_snapshot: l.name, unit_price: l.price, cost_snapshot: l.cost, quantity: l.quantity, note: l.note })),
        items_total: plan.itemsTotal, discount: 0, shipping_fee: plan.shippingFee, grand_total: plan.grandTotal, shipping_address: body.shipping_address, shipping_method_id: body.shipping_method_id,
        payment_method: body.payment_method, note: body.note,
      }, tx);
    } catch (e) {
      if (e instanceof OrderBusinessError && e.code === 'source_unavailable') throw new DomainError('order-source-unavailable'); // nguồn bị tắt giữa hai lần kiểm (ORD kiểm lại dưới khóa)
      if (e instanceof OrderBusinessError && e.code === 'order_code_exhausted') { // hết 99999 số trong ngày (ORD): lỗi tạm, bộ đếm mới từ 0 giờ Asia/Ho_Chi_Minh (UTC+7 quanh năm) nên Retry-After là số giây tới lúc đó
        const left = 86_400 - (Math.floor(this.clock.now().getTime() / 1000) + 7 * 3600) % 86_400;
        throw new DomainError('dependency-unavailable', { headers: { 'Retry-After': String(left) } });
      }
      throw e;
    }
    const held = await this.deps.reserve(order.order_id, plan.lines.map((l) => ({ product_id: l.product_id, quantity: l.quantity })), tx);
    if (!held.ok) {
      const name = new Map(plan.lines.map((l) => [l.product_id, l.name]));
      throw new DomainError('insufficient-stock', { extra: { items: held.shortages.map((x) => ({ product_id: x.product_id, name: name.get(x.product_id) ?? '', requested: x.requested, available: x.available, reason: x.reason })) } });
    }
    this.log.info('tạo đơn hộ thành công', { user_id: s.user_id, order_code: order.code, source: body.source_code });
    return {
      status: 201,
      body: { replayed: false, order: { code: order.code, status: 'confirmed', grand_total: plan.grandTotal, payment_method: body.payment_method, source_code: body.source_code }, next: { url: `/sales/orders/${order.code}` } },
    };
  }
}
