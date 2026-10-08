import { Prisma } from '@prisma/client';

/** Lỗi PostgreSQL qua Prisma raw (P2010): mã SQLSTATE và tên ràng buộc (nếu thông điệp có), để đổi thành lỗi nghiệp vụ. */
export function pgViolation(e: unknown): { code: string; constraint: string; message: string } | null {
  const meta = (e as { meta?: { code?: unknown; message?: unknown } } | null)?.meta;
  const code = typeof meta?.code === 'string' ? meta.code : (e as { code?: unknown } | null)?.code;
  if (typeof code !== 'string' || !/^\d{5}$/.test(code)) return null;
  const message = String(meta?.message ?? (e as Error | null)?.message ?? '');
  return { code, constraint: message.match(/constraint "([^"]+)"/)?.[1] ?? '', message };
}
/** Vi phạm unique (23505); Prisma raw (P2010) chỉ đưa `Key (cột)=(giá trị)` chứ không có tên ràng buộc nên so khớp trên cả tên ràng buộc lẫn thông điệp (cột hay biểu thức của chỉ mục). */
export const isUnique = (e: unknown, match?: RegExp): boolean => { const v = pgViolation(e); return !!v && v.code === '23505' && (!match || match.test(`${v.constraint} ${v.message}`)); };

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

import type { ShipmentStatus } from './config';

export interface MethodRow {
  id: string; name: string; base_fee: bigint; rule: unknown; is_active: boolean; version: number; created_at: Date; updated_at: Date;
}
export const METHOD_COLS = Prisma.raw('id, name, base_fee, rule, is_active, version, created_at, updated_at');

export interface ShipmentRow {
  id: string; order_id: string; shipping_method_id: string; status: ShipmentStatus; tracking_number: string | null; cod_amount: bigint;
  shipped_at: Date | null; delivered_at: Date | null; version: number; created_at: Date; updated_at: Date;
}
export const SHIPMENT_COLS = Prisma.raw(
  'id, order_id, shipping_method_id, status::text AS status, tracking_number, cod_amount, shipped_at, delivered_at, version, created_at, updated_at',
);
