import { z } from 'zod';

// Mã lỗi trường theo USR-API: required, too_long, too_short, invalid_phone, unknown_field, invalid_format (platform đọc `message` snake_case của zod làm mã, zodItems).
// ký tự điều khiển U+0000 đến U+001F và U+007F bị từ chối (USR-REQ-...504 BR3); chủ ý dùng ký tự điều khiển trong biểu thức
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001F\u007F]/;
const PHONE_RE = /^0[35789][0-9]{8}$/;
const len = (s: string): number => [...s].length; // ký tự Unicode, khớp length() của PostgreSQL

/** Số di động Việt Nam: bỏ khoảng trắng, dấu chấm, dấu gạch ngang; +84 hoặc 84 đầu số đổi thành 0 (USR-REQ-...504 BR4). */
export function normalizePhone(raw: string): string {
  const s = raw.replace(/[\s.-]/g, '');
  return s.startsWith('+84') ? `0${s.slice(3)}` : s.startsWith('84') ? `0${s.slice(2)}` : s;
}

const asText = (max: number) => z.string({ required_error: 'required', invalid_type_error: 'invalid_format' })
  .transform((s) => s.normalize('NFC').trim())
  .pipe(z.string().superRefine((v, ctx) => {
    const code = !v ? 'required' : CONTROL.test(v) ? 'invalid_format' : len(v) > max ? 'too_long' : null; // một mã duy nhất mỗi lần
    if (code) ctx.addIssue({ code: 'custom', message: code });
  }));

/** Chuỗi tùy chọn: thiếu thì không đổi (`.optional()` ở nơi dùng), null hoặc rỗng thì xóa về null (district, E-06). */
const nullableText = (max: number) => z.union([z.string(), z.null()], { errorMap: () => ({ message: 'invalid_format' }) })
  .transform((v) => (v === null ? '' : v.normalize('NFC').trim()))
  .pipe(z.string().superRefine((v, ctx) => {
    const code = CONTROL.test(v) ? 'invalid_format' : len(v) > max ? 'too_long' : null;
    if (code) ctx.addIssue({ code: 'custom', message: code });
  }))
  .transform((v) => v || null);

const requiredPhone = z.string({ required_error: 'required', invalid_type_error: 'invalid_format' })
  .transform(normalizePhone)
  .pipe(z.string().superRefine((v, ctx) => {
    const code = !v ? 'required' : !PHONE_RE.test(v) ? 'invalid_phone' : null;
    if (code) ctx.addIssue({ code: 'custom', message: code });
  }));
const clearablePhone = z.union([z.string(), z.null()], { errorMap: () => ({ message: 'invalid_format' }) })
  .transform((v) => normalizePhone(v ?? ''))
  .pipe(z.string().superRefine((v, ctx) => { if (v && !PHONE_RE.test(v)) ctx.addIssue({ code: 'custom', message: 'invalid_phone' }); }))
  .transform((v) => v || null);

/** Đối tượng đóng: khóa lạ (kể cả `role`, `user_id`) bị từ chối với `unknown_field` (SB-05, SB-11); body rỗng là lỗi. */
function closedObject<T extends z.ZodRawShape>(shape: T) {
  const known = new Set(Object.keys(shape));
  return z.object(shape).passthrough().superRefine((o, ctx) => {
    const add = (field: string, message: string) => ctx.addIssue({ code: 'custom', path: [field], message });
    for (const k of Object.keys(o)) if (!known.has(k)) add(k, 'unknown_field');
    if (!Object.keys(o).length) add('body', 'required');
  });
}

export const profilePatchBody = closedObject({ full_name: asText(100).optional(), phone: clearablePhone.optional() });
export const passwordBody = closedObject({
  current_password: z.string({ required_error: 'required', invalid_type_error: 'invalid_format' }).min(1, 'required').max(256, 'incorrect'),
  new_password: z.string({ required_error: 'required', invalid_type_error: 'invalid_format' }).min(1, 'required').max(1024, 'too_long'),
});
const isDefault = z.boolean({ invalid_type_error: 'invalid_format' });
export const addressCreateBody = closedObject({
  receiver: asText(100), phone: requiredPhone, line1: asText(200), ward: asText(100), district: nullableText(100).optional(), city: asText(100), is_default: isDefault.optional(),
});
export const addressPatchBody = closedObject({
  receiver: asText(100).optional(), phone: requiredPhone.optional(), line1: asText(200).optional(), ward: asText(100).optional(),
  district: nullableText(100).optional(), city: asText(100).optional(), is_default: isDefault.optional(),
});
export const noParams = z.object({}).strict();
export const idParams = z.object({ id: z.string() }).strict();
export const lookupQuery = z.object({
  email: z.string({ required_error: 'required', invalid_type_error: 'invalid_format' }).transform((s) => s.trim().toLowerCase())
    .pipe(z.string().superRefine((v, ctx) => {
      // khớp chính xác: `%` và `_` là ký tự thường; chỉ cần có dạng `phần@phần` (USR-REQ-...117 BR1)
      const code = !v ? 'required' : v.length > 254 ? 'too_long' : !/^[^\s@]+@[^\s@]+$/.test(v) ? 'invalid_format' : null;
      if (code) ctx.addIssue({ code: 'custom', message: code });
    })),
}).strict();

export type ProfilePatch = z.infer<typeof profilePatchBody>;
export type AddressCreate = z.infer<typeof addressCreateBody>;
export type AddressPatch = z.infer<typeof addressPatchBody>;

/** Che email cho staff: giữ 2 ký tự đầu phần trước `@` (1 nếu chỉ có 1), `***`, giữ tên miền (USR-REQ-...117 BR3). */
export function maskEmail(email: string): string {
  const at = email.lastIndexOf('@');
  const local = at < 0 ? email : email.slice(0, at);
  const keep = [...local].slice(0, local.length === 1 ? 1 : 2).join('');
  return `${keep}***${at < 0 ? '' : email.slice(at)}`;
}
/** Che điện thoại: giữ 3 chữ số đầu và 3 chữ số cuối, giữa `****`; rỗng thì null. */
export function maskPhone(phone: string | null | undefined): string | null {
  if (!phone) return null;
  return phone.length >= 7 ? `${phone.slice(0, 3)}****${phone.slice(-3)}` : '****';
}
