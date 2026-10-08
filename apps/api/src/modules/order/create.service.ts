import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomInt } from 'node:crypto';
import { Clock, EventsService, type Tx } from '../platform';
import { CODE_ALPHABET, CODE_ATTEMPTS, CODE_LENGTH } from './config';
import { OrderBusinessError } from './errors';
import { UUID_RE, lockById, type PaymentMethod } from './row';
import { TransitionService } from './transition.service';

export interface OrderItemInput { product_id: string; name_snapshot: string; unit_price: number; quantity: number }
export interface ShippingAddress { receiver: string; phone: string; line1: string; ward: string; city: string }
export interface CreatePendingInput {
  user_id: string; items: OrderItemInput[]; items_total: number; discount: number; shipping_fee: number; grand_total: number;
  shipping_address: ShippingAddress; shipping_method_id: string; payment_method: PaymentMethod; payment_expires_at: Date | null;
}

const ADDRESS_KEYS = ['receiver', 'phone', 'line1', 'ward', 'city'] as const;
const SURROGATE = /\p{Cs}/u; // nửa cặp thay thế lẻ không mã hóa được UTF-8 (PostgreSQL từ chối): lỗi nghiệp vụ ở biên, không 500
const money = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;
const NUL = { test: (v: string): boolean => v.includes('\u0000') }; // PostgreSQL không lưu NUL trong text hay jsonb (lỗi 22021, 22P05): từ chối ở biên như nửa cặp thay thế lẻ
const text = (v: unknown, max: number): v is string => typeof v === 'string' && v.trim().length > 0 && [...v].length <= max && !SURROGATE.test(v) && !NUL.test(v);
const confirmedAt = (d: Date) => Prisma.sql`, confirmed_at = ${d}::timestamptz`;
const bad = (why: string): never => { throw new OrderBusinessError('invalid_input', why); };

/** Kiểm đầu vào của `createPending` (T16, T21, R-03): số tiền do CHK tính ở server, ORD kiểm lại công thức; CHECK của CSDL là lớp hai. Ném `OrderBusinessError('invalid_input')`. */
function validate(i: CreatePendingInput): void {
  if (!i || typeof i !== 'object') return bad('đầu vào rỗng');
  if (typeof i.user_id !== 'string' || !UUID_RE.test(i.user_id)) bad('user_id không phải uuid');
  if (typeof i.shipping_method_id !== 'string' || !UUID_RE.test(i.shipping_method_id)) bad('shipping_method_id không phải uuid');
  if (i.payment_method !== 'vnpay' && i.payment_method !== 'cod') bad('payment_method phải là vnpay hoặc cod');
  const a = i.shipping_address as unknown as Record<string, unknown> | null;
  if (!a || typeof a !== 'object' || Object.keys(a).sort().join() !== [...ADDRESS_KEYS].sort().join() || ADDRESS_KEYS.some((k) => !text(a[k], 500))) bad('shipping_address phải có đúng năm khóa receiver, phone, line1, ward, city');
  if (!Array.isArray(i.items) || i.items.length === 0) bad('đơn phải có ít nhất một dòng hàng');
  let sum = 0;
  for (const it of i.items) {
    if (!it || typeof it.product_id !== 'string' || !UUID_RE.test(it.product_id)) bad('product_id không phải uuid');
    if (!text(it.name_snapshot, 500)) bad('name_snapshot rỗng hoặc quá dài');
    if (!money(it.unit_price)) bad('unit_price phải là số nguyên không âm');
    if (!Number.isSafeInteger(it.quantity) || it.quantity < 1 || it.quantity > 2_147_483_647) bad('quantity phải là số nguyên dương');
    sum += it.unit_price * it.quantity;
  }
  for (const k of ['items_total', 'discount', 'shipping_fee', 'grand_total'] as const) if (!money(i[k])) bad(`${k} phải là số nguyên không âm`);
  if (i.grand_total <= 0) bad('grand_total phải lớn hơn 0 (R-03)');
  if (i.grand_total !== i.items_total - i.discount + i.shipping_fee) bad('grand_total không bằng items_total - discount + shipping_fee');
  if (i.items_total !== sum) bad('items_total không bằng tổng các dòng hàng');
  if (i.payment_method === 'vnpay') { if (!(i.payment_expires_at instanceof Date) || Number.isNaN(i.payment_expires_at.getTime()) || i.payment_expires_at.getUTCFullYear() > 9999) bad('đơn vnpay phải có payment_expires_at hợp lệ'); }
  else if (i.payment_expires_at != null) bad('đơn COD không có payment_expires_at');
}

