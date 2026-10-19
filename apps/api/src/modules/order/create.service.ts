import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AuditService, Clock, EventsService, type Tx } from '../platform';
import { CODE_DAILY_MAX, CODE_TZ, HO_ITEMS_MAX, ITEM_NOTE_MAX, NOTE_MAX, WEBSITE_SOURCE_ID } from './config';
import { OrderBusinessError } from './errors';
import { UUID_RE, lockById, type Actor, type PaymentMethod } from './row';
import { TransitionService } from './transition.service';

export interface OrderItemInput { product_id: string; name_snapshot: string; unit_price: number; quantity: number }
/** Bản chụp địa chỉ lúc đặt: ĐÚNG sáu khóa; `district` (quận, huyện) là chuỗi hoặc `null` khi khách không có (USR cho phép rỗng, E-06). Đơn cũ trước 2026-10-13 chỉ có năm khóa, không có `district`. */
export interface ShippingAddress { receiver: string; phone: string; line1: string; ward: string; district: string | null; city: string }
/** Dòng hàng của đơn hộ (SAL chụp giá bán `unit_price` và giá vốn `cost_snapshot` từ PRD lúc bán; `note` là ghi chú dòng, văn bản thuần). */
export interface HoItemInput extends OrderItemInput { cost_snapshot?: number | null; note?: string | null }
/** Đầu vào của `createHo` (ORD-API mục Giao diện module, hàng SAL): tập khóa đóng, trừ `created_by_role`, `user_id`, `note` là tùy chọn. */
export interface CreateHoInput {
  created_by: string; created_by_role?: 'sale' | 'admin'; user_id?: string | null; customer_snapshot: { full_name: string; phone: string }; source_code: string;
  items: HoItemInput[]; items_total: number; discount: number; shipping_fee: number; grand_total: number; shipping_address: ShippingAddress; shipping_method_id: string;
  payment_method: 'cod' | 'cash' | 'bank_transfer'; note?: string | null;
}
export interface CreatePendingInput {
  user_id: string; items: OrderItemInput[]; items_total: number; discount: number; shipping_fee: number; grand_total: number;
  shipping_address: ShippingAddress; shipping_method_id: string; payment_method: 'vnpay' | 'cod'; payment_expires_at: Date | null;
}

const ADDRESS_KEYS = ['receiver', 'phone', 'line1', 'ward', 'district', 'city'] as const;
const SURROGATE = /\p{Cs}/u; // nửa cặp thay thế lẻ không mã hóa được UTF-8 (PostgreSQL từ chối): lỗi nghiệp vụ ở biên, không 500
const money = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;
const NUL = { test: (v: string): boolean => v.includes('\u0000') }; // PostgreSQL không lưu NUL trong text hay jsonb (lỗi 22021, 22P05): từ chối ở biên như nửa cặp thay thế lẻ
const text = (v: unknown, max: number): v is string => typeof v === 'string' && v.trim().length > 0 && [...v].length <= max && !SURROGATE.test(v) && !NUL.test(v);
const confirmedAt = (d: Date) => Prisma.sql`, confirmed_at = ${d}::timestamptz`;
const bad = (why: string): never => { throw new OrderBusinessError('invalid_input', why); };
// eslint-disable-next-line no-control-regex
const CONTROL_TEXT = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/; // ghi chú nhiều dòng: cho phép xuống dòng và tab, cấm NUL và ký tự điều khiển còn lại
const PHONE_RE = /^[0-9+ .\-()]{8,20}$/;

/** Kiểm đầu vào của `createPending` (T16, T21, R-03): số tiền do CHK tính ở server, ORD kiểm lại công thức; CHECK của CSDL là lớp hai. Ném `OrderBusinessError('invalid_input')`. */
const PENDING_KEYS = ['user_id', 'items', 'items_total', 'discount', 'shipping_fee', 'grand_total', 'shipping_address', 'shipping_method_id', 'payment_method', 'payment_expires_at'];
/** Tập khóa đóng: khóa thừa (`source_id`, `created_by`, `note`...) hay thiếu là `invalid_input` (hai đường tạo đơn tách bạch, ADR-026). */
const closedKeys = (o: object, required: readonly string[], optional: readonly string[] = []): void => {
  const keys = Object.keys(o);
  if (required.some((k) => !keys.includes(k)) || keys.some((k) => !required.includes(k) && !optional.includes(k))) bad('khóa thừa hoặc thiếu trong đầu vào');
};

