import { z } from 'zod';
import { paginationQuery } from '../platform';
import { AVAILABILITY_MAX_IDS, MAX_ON_HAND, MAX_QTY, MAX_THRESHOLD, MOVEMENT_MAX_SPAN_DAYS } from './config';

// Mã lỗi trường (platform đọc `message` snake_case của zod làm mã): required, invalid_format, out_of_range, too_long, too_short, unknown_field, invalid_range.
const str = { required_error: 'required', invalid_type_error: 'invalid_format' };
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001F\u007F]/;
const len = (s: string): number => [...s].length; // ký tự Unicode, khớp length() của PostgreSQL

const int = (min: number, max: number) => z.number(str).int({ message: 'invalid_format' }).min(min, { message: 'out_of_range' }).max(max, { message: 'out_of_range' });
const enumOf = <T extends [string, ...string[]]>(values: T) => z.enum(values, { errorMap: () => ({ message: 'invalid_format' }) });
const note = (min: number) => z.string(str).transform((s) => s.normalize('NFC').trim()).pipe(z.string().superRefine((v, ctx) => {
  const code = CONTROL.test(v) ? 'invalid_format' : len(v) > 200 ? 'too_long' : len(v) < min ? (min ? 'too_short' : null) : null;
  if (code) ctx.addIssue({ code: 'custom', message: code });
}));

/** Đối tượng đóng: khóa lạ (`on_hand`, `reserved`, `actor_id`, `version` ở nhập hay xuất) bị từ chối với `unknown_field` (SB-11, T12). */
function closedObject<T extends z.ZodRawShape>(shape: T) {
  const known = new Set(Object.keys(shape));
  return z.object(shape).passthrough().superRefine((o, ctx) => {
    for (const k of Object.keys(o)) if (!known.has(k)) ctx.addIssue({ code: 'custom', path: [k], message: 'unknown_field' });
  });
}
/** `note` bắt buộc khi lý do là `other` (INV-REQ ...463 BR2, ...487 BR2). */
const needsNote = (o: { reason: string; note?: string }, ctx: z.RefinementCtx): void => {
  if (o.reason === 'other' && !o.note) ctx.addIssue({ code: 'custom', path: ['note'], message: 'required' });
};

export const stockInBody = closedObject({ quantity: int(1, MAX_QTY), reason: enumOf(['purchase', 'transfer_in', 'other']), note: note(0).optional() }).superRefine(needsNote);
export const stockOutBody = closedObject({ quantity: int(1, MAX_QTY), reason: enumOf(['damaged', 'lost', 'internal_use', 'other']), note: note(0).optional() }).superRefine(needsNote);
export const adjustBody = closedObject({ new_on_hand: int(0, MAX_ON_HAND), version: int(1, 2_147_483_647), note: note(5) });
export const thresholdBody = closedObject({ low_stock_threshold: int(0, MAX_THRESHOLD), version: int(1, 2_147_483_647) });

export const noParams = z.object({}).strict();
// Id sai định dạng không phải 400 mà là 404 giống hệt id không tồn tại (INV-REQ ...435 BR5): schema nhận chuỗi, service kiểm uuid.
export const productParams = z.object({ product_id: z.string() }).strict();

const q = z.string(str).transform((s) => s.trim()).pipe(z.string().superRefine((v, ctx) => {
  const code = !v ? 'required' : len(v) > 100 ? 'too_long' : null;
  if (code) ctx.addIssue({ code: 'custom', message: code });
}));
export const listQuery = paginationQuery.extend({ q: q.optional(), archived: enumOf(['true', 'false']).optional(), sort: enumOf(['updated_at_desc', 'available_asc']).default('updated_at_desc') });
export const lowStockQuery = paginationQuery;

export const MOVEMENT_TYPES = ['in', 'out', 'adjust', 'sale', 'restock', 'return'] as const;
const ISO = /^(\d{4})-(\d{2})-(\d{2})(?:T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2}))?$/;
/** ISO-8601: ngày (UTC 00:00) hoặc giờ có múi giờ; ngày không có thật (30/02) bị từ chối. */
const instant = z.string(str).transform((s, ctx) => {
  const m = ISO.exec(s), d = new Date(s);
  const real = m && !Number.isNaN(d.getTime()) && new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])).getUTCDate() === +m[3];
  if (!real) { ctx.addIssue({ code: 'custom', message: 'invalid_format' }); return z.NEVER; }
  return d;
});
const types = z.string(str).transform((s) => s.split(',')).pipe(z.array(enumOf([...MOVEMENT_TYPES])).min(1).max(MOVEMENT_TYPES.length))
  .transform((a) => [...new Set(a)]);
export const movementsQuery = paginationQuery.extend({ type: types.optional(), from: instant.optional(), to: instant.optional() }).superRefine((o, ctx) => {
  if (o.from && o.to && o.from >= o.to) ctx.addIssue({ code: 'custom', path: ['from'], message: 'invalid_range' });
  else if (o.from && o.to && o.to.getTime() - o.from.getTime() > MOVEMENT_MAX_SPAN_DAYS * 86_400_000) ctx.addIssue({ code: 'custom', path: ['to'], message: 'out_of_range' });
});

/** 1 đến 100 uuid cách nhau bởi dấu phẩy; trùng thì gộp (giữ thứ tự xuất hiện đầu), phần tử sai định dạng hay rỗng là 400; tham số lạ cũng 400 (strict). */
export const availabilityQuery = z.object({
  product_ids: z.string(str).transform((s) => s.split(',')).pipe(z.array(z.string().uuid({ message: 'invalid_format' })).min(1, { message: 'required' }).max(AVAILABILITY_MAX_IDS, { message: 'too_long' }))
    .transform((a) => [...new Set(a.map((x) => x.toLowerCase()))]),
}).strict();

export type StockIn = z.infer<typeof stockInBody>;
export type StockOut = z.infer<typeof stockOutBody>;
export type Adjust = z.infer<typeof adjustBody>;
export type Threshold = z.infer<typeof thresholdBody>;
export type ListQuery = z.infer<typeof listQuery>;
export type LowStockQuery = z.infer<typeof lowStockQuery>;
export type MovementsQuery = z.infer<typeof movementsQuery>;
export type AvailabilityQuery = z.infer<typeof availabilityQuery>;
