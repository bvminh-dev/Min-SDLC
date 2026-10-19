import { z } from 'zod';
import { paginationQuery } from '../platform';

// Mã lỗi trường (platform đọc `message` snake_case của zod làm mã, zodItems): required, too_long, invalid_format, out_of_range, unknown_field, invalid_range, no_changes.
// Ký tự điều khiển U+0000..U+001F và U+007F bị từ chối (tên, sku), riêng mô tả cho xuống dòng và tab; chủ ý dùng ký tự điều khiển trong biểu thức.
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001F\u007F]/;
// eslint-disable-next-line no-control-regex
const CONTROL_NO_NEWLINE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;
const len = (s: string): number => [...s].length; // ký tự Unicode, khớp length() của PostgreSQL
const str = { required_error: 'required', invalid_type_error: 'invalid_format' };

/** Chuỗi văn bản thường (không HTML, SB-12: lưu nguyên, escape lúc hiển thị): cắt khoảng trắng hai đầu, 1..max ký tự, không ký tự điều khiển. */
const text = (max: number) => z.string(str).transform((s) => s.normalize('NFC').trim()).pipe(z.string().superRefine((v, ctx) => {
  const code = !v ? 'required' : CONTROL.test(v) ? 'invalid_format' : len(v) > max ? 'too_long' : null;
  if (code) ctx.addIssue({ code: 'custom', message: code });
}));

const sku = z.string(str).transform((s) => s.trim().toUpperCase()).pipe(z.string().superRefine((v, ctx) => {
  const code = !v ? 'required' : !/^[A-Z0-9_-]{3,40}$/.test(v) ? 'invalid_format' : null;
  if (code) ctx.addIssue({ code: 'custom', message: code });
}));

const description = z.string(str).superRefine((v, ctx) => {
  const code = CONTROL_NO_NEWLINE.test(v) ? 'invalid_format' : len(v) > 5000 ? 'too_long' : null;
  if (code) ctx.addIssue({ code: 'custom', message: code });
}).transform((v) => v.normalize('NFC'));

const uuid = z.string(str).uuid({ message: 'invalid_format' });
const price = z.number({ required_error: 'required', invalid_type_error: 'invalid_format' }).int({ message: 'invalid_format' }).min(1, { message: 'out_of_range' }).max(1_000_000_000, { message: 'out_of_range' });
// Giá vốn (SB-42): số nguyên 0..1.000.000.000, tùy chọn; PATCH nhận thêm `null` để xóa. Chỉ admin gọi hai endpoint ghi nên schema này không bao giờ chạy với role khác.
const costPrice = z.number({ invalid_type_error: 'invalid_format' }).int({ message: 'invalid_format' }).min(0, { message: 'out_of_range' }).max(1_000_000_000, { message: 'out_of_range' });

/** Đối tượng đóng: khóa lạ (kể cả `status`, `rating_count`, `images`, `slug`) bị từ chối với `unknown_field` (SB-05, SB-11). */
function closedObject<T extends z.ZodRawShape>(shape: T) {
  const known = new Set(Object.keys(shape));
  return z.object(shape).passthrough().superRefine((o, ctx) => {
    for (const k of Object.keys(o)) if (!known.has(k)) ctx.addIssue({ code: 'custom', path: [k], message: 'unknown_field' });
  });
}
/** Sửa một phần: ngoài các khóa bắt buộc (`version`) phải có ít nhất một trường để đổi. */
const needsChange = <T extends Record<string, unknown>>(o: T, ctx: z.RefinementCtx, ignore: string[] = []): void => {
  if (!Object.keys(o).some((k) => !ignore.includes(k) && o[k] !== undefined)) ctx.addIssue({ code: 'custom', path: ['body'], message: 'no_changes' });
};

export const categoryCreateBody = closedObject({ name: text(100), parent_id: z.union([uuid, z.null()]).optional() });
export const categoryPatchBody = closedObject({ name: text(100).optional(), parent_id: z.union([uuid, z.null()]).optional() }).superRefine((o, ctx) => needsChange(o, ctx));
export const productCreateBody = closedObject({ name: text(200), sku, category_id: uuid, price, cost_price: costPrice.optional(), description: description.optional() });
export const productPatchBody = closedObject({
  version: z.number({ required_error: 'required', invalid_type_error: 'invalid_format' }).int({ message: 'invalid_format' }).min(1, { message: 'out_of_range' }),
  name: text(200).optional(), sku: sku.optional(), category_id: uuid.optional(), price: price.optional(), cost_price: z.union([costPrice, z.null()]).optional(),
  description: z.union([description, z.null()]).optional(),
}).superRefine((o, ctx) => needsChange(o, ctx, ['version']));
export const imageOrderBody = closedObject({ image_ids: z.array(uuid, str).min(1, { message: 'required' }).max(8, { message: 'too_long' }) });

/** Import sản phẩm: `dry_run` bắt buộc, đúng `true` hoặc `false` (PRD-REQ-20261015-092431191 BR1); tham số lạ bị 400. */
export const importQuery = z.object({ dry_run: z.enum(['true', 'false'], { errorMap: () => ({ message: 'invalid_format' }) }).transform((v) => v === 'true') }).strict();
export type ImportQuery = z.infer<typeof importQuery>;

export const noParams = z.object({}).strict();
export const idParams = z.object({ id: z.string() }).strict();
export const imageParams = z.object({ id: z.string(), image_id: z.string() }).strict();

const intStr = () => z.string().regex(/^\d{1,15}$/, 'invalid_format').transform(Number).pipe(z.number().int().min(0, 'out_of_range'));
const q = z.string(str).transform((s) => s.trim()).pipe(z.string().superRefine((v, ctx) => {
  const code = !v ? 'required' : len(v) > 100 ? 'too_long' : null;
  if (code) ctx.addIssue({ code: 'custom', message: code });
}));
const rangeCheck = (o: { min_price?: number; max_price?: number }, ctx: z.RefinementCtx) => {
  if (o.min_price !== undefined && o.max_price !== undefined && o.min_price > o.max_price) ctx.addIssue({ code: 'custom', path: ['min_price'], message: 'invalid_range' });
};
const shared = { category_id: uuid.optional(), min_price: intStr().optional(), max_price: intStr().optional() };
const enumOf = <T extends [string, ...string[]]>(values: T) => z.enum(values, { errorMap: () => ({ message: 'invalid_format' }) });

/** Danh sách công khai: tham số lạ và giá trị sai bị 400; `sort` chỉ nhận danh sách trắng (không nối vào ORDER BY, SB-11). */
export const browseQuery = paginationQuery.extend({ ...shared, sort: enumOf(['newest', 'price_asc', 'price_desc']).default('newest') }).superRefine(rangeCheck);
export const searchQuery = paginationQuery.extend({ ...shared, q, sort: enumOf(['relevance', 'newest', 'price_asc', 'price_desc']).default('relevance') }).superRefine(rangeCheck);
export const adminListQuery = paginationQuery.extend({ status: enumOf(['draft', 'active', 'archived']).optional(), category_id: uuid.optional(), q: q.optional() });

export type CategoryCreate = z.infer<typeof categoryCreateBody>;
export type CategoryPatch = z.infer<typeof categoryPatchBody>;
export type ProductCreate = z.infer<typeof productCreateBody>;
export type ProductPatch = z.infer<typeof productPatchBody>;
export type BrowseQuery = z.infer<typeof browseQuery>;
export type SearchQuery = z.infer<typeof searchQuery>;
export type AdminListQuery = z.infer<typeof adminListQuery>;
