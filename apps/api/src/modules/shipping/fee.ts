import { z } from 'zod';

/** Chuẩn hóa tên thành phố để so khớp (SHP-DB mục Bảng): bỏ khoảng trắng đầu cuối, gộp khoảng trắng, chữ thường, bỏ dấu (NFD) và `đ` thành `d`. */
export const normalizeCity = (s: string): string =>
  s.trim().replace(/\s+/gu, ' ').toLowerCase().normalize('NFD').replace(/\p{M}/gu, '').replace(/đ/gu, 'd');

/** Cấu trúc `rule` đọc lại từ CSDL trước khi tính (SHP-SEC T6): sai kiểu thì ném, không tính phí bằng dữ liệu hỏng. */
const stored = z.object({
  free_over: z.number().int().min(0).nullable(), surcharge: z.number().int().min(0), surcharge_cities: z.array(z.string()),
}).strict();
export type StoredRule = z.infer<typeof stored>;
export const readRule = (json: unknown): StoredRule => stored.parse(json);

/** Công thức phí (SHP-API, quote): `subtotal >= free_over` thì 0, ngược lại `base_fee` cộng `surcharge` nếu `city` khớp danh sách sau chuẩn hóa. Số nguyên đồng. */
export function computeFee(baseFee: number, rule: StoredRule, city: string, subtotal: number): { fee: number; free_shipping: boolean } {
  if (rule.free_over !== null && subtotal >= rule.free_over) return { fee: 0, free_shipping: true };
  const c = normalizeCity(city);
  const surcharged = rule.surcharge > 0 && rule.surcharge_cities.some((x) => normalizeCity(x) === c);
  return { fee: baseFee + (surcharged ? rule.surcharge : 0), free_shipping: false };
}
