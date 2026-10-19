// Dựng tệp CSV của hai báo cáo tính lương (DSH-REQ-20261015-092608812 BR8, DSH-REQ-20261015-092608849 BR8, DSH-API mục Xuất CSV): hàm thuần, chạy ở server từ CÙNG bản đệm với JSON.
// UTF-8 có BOM, dấu phẩy, CRLF, RFC 4180; ô chữ là đầu vào không tin cậy (tên nguồn do admin đặt, họ tên sale do người dùng nhập) nên thoát công thức (cùng nguyên tắc SB-43 với tệp nhập).

const BOM = '\uFEFF';
const FORMULA_LEAD = /^[=+\-@\t\r]/;
const LONE_SURROGATE = /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/g;

/** Một ô chữ: bỏ NUL và nửa cặp thay thế lẻ (để tệp luôn là UTF-8 hợp lệ), thêm `'` trước ký tự đầu `=`, `+`, `-`, `@`, tab, CR, rồi bao nháy kép (nhân đôi nháy trong ô) nếu có dấu phẩy, nháy kép, CR, LF. */
export function csvText(v: string): string {
  let s = v.split('\u0000').join('').replace(LONE_SURROGATE, '\uFFFD');
  if (FORMULA_LEAD.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
/** Ô số: số nguyên VND in thẳng, không dấu phân nghìn, không thoát (không bao giờ là chữ). */
const csvInt = (n: number): string => String(Math.trunc(Number(n)));

type Cell = string | number;
const line = (cells: Cell[]): string => cells.map((c) => (typeof c === 'number' ? csvInt(c) : csvText(c))).join(',');
const file = (header: string[], rows: Cell[][], total: Cell[]): string => BOM + [header, ...rows, total].map(line).join('\r\n') + '\r\n';

interface Totals { orders: number; revenue: number }
interface SourceRow { code: string; name: string; orders: number; revenue: number }
interface SaleRow { user_id: string; name: string; orders: number; revenue: number }

/** `Mã nguồn,Tên nguồn,Số đơn,Doanh thu`, các dòng nguồn theo thứ tự của JSON, dòng `Tổng` lấy từ `totals`. Trả thêm số dòng dữ liệu (không tính tiêu đề, `Tổng`) cho audit. */
export function sourcesCsv(items: SourceRow[], totals: Totals): { text: string; rows: number } {
  return { text: file(['Mã nguồn', 'Tên nguồn', 'Số đơn', 'Doanh thu'], items.map((i) => [i.code, i.name, i.orders, i.revenue]), ['Tổng', '', totals.orders, totals.revenue]), rows: items.length };
}
/** `Người tạo đơn,Mã người dùng,Số đơn,Doanh thu`, các dòng `items`, dòng website (ô mã trống), dòng `Tổng`. */
export function salesCsv(items: SaleRow[], website: { name: string; orders: number; revenue: number }, totals: Totals): { text: string; rows: number } {
  const rows: Cell[][] = [...items.map((i) => [i.name, i.user_id, i.orders, i.revenue]), [website.name, '', website.orders, website.revenue]];
  return { text: file(['Người tạo đơn', 'Mã người dùng', 'Số đơn', 'Doanh thu'], rows, ['Tổng', '', totals.orders, totals.revenue]), rows: rows.length };
}
