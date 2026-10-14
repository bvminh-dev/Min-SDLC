// Ngày, khoảng ngày và mốc theo giờ Việt Nam (Asia/Ho_Chi_Minh, UTC+7 cố định), không dùng `Date` để tính lịch: năm nhỏ (0 đến 99) bị `Date.UTC` hiểu thành 1900 đến 1999.
// Toàn bộ là hàm thuần để test cả ca biên (ngày nhuận, 00:00 giờ Việt Nam, tuần bắt đầu thứ Hai, 366 ngày).
import { DAY_MS, DEFAULT_RANGE_DAYS, GRANULARITY_DAY_MAX, GRANULARITY_WEEK_MAX, HOUR_MS, CHUNK_HOURS, MAX_RANGE_DAYS, MIN_DATE_NUM, TZ_OFFSET_MS } from './config';

export interface ParamError { field: string; code: string; reason: string }
export const paramError = (field: string, code: string): ParamError => ({ field, code, reason: code }); // `code` là khóa chung của PRJ (ADR-006), `reason` là tên khóa của DSH-API
export type Granularity = 'day' | 'week' | 'month';

const pad = (n: number, w: number): string => String(n).padStart(w, '0');
const isLeap = (y: number): boolean => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
const daysIn = (y: number, m: number): number => [31, isLeap(y) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1];
const mod = (a: number, b: number): number => ((a % b) + b) % b;

