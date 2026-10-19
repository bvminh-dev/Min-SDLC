import { randomUUID } from 'node:crypto';
import { createChkApp, newKey, resetChk, relayAll, alignWindow, type ChkApp } from './chk';
import { q, seedUser } from './auth';
import { stock } from './crt';
import { resetSources } from './ho';
import { call, seedCategory, seedProduct, who, type Who } from './prd';
import { seedMethod } from './shp';
import { setMethodActive } from './chk';

export type SalApp = ChkApp;
/** Ứng dụng thật (AppModule đủ PRD, INV, SHP, ORD, USR, SAL...) trên PostgreSQL thật; không có bản giả của module nào SAL gọi: gài lỗi hay đếm lời gọi bằng `jest.spyOn` trên chính các lớp `*Api`. */
export const createSalApp = (o: Parameters<typeof createChkApp>[0] = {}): Promise<SalApp> => createChkApp(o);
export { alignWindow, newKey, relayAll, call, q, who };

/** Đầu mỗi test: CSDL sạch, bộ đếm tần suất sạch, danh mục nguồn về dữ liệu mồi (website, facebook, tiktok, hotline đều bật). */
export async function resetSal(t: SalApp): Promise<void> {
  await resetChk(t);
  await resetSources(t as never);
  t.logs.clear();
}

/** Dữ liệu mồi theo tài liệu TC: sale S1, S2, admin AD1, staff ST1, customer U1 (không phải C1); P1 "Áo thun cotton" 150000 (giá vốn 90000, kho 50), P2 "Tất cổ cao" 50000 (kho 3), SM1 30000 miễn phí từ 500000 (phụ thu 20000 "Hà Giang"), SM2 50000. */
export interface SalWorld { s1: Who; s2: Who; ad: Who; st: Who; u1: Who; p1: string; p2: string; sm1: string; sm2: string }
export async function prod(t: SalApp, o: { name?: string; price?: number; cost?: number | null; status?: 'draft' | 'active' | 'archived'; onHand?: number | null } = {}): Promise<string> {
  const category = t.cat || (t.cat = await seedCategory(t, 'Áo'));
  const id = await seedProduct(t as never, { category, name: o.name, price: o.price ?? 100000, costPrice: o.cost === undefined ? null : o.cost, status: o.status ?? 'active', images: 0 });
  if (o.onHand !== null) await stock(t as never, id, o.onHand ?? 50);
  return id;
}
export async function salWorld(t: SalApp): Promise<SalWorld> {
  const [s1, s2, ad, st, u1] = [await who(t, 'sale', 's1@shop.vn'), await who(t, 'sale', 's2@shop.vn'), await who(t, 'admin', 'ad1@shop.vn'), await who(t, 'staff', 'st1@shop.vn'), await who(t, 'customer', 'u1@shop.vn')];
  await q(t, `UPDATE users SET full_name = 'Trần Thu' WHERE id = '${s1.id}'`);
  await q(t, `UPDATE users SET full_name = 'Lê Hoa' WHERE id = '${s2.id}'`);
  const p1 = await prod(t, { name: 'Áo thun cotton', price: 150000, cost: 90000, onHand: 50 });
  const p2 = await prod(t, { name: 'Tất cổ cao', price: 50000, cost: 20000, onHand: 3 });
  const sm1 = await seedMethod(t, { name: 'Giao tiêu chuẩn', fee: 30000, freeOver: 500000, surcharge: 20000, cities: ['Hà Giang'] });
  const sm2 = await seedMethod(t, { name: 'Giao nhanh', fee: 50000 });
  return { s1, s2, ad, st, u1, p1, p2, sm1, sm2 };
}

export const ADDRESS = { receiver: 'Nguyễn An', phone: '0901234567', line1: '45 Nguyễn Huệ', ward: 'Bến Nghé', district: 'Quận 1', city: 'Hồ Chí Minh' };
/** Thân hợp lệ chuẩn: nguồn facebook, khách chưa có tài khoản, P1 x 2, SM1, COD, tổng 330000 (300000 hàng, 30000 phí). `over` ghi đè từng khóa ở gốc. */
export const stdBody = (w: Pick<SalWorld, 'p1' | 'sm1'>, over: Record<string, unknown> = {}): Record<string, any> => ({
  source_code: 'facebook', customer: { full_name: 'Nguyễn An', phone: '0901234567' }, shipping_address: { ...ADDRESS }, shipping_method_id: w.sm1, payment_method: 'cod',
  items: [{ product_id: w.p1, quantity: 2 }], expected_grand_total: 330000, ...over,
});
/** Tạo đơn hộ: `Idempotency-Key` mới mỗi lần, giữ nguyên khi truyền `key`; `key: null` bỏ header. */
export function postOrder(t: SalApp, u: Who | undefined, body: unknown, o: { key?: string | null; origin?: string | null } = {}) {
  const r = call(t, 'post', '/sales/orders', { cookie: u?.cookie, body, origin: o.origin });
  const key = o.key === undefined ? newKey() : o.key;
  return key === null ? r : r.set('Idempotency-Key', key);
}
export const salesGet = (t: SalApp, u: { cookie: string } | undefined, path: string, query: Record<string, string> = {}) => call(t, 'get', `/sales${path}`, { cookie: u?.cookie }).query(query);

// --- đọc CSDL
export const count = async (t: SalApp, table: string, where = 'TRUE'): Promise<number> => (await q<{ n: number }>(t, `SELECT count(*)::int AS n FROM ${table} WHERE ${where}`))[0].n;
/** Số bản ghi do tạo đơn hộ để lại: đơn, dòng hàng, giữ hàng, khóa idempotency của SAL, audit `order.created_ho`, event. Rỗng cả sáu nghĩa là giao dịch đã hoàn tác. */
export const traces = async (t: SalApp): Promise<number[]> => Promise.all([
  count(t, 'orders'), count(t, 'order_items'), count(t, 'stock_reservations'), count(t, 'idempotency_keys', "scope = 'sales.create_order'"), count(t, 'audit_logs', "action = 'order.created_ho'"), count(t, 'outbox_events'),
]);
export const reservedOf = async (t: SalApp, product: string): Promise<number> => (await q<{ reserved: number }>(t, `SELECT reserved FROM stock_items WHERE product_id = '${product}'`))[0].reserved;
export const orderRow = async (t: SalApp, code: string) => (await q<any>(t, `SELECT o.*, s.code AS source_code FROM orders o JOIN order_sources s ON s.id = o.source_id WHERE o.code = '${code}'`))[0];
export const itemRows = (t: SalApp, orderId: string) => q<any>(t, `SELECT product_id, name_snapshot, unit_price::int AS unit_price, quantity, note, cost_snapshot::int AS cost_snapshot FROM order_items WHERE order_id = '${orderId}' ORDER BY position`);
export const setSource = (t: SalApp, code: string, active: boolean) => q(t, `UPDATE order_sources SET is_active = ${active} WHERE code = '${code}'`);
export { setMethodActive, randomUUID, seedUser };

/** Dựng thẳng một đơn hộ qua SAL (một lần gọi hợp lệ) rồi trả mã đơn; dùng cho test đọc. */
export async function placed(t: SalApp, u: Who, w: SalWorld, over: Record<string, unknown> = {}): Promise<string> {
  const r = await postOrder(t, u, stdBody(w, over));
  if (r.status !== 201) throw new Error(`dựng đơn hộ thất bại: ${r.status} ${JSON.stringify(r.body)}`);
  return r.body.order.code as string;
}
