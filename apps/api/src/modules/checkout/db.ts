import { Prisma } from '@prisma/client';
import type { PaymentMethod, SessionStatus } from './config';

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (v: unknown): v is string => typeof v === 'string' && UUID_RE.test(v);

/** Bản chụp địa chỉ trong phiên (CHK-DB): sáu trường nội dung và `updated_at` của địa chỉ gốc (ISO 8601). Dữ liệu cá nhân: chỉ trả cho chủ phiên, không vào log, xóa sau 30 ngày khi phiên đã đóng (SB-08). */
export interface AddressSnap { receiver: string; phone: string; line1: string; ward: string; district: string | null; city: string; updated_at: string }

/** Một dòng `checkout_sessions`; `overdue` là `expires_at <= clock_timestamp()` tính ở CSDL (đồng hồ CSDL, không đồng hồ của ứng dụng, CHK-DB mục 2). */
export interface SessionRow {
  id: string; user_id: string; cart_id: string; address_id: string | null; shipping_method_id: string | null; order_id: string | null; payment_method: PaymentMethod | null;
  coupon_code: string | null; address_snapshot: AddressSnap | null; status: SessionStatus; expires_at: Date; overdue: boolean;
}
export const COLS = Prisma.raw(
  `id, user_id, cart_id, address_id, shipping_method_id, order_id, payment_method::text AS payment_method, coupon_code, address_snapshot, status::text AS status, expires_at, (expires_at <= clock_timestamp()) AS overdue`,
);