/** Số ngày kể từ 1970-01-01 của ngày lịch (thuật toán `days_from_civil`, đúng với mọi năm kể cả âm). */
export function dayNum(y: number, m: number, d: number): number {
  const yy = m <= 2 ? y - 1 : y;
  const era = Math.floor(yy / 400);
  const yoe = yy - era * 400;
  const doy = Math.floor((153 * (m + (m > 2 ? -3 : 9)) + 2) / 5) + d - 1;
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
  return era * 146097 + doe - 719468;
}
export function civil(n: number): { y: number; m: number; d: number } {
  const z = n + 719468;
  const era = Math.floor(z / 146097);
  const doe = z - era * 146097;
  const yoe = Math.floor((doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365);
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
  const mp = Math.floor((5 * doy + 2) / 153);
  const m = mp + (mp < 10 ? 3 : -9);
  return { y: yoe + era * 400 + (m <= 2 ? 1 : 0), m, d: doy - Math.floor((153 * mp + 2) / 5) + 1 };
}
export const fmt = (n: number): string => { const { y, m, d } = civil(n); return `${pad(y, 4)}-${pad(m, 2)}-${pad(d, 2)}`; };
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
/** `YYYY-MM-DD` hợp lệ theo lịch (có ngày nhuận) thành số ngày; sai dạng hoặc ngày không có (2026-02-30, 2026-13-01) thì `null`. */
export function parseDate(s: string): number | null {
  const m = DATE_RE.exec(s);
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (mo < 1 || mo > 12 || d < 1 || d > daysIn(y, mo)) return null;
  return dayNum(y, mo, d);
}
/** Ngày (số ngày kể từ 1970) của một thời điểm theo giờ Việt Nam. */
export const ictDayOf = (ms: number): number => Math.floor((ms + TZ_OFFSET_MS) / DAY_MS);
/** Thời điểm UTC (mili giây) của 00:00 giờ Việt Nam của ngày `n`. */
export const dayStartUtcMs = (n: number): number => n * DAY_MS - TZ_OFFSET_MS;
export const todayNum = (now: Date): number => ictDayOf(now.getTime());

export interface DateRange { from: string; to: string; fromNum: number; toNum: number; days: number; fromUtc: Date; toUtc: Date }
const rangeOf = (fromNum: number, toNum: number): DateRange => ({
  from: fmt(fromNum), to: fmt(toNum), fromNum, toNum, days: toNum - fromNum + 1,
  fromUtc: new Date(dayStartUtcMs(fromNum)), toUtc: new Date(dayStartUtcMs(toNum + 1)), // nửa mở [from 00:00, to + 1 ngày 00:00) theo giờ Việt Nam
});

/** `from`, `to`: mỗi tham số sai thì có một phần tử lỗi mang đúng tên tham số; thiếu tham số thì nhận mặc định (DSH-API, Quy tắc chung). */
export function resolveRange(q: Record<string, unknown>, now: Date, errors: ParamError[]): DateRange | null {
  const today = todayNum(now);
  const read = (field: 'from' | 'to'): number | undefined | null => {
    const v = q[field];
    if (v === undefined) return undefined;
    if (typeof v !== 'string') { errors.push(paramError(field, 'invalid_value')); return null; }
    const n = parseDate(v);
    if (n === null) { errors.push(paramError(field, DATE_RE.test(v) ? 'invalid_date' : 'invalid_format')); return null; }
    if (n < MIN_DATE_NUM) { errors.push(paramError(field, 'too_early')); return null; }
    return n;
  };
  const f = read('from'), t = read('to');
  if (f === null || t === null) return null;
  const toNum = t ?? today;
  if (t !== undefined && toNum > today) { errors.push(paramError('to', 'after_today')); return null; }
  const fromNum = f ?? toNum - (DEFAULT_RANGE_DAYS - 1);
  if (fromNum < MIN_DATE_NUM) { errors.push(paramError('from', 'too_early')); return null; }
  if (fromNum > toNum) { errors.push(paramError('from', 'from_after_to')); return null; }
  if (toNum - fromNum + 1 > MAX_RANGE_DAYS) { errors.push(paramError('from', 'range_too_long')); return null; }
  return rangeOf(fromNum, toNum);
}

/** Độ mịn theo số ngày gồm hai đầu (DSH-REQ-20261006-105126271 BR3): 1 đến 31 `day`, 32 đến 92 `week`, từ 93 `month`. */
export const granularityOf = (days: number): Granularity => (days <= GRANULARITY_DAY_MAX ? 'day' : days <= GRANULARITY_WEEK_MAX ? 'week' : 'month');

/** Ngày bắt đầu của mốc chứa ngày `n`: `day` là chính nó, `week` là thứ Hai (1970-01-01 là thứ Năm), `month` là ngày 1. */
export function bucketStart(g: Granularity, n: number): number {
  if (g === 'day') return n;
  if (g === 'week') return n - mod(n + 3, 7);
  const { y, m } = civil(n);
  return dayNum(y, m, 1);
}
/** Mọi mốc từ ngày `fromNum` tới `toNum`, kể cả mốc không có giao dịch (trục thời gian liên tục); mốc đầu có thể bắt đầu trước `fromNum`. */
export function bucketList(g: Granularity, fromNum: number, toNum: number): number[] {
  const out: number[] = [];
  if (g === 'month') {
    let { y, m } = civil(fromNum);
    for (let s = dayNum(y, m, 1); s <= toNum; s = dayNum(y, m, 1)) { out.push(s); m += 1; if (m > 12) { m = 1; y += 1; } }
    return out;
  }
  const step = g === 'day' ? 1 : 7;
  for (let s = bucketStart(g, fromNum); s <= toNum; s += step) out.push(s);
  return out;
}

/** Khoảng [from, to) chia thành các đoạn tối đa `CHUNK_HOURS` giờ để mỗi lời gọi nguồn theo giờ UTC dưới trần 1000 mốc (giờ Việt Nam lệch UTC đúng 7 giờ nên ranh giới ngày trùng ranh giới giờ). */
export function hourChunks(from: Date, to: Date): { from: Date; to: Date }[] {
  const out: { from: Date; to: Date }[] = [];
  const step = CHUNK_HOURS * HOUR_MS;
  for (let s = from.getTime(); s < to.getTime(); s += step) out.push({ from: new Date(s), to: new Date(Math.min(s + step, to.getTime())) });
  return out;
}

/** Bỏ phần mili giây `.000` (as_of, created_at theo dạng của DSH-API: `2026-10-06T03:00:00Z`). */
export const isoZ = (d: Date | string): string => (typeof d === 'string' ? d : d.toISOString()).replace(/\.000Z$/, 'Z');
