import { MAX_MONEY } from './config';

export interface DiscountRule { type: 'percentage' | 'fixed'; value: number; max_discount: number | null }

/**
 * Tiền giảm bằng số nguyên VND (PRM-REQ ...352, ...376; PRM-API mục Công thức tiền giảm), tính bằng BigInt để không tràn và không bao giờ dùng số thực:
 * percentage = min(floor(subtotal * value / 100), max_discount nếu có, subtotal); fixed = min(value, subtotal). Không bao giờ vượt tạm tính nên tổng không âm.
 * Kết quả < 1 là "không giảm" (bên gọi trả `no_discount`); `subtotal` phải là số nguyên 1..MAX_MONEY (đã kiểm ở bên gọi).
 */
export function discountOf(rule: DiscountRule, subtotal: number): number {
  const s = BigInt(subtotal);
  let d = rule.type === 'percentage' ? (s * BigInt(rule.value)) / 100n : BigInt(rule.value); // BigInt chia cắt phần thập phân (xuống đồng với số không âm)
  if (rule.type === 'percentage' && rule.max_discount !== null && d > BigInt(rule.max_discount)) d = BigInt(rule.max_discount);
  if (d > s) d = s;
  return Number(d);
}

/** `items_subtotal` hợp lệ: số nguyên 1..1.000.000.000 (trần của CHECK `amount`, PRM-REQ ...352 BR7). */
export const isSubtotal = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= MAX_MONEY;
