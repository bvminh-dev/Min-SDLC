'use client';
// Coupon (epic PRM): kiểu dữ liệu và định dạng dùng chung hai màn quản trị `admin-coupon-list` và `admin-coupon-edit`.
// Giờ hiển thị và nhập là Asia/Ho_Chi_Minh (UTC+7, không có giờ mùa hè), API trả và nhận UTC (PRM-REQ-20261006-101036424 BR1, questions.md câu 8).
export type CouponStatus = 'active' | 'disabled' | 'expired' | 'exhausted';
export interface Coupon {
  id: string; code: string; type: 'percentage' | 'fixed'; value: number; min_order_value: number; max_discount: number | null; expires_at: string; usage_limit: number;
  per_user_limit: number | null; consumed_count: number; reserved_count: number; remaining: number; status: CouponStatus; version: number; created_at: string; updated_at?: string;
}
export const STATUS_LABEL: Record<CouponStatus, string> = { active: 'Đang chạy', disabled: 'Đã tắt', expired: 'Hết hạn', exhausted: 'Hết lượt' };
export const FILTERS: [CouponStatus | '', string][] = [['', 'Tất cả'], ['active', 'Đang chạy'], ['disabled', 'Đã tắt'], ['expired', 'Hết hạn'], ['exhausted', 'Hết lượt']];

const VN_OFFSET_MS = 7 * 3600_000;
const pad = (n: number): string => String(n).padStart(2, '0');
/** `13/10/2026 23:59` theo giờ Việt Nam. */
export const formatVn = (iso: string): string => {
  const d = new Date(new Date(iso).getTime() + VN_OFFSET_MS);
  return `${pad(d.getUTCDate())}/${pad(d.getUTCMonth() + 1)}/${d.getUTCFullYear()} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
};
/** UTC ISO sang giá trị của `<input type="datetime-local">` (giờ Việt Nam). */
export const toLocalInput = (iso: string): string => new Date(new Date(iso).getTime() + VN_OFFSET_MS).toISOString().slice(0, 16);
/** Giá trị `datetime-local` (giờ Việt Nam) sang UTC ISO; `null` khi rỗng hay sai dạng. */
export const fromLocalInput = (v: string): string | null => {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(v)) return null;
  const d = new Date(`${v}:00+07:00`);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
};
export const money = (n: number): string => `${n.toLocaleString('vi-VN')} đ`;
export const num = (n: number): string => n.toLocaleString('vi-VN');
/** Số nguyên không âm từ chuỗi nhập (chỉ chữ số, tối đa 10); `null` nếu rỗng hay sai dạng. */
export const parseInt0 = (s: string): number | null => (/^\d{1,10}$/.test(s.trim()) ? Number(s.trim()) : null);

/** "10% tối đa 50.000 đ, từ 200.000 đ" hoặc "50.000 đ" (cột Giảm của danh sách). */
export const describeDiscount = (c: Pick<Coupon, 'type' | 'value' | 'max_discount' | 'min_order_value'>): string =>
  `${c.type === 'percentage' ? `${c.value}%` : money(c.value)}${c.max_discount ? ` tối đa ${money(c.max_discount)}` : ''}${c.min_order_value > 0 ? `, từ ${money(c.min_order_value)}` : ''}`;
/** Coupon Đang chạy hoặc Đã tắt đã quá hạn mà job chưa chuyển Hết hạn (job chạy mỗi phút): nguồn đúng là máy chủ khi dùng. */
export const isOverdue = (c: Pick<Coupon, 'status' | 'expires_at'>, now = Date.now()): boolean => (c.status === 'active' || c.status === 'disabled') && new Date(c.expires_at).getTime() <= now;
