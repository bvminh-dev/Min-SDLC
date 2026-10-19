import { z } from 'zod';
import { paginationQuery } from '../platform';
import { ITEMS_MAX, ITEM_NOTE_MAX, NOTE_MAX, ORDER_STATUSES, PAYMENT_METHODS, QTY_MAX } from './config';

// Mã lỗi trường (platform đọc `message` snake_case của zod làm mã): required, too_long, invalid_format, invalid_phone, out_of_range, duplicate_product, unknown_field.
const str = { required_error: 'required', invalid_type_error: 'invalid_format' };
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001F\u007F]/; // NUL làm PostgreSQL ném lỗi nên không được đi tới câu truy vấn
// eslint-disable-next-line no-control-regex
const CONTROL_NOTE = /[\u0000-\u0009\u000B-\u001F\u007F]/; // ghi chú nhiều dòng: chỉ cho xuống dòng `\n`
const SURROGATE = /\p{Cs}/u; // nửa cặp thay thế lẻ không mã hóa được UTF-8
const PHONE_RE = /^0[35789][0-9]{8}$/;
const len = (s: string): number => [...s].length; // ký tự Unicode (điểm mã), khớp char_length() của PostgreSQL
export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Số di động Việt Nam: bỏ khoảng trắng, dấu chấm, gạch ngang; `+84` hoặc `84` đầu số đổi thành `0` (USR-REQ-20261006-101003504 BR4; USR không phơi hàm này nên SAL tự có bản chuẩn hóa cùng luật). */
export function normalizePhone(raw: string): string {
  const s = raw.replace(/[\s.-]/g, '');
  return s.startsWith('+84') ? `0${s.slice(3)}` : s.startsWith('84') ? `0${s.slice(2)}` : s;
}

/**
 * Đối tượng đóng (SB-11, SB-23, SB-45): khóa lạ (`created_by`, `status`, `unit_price`, `grand_total`, `user_id` ở gốc...) bị từ chối với `unknown_field`.
 * Khóa `__proto__` của JSON bị zod âm thầm bỏ khi sao chép khóa dư nên kiểm trên đầu vào thô TRƯỚC khi vào zod.
 */
function closedObject<T extends z.ZodRawShape>(shape: T, pre?: (o: Record<string, unknown>, add: (field: string, code: string) => void) => void) {
  const known = new Set(Object.keys(shape));
  const inner = z.object(shape).passthrough().superRefine((o, ctx) => {
    for (const k of Object.keys(o)) if (!known.has(k)) ctx.addIssue({ code: 'custom', path: [k], message: 'unknown_field' });
  });
  return z.unknown().superRefine((v, ctx) => {
    if (v && typeof v === 'object' && Object.prototype.hasOwnProperty.call(v, '__proto__')) ctx.addIssue({ code: 'custom', path: ['__proto__'], message: 'unknown_field' });
    else if (v && typeof v === 'object' && !Array.isArray(v)) pre?.(v as Record<string, unknown>, (field, message) => ctx.addIssue({ code: 'custom', path: [field], message }));
  }).pipe(inner);
}