/** Mã đơn: 12 ký tự ngẫu nhiên mật mã học (không tuần tự để khó đoán, T2). */
export const newCode = (): string => Array.from({ length: CODE_LENGTH }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join('');

/** Tạo đơn và xác nhận COD cho CHK (ORD-DB mục Giao dịch và khóa 8): chạy trong `tx` của CHK, ORD không mở giao dịch riêng và chỉ khóa dòng của đơn mình (ADR-012). */
@Injectable()
export class CreateService {
  constructor(private readonly events: EventsService, private readonly transitions: TransitionService, private readonly clock: Clock) {}

  async createPending(input: CreatePendingInput, tx: Tx): Promise<{ order_id: string; code: string }> {
    validate(input);
    if (input.payment_method === 'vnpay') {
      // hạn phải sau giờ CSDL (cùng giá trị CHK truyền cho INV.reserve; INV cũng so với giờ CSDL)
      const [{ ok }] = await tx.$queryRaw<{ ok: boolean }[]>`SELECT ${input.payment_expires_at}::timestamptz > clock_timestamp() AS ok`;
      if (!ok) bad('payment_expires_at phải sau thời điểm hiện tại');
    }
    const now = this.clock.now();
    let row: { id: string; code: string } | undefined;
    for (let attempt = 0; !row && attempt < CODE_ATTEMPTS; attempt++) {
      // ON CONFLICT DO NOTHING: trùng mã (cực hiếm) không làm hỏng giao dịch của CHK, sinh lại mã khác
      row = (await tx.$queryRaw<{ id: string; code: string }[]>`
        INSERT INTO orders (user_id, code, items_total, discount, shipping_fee, grand_total, shipping_address, shipping_method_id, payment_method, payment_expires_at, created_at, updated_at)
        VALUES (${input.user_id}::uuid, ${newCode()}, ${input.items_total}, ${input.discount}, ${input.shipping_fee}, ${input.grand_total}, ${JSON.stringify(input.shipping_address)}::jsonb,
                ${input.shipping_method_id}::uuid, ${input.payment_method}::order_payment_method, ${input.payment_expires_at}::timestamptz, ${now}::timestamptz, ${now}::timestamptz)
        ON CONFLICT (code) DO NOTHING RETURNING id, code`)[0];
    }
    if (!row) throw new Error('không sinh được mã đơn duy nhất'); // xác suất không đáng kể; lỗi hạ tầng, không phải lỗi đầu vào
    const lines = input.items;
    await tx.$executeRaw`
      INSERT INTO order_items (order_id, product_id, name_snapshot, unit_price, quantity, position)
      SELECT ${row.id}::uuid, p, n, u, q, ord::int
      FROM unnest(${lines.map((l) => l.product_id)}::uuid[], ${lines.map((l) => l.name_snapshot)}::text[], ${lines.map((l) => l.unit_price)}::bigint[], ${lines.map((l) => l.quantity)}::int[]) WITH ORDINALITY AS t(p, n, u, q, ord)`;
    await this.transitions.history(tx, row.id, null, 'pending', { id: input.user_id, role: 'customer' }, now);
    await this.events.publish(tx, {
      type: 'OrderCreated', aggregate_type: 'order', aggregate_id: row.id,
      payload: {
        order_id: row.id, order_code: row.code, user_id: input.user_id, grand_total: input.grand_total, payment_method: input.payment_method,
        payment_expires_at: input.payment_expires_at ? input.payment_expires_at.toISOString() : null,
        items: lines.map((l) => ({ product_id: l.product_id, name: l.name_snapshot, unit_price: l.unit_price, quantity: l.quantity })),
      },
    });
    return { order_id: row.id, code: row.code };
  }

  /** `pending -> confirmed` cho đơn COD trong giao dịch đặt hàng của CHK (K-03a, không qua event); không phải COD `pending` thì ném `not_confirmable`, không ghi gì. */
  async confirmCod(orderId: string, tx: Tx): Promise<{ order_id: string; status: 'confirmed' }> {
    const o = typeof orderId === 'string' && UUID_RE.test(orderId) ? await lockById(tx, orderId) : undefined;
    if (!o) throw new OrderBusinessError('order_not_found');
    if (o.payment_method !== 'cod' || o.status !== 'pending') throw new OrderBusinessError('not_confirmable');
    const now = this.clock.now();
    const moved = await this.transitions.move(tx, o, 'confirmed', {
      actor: { id: null, role: 'system' }, now, set: confirmedAt(now),
      event: { type: 'OrderConfirmed', payload: { order_id: o.id, order_code: o.code, user_id: o.user_id, confirmed_at: now.toISOString() } },
    });
    if (!moved) throw new OrderBusinessError('not_confirmable');
    return { order_id: o.id, status: 'confirmed' };
  }
}
