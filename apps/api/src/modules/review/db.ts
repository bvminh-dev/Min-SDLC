import { Prisma } from '@prisma/client';

/** Lỗi PostgreSQL qua Prisma raw (P2010): mã SQLSTATE và tên ràng buộc (nếu thông điệp có), để đổi thành lỗi nghiệp vụ. */
export function pgViolation(e: unknown): { code: string; constraint: string; message: string } | null {
  const meta = (e as { meta?: { code?: unknown; message?: unknown } } | null)?.meta;
  const code = typeof meta?.code === 'string' ? meta.code : (e as { code?: unknown } | null)?.code;
  if (typeof code !== 'string' || !/^\d{5}$/.test(code)) return null;
  const message = String(meta?.message ?? (e as Error | null)?.message ?? '');
  return { code, constraint: message.match(/constraint "([^"]+)"/)?.[1] ?? '', message };
}
/** Vi phạm unique (23505); Prisma raw (P2010) chỉ đưa `Key (cột)=(giá trị)` nên so khớp trên cả tên ràng buộc lẫn thông điệp. */
export const isUnique = (e: unknown, match?: RegExp): boolean => { const v = pgViolation(e); return !!v && v.code === '23505' && (!match || match.test(`${v.constraint} ${v.message}`)); };

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface ReviewRow {
  id: string; user_id: string; product_id: string; order_item_id: string; status: 'pending' | 'published' | 'rejected' | 'hidden' | 'deleted'; rating: number; comment: string | null;
  moderation_reason: string | null; moderated_by: string | null; moderated_at: Date | null; published_at: Date | null; edited_at: Date | null; deleted_at: Date | null;
  created_at: Date; updated_at: Date;
}
export const REVIEW_COLS = Prisma.raw(
  'id, user_id, product_id, order_item_id, status::text AS status, rating::int AS rating, comment, moderation_reason, moderated_by, moderated_at, published_at, edited_at, deleted_at, created_at, updated_at',
);
export interface ImageRow { id: string; review_id: string | null; position: number | null; storage_key: string; width: number; height: number }
