import { z } from 'zod';
import { paginationQuery } from '../platform';
import { METHODS, NOTE_MAX, ORDER_CODE_QUERY_MAX, PAYMENT_STATUSES, REASON_MAX, REASON_MIN, REFUND_STATUSES } from './config';

// Mã lỗi trường (platform đọc `message` snake_case của zod làm mã): required, invalid_format, out_of_range, too_long, too_short, unknown_field.
const str = { required_error: 'required', invalid_type_error: 'invalid_format' };
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001F\u007F]/; // NUL làm PostgreSQL ném lỗi nên không được đi tới câu truy vấn
// eslint-disable-next-line no-control-regex
const CONTROL_TEXT = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/; // lý do và ghi chú nhập ở ô nhiều dòng: cho phép xuống dòng và tab
const len = (s: string): number => [...s].length; // ký tự Unicode, khớp char_length() của PostgreSQL
const enumOf = <T extends [string, ...string[]]>(values: T) => z.enum(values, { errorMap: () => ({ message: 'invalid_format' }) });

/**
 * Đối tượng đóng: khóa lạc (`amount`, `user_id`, `status`, `return_url`...) bị từ chối với `unknown_field` (SB-11, SB-23). Khóa `__proto__` của JSON bị zod âm thầm bỏ khi sao chép khóa dư
 * nên kiểm trên đầu vào thô TRƯỚC khi vào zod.
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

/** `{id}` sai định dạng không phải 400 mà là 404 giống hệt id không tồn tại (SB-06): schema nhận chuỗi, service kiểm định dạng. */
export const idParams = z.object({ id: z.string() }).strict();
export const emptyBody = closedObject({});

/** Số tiền thu COD: số nguyên dương, không ép kiểu (chuỗi, số thực, số âm bị từ chối, SB-11). */
const collected = z.number(str).int({ message: 'invalid_format' }).min(1, { message: 'out_of_range' }).max(Number.MAX_SAFE_INTEGER, { message: 'out_of_range' });
const textField = (min: number, max: number, control: RegExp) => z.string(str).transform((s) => s.trim()).pipe(z.string().superRefine((v, ctx) => {
  const n = len(v);
  const c = n === 0 ? 'required' : n < min ? 'too_short' : n > max ? 'too_long' : control.test(v) ? 'invalid_format' : null;
  if (c) ctx.addIssue({ code: 'custom', message: c });
}));
export const codBody = closedObject({ collected_amount: collected, note: textField(1, NOTE_MAX, CONTROL_TEXT).optional() });
export const refundBody = closedObject({ reason: textField(REASON_MIN, REASON_MAX, CONTROL_TEXT) });

const orderCode = z.string(str).superRefine((v, ctx) => {
  const n = len(v);
  const c = n < 1 ? 'required' : n > ORDER_CODE_QUERY_MAX ? 'too_long' : CONTROL.test(v) ? 'invalid_format' : null;
  if (c) ctx.addIssue({ code: 'custom', message: c });
});
export const myListQuery = paginationQuery.extend({
  status: enumOf([...PAYMENT_STATUSES] as [string, ...string[]]).optional() as unknown as z.ZodOptional<z.ZodType<(typeof PAYMENT_STATUSES)[number]>>,
  order_code: orderCode.optional(),
});
export const adminListQuery = myListQuery.extend({
  method: enumOf([...METHODS] as [string, ...string[]]).optional() as unknown as z.ZodOptional<z.ZodType<(typeof METHODS)[number]>>,
});
export const refundQueueQuery = paginationQuery.extend({
  status: enumOf([...REFUND_STATUSES] as [string, ...string[]]).optional() as unknown as z.ZodOptional<z.ZodType<(typeof REFUND_STATUSES)[number]>>,
});
/** IPN: mọi tham số `vnp_*` đi qua service (chữ ký sai, thiếu hay lạ phải ra RspCode, không phải 400 problem+json): schema nhận tất cả. */
export const ipnQuery = z.unknown();

export type CodBody = z.infer<typeof codBody>;
export type RefundBody = z.infer<typeof refundBody>;
export type MyListQuery = z.infer<typeof myListQuery>;
export type AdminListQuery = z.infer<typeof adminListQuery>;
export type RefundQueueQuery = z.infer<typeof refundQueueQuery>;
