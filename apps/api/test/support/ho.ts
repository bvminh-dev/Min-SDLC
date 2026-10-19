import { randomUUID } from 'node:crypto';
import type { CreateHoInput, HoItemInput } from '../../src/modules/order';
import type { Tx } from '../../src/modules/platform';
import { q } from './auth';
import { ADDRESS, type OrdApp } from './ord';
import { who, type Who } from './prd';

/** Đầu vào `createHo` hợp lệ của đợt bán hộ: hai dòng hàng (Áo thun 100000 x 2 ghi chú "size M, màu đen" giá vốn 60000; Quần jean 250000 x 1 giá vốn 150000), 480000 đồng, COD, nguồn `facebook`, ghi chú đơn. */
export const hoItems = (): HoItemInput[] => [
  { product_id: randomUUID(), name_snapshot: 'Áo thun', unit_price: 100000, cost_snapshot: 60000, quantity: 2, note: 'size M, màu đen' },
  { product_id: randomUUID(), name_snapshot: 'Quần jean', unit_price: 250000, cost_snapshot: 150000, quantity: 1, note: null },
];
export const baseHo = (createdBy: string, o: Partial<CreateHoInput> = {}): CreateHoInput => ({
  created_by: createdBy, created_by_role: 'sale', user_id: null, customer_snapshot: { full_name: 'Trần Thị Mai', phone: '0912345678' }, source_code: 'facebook', items: hoItems(),
  items_total: 450000, discount: 0, shipping_fee: 30000, grand_total: 480000, shipping_address: { ...ADDRESS }, shipping_method_id: randomUUID(), payment_method: 'cod', note: 'Khách muốn giao sau 18h', ...o,
});
/** SAL: một giao dịch cam kết khi xong (ném lỗi thì quay lui). */
export const createHo = (t: OrdApp, input: CreateHoInput) => t.tx.run((tx: Tx) => t.ord.createHo(input, tx));
/** Ba người dùng của đợt bán hộ: sale S1, S2 (tên khác nhau để thấy tên người tạo), customer A, B, staff, admin. */
export async function ho(t: OrdApp): Promise<{ s1: Who; s2: Who; a: Who; b: Who; staff: Who; admin: Who }> {
  const s1 = await who(t, 'sale', 's1@x.vn'), s2 = await who(t, 'sale', 's2@x.vn');
  await q(t, `UPDATE users SET full_name = 'Trần Thu' WHERE id = '${s1.id}'`);
  await q(t, `UPDATE users SET full_name = 'Lê Hoa' WHERE id = '${s2.id}'`);
  return { s1, s2, a: await who(t, 'customer', 'a@x.vn'), b: await who(t, 'customer', 'b@x.vn'), staff: await who(t, 'staff', 'staff@shop.vn'), admin: await who(t, 'admin', 'admin@shop.vn') };
}
/** Đưa danh mục nguồn về dữ liệu mồi của migration (website, facebook, tiktok, hotline đều bật, thứ tự 0): trigger bảo vệ tắt tạm bằng phiên superuser của test. */
export async function resetSources(t: OrdApp): Promise<void> {
  for (const sql of [
    'ALTER TABLE order_sources DISABLE TRIGGER USER',
    "DELETE FROM order_sources WHERE code NOT IN ('website', 'facebook', 'tiktok', 'hotline')",
    "UPDATE order_sources SET is_active = true, position = 0, name = CASE code WHEN 'tiktok' THEN 'TikTok' ELSE initcap(code) END",
    'ALTER TABLE order_sources ENABLE TRIGGER USER',
  ]) await q(t, sql);
}
export const sourceId = async (t: OrdApp, code: string): Promise<string> => (await q<{ id: string }>(t, `SELECT id FROM order_sources WHERE code = '${code}'`))[0].id;
