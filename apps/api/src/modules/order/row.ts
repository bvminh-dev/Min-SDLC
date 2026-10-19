import { Prisma } from '@prisma/client';
import type { Tx } from '../platform';
import type { OrderStatus } from './config';

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type PaymentStatus = 'pending' | 'processing' | 'succeeded' | 'failed' | 'expired' | 'cancelled' | 'refunded';
export type PaymentMethod = 'vnpay' | 'cod' | 'cash' | 'bank_transfer';
export type Actor = { id: string | null; role: 'customer' | 'admin' | 'system' | 'sale' };

/** Dòng đơn đọc dưới khóa (`FOR UPDATE`): đủ để quyết định chuyển trạng thái, không có dữ liệu cá nhân. */
export interface OrderRow {
  id: string; user_id: string | null; code: string; status: OrderStatus; payment_status: PaymentStatus; payment_method: PaymentMethod;
  grand_total: bigint; handoff_locked_at: Date | null; tracking_number: string | null; payment_expires_at: Date | null;
}
const LOCK_COLS = Prisma.raw(
  'id, user_id, code, status::text AS status, payment_status::text AS payment_status, payment_method::text AS payment_method, grand_total, handoff_locked_at, tracking_number, payment_expires_at',
);

/** Khóa dòng đơn theo id (đường event và giao diện nội bộ). Không thấy thì `undefined`. */
export async function lockById(tx: Tx, id: string): Promise<OrderRow | undefined> {
  return (await tx.$queryRaw<OrderRow[]>`SELECT ${LOCK_COLS} FROM orders WHERE id = ${id}::uuid FOR UPDATE`)[0];
}
/** Khóa dòng đơn theo mã; `userId` có thì điều kiện sở hữu nằm NGAY TRONG câu truy vấn (SB-06, SB-44): đơn người khác (kể cả đơn hộ không tài khoản, `user_id` NULL) không bị khóa, không khác đơn không tồn tại. */
export async function lockByCode(tx: Tx, code: string, userId?: string): Promise<OrderRow | undefined> {
  return userId
    ? (await tx.$queryRaw<OrderRow[]>`SELECT ${LOCK_COLS} FROM orders WHERE code = ${code} AND user_id = ${userId}::uuid FOR UPDATE`)[0]
    : (await tx.$queryRaw<OrderRow[]>`SELECT ${LOCK_COLS} FROM orders WHERE code = ${code} FOR UPDATE`)[0];
}
