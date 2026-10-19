import { z } from 'zod';
import { COMMON_PASSWORDS } from './common-passwords';

// Mã lỗi trường theo AUTH-API: invalid_format, too_short, too_long, same_as_email, too_common, required, unknown_field.
// platform đọc `message` dạng snake_case của zod làm mã (zodItems).
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const reqStr = (extra?: object) => z.string({ required_error: 'required', invalid_type_error: 'invalid_format', ...extra });

export const normalizeEmail = (s: string): string => s.trim().toLowerCase();
/** citext của PostgreSQL gấp ký hiệu Kelvin (U+212A) thành `k`: khi TRA tài khoản, email THÔ (kiểm trước `toLowerCase`, vì nó cũng đổi Kelvin thành `k`) chứa ký tự ngoài ASCII không khớp ai (SB-11). */
export const isAsciiEmail = (s: string): boolean => /^[\x20-\x7e]*$/.test(s.trim());

export const emailField = reqStr()
  .transform(normalizeEmail)
  .pipe(z.string().superRefine((v, ctx) => {
    const code = !v ? 'required' : v.length > 254 ? 'too_long' : !EMAIL_RE.test(v) ? 'invalid_format' : null; // một mã duy nhất mỗi lần
    if (code) ctx.addIssue({ code: 'custom', message: code });
  }));

/** Chính sách mật khẩu (REQ-620 BR2): 10 đến 128 ký tự, không trong danh sách phổ biến; không ép ký tự hoa, số, ký hiệu. */
export const passwordField = reqStr()
  .pipe(z.string().min(10, 'too_short').max(128, 'too_long').refine((v) => !COMMON_PASSWORDS.has(v.toLowerCase()), 'too_common'));

export const fullNameField = reqStr()
  .transform((s) => s.trim())
  .pipe(z.string().min(1, 'required').max(100, 'too_long'));

/** Đối tượng đóng: khóa lạ (kể cả `role`) bị từ chối với mã `unknown_field` (SB-05, SB-11); hàm `check` thêm quy tắc chéo trường. */
export function closedObject<T extends z.ZodRawShape>(shape: T, check?: (o: z.infer<z.ZodObject<T>>, add: (field: string, code: string) => void) => void) {
  const known = new Set(Object.keys(shape));
  return z.object(shape).passthrough().superRefine((o, ctx) => {
    const add = (field: string, message: string) => ctx.addIssue({ code: 'custom', path: [field], message });
    for (const k of Object.keys(o)) if (!known.has(k)) add(k, 'unknown_field');
    check?.(o as z.infer<z.ZodObject<T>>, add);
  });
}

const tokenField = z.string({ required_error: 'required', invalid_type_error: 'invalid_format' }).regex(/^[A-Za-z0-9_-]{43,64}$/, 'invalid_format');
const sameAsEmail = (email: string, password: string) => normalizeEmail(email) === password.trim().toLowerCase();

export const registerBody = closedObject(
  { email: emailField, password: passwordField, full_name: fullNameField },
  (o, add) => { if (typeof o.email === 'string' && typeof o.password === 'string' && sameAsEmail(o.email, o.password)) add('password', 'same_as_email'); },
);
export const loginBody = closedObject({ email: reqStr().min(1, 'required'), password: reqStr().min(1, 'required') });
export const emailOnlyBody = closedObject({ email: emailField });
export const tokenBody = closedObject({ token: tokenField });
export const resetBody = closedObject({ token: tokenField, new_password: passwordField });
export const lockBody = closedObject({ reason: z.string({ invalid_type_error: 'invalid_format' }).max(200, 'too_long').optional() });
export const roleBody = closedObject({ role: z.enum(['customer', 'staff', 'sale', 'admin'], { errorMap: (i, c) => ({ message: i.code === 'invalid_type' && c.data === undefined ? 'required' : 'invalid_format' }) }) });
export const idParams = z.object({ id: z.string() }).strict();
export const adminListQuery = z.object({
  page: z.string().regex(/^\d+$/, 'invalid_format').transform(Number).pipe(z.number().int().min(1, 'invalid_format')).optional().transform((v) => v ?? 1),
  limit: z.string().regex(/^\d+$/, 'invalid_format').transform(Number).pipe(z.number().int().min(1, 'invalid_format').max(100, 'too_long')).optional().transform((v) => v ?? 20),
  role: z.enum(['customer', 'staff', 'sale', 'admin'], { errorMap: () => ({ message: 'invalid_format' }) }).optional(),
  status: z.enum(['active', 'locked'], { errorMap: () => ({ message: 'invalid_format' }) }).optional(),
  q: z.string().min(3, 'too_short').max(254, 'too_long').optional(),
}).strict();
export { sameAsEmail };