/** Chuỗi nhập: chuẩn hóa NFC, cắt khoảng trắng hai đầu, 1..max ký tự, không ký tự điều khiển, NUL hay nửa cặp thay thế lẻ. */
const text = (max: number) => z.string(str).transform((s) => s.normalize('NFC').trim()).pipe(z.string().superRefine((v, ctx) => {
  const n = len(v);
  const c = n === 0 ? 'required' : n > max ? 'too_long' : CONTROL.test(v) || SURROGATE.test(v) ? 'invalid_format' : null;
  if (c) ctx.addIssue({ code: 'custom', message: c });
}));
/** Chuỗi tùy chọn (quận, huyện): null hoặc rỗng thành null, còn lại như `text`. */
const optText = (max: number) => z.union([z.string(), z.null()], { errorMap: () => ({ message: 'invalid_format' }) }).optional().transform((v) => v?.normalize('NFC').trim() || null).pipe(z.string().nullable().superRefine((v, ctx) => {
  if (v === null) return;
  const c = len(v) > max ? 'too_long' : CONTROL.test(v) || SURROGATE.test(v) ? 'invalid_format' : null;
  if (c) ctx.addIssue({ code: 'custom', message: c });
}));
/** Ghi chú (đơn, dòng hàng): văn bản thuần; null hay rỗng thành null; cho `\n`, cấm ký tự điều khiển khác. */
const note = (max: number) => z.union([z.string(), z.null()], { errorMap: () => ({ message: 'invalid_format' }) }).optional().transform((v) => v?.normalize('NFC').trim() || null).pipe(z.string().nullable().superRefine((v, ctx) => {
  if (v === null) return;
  const c = len(v) > max ? 'too_long' : CONTROL_NOTE.test(v) || SURROGATE.test(v) ? 'invalid_format' : null;
  if (c) ctx.addIssue({ code: 'custom', message: c });
}));
export const MASKED_PHONE = /^\d{3}\*{4}\d{3}$/;
const phone = z.string(str).transform(normalizePhone).pipe(z.string().superRefine((v, ctx) => {
  if (!v) ctx.addIssue({ code: 'custom', message: 'required' });
  else if (!PHONE_RE.test(v) && !MASKED_PHONE.test(v)) ctx.addIssue({ code: 'custom', message: 'invalid_phone' }); // bản che chỉ qua được khi có `user_id` khớp: CreateService đổi về số thật
}));
/** Mã định danh nhận chuỗi bất kỳ tới 100 ký tự và KHÔNG kiểm uuid ở đây: id sai định dạng cùng nội dung với id không có (409 `product-unavailable`, `shipping-method-unavailable`, 422 `customer-not-found`, SB-06). */
const looseId = z.string(str).superRefine((v, ctx) => { if (v.length === 0) ctx.addIssue({ code: 'custom', message: 'required' }); else if (v.length > 100) ctx.addIssue({ code: 'custom', message: 'too_long' }); });
/** `source_code` nhận chuỗi bất kỳ tới 100 ký tự: mã sai định dạng, không có hay đã tắt cùng 409 `order-source-unavailable` (SAL-REQ-20261015-092711128 BR2, SB-45). */
const sourceCode = z.string(str).superRefine((v, ctx) => { if (v.length === 0) ctx.addIssue({ code: 'custom', message: 'required' }); else if (v.length > 100) ctx.addIssue({ code: 'custom', message: 'too_long' }); });

const customer = closedObject({ user_id: z.union([z.string(), z.null()], { errorMap: () => ({ message: 'invalid_format' }) }).optional(), full_name: text(100), phone });
const address = closedObject({ receiver: text(100), phone, line1: text(200), ward: text(100), district: optText(100), city: text(100) });
const item = closedObject({
  product_id: looseId, note: note(ITEM_NOTE_MAX),
  quantity: z.number(str).int({ message: 'invalid_format' }).min(1, { message: 'out_of_range' }).max(QTY_MAX, { message: 'out_of_range' }),
});

/**
 * Tạo đơn hộ (SAL-API POST /sales/orders): `created_by`, `user_id` của người tạo, `status`, mọi trường tiền ngoài `expected_grand_total` là trường lạ (400). Số dòng quá 50 bị từ chối ở đây,
 * TRƯỚC khi gọi PRD (SB-34). `expected_grand_total` chỉ để so sánh với tổng server tính (BR10), không bao giờ là số tiền của đơn.
 */
export const orderBody = closedObject({
  source_code: sourceCode, customer, shipping_address: address, shipping_method_id: looseId,
  payment_method: z.enum(PAYMENT_METHODS, { errorMap: (i, c) => ({ message: i.code === 'invalid_type' && c.data === undefined ? 'required' : 'invalid_format' }) }),
  note: note(NOTE_MAX),
  items: z.array(item, { required_error: 'required', invalid_type_error: 'invalid_format' }).min(1, { message: 'required' }).max(ITEMS_MAX, { message: 'too_long' }).superRefine((list, ctx) => {
    const seen = new Set<string>();
    list.forEach((it, i) => { const k = it.product_id.toLowerCase(); if (seen.has(k)) ctx.addIssue({ code: 'custom', path: [i, 'product_id'], message: 'duplicate_product' }); seen.add(k); });
  }),
  expected_grand_total: z.number(str).int({ message: 'invalid_format' }).min(1, { message: 'out_of_range' }).max(Number.MAX_SAFE_INTEGER, { message: 'out_of_range' }),
}, (o, add) => { if (Array.isArray(o.items) && o.items.length > ITEMS_MAX) add('items', 'too_long'); }); // quá 50 dòng bị từ chối TRƯỚC khi zod duyệt từng phần tử (thân hàng chục nghìn dòng không tốn CPU, SB-34)
export type OrderBody = z.infer<typeof orderBody>;

