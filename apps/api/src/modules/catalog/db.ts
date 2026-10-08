/**
 * Lỗi PostgreSQL qua Prisma raw (P2010): mã SQLSTATE và `constraint` (tên ràng buộc nếu thông điệp có, không thì phần `Key (cột...)=` của DETAIL: Prisma chỉ chuyển DETAIL cho lỗi 23505),
 * để đổi thành lỗi nghiệp vụ (SB-11). Bên gọi so khớp theo cột: `(slug)`, `(sku)`, `lower(name)`.
 */
export function pgViolation(e: unknown): { code: string; constraint: string } | null {
  const meta = (e as { meta?: { code?: unknown; message?: unknown } } | null)?.meta;
  const code = typeof meta?.code === 'string' ? meta.code : (e as { code?: unknown } | null)?.code;
  if (typeof code !== 'string' || !/^\d{5}$/.test(code)) return null;
  const message = String(meta?.message ?? (e as Error | null)?.message ?? '');
  return { code, constraint: message.match(/constraint "([^"]+)"/)?.[1] ?? message.match(/^Key \(([^)]*(?:\([^)]*\))?[^)]*)\)=/)?.[0] ?? '' };
}
export const isUnique = (e: unknown, constraint?: RegExp): boolean => { const v = pgViolation(e); return !!v && v.code === '23505' && (!constraint || constraint.test(v.constraint)); };
export const isForeignKey = (e: unknown): boolean => pgViolation(e)?.code === '23503';
