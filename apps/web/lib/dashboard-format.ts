// Hàm thuần của dashboard và báo cáo (epic DSH): ngày theo giờ Việt Nam (UTC+7 cố định, tính tay để không phụ thuộc múi giờ của máy), định dạng tiền, phần trăm, mốc. Không React, không `window`,
// không gọi API: test Jest nhập thẳng (DSH-TC-20261006-110331609, DSH-TC-20261006-110407878). `lib/dashboard.ts` dùng lại và thêm hook tải khối.
import { formatPrice } from './format';

export type Granularity = 'day' | 'week' | 'month';

// --- ngày theo giờ Việt Nam
const DAY_MS = 86_400_000, VN_MS = 7 * 3_600_000;
const two = (n: number): string => String(n).padStart(2, '0');
const ymdOf = (d: Date): string => `${d.getUTCFullYear()}-${two(d.getUTCMonth() + 1)}-${two(d.getUTCDate())}`;
/** Hôm nay `YYYY-MM-DD` theo giờ Việt Nam (đồng hồ của trình duyệt chỉ để điền ô nhập; máy chủ mới là nơi quyết định khoảng hợp lệ). */
export const todayYmd = (now: number = Date.now()): string => ymdOf(new Date(now + VN_MS));
export const addDays = (ymd: string, n: number): string => ymdOf(new Date(Date.parse(`${ymd}T00:00:00Z`) + n * DAY_MS));
export const defaultRange = (now?: number): { from: string; to: string } => { const to = todayYmd(now); return { from: addDays(to, -29), to }; };
/** Khoảng đang áp dụng từ URL, đúng cách máy chủ điền tham số thiếu (DSH-API, Quy tắc chung): thiếu `to` là hôm nay, thiếu `from` là `to` trừ 29 ngày; không có tham số nào là `null` (mặc định 30 ngày qua). */
export const appliedRange = (from: string | null, to: string | null, now?: number): { from: string; to: string } | null => {
  if (!from && !to) return null;
  const end = to || todayYmd(now);
  return { from: from || addDays(end, -29), to: end };
};
/** `2026-09-01` thành `01/09/2026`; chuỗi lạ giữ nguyên. */
export const formatYmd = (s: string): string => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s); return m ? `${m[3]}/${m[2]}/${m[1]}` : s; };
export const asOfText = (iso: string | undefined): string => {
  if (!iso) return '';
  const d = new Date(new Date(iso).getTime() + VN_MS);
  return `Cập nhật lúc ${two(d.getUTCHours())}:${two(d.getUTCMinutes())}`;
};
export const money = (n: number): string => formatPrice(n);
export const count = (n: number): string => n.toLocaleString('vi-VN');
/** Phần trăm một chữ số thập phân với dấu phẩy ("15,0%"); `null` là "—" (không bao giờ 0%). */
export const percentText = (v: number | null | undefined): string => (v == null ? '—' : `${v.toFixed(1).replace('.', ',')}%`);
export const moneyOrDash = (v: number | null | undefined): string => (v == null ? '—' : money(v));
export const GRAN_TEXT: Record<Granularity, string> = { day: 'ngày', week: 'tuần', month: 'tháng' };
/** Nhãn mốc: ngày `02/09/2026`, tuần `29/06/2026` (thứ Hai bắt đầu), tháng `09/2026`. */
export const bucketLabel = (g: Granularity, start: string): string => (g === 'month' ? formatYmd(start).slice(3) : formatYmd(start));
export const limitedText = (retryAfter?: number): string => `Thao tác quá nhanh, thử lại sau ${retryAfter ?? 60} giây`;
/** Truy vấn `from`, `to` từ URL; chuỗi rỗng là không đặt (máy chủ dùng 30 ngày qua). */
export function rangeQuery(from: string | null, to: string | null, extra: Record<string, string> = {}): string {
  const p = new URLSearchParams();
  if (from) p.set('from', from);
  if (to) p.set('to', to);
  for (const [k, v] of Object.entries(extra)) p.set(k, v);
  const s = p.toString();
  return s ? `?${s}` : '';
}


export type BlockStatus = 'loading' | 'ready' | 'error' | 'invalid' | 'limited' | 'forbidden';
/** Khối coi là lỗi (không hiện số): lỗi nguồn hoặc mạng, hay bị 429 ngay lần tải đầu khi chưa có số nào để giữ. */
export const failed = (b: { status: BlockStatus; data: unknown }): boolean => b.status === 'error' || (b.status === 'limited' && !b.data);
