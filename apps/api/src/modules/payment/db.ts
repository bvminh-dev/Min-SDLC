import { Prisma } from '@prisma/client';
import type { FailReason, PaymentMethod, PaymentStatus, RefundReason, RefundStatus } from './config';

/** Lỗi PostgreSQL qua Prisma raw (P2010): mã SQLSTATE và tên ràng buộc (nếu thông điệp có), để đổi thành lỗi nghiệp vụ. */
export function pgViolation(e: unknown): { code: string; constraint: string; message: string } | null {
  const meta = (e as { meta?: { code?: unknown; message?: unknown } } | null)?.meta;
  const code = typeof meta?.code === 'string' ? meta.code : (e as { code?: unknown } | null)?.code;
  if (typeof code !== 'string' || !/^\d{5}$/.test(code)) return null;
  const message = String(meta?.message ?? (e as Error | null)?.message ?? '');
  return { code, constraint: message.match(/constraint "([^"]+)"/)?.[1] ?? '', message };
}
/** Vi phạm unique (23505); Prisma raw chỉ đưa `Key (cột)=(giá trị)` chứ không có tên ràng buộc nên so khớp trên cả tên ràng buộc lẫn thông điệp. */
export const isUnique = (e: unknown, match?: RegExp): boolean => { const v = pgViolation(e); return !!v && v.code === '23505' && (!match || match.test(`${v.constraint} ${v.message}`)); };

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface PaymentRow {
  id: string; order_id: string; order_code: string; user_id: string; amount: bigint; method: PaymentMethod; status: PaymentStatus; attempt_no: number;
  provider_ref: string | null; expires_at: Date | null; paid_at: Date | null; version: number; created_at: Date; updated_at: Date;
}
export const PAYMENT_COLS = Prisma.raw(
  'id, order_id, order_code, user_id, amount, method::text AS method, status::text AS status, attempt_no, provider_ref, expires_at, paid_at, version, created_at, updated_at',
);
export interface AttemptRow {
  id: string; payment_id: string; attempt_no: number; txn_ref: string; status: 'processing' | 'succeeded' | 'failed' | 'superseded'; reason: FailReason | null;
  gateway_code: string | null; provider_txn_no: string | null; create_date: Date; expires_at: Date; resolved_at: Date | null; created_at: Date; updated_at: Date;
}
export const ATTEMPT_COLS = Prisma.raw(
  'id, payment_id, attempt_no, txn_ref, status::text AS status, reason::text AS reason, gateway_code, provider_txn_no, create_date, expires_at, resolved_at, created_at, updated_at',
);
export interface RefundRow {
  id: string; payment_id: string; attempt_id: string; amount: bigint; reason: RefundReason; note: string | null; requested_by: string | null; status: RefundStatus;
  failure_reason: string | null; gateway_code: string | null; gateway_request_id: string; auto_attempt_no: number | null; next_retry_at: Date | null;
  requested_at: Date; created_at: Date; updated_at: Date; resolved_at: Date | null;
}
export const REFUND_COLS = Prisma.raw(
  'id, payment_id, attempt_id, amount, reason::text AS reason, note, requested_by, status::text AS status, failure_reason, gateway_code, gateway_request_id, auto_attempt_no, next_retry_at, requested_at, created_at, updated_at, resolved_at',
);