function validate(i: CreatePendingInput): void {
  if (!i || typeof i !== 'object') return bad('đầu vào rỗng');
  closedKeys(i, PENDING_KEYS);
  if (typeof i.user_id !== 'string' || !UUID_RE.test(i.user_id)) bad('user_id không phải uuid');
  if (typeof i.shipping_method_id !== 'string' || !UUID_RE.test(i.shipping_method_id)) bad('shipping_method_id không phải uuid');
  if (i.payment_method !== 'vnpay' && i.payment_method !== 'cod') bad('payment_method phải là vnpay hoặc cod');
  const a = i.shipping_address as unknown as Record<string, unknown> | null;
  if (!a || typeof a !== 'object' || Object.keys(a).sort().join() !== [...ADDRESS_KEYS].sort().join() || ADDRESS_KEYS.some((k) => !(k === 'district' && a[k] === null) && !text(a[k], 500))) bad('shipping_address phải có đúng sáu khóa receiver, phone, line1, ward, district, city (district là chuỗi hoặc null)');
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

/**
 * Mã đơn mới `HDyymmdd-NNNNN` (ADR-024): MỘT câu UPSERT trên bộ đếm theo ngày giờ Asia/Ho_Chi_Minh trong giao dịch tạo đơn; dòng bộ đếm bị khóa tới cuối giao dịch nên hai đơn không bao giờ cùng số,
 * giao dịch hoàn tác thì bộ đếm hoàn tác theo. Ngày tính MỘT lần từ đồng hồ máy chủ `at` (không phải `now()` của giao dịch, giao dịch kéo qua nửa đêm không lệch); số thứ 100000 vi phạm CHECK nên là `order_code_exhausted`.
 */
export async function newCode(tx: Tx, at: Date): Promise<string> {
  try {
    const [r] = await tx.$queryRaw<{ code: string }[]>`
      INSERT INTO order_code_counters (day, last) VALUES ((${at}::timestamptz AT TIME ZONE ${CODE_TZ})::date, 1)
      ON CONFLICT (day) DO UPDATE SET last = order_code_counters.last + 1
      RETURNING 'HD' || to_char(day, 'YYMMDD') || '-' || lpad(last::text, 5, '0') AS code`;
    return r.code;
  } catch (e) {
    const x = e as { meta?: { code?: unknown; message?: unknown }; code?: unknown; message?: unknown };
    if (String(x.meta?.code ?? x.code) === '23514' && `${x.meta?.message ?? ''}${x.message ?? ''}`.includes('order_code_counters')) throw new OrderBusinessError('order_code_exhausted', `hết ${CODE_DAILY_MAX} số trong ngày`);
    throw e;
  }
}

/** Mọi lỗi CSDL do khóa ngoại (`user_id`, `created_by` không có trong `users`) là đầu vào sai, không phải 500. */
const isFkViolation = (e: unknown): boolean => { const x = e as { meta?: { code?: unknown }; code?: unknown }; return String(x?.meta?.code ?? x?.code) === '23503'; };

const trimNote = (v: unknown, max: number, what: string): string | null => {
  if (v == null) return null;
  if (typeof v !== 'string' || SURROGATE.test(v) || CONTROL_TEXT.test(v)) return bad(`${what} không hợp lệ`);
  const t = v.trim();
  if ([...t].length > max) bad(`${what} quá ${max} ký tự`);
  return t || null;
};

/** Kiểm đầu vào của `createHo` (ORD-REQ-20261015-092748715 BR1 đến BR8): cùng kiểm tiền như `createPending`; ghi chú đã cắt khoảng trắng, rỗng là null. Trả bản đã chuẩn hóa. */
function validateHo(i: CreateHoInput): { note: string | null; items: { product_id: string; name_snapshot: string; unit_price: number; cost_snapshot: number | null; quantity: number; note: string | null }[]; user_id: string | null } {
  if (!i || typeof i !== 'object') return bad('đầu vào rỗng');
  closedKeys(i, ['created_by', 'customer_snapshot', 'source_code', 'items', 'items_total', 'discount', 'shipping_fee', 'grand_total', 'shipping_address', 'shipping_method_id', 'payment_method'], ['created_by_role', 'user_id', 'note']);
  if (typeof i.created_by !== 'string' || !UUID_RE.test(i.created_by)) bad('created_by không phải uuid');
  if (i.created_by_role !== undefined && i.created_by_role !== 'sale' && i.created_by_role !== 'admin') bad('created_by_role phải là sale hoặc admin');
  if (i.user_id != null && (typeof i.user_id !== 'string' || !UUID_RE.test(i.user_id))) bad('user_id không phải uuid');
  const c = i.customer_snapshot as unknown as Record<string, unknown> | null;
  if (!c || typeof c !== 'object') return bad('customer_snapshot rỗng');
  closedKeys(c, ['full_name', 'phone']);
  if (!text(c.full_name, 100) || CONTROL_TEXT.test(c.full_name as string)) bad('full_name phải 1 đến 100 ký tự');
  if (typeof c.phone !== 'string' || !PHONE_RE.test(c.phone)) bad('phone phải 8 đến 20 ký tự (chữ số, +, khoảng trắng, ., -, ngoặc)');
  if (typeof i.source_code !== 'string') bad('source_code bắt buộc');
  if (i.payment_method !== 'cod' && i.payment_method !== 'cash' && i.payment_method !== 'bank_transfer') bad('payment_method phải là cod, cash hoặc bank_transfer');
  if (typeof i.shipping_method_id !== 'string' || !UUID_RE.test(i.shipping_method_id)) bad('shipping_method_id không phải uuid');
  const a = i.shipping_address as unknown as Record<string, unknown> | null;
  if (!a || typeof a !== 'object' || Object.keys(a).sort().join() !== [...ADDRESS_KEYS].sort().join() || ADDRESS_KEYS.some((k) => !(k === 'district' && a[k] === null) && !text(a[k], 500))) bad('shipping_address phải có đúng sáu khóa');
  if (!Array.isArray(i.items) || i.items.length === 0 || i.items.length > HO_ITEMS_MAX) bad(`đơn phải có 1 đến ${HO_ITEMS_MAX} dòng hàng`);
  let sum = 0;
  const items = i.items.map((it) => {
    if (!it || typeof it !== 'object') return bad('dòng hàng rỗng');
    closedKeys(it, ['product_id', 'name_snapshot', 'unit_price', 'quantity'], ['cost_snapshot', 'note']);
    if (typeof it.product_id !== 'string' || !UUID_RE.test(it.product_id)) bad('product_id không phải uuid');
    if (!text(it.name_snapshot, 500)) bad('name_snapshot rỗng hoặc quá dài');
    if (!money(it.unit_price)) bad('unit_price phải là số nguyên không âm');
    if (it.cost_snapshot != null && !money(it.cost_snapshot)) bad('cost_snapshot phải là số nguyên không âm hoặc null');
    if (!Number.isSafeInteger(it.quantity) || it.quantity < 1 || it.quantity > 2_147_483_647) bad('quantity phải là số nguyên dương');
    sum += it.unit_price * it.quantity;
    return { product_id: it.product_id, name_snapshot: it.name_snapshot, unit_price: it.unit_price, cost_snapshot: it.cost_snapshot ?? null, quantity: it.quantity, note: trimNote(it.note, ITEM_NOTE_MAX, 'ghi chú dòng hàng') };
  });
  for (const k of ['items_total', 'discount', 'shipping_fee', 'grand_total'] as const) if (!money(i[k])) bad(`${k} phải là số nguyên không âm`);
  if (i.grand_total <= 0) bad('grand_total phải lớn hơn 0 (R-03)');
  if (i.grand_total !== i.items_total - i.discount + i.shipping_fee) bad('grand_total không bằng items_total - discount + shipping_fee');
  if (i.items_total !== sum) bad('items_total không bằng tổng các dòng hàng');
  return { note: trimNote(i.note, NOTE_MAX, 'ghi chú đơn'), items, user_id: i.user_id ?? null };
}

/** Tạo đơn khách tự đặt (CHK) và đơn hộ (SAL), xác nhận COD (ORD-DB mục Giao dịch và khóa 8, 8b): chạy trong `tx` của bên gọi, ORD không mở giao dịch riêng và chỉ khóa dòng của đơn mình (ADR-012). */
@Injectable()
export class CreateService {
  constructor(private readonly events: EventsService, private readonly transitions: TransitionService, private readonly clock: Clock, private readonly audit: AuditService) {}

  /** Dòng đơn hàng và dòng hàng, lịch sử `pending`: dùng chung cho hai đường tạo đơn. `code` đã cấp từ bộ đếm (khóa dòng bộ đếm NGAY TRƯỚC khi ghi `orders`, thứ tự khóa của ADR-012). */
  private async insertOrder(tx: Tx, o: {
    userId: string | null; createdBy: string | null; sourceId: string; customer: { full_name: string; phone: string } | null; note: string | null; input: Pick<CreatePendingInput, 'items_total' | 'discount' | 'shipping_fee' | 'grand_total' | 'shipping_address' | 'shipping_method_id' | 'payment_expires_at'> & { payment_method: PaymentMethod };
    items: { product_id: string; name_snapshot: string; unit_price: number; cost_snapshot?: number | null; quantity: number; note?: string | null }[]; now: Date; actor: Actor;
  }): Promise<{ id: string; code: string }> {
    const code = await newCode(tx, o.now);
    const i = o.input;
    let row: { id: string };
    try {
      [row] = await tx.$queryRaw<{ id: string }[]>`
        INSERT INTO orders (user_id, code, items_total, discount, shipping_fee, grand_total, shipping_address, shipping_method_id, payment_method, payment_expires_at, created_at, updated_at, source_id, created_by, customer_snapshot, note)
        VALUES (${o.userId}::uuid, ${code}, ${i.items_total}, ${i.discount}, ${i.shipping_fee}, ${i.grand_total}, ${JSON.stringify(i.shipping_address)}::jsonb,
                ${i.shipping_method_id}::uuid, ${i.payment_method}::order_payment_method, ${i.payment_expires_at}::timestamptz, ${o.now}::timestamptz, ${o.now}::timestamptz,
                ${o.sourceId}::uuid, ${o.createdBy}::uuid, ${o.customer ? JSON.stringify(o.customer) : null}::jsonb, ${o.note})
        RETURNING id`;
    } catch (e) { if (isFkViolation(e)) return bad('user_id hoặc created_by không có trong users'); throw e; }
    await tx.$executeRaw`
      INSERT INTO order_items (order_id, product_id, name_snapshot, unit_price, quantity, position, note, cost_snapshot)
      SELECT ${row.id}::uuid, (t.e->>'product_id')::uuid, t.e->>'name_snapshot', (t.e->>'unit_price')::bigint, (t.e->>'quantity')::int, t.ord::int, t.e->>'note', (t.e->>'cost_snapshot')::bigint
      FROM jsonb_array_elements(${JSON.stringify(o.items)}::jsonb) WITH ORDINALITY AS t(e, ord)`;
    await this.transitions.history(tx, row.id, null, 'pending', o.actor, o.now);
    return { id: row.id, code };
  }

  async createPending(input: CreatePendingInput, tx: Tx): Promise<{ order_id: string; code: string }> {
    validate(input);
    if (input.payment_method === 'vnpay') {
      // hạn phải sau giờ CSDL (cùng giá trị CHK truyền cho INV.reserve; INV cũng so với giờ CSDL)
      const [{ ok }] = await tx.$queryRaw<{ ok: boolean }[]>`SELECT ${input.payment_expires_at}::timestamptz > clock_timestamp() AS ok`;
      if (!ok) bad('payment_expires_at phải sau thời điểm hiện tại');
    }
    const now = this.clock.now();
    const row = await this.insertOrder(tx, { userId: input.user_id, createdBy: null, sourceId: WEBSITE_SOURCE_ID, customer: null, note: null, input, items: input.items, now, actor: { id: input.user_id, role: 'customer' } });
    await this.events.publish(tx, {
      type: 'OrderCreated', aggregate_type: 'order', aggregate_id: row.id,
      payload: {
        order_id: row.id, order_code: row.code, user_id: input.user_id, grand_total: input.grand_total, payment_method: input.payment_method,
        payment_expires_at: input.payment_expires_at ? input.payment_expires_at.toISOString() : null, source: 'website', created_by: null,
        items: input.items.map((l) => ({ product_id: l.product_id, name: l.name_snapshot, unit_price: l.unit_price, quantity: l.quantity })),
      },
    });
    return { order_id: row.id, code: row.code };
  }

  /**
   * SAL: đơn hộ `pending` rồi `confirmed` trong CÙNG `tx` của SAL (ORD-REQ-20261015-092748715): kiểm đầu vào, tra nguồn dưới khóa chia sẻ (việc tắt nguồn của admin lấy `FOR UPDATE` nên xếp thứ tự),
   * cấp mã, ghi đơn, dòng hàng, hai dòng lịch sử, OrderCreated rồi OrderConfirmed, audit `order.created_ho`. Lỗi ném `OrderBusinessError`, không ghi gì (SAL hoàn tác `tx`); không gọi module khác (SB-31).
   */
  async createHo(input: CreateHoInput, tx: Tx): Promise<{ order_id: string; code: string }> {
    const v = validateHo(input);
    const [src] = await tx.$queryRaw<{ id: string; is_active: boolean }[]>`SELECT id, is_active FROM order_sources WHERE code = ${input.source_code} FOR SHARE`;
    if (!src || !src.is_active) throw new OrderBusinessError('source_unavailable', 'nguồn đơn không dùng được', src ? 'inactive' : 'not_found');
    const now = this.clock.now();
    const role = input.created_by_role;
    const row = await this.insertOrder(tx, {
      userId: v.user_id, createdBy: input.created_by, sourceId: src.id, customer: { full_name: input.customer_snapshot.full_name.trim(), phone: input.customer_snapshot.phone }, note: v.note,
      input: { ...input, payment_expires_at: null }, items: v.items, now, actor: { id: input.created_by, role: role ?? 'system' },
    });
    await this.events.publish(tx, {
      type: 'OrderCreated', aggregate_type: 'order', aggregate_id: row.id,
      payload: {
        order_id: row.id, order_code: row.code, user_id: v.user_id, grand_total: input.grand_total, payment_method: input.payment_method, payment_expires_at: null, source: input.source_code, created_by: input.created_by,
        items: v.items.map((l) => ({ product_id: l.product_id, name: l.name_snapshot, unit_price: l.unit_price, quantity: l.quantity })), // không ghi chú, không giá vốn (SB-42)
      },
    });
    const o = await lockById(tx, row.id);
    const moved = o && (await this.transitions.move(tx, o, 'confirmed', {
      actor: { id: null, role: 'system' }, now, set: confirmedAt(now),
      event: { type: 'OrderConfirmed', payload: { order_id: row.id, order_code: row.code, user_id: v.user_id, confirmed_at: now.toISOString() } },
    }));
    if (!moved) throw new Error('không chuyển được đơn hộ sang confirmed'); // không xảy ra: vừa tạo trong chính giao dịch này
    await this.audit.record(tx, { actor_id: input.created_by, actor_role: role ?? 'system', action: 'order.created_ho', target_type: 'order', target_id: row.id, after: { order_code: row.code, source: input.source_code, has_user_id: v.user_id !== null, items: v.items.length, grand_total: input.grand_total, payment_method: input.payment_method } });
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
