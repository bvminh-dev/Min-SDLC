import { z } from 'zod';
import { CODE_MAX, PAYMENT_METHODS } from './config';

// Mã lỗi trường (platform đọc `message` snake_case của zod làm mã): required, invalid_format, out_of_range, too_long, unknown_field.
const str = { required_error: 'required', invalid_type_error: 'invalid_format' };
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001F\u007F]/; // NUL làm PostgreSQL ném lỗi nên không được đi tới câu truy vấn
const len = (s: string): number => [...s].length; // ký tự Unicode, khớp char_length() của PostgreSQL

/**
 * Đối tượng đóng (SB-11, SB-23): khóa lạ (`unit_price`, `grand_total`, `items`, `user_id`, `cart_id`, `city`, `fee`, `card_number`...) bị từ chối với `unknown_field`, không có trường tiền hay dữ liệu thẻ nào ở request.
 * Khóa `__proto__` của JSON bị zod âm thầm bỏ khi sao chép khóa dư nên kiểm trên đầu vào thô TRƯỚC khi vào zod.
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

/**
 * Id nhận chuỗi bất kỳ tới 100 ký tự và KHÔNG kiểm uuid ở đây: id sai định dạng cùng nội dung với id không có (404 `checkout-session-not-found`, 404 `address-not-found`, 409 `shipping-method-unavailable`, SB-06),
 * service kiểm định dạng. Rỗng, quá dài hay không phải chuỗi là 400.
 */
const looseId = z.string(str).superRefine((v, ctx) => { if (v.length === 0) ctx.addIssue({ code: 'custom', message: 'required' }); else if (v.length > 100) ctx.addIssue({ code: 'custom', message: 'too_long' }); });
/** Chuỗi nhập của khách: cắt khoảng trắng hai đầu, 1..max ký tự, không ký tự điều khiển (kể cả NUL). */
const text = (max: number) => z.string(str).transform((s) => s.trim()).pipe(z.string().superRefine((v, ctx) => {
  const n = len(v);
  const c = n === 0 ? 'required' : n > max ? 'too_long' : CONTROL.test(v) ? 'invalid_format' : null;
  if (c) ctx.addIssue({ code: 'custom', message: c });
}));
/** Số nguyên an toàn (tiền VND và phiên bản giỏ): số thực, chuỗi, `NaN` đều là `invalid_format`. */
const int = (min: number) => z.number(str).int({ message: 'invalid_format' }).min(min, { message: 'out_of_range' }).max(Number.MAX_SAFE_INTEGER, { message: 'out_of_range' });

export const emptyBody = closedObject({});
export const idParams = z.object({ id: z.string() }).strict();
export const addressBody = closedObject({ address_id: looseId });
export const shippingBody = closedObject({ method_id: looseId });
export const paymentBody = closedObject({ payment_method: z.enum(PAYMENT_METHODS, { errorMap: () => ({ message: 'invalid_format' }) }) });
export const couponBody = closedObject({ code: text(CODE_MAX) });
/** Đặt hàng: chỉ hai số để SO SÁNH (BR2 của CHK-REQ ...105051825), không bao giờ làm số tiền của đơn; khóa chống gửi lại nằm ở header `Idempotency-Key`, không ở body. */
export const placeBody = closedObject({ expected_grand_total: int(0), cart_version: int(0) });

export type AddressBody = z.infer<typeof addressBody>;
export type ShippingBody = z.infer<typeof shippingBody>;
export type PaymentBody = z.infer<typeof paymentBody>;
export type CouponBody = z.infer<typeof couponBody>;
export type PlaceBody = z.infer<typeof placeBody>;
