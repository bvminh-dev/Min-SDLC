import { z } from 'zod';
import { paginationQuery } from '../platform';
import {
  BASE_FEE_MAX, CITIES_MAX, CITY_MAX, CITY_QUERY_MAX, FAIL_REASONS, FREE_OVER_MAX, NAME_MAX, NAME_MIN, NOTE_MAX, ORDER_CODE_QUERY_MAX, SHIPMENT_STATUSES, SUBTOTAL_MAX, SURCHARGE_MAX,
  TRACKING_MAX, TRACKING_MIN, VERSION_MAX,
} from './config';
import { UUID_RE } from './db';
import { normalizeCity } from './fee';

// Mã lỗi trường (platform đọc `message` snake_case của zod làm mã): required, invalid_format, out_of_range, too_long, too_short, unknown_field.
const str = { required_error: 'required', invalid_type_error: 'invalid_format' };
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001F\u007F]/; // NUL làm PostgreSQL ném lỗi nên không được đi tới câu truy vấn
// eslint-disable-next-line no-control-regex
const CONTROL_TEXT = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/; // ghi chú nhập ở ô nhiều dòng: cho phép xuống dòng và tab
const len = (s: string): number => [...s].length; // ký tự Unicode, khớp char_length() của PostgreSQL
const int = (min: number, max: number) => z.number(str).int({ message: 'invalid_format' }).min(min, { message: 'out_of_range' }).max(max, { message: 'out_of_range' });
const enumOf = <T extends [string, ...string[]]>(values: T) => z.enum(values, { errorMap: () => ({ message: 'invalid_format' }) });

/**
 * Đối tượng đóng: khóa lạ (`status`, `fee`, `is_active`, `delivered_at`, `user_id`...) bị từ chối với `unknown_field` (SB-11). Khóa `__proto__` của JSON bị zod âm thầm bỏ khi sao chép khóa dư
 * (chống ô nhiễm nguyên mẫu) nên không còn thấy ở bước kiểm của chính nó: kiểm trên đầu vào thô TRƯỚC khi vào zod.
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

/** Tên phương thức: cắt khoảng trắng hai đầu, 2..80 ký tự, không ký tự điều khiển. */
const name = z.string(str).transform((s) => s.trim()).pipe(z.string().superRefine((v, ctx) => {
  const n = len(v);
  const c = n === 0 ? 'required' : n < NAME_MIN ? 'too_short' : n > NAME_MAX ? 'too_long' : CONTROL.test(v) ? 'invalid_format' : null;
  if (c) ctx.addIssue({ code: 'custom', message: c });
}));
const city = z.string(str).transform((s) => s.trim()).pipe(z.string().superRefine((v, ctx) => {
  const n = len(v);
  const c = n === 0 || !normalizeCity(v) ? 'required' : n > CITY_MAX ? 'too_long' : CONTROL.test(v) ? 'invalid_format' : null;
  if (c) ctx.addIssue({ code: 'custom', message: c });
}));
export const baseFee = int(0, BASE_FEE_MAX);
/** `rule` (E-15): các khóa vắng nhận mặc định (không miễn phí, không phụ thu); đối tượng đóng; phụ thu > 0 bắt buộc có thành phố. */
export const ruleSchema = closedObject({
  free_over: int(0, FREE_OVER_MAX).nullable().optional(),
  surcharge: int(0, SURCHARGE_MAX).optional(),
  surcharge_cities: z.array(city, { invalid_type_error: 'invalid_format' }).max(CITIES_MAX, { message: 'too_long' }).optional(),
}).superRefine((r, ctx) => {
  if ((r.surcharge ?? 0) > 0 && !(r.surcharge_cities?.length)) ctx.addIssue({ code: 'custom', path: ['surcharge_cities'], message: 'required' });
}).transform((r) => ({ free_over: r.free_over ?? null, surcharge: r.surcharge ?? 0, surcharge_cities: r.surcharge_cities ?? [] }));
export type Rule = z.infer<typeof ruleSchema>;

const version = int(1, VERSION_MAX);
export const createMethodBody = closedObject({ name, base_fee: baseFee, rule: ruleSchema.optional() }).transform((b) => ({ name: b.name, base_fee: b.base_fee, rule: b.rule ?? ruleSchema.parse({}) }));
export const patchMethodBody = closedObject({ name: name.optional(), base_fee: baseFee.optional(), rule: ruleSchema.optional(), version }).superRefine((b, ctx) => {
  if (b.name === undefined && b.base_fee === undefined && b.rule === undefined) ctx.addIssue({ code: 'custom', path: ['name'], message: 'required' }); // sửa rỗng: không đổi gì mà vẫn tăng version và ghi audit
});
export const stateBody = closedObject({ version });
export const idParams = z.object({ id: z.string() }).strict();
export const adminListQuery = paginationQuery;

