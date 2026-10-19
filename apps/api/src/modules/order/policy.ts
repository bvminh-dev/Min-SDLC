import { z } from 'zod';
import { paginationQuery } from '../platform';
import { ORDER_STATUSES, REASON_MAX, SEARCH_CODE_MAX, SOURCE_CODE_RE } from './config';

// Mã lỗi trường (platform đọc `message` snake_case của zod làm mã): required, invalid_format, too_long, unknown_field.
const str = { required_error: 'required', invalid_type_error: 'invalid_format' };
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001F\u007F]/; // mã tìm: không ký tự điều khiển nào (NUL làm PostgreSQL ném lỗi nên không được đi tới câu truy vấn)
// eslint-disable-next-line no-control-regex
const CONTROL_TEXT = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/; // lý do hủy nhập ở ô nhiều dòng: cho phép xuống dòng và tab, cấm ký tự điều khiển còn lại
const len = (s: string): number => [...s].length; // ký tự Unicode, khớp length() của PostgreSQL

const status = z.enum(ORDER_STATUSES, { errorMap: () => ({ message: 'invalid_format' }) });

/** Đối tượng đóng: khóa lạ (`user_id`, `role`, `email`) bị từ chối với `unknown_field` (SB-11, T1, T5). */
function closedObject<T extends z.ZodRawShape>(shape: T) {
  const known = new Set(Object.keys(shape));
  return z.object(shape).passthrough().superRefine((o, ctx) => {
    for (const k of Object.keys(o)) if (!known.has(k)) ctx.addIssue({ code: 'custom', path: [k], message: 'unknown_field' });
  });
}

/** `status` đúng MỘT trong tám giá trị chữ thường; hai lần hay rỗng là 400 (ORD-REQ ...716 BR4). Tham số lạ bị từ chối (strict của paginationQuery). */
export const listQuery = paginationQuery.extend({ status: status.optional() });
/** Ô tìm mã đơn: 1..32 ký tự SAU khi cắt khoảng trắng hai đầu (ORD-API), không ký tự điều khiển. */
const searchCode = z.string(str).transform((s) => s.trim()).pipe(z.string().superRefine((v, ctx) => {
  const n = len(v);
  if (n < 1) ctx.addIssue({ code: 'custom', message: 'required' });
  else if (n > SEARCH_CODE_MAX) ctx.addIssue({ code: 'custom', message: 'too_long' });
  else if (CONTROL.test(v)) ctx.addIssue({ code: 'custom', message: 'invalid_format' });
}));
const sourceCode = z.string(str).refine((v) => SOURCE_CODE_RE.test(v), { message: 'invalid_format' });
const uuid = z.string(str).refine((v) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v), { message: 'invalid_format' });
/** Danh sách quản trị (staff, sale, admin): thêm `source` (mã nguồn) và `created_by` (uuid; sale gửi thì service trả 400). Không có tham số theo email, tên, điện thoại (SB-08). */
export const adminListQuery = paginationQuery.extend({ status: status.optional(), code: searchCode.optional(), source: sourceCode.optional(), created_by: uuid.optional() });

/** `GET /order-sources`: `include_inactive` là `true` hoặc `false` (chỉ staff và admin dùng, service trả 400 cho sale). */
export const sourcesQuery = z.object({ include_inactive: z.enum(['true', 'false'], { errorMap: () => ({ message: 'invalid_format' }) }).optional() }).strict();
export const noQuery = z.object({}).strict();
export const idParams = z.object({ id: z.string() }).strict(); // id sai định dạng là 404 giống id không có (service kiểm uuid), không phải 400

const sourceName = z.string(str).transform((s) => s.trim()).pipe(z.string().superRefine((v, ctx) => {
  const n = len(v);
  const c = n < 1 ? 'required' : n > 60 ? 'too_long' : CONTROL.test(v) || /\p{Cs}/u.test(v) ? 'invalid_format' : null;
  if (c) ctx.addIssue({ code: 'custom', message: c });
}));
const position = z.number(str).int({ message: 'invalid_format' }).min(0, { message: 'out_of_range' }).max(999, { message: 'out_of_range' });
export const sourceCreateBody = closedObject({ code: sourceCode, name: sourceName, position: position.optional() });
/** `code` và `is_system` không đổi được: khóa lạ (kể cả hai khóa này) là `unknown_field`; thân phải có ít nhất một khóa. */
export const sourcePatchBody = closedObject({ name: sourceName.optional(), position: position.optional(), is_active: z.boolean({ required_error: 'required', invalid_type_error: 'invalid_format' }).optional() })
  .superRefine((o, ctx) => { if (o.name === undefined && o.position === undefined && o.is_active === undefined) ctx.addIssue({ code: 'custom', message: 'required' }); });

// `{code}` sai định dạng không phải 400 mà là 404 giống hệt mã không tồn tại (ORD-API Quy ước chung): schema nhận chuỗi, service kiểm định dạng.
export const codeParams = z.object({ code: z.string() }).strict();

/** `reason` tùy chọn, tối đa 500 ký tự (đếm ký tự, không đếm byte); rỗng hay chỉ khoảng trắng coi như không có; văn bản thường, không mã hóa hay lọc nội dung (SB-12 là việc của giao diện). */
const reason = z.string(str).transform((s) => s.trim()).pipe(z.string().superRefine((v, ctx) => {
  const code = CONTROL_TEXT.test(v) ? 'invalid_format' : len(v) > REASON_MAX ? 'too_long' : null;
  if (code) ctx.addIssue({ code: 'custom', message: code });
})).transform((v) => v || undefined);
export const cancelBody = closedObject({ reason: reason.optional() });

export type ListQuery = z.infer<typeof listQuery>;
export type AdminListQuery = z.infer<typeof adminListQuery>;
export type CancelBody = z.infer<typeof cancelBody>;
export type SourcesQuery = z.infer<typeof sourcesQuery>;
export type SourceCreateBody = z.infer<typeof sourceCreateBody>;
export type SourcePatchBody = z.infer<typeof sourcePatchBody>;
