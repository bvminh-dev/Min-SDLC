import { Prisma } from '@prisma/client';

/** Lỗi PostgreSQL qua Prisma raw (P2010): mã SQLSTATE và `constraint` (tên ràng buộc nếu thông điệp có), để đổi thành lỗi nghiệp vụ (SB-11). */
export function pgViolation(e: unknown): { code: string; constraint: string } | null {
  const meta = (e as { meta?: { code?: unknown; message?: unknown } } | null)?.meta;
  const code = typeof meta?.code === 'string' ? meta.code : (e as { code?: unknown } | null)?.code;
  if (typeof code !== 'string' || !/^\d{5}$/.test(code)) return null;
  const message = String(meta?.message ?? (e as Error | null)?.message ?? '');
  return { code, constraint: message.match(/constraint "([^"]+)"/)?.[1] ?? message.match(/^Key \(([^)]*)\)=/)?.[0] ?? '' };
}
export const isUnique = (e: unknown, constraint?: RegExp): boolean => { const v = pgViolation(e); return !!v && v.code === '23505' && (!constraint || constraint.test(v.constraint)); };

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Cột của một coupon (SQL tĩnh, không có đầu vào người dùng). `bigint` về là BigInt nên `toCoupon` đổi sang số. */
export const COLS = Prisma.raw(
  'id, code, type::text AS type, value, min_order_value, max_discount, expires_at, usage_limit, per_user_limit, consumed_count, reserved_count, status::text AS status, version, created_at, updated_at',
);

export type CouponStatus = 'active' | 'disabled' | 'expired' | 'exhausted' | 'deleted';
export interface CouponRow {
  id: string; code: string; type: 'percentage' | 'fixed'; value: bigint; min_order_value: bigint; max_discount: bigint | null; expires_at: Date; usage_limit: number;
  per_user_limit: number | null; consumed_count: number; reserved_count: number; status: CouponStatus; version: number; created_at: Date; updated_at: Date;
}

/** Thân phản hồi của coupon (PRM-API mục Hợp đồng dữ liệu): không có `deleted_at`, `created_by`; `remaining` tính lúc đọc (PRM-REQ ...299 BR5). */
export function toCoupon(r: CouponRow) {
  return {
    id: r.id, code: r.code, type: r.type, value: Number(r.value), min_order_value: Number(r.min_order_value),
    max_discount: r.max_discount === null ? null : Number(r.max_discount), expires_at: r.expires_at.toISOString(), usage_limit: r.usage_limit,
    per_user_limit: r.per_user_limit, consumed_count: r.consumed_count, reserved_count: r.reserved_count, remaining: r.usage_limit - r.consumed_count - r.reserved_count,
    status: r.status, version: r.version, created_at: r.created_at.toISOString(), updated_at: r.updated_at.toISOString(),
  };
}