export const methodIdOk = (v: unknown): v is string => typeof v === 'string' && UUID_RE.test(v);
export const quoteBody = closedObject({
  method_id: z.string(str).refine((v) => UUID_RE.test(v), { message: 'invalid_format' }),
  city: z.string(str).superRefine((v, ctx) => {
    const n = len(v);
    const c = n < 1 ? 'required' : n > CITY_QUERY_MAX ? 'too_long' : CONTROL.test(v) ? 'invalid_format' : null;
    if (c) ctx.addIssue({ code: 'custom', message: c });
  }),
  subtotal: int(0, SUBTOTAL_MAX),
});

// `{code}` sai định dạng không phải 400 mà là 404 giống hệt mã không tồn tại (SHP-API Quy ước chung): schema nhận chuỗi, ORD kiểm định dạng.
export const codeParams = z.object({ code: z.string() }).strict();

/** Mã vận đơn: bỏ khoảng trắng hai đầu, KIỂM khuôn ASCII `A-Z0-9-` 8..30 ký tự RỒI mới đổi sang chữ hoa (đổi trước thì `ſ`, `ß` thành chữ A-Z khác và lọt khuôn). */
export const normalizeTracking = (raw: string): string | null => {
  const s = raw.trim();
  return new RegExp(`^[A-Za-z0-9-]{${TRACKING_MIN},${TRACKING_MAX}}$`).test(s) ? s.toUpperCase() : null;
};
const tracking = z.string(str).superRefine((v, ctx) => { if (normalizeTracking(v) === null) ctx.addIssue({ code: 'custom', message: v.trim() === '' ? 'required' : 'invalid_format' }); }).transform((v) => normalizeTracking(v) as string);
export const shipBody = closedObject({ tracking_number: tracking });
export const trackingBody = closedObject({ tracking_number: tracking, version });
export const emptyBody = closedObject({});

/** Ghi chú giao thất bại: tùy chọn, tối đa 300 ký tự (đếm ký tự); rỗng hay chỉ khoảng trắng coi như không có; văn bản thường, không lọc nội dung (escape là việc của giao diện, SB-12). */
const note = z.string(str).transform((s) => s.trim()).pipe(z.string().superRefine((v, ctx) => {
  const c = CONTROL_TEXT.test(v) ? 'invalid_format' : len(v) > NOTE_MAX ? 'too_long' : null;
  if (c) ctx.addIssue({ code: 'custom', message: c });
})).transform((v) => v || undefined);
export const failBody = closedObject({ reason_code: enumOf([...FAIL_REASONS] as [string, ...string[]]) as unknown as z.ZodType<(typeof FAIL_REASONS)[number]>, note: note.optional() });

const orderCode = z.string(str).superRefine((v, ctx) => {
  const n = len(v);
  const c = n < 1 ? 'required' : n > ORDER_CODE_QUERY_MAX ? 'too_long' : CONTROL.test(v) ? 'invalid_format' : null;
  if (c) ctx.addIssue({ code: 'custom', message: c });
});
export const listQuery = paginationQuery.extend({
  status: enumOf([...SHIPMENT_STATUSES] as [string, ...string[]]).optional() as unknown as z.ZodOptional<z.ZodType<(typeof SHIPMENT_STATUSES)[number]>>,
  order_code: orderCode.optional(),
  tracking_number: tracking.optional(),
  sort: enumOf(['newest', 'oldest']).optional().transform((v) => (v ?? 'newest') as 'newest' | 'oldest'),
});

export type CreateMethodBody = z.infer<typeof createMethodBody>;
export type PatchMethodBody = z.infer<typeof patchMethodBody>;
export type StateBody = z.infer<typeof stateBody>;
export type QuoteBody = z.infer<typeof quoteBody>;
export type ShipBody = z.infer<typeof shipBody>;
export type TrackingBody = z.infer<typeof trackingBody>;
export type FailBody = z.infer<typeof failBody>;
export type ListQuery = z.infer<typeof listQuery>;
export type AdminListQuery = z.infer<typeof adminListQuery>;
