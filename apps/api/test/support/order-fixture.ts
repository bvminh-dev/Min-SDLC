import { randomInt, randomUUID } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';

// Đơn dựng thẳng trong CSDL (fixture, không qua CHK): dùng chung bởi test Jest (support/ord.ts) và máy chủ E2E (e2e/server.ts), không phụ thuộc Nest hay Jest.
export type Status = 'pending' | 'confirmed' | 'paid' | 'shipped' | 'delivered' | 'cancelled' | 'expired' | 'returned';
export type PayStatus = 'pending' | 'processing' | 'succeeded' | 'failed' | 'expired' | 'cancelled' | 'refunded';
export const ADDRESS = { receiver: 'Nguyễn Văn A', phone: '0901234567', line1: '12 Lê Lợi', ward: 'Bến Nghé', district: 'Quận 1', city: 'TP.HCM' };
export const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
/** Mã đơn hợp lệ (12 ký tự Crockford ngẫu nhiên). */
export const code = (): string => Array.from({ length: 12 }, () => ALPHABET[randomInt(32)]).join('');

export interface SeedOrder {
  id?: string; code?: string; user?: string; status?: Status; method?: 'vnpay' | 'cod'; payment?: PayStatus; createdAt?: Date;
  items?: { product?: string; name?: string; price?: number; qty?: number }[]; discount?: number; shipping?: number;
  paidAt?: Date | null; tracking?: string | null; handoff?: Date | null; expiresAt?: Date | null; deliveredAt?: Date | null; address?: Record<string, string>;
  cancel?: { reason: 'customer_request' | 'admin' | 'payment_failed' | 'stock_commit_failed'; by: 'customer' | 'admin' | 'system'; text?: string };
  /** Bỏ qua dòng lịch sử mặc định (đường đi theo trạng thái) khi test tự dựng lịch sử. */
  noHistory?: boolean;
}
const PATH: Record<Status, (m: 'vnpay' | 'cod') => Status[]> = {
  pending: () => ['pending'], confirmed: () => ['pending', 'confirmed'], paid: () => ['pending', 'paid'],
  shipped: (m) => ['pending', m === 'cod' ? 'confirmed' : 'paid', 'shipped'], delivered: (m) => ['pending', m === 'cod' ? 'confirmed' : 'paid', 'shipped', 'delivered'],
  cancelled: () => ['pending', 'cancelled'], expired: () => ['pending', 'expired'], returned: (m) => ['pending', m === 'cod' ? 'confirmed' : 'paid', 'shipped', 'returned'],
};
/** Đơn dựng thẳng trong CSDL (fixture, không qua CHK): `status` cùng cột kèm theo cho khớp CHECK, lịch sử theo đường đi hợp lệ tới `status` (mỗi dòng cách nhau một phút từ `createdAt`). */
export async function insertOrder(db: PrismaClient, now: Date, o: SeedOrder & { user: string }): Promise<{ id: string; code: string; user: string }> {
  const user = o.user;
  const status = o.status ?? 'paid', method = o.method ?? (status === 'confirmed' ? 'cod' : 'vnpay');
  const items = o.items ?? [{ price: 100000, qty: 2 }, { price: 150000, qty: 1 }];
  const itemsTotal = items.reduce((s, i) => s + (i.price ?? 100000) * (i.qty ?? 1), 0), discount = o.discount ?? 0, shipping = o.shipping ?? 30000;
  const createdAt = o.createdAt ?? new Date(now.getTime() - 3600_000);
  const payment: PayStatus = o.payment ?? (status === 'paid' || status === 'shipped' && method === 'vnpay' ? 'succeeded' : status === 'cancelled' ? 'cancelled' : 'pending');
  const plain = (d: Date | null | undefined) => d ?? null;
  const tracking = o.tracking !== undefined ? o.tracking : (['shipped', 'delivered', 'returned'] as Status[]).includes(status) ? 'VN123456' : null;
  const expiresAt = method === 'vnpay' ? (o.expiresAt ?? new Date(createdAt.getTime() + 900_000)) : null;
  const orderCode = o.code ?? code();
  const cancel = status === 'cancelled' ? (o.cancel ?? { reason: 'customer_request' as const, by: 'customer' as const }) : null;
  const id = o.id ?? randomUUID();
  const at = (i: number) => new Date(createdAt.getTime() + i * 60_000);
  await db.$executeRaw`
    INSERT INTO orders (id, user_id, code, status, payment_status, items_total, discount, shipping_fee, grand_total, shipping_address, shipping_method_id, payment_method, payment_expires_at,
                        handoff_locked_at, tracking_number, cancel_reason, cancelled_by_role, confirmed_at, paid_at, delivered_at, created_at, updated_at)
    VALUES (${id}::uuid, ${user}::uuid, ${orderCode}, ${status}::order_status, ${payment}::order_payment_status, ${itemsTotal}, ${discount}, ${shipping}, ${itemsTotal - discount + shipping},
            ${JSON.stringify(o.address ?? ADDRESS)}::jsonb, ${randomUUID()}::uuid, ${method}::order_payment_method, ${expiresAt}::timestamptz,
            ${plain(o.handoff)}::timestamptz, ${tracking}, ${cancel?.reason ?? null}::order_cancel_reason, ${cancel?.by ?? null}::order_actor_role,
            ${status === 'confirmed' ? at(1) : null}::timestamptz, ${o.paidAt !== undefined ? o.paidAt : payment === 'succeeded' ? at(1) : null}::timestamptz,
            ${status === 'delivered' ? (o.deliveredAt ?? at(3)) : null}::timestamptz, ${createdAt}::timestamptz, ${createdAt}::timestamptz)`;
  for (const [idx, i] of items.entries()) {
    await db.$executeRaw`INSERT INTO order_items (order_id, product_id, name_snapshot, unit_price, quantity, position) VALUES (${id}::uuid, ${i.product ?? randomUUID()}::uuid, ${i.name ?? `Sản phẩm ${idx + 1}`}, ${i.price ?? 100000}, ${i.qty ?? 1}, ${idx + 1})`;
  }
  if (!o.noHistory) {
    const path = PATH[status](method);
    for (let i = 0; i < path.length; i++) {
      const last = i === path.length - 1 && status === 'cancelled';
      await db.$executeRaw`
        INSERT INTO order_status_history (order_id, from_status, to_status, actor_id, actor_role, reason, created_at)
        VALUES (${id}::uuid, ${i ? path[i - 1] : null}::order_status, ${path[i]}::order_status, ${i === 0 ? user : null}::uuid, ${(i === 0 ? 'customer' : last ? (cancel?.by ?? 'customer') : 'system')}::order_actor_role,
                ${last ? (cancel?.text ?? null) : null}, ${at(i)}::timestamptz)`;
    }
  }
  return { id, code: orderCode, user };
}

