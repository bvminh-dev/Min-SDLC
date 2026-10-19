import { DomainError } from '../platform';
import { TOP_LIMIT_DEFAULT, TOP_LIMIT_MAX, type Block } from './config';
import { paramError, resolveRange, type DateRange, type ParamError } from './range';

export interface Params { range?: DateRange; sort?: 'units' | 'amount'; limit?: number; format?: 'csv' }

const RANGED: readonly Block[] = ['revenue', 'orders', 'customers', 'report-revenue', 'report-orders', 'report-products', 'report-sources', 'report-sales'];
/** Tham số cho phép của từng khối (DSH-API, bảng Endpoint): tham số ngoài danh sách là 400, kể cả endpoint không nhận tham số nào. */
const ALLOWED: Record<Block, readonly string[]> = {
  revenue: ['from', 'to'], orders: ['from', 'to'], customers: ['from', 'to'], products: [], 'low-stock': [], 'recent-orders': [],
  'report-revenue': ['from', 'to'], 'report-orders': ['from', 'to'], 'report-products': ['from', 'to', 'sort', 'limit'], 'report-sources': ['from', 'to', 'format'], 'report-sales': ['from', 'to', 'format'],
};
const SAFE_FIELD = /^[A-Za-z0-9_.[\]-]{1,64}$/;

/**
 * Kiểm schema chặt ở biên API (SB-11, T3): từ chối tham số lạ, ngày sai lịch, khoảng đảo, quá 366 ngày, sau hôm nay, `sort`, `limit` sai; mọi lỗi 400 `invalid-parameter` kèm tên tham số sai, không lặp lại giá trị
 * client gửi. Đọc `Object.keys` của chính truy vấn (không qua zod): khóa `__proto__` là tham số lạ như mọi khóa khác chứ không bị bỏ qua âm thầm. Chạy TRƯỚC mọi lời gọi nguồn.
 */
export function parseParams(block: Block, raw: Record<string, unknown>, now: Date): Params {
  const errors: ParamError[] = [];
  const allowed = ALLOWED[block];
  const keys = Object.keys(raw ?? {});
  for (const k of keys) if (!allowed.includes(k)) errors.push(paramError(SAFE_FIELD.test(k) ? k : '(parameter)', 'unknown_parameter'));
  const out: Params = {};
  if (RANGED.includes(block)) {
    const r = resolveRange(Object.fromEntries(allowed.filter((k) => k === 'from' || k === 'to').map((k) => [k, (raw as Record<string, unknown>)[k]])), now, errors);
    if (r) out.range = r;
  }
  if (block === 'report-products') {
    const s = raw.sort;
    if (s === undefined) out.sort = 'units';
    else if (s === 'units' || s === 'amount') out.sort = s;
    else errors.push(paramError('sort', 'invalid_value'));
    const l = raw.limit;
    if (l === undefined) out.limit = TOP_LIMIT_DEFAULT;
    else if (typeof l !== 'string' || !/^(0|[1-9]\d*)$/.test(l)) errors.push(paramError('limit', 'not_integer'));
    else if (l.length > 3 || Number(l) < 1 || Number(l) > TOP_LIMIT_MAX) errors.push(paramError('limit', 'out_of_range'));
    else out.limit = Number(l);
  }
  if (block === 'report-sources' || block === 'report-sales') {
    const f = raw.format; // chỉ đúng `csv` hoặc vắng mặt; lặp tham số (mảng), chuỗi rỗng, giá trị lạ đều `invalid_value` (SB-11, T20)
    if (f === 'csv') out.format = 'csv';
    else if (f !== undefined) errors.push(paramError('format', 'invalid_value'));
  }
  if (errors.length) throw new DomainError('invalid-parameter', { errors });
  return out;
}

/** Khóa đệm: tên khối cộng TOÀN BỘ tham số đã chuẩn hóa (T7): hai khoảng ngày, hai `sort` hay hai `limit` khác nhau không bao giờ dùng chung một mục. */
export const cacheKey = (block: Block, p: Params): string => [block, p.range?.from ?? '-', p.range?.to ?? '-', p.sort ?? '-', p.limit ?? '-'].join(':');
