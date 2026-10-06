import { z } from 'zod';

// Phân trang dùng chung (PRJ-REQ-20261006-095422650 BR3): ngoài miền hoặc không phải số thì bị từ chối 400, không bỏ qua âm thầm.
const int = (min: number, max: number, def: number) =>
  z.string().regex(/^-?\d+$/).transform(Number).pipe(z.number().int().min(min).max(max)).optional().transform((v) => v ?? def);

export const paginationQuery = z.object({ page: int(1, Number.MAX_SAFE_INTEGER, 1), limit: int(1, 100, 20) }).strict();
export type PaginationQuery = z.infer<typeof paginationQuery>;

export const paginate = (q: PaginationQuery): { skip: number; take: number } => ({ skip: (q.page - 1) * q.limit, take: q.limit });
export const toPage = <T>(items: T[], total: number, q: PaginationQuery) => ({ items, page: q.page, limit: q.limit, total });
