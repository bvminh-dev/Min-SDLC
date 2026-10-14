import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (v: unknown): v is string => typeof v === 'string' && UUID_RE.test(v);

/** Giỏ active của một người dùng cùng các dòng (một câu truy vấn, một ảnh chụp nhất quán). */
export interface CartHead {
  id: string; user_id: string; coupon_code: string | null; shipping_method_id: string | null; shipping_city: string | null; version: number;
}
export interface ItemRow { id: string; product_id: string; quantity: number; unit_price: bigint; unavailable_reason: string | null }
export interface RawCart { head: CartHead; items: ItemRow[] }

export const HEAD_COLS = Prisma.raw('id, user_id, coupon_code, shipping_method_id, shipping_city, version');

/** Id người dùng đã băm để ghi log (SB-18, CRT-SEC T14): không bao giờ ghi `user_id` nguyên văn cạnh dữ liệu khác. */
export const hashId = (id: string): string => createHash('sha256').update(id).digest('hex').slice(0, 12);
