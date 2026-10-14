import { z } from 'zod';
import { CITY_MAX, CODE_MAX, MAX_QUANTITY, PRODUCT_ID_MAX } from './config';
import { UUID_RE } from './db';

// Mã lỗi trường (platform đọc `message` snake_case của zod làm mã): required, invalid_format, out_of_range, too_long, unknown_field.
const str = { required_error: 'required', invalid_type_error: 'invalid_format' };
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001F\u007F]/; // NUL làm PostgreSQL ném lỗi nên không được đi tới câu truy vấn
const len = (s: string): number => [...s].length; // ký tự Unicode, khớp char_length() của PostgreSQL

/**
 * Đối tượng đóng (SB-11): khóa lạ (`unit_price`, `price`, `total`, `subtotal`, `discount`, `shipping_fee`, `fee`, `free_shipping`, `user_id`...) bị từ chối với `unknown_field`, không có trường tiền nào
 * ở request (SB-23). Khóa `__proto__` của JSON bị zod âm thầm bỏ khi sao chép khóa dư nên kiểm trên đầu vào thô TRƯỚC khi vào zod.
 */
function closedObject<T extends z.ZodRawShape>(shape: T) {
  const known = new Set(Object.keys(shape));
  const inner = z.object(shape).passthrough().superRefine((o, ctx) => {
    for (const k of Object.keys(o)) if (!known.has(k)) ctx.addIssue({ code: 'custom', path: [k], message: 'unknown_field' });
  });
  return z.unknown().superRefine((v, ctx) => {
    if (v && typeof v === 'object' && Object.prototype.hasOwnProperty.call(v, '__proto__')) ctx.addIssue({ code: 'custom', path: ['__proto__'], message: 'unknown_field' });
  }).pipe(inner);
}

const quantity = z.number(str).int({ message: 'invalid_format' }).min(1, { message: 'out_of_range' }).max(MAX_QUANTITY, { message: 'out_of_range' });
/** Chuỗi nhập của khách: cắt khoảng trắng hai đầu, 1..max ký tự, không ký tự điều khiển (kể cả NUL). */
const text = (max: number) => z.string(str).transform((s) => s.trim()).pipe(z.string().superRefine((v, ctx) => {
  const n = len(v);
  const c = n === 0 ? 'required' : n > max ? 'too_long' : CONTROL.test(v) ? 'invalid_format' : null;
  if (c) ctx.addIssue({ code: 'custom', message: c });
}));

/** `product_id`: chuỗi bất kỳ tới 100 ký tự. KHÔNG kiểm uuid ở đây: sai định dạng là 404 `product-unavailable` cùng nội dung với sản phẩm không có (CRT-REQ-20261006-103226376 BR3). */
const productId = z.string(str).superRefine((v, ctx) => { if (v.length === 0) ctx.addIssue({ code: 'custom', message: 'required' }); else if (v.length > PRODUCT_ID_MAX) ctx.addIssue({ code: 'custom', message: 'too_long' }); });

export const addBody = closedObject({ product_id: productId, quantity });
export const patchBody = closedObject({ quantity });
export const couponBody = closedObject({ code: text(CODE_MAX) });
export const shippingBody = closedObject({
  method_id: z.string(str).refine((v) => UUID_RE.test(v), { message: 'invalid_format' }), // sai định dạng là 400 (CRT-REQ-20261006-103226537 BR4)
  city: text(CITY_MAX),
});
export const emptyBody = closedObject({});
/** `{item_id}`: nhận chuỗi bất kỳ; id sai định dạng cùng 404 `cart-item-not-found` với id không có (SB-06). */
export const itemParams = z.object({ item_id: z.string() }).strict();

export type AddBody = z.infer<typeof addBody>;
export type PatchBody = z.infer<typeof patchBody>;
export type CouponBody = z.infer<typeof couponBody>;
export type ShippingBody = z.infer<typeof shippingBody>;
