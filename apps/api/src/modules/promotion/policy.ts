import { z } from 'zod';
import { paginationQuery } from '../platform';
import { MAX_LIMIT, MAX_MONEY } from './config';

// Mã lỗi trường (platform đọc `message` snake_case của zod làm mã): required, invalid_format, out_of_range, too_long, too_short, unknown_field.
const str = { required_error: 'required', invalid_type_error: 'invalid_format' };
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001F\u007F]/;
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;
const int = (min: number, max: number) => z.number(str).int({ message: 'invalid_format' }).min(min, { message: 'out_of_range' }).max(max, { message: 'out_of_range' });
const enumOf = <T extends [string, ...string[]]>(values: T) => z.enum(values, { errorMap: () => ({ message: 'invalid_format' }) });

/** Đối tượng đóng: khóa lạ (`status`, `consumed_count`, `reserved_count`, `id`...) bị từ chối với `unknown_field` (SB-11, PRM-REQ ...201 BR10). */
function closedObject<T extends z.ZodRawShape>(shape: T) {
  const known = new Set(Object.keys(shape));
  return z.object(shape).passthrough().superRefine((o, ctx) => {
    for (const k of Object.keys(o)) if (!known.has(k)) ctx.addIssue({ code: 'custom', path: [k], message: 'unknown_field' });
  });
}

/** Mã coupon: cắt khoảng trắng hai đầu, KIỂM khuôn ASCII `A-Z0-9_-` 4 đến 20 ký tự RỒI mới đổi sang chữ hoa (đổi trước thì `ß`, `ı`, `ſ` hay ligature `ﬁ` thành chữ A-Z khác và lọt khuôn). */
export const normalizeCode = (raw: string): string | null => {
  const s = raw.trim();
  return /^[A-Za-z0-9_-]{4,20}$/.test(s) ? s.toUpperCase() : null;
};
const code = z.string(str).transform((s) => s.trim()).pipe(z.string().superRefine((v, ctx) => {
  const c = !v ? 'required' : v.length < 4 ? 'too_short' : v.length > 20 ? 'too_long' : !/^[A-Za-z0-9_-]+$/.test(v) ? 'invalid_format' : null;
  if (c) ctx.addIssue({ code: 'custom', message: c });
})).transform((v) => v.toUpperCase());

const ISO = /^(\d{4})-(\d{2})-(\d{2})T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/;
/** ISO 8601 có múi giờ; ngày không có thật (30/02) bị từ chối. */
const instant = z.string(str).transform((s, ctx) => {
  const m = ISO.exec(s), d = new Date(s);
  if (!(m && !Number.isNaN(d.getTime()) && new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])).getUTCDate() === +m[3])) { ctx.addIssue({ code: 'custom', message: 'invalid_format' }); return z.NEVER; }
  return d;
});

const money = int(1, MAX_MONEY);
/** `value` theo loại: percentage 1..100, fixed 1..1.000.000.000 (PRM-REQ ...201 BR4). */
const valueByType = (type: string, value: number, ctx: z.RefinementCtx): void => {
  if (type === 'percentage' && value > 100) ctx.addIssue({ code: 'custom', path: ['value'], message: 'out_of_range' });
};

export const createBody = closedObject({
  code, type: enumOf(['percentage', 'fixed']), value: money,
  min_order_value: int(0, MAX_MONEY).optional(), max_discount: int(1, MAX_MONEY).nullable().optional(),
  expires_at: instant, usage_limit: int(1, MAX_LIMIT), per_user_limit: int(1, MAX_LIMIT).nullable().optional(),
}).superRefine((o, ctx) => {
  valueByType(o.type, o.value, ctx);
  if (o.type === 'fixed' && o.max_discount != null) ctx.addIssue({ code: 'custom', path: ['max_discount'], message: 'invalid_format' }); // chỉ cho percentage (BR6)
});

export const patchBody = closedObject({
  version: int(1, 2_147_483_647),
  code: z.string(str).optional(), type: enumOf(['percentage', 'fixed']).optional(), // chỉ nhận khi trùng giá trị hiện tại (field_immutable ở service)
  value: money.optional(), min_order_value: int(0, MAX_MONEY).optional(), max_discount: int(1, MAX_MONEY).nullable().optional(),
  expires_at: instant.optional(), usage_limit: int(1, MAX_LIMIT).optional(), per_user_limit: int(1, MAX_LIMIT).nullable().optional(),
});

export const idParams = z.object({ id: z.string() }).strict(); // id sai định dạng là 404 giống id không có (service kiểm uuid), không phải 400
export const noQuery = z.object({}).strict();

/** `q`: tiền tố mã 1..20 ký tự, rỗng coi như không lọc; ký tự điều khiển (NUL làm PostgreSQL từ chối) và nửa cặp thay thế lẻ là 400, không phải 500 (SB-11). */
const q = z.string(str).transform((s) => s.trim()).pipe(z.string().superRefine((v, ctx) => {
  const c = v.length > 20 ? 'too_long' : CONTROL.test(v) || LONE_SURROGATE.test(v) ? 'invalid_format' : null;
  if (c) ctx.addIssue({ code: 'custom', message: c });
})).transform((v) => v || undefined);
export const listQuery = paginationQuery.extend({ status: enumOf(['active', 'disabled', 'expired', 'exhausted']).optional(), q: q.optional() });

export type CreateBody = z.infer<typeof createBody>;
export type PatchBody = z.infer<typeof patchBody>;
export type ListQuery = z.infer<typeof listQuery>;