/** Tra khách: đúng MỘT trong `phone`, `email` (cả hai hay không có là 400); tham số lạ (`id`, `q`) bị từ chối. Điện thoại chuẩn hóa, email chữ thường. */
export const lookupQuery = z.object({ phone: z.string(str).optional(), email: z.string(str).optional() }).strict().superRefine((q, ctx) => {
  if ((q.phone === undefined) === (q.email === undefined)) ctx.addIssue({ code: 'custom', path: [q.phone === undefined ? 'phone' : 'email'], message: q.phone === undefined ? 'required' : 'unknown_field' });
}).transform((q, ctx) => {
  if (q.phone !== undefined) {
    const p = normalizePhone(q.phone);
    if (!PHONE_RE.test(p)) { ctx.addIssue({ code: 'custom', path: ['phone'], message: 'invalid_phone' }); return z.NEVER; }
    return { phone: p } as { phone?: string; email?: string };
  }
  const raw = q.email!.trim(); // ngoài ASCII bị từ chối TRƯỚC toLowerCase (Kelvin U+212A thành `k`, citext cũng gấp nó)
  const e = raw.toLowerCase();
  if (e.length > 254 || /[^\x20-\x7e]/.test(raw) || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) { ctx.addIssue({ code: 'custom', path: ['email'], message: 'invalid_format' }); return z.NEVER; }
  return { email: e } as { phone?: string; email?: string };
});
export type LookupQuery = z.infer<typeof lookupQuery>;
/** Gợi ý khách khi gõ dở: `q` 0..100 ký tự, không NUL (dưới 3 ký tự service trả rỗng). */
export const suggestQuery = z.object({ q: z.string(str).max(100).refine((v) => !v.includes('\0'), 'invalid_format') }).strict();

/** Báo phí: `city` 1..100 sau khi cắt, `items_subtotal` nguyên 1..10.000.000.000, cả hai bắt buộc, tham số lạ (`method_id`) là 400. Số lớn quá trần bị từ chối ở đây, không gọi SHP. */
export const shippingQuery = z.object({
  city: z.string(str).transform((s) => s.normalize('NFC').trim()).pipe(z.string().superRefine((v, ctx) => {
    const n = len(v);
    const c = n === 0 ? 'required' : n > 100 ? 'too_long' : CONTROL.test(v) || SURROGATE.test(v) ? 'invalid_format' : null;
    if (c) ctx.addIssue({ code: 'custom', message: c });
  })),
  items_subtotal: z.string(str).regex(/^\d{1,20}$/, 'invalid_format').transform(Number).pipe(z.number().int().min(1, 'out_of_range').max(10_000_000_000, 'out_of_range')),
}).strict();
export type ShippingQuery = z.infer<typeof shippingQuery>;

const status = z.enum(ORDER_STATUSES, { errorMap: () => ({ message: 'invalid_format' }) });
const uuid = z.string(str).refine((v) => UUID_RE.test(v), { message: 'invalid_format' });
/** Danh sách: `status`, `source` (mã nguồn, khớp chính xác), `code` (1..32 ký tự, chuẩn hóa chữ hoa ở ORD), `created_by` (uuid; sale gửi thì service trả 400). Tham số lạ là 400 (strict của paginationQuery). */
export const listQuery = paginationQuery.extend({
  status: status.optional(),
  source: z.string(str).regex(/^[a-z0-9_]{2,32}$/, 'invalid_format').optional(), // khuôn mã nguồn của ORD (`listForSale` ném RangeError với mã khác)
  code: z.string(str).transform((s) => s.trim()).pipe(z.string().superRefine((v, ctx) => {
    const n = len(v);
    if (n < 1) ctx.addIssue({ code: 'custom', message: 'required' });
    else if (n > 32) ctx.addIssue({ code: 'custom', message: 'too_long' });
    else if (CONTROL.test(v)) ctx.addIssue({ code: 'custom', message: 'invalid_format' });
  })).optional(),
  created_by: uuid.optional(),
});
export type ListQuery = z.infer<typeof listQuery>;
/** `{code}` sai định dạng không phải 400 mà là 404 giống hệt mã không tồn tại (SB-44): schema nhận chuỗi, ORD kiểm định dạng. */
export const codeParams = z.object({ code: z.string() }).strict();
export const noQuery = z.object({}).strict();
export const noBody = closedObject({});
