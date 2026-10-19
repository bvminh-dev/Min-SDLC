import { strToU8, zipSync } from 'fflate';
import type { Test } from 'supertest';
import { ORIGIN } from './app';
import { http, type AuthApp } from './auth';

/** Ô xlsx của fixture: chuỗi (chữ), số, `{ f }` (công thức), `null` (trống). */
export type XCell = string | number | { f: string } | null;
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const col = (i: number) => String.fromCharCode(65 + i);
export const KIOT_HEADER = ['Mã hàng', 'Tên hàng', 'Nhóm hàng', 'Giá bán', 'Giá vốn', 'ĐVT', 'Tồn kho'];

function cellXml(v: XCell, ref: string): string {
  if (v === null) return '';
  if (typeof v === 'number') return `<c r="${ref}"><v>${v}</v></c>`;
  if (typeof v === 'string') return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${esc(v)}</t></is></c>`;
  return `<c r="${ref}"><f>${esc(v.f)}</f><v>0</v></c>`; // công thức: kèm giá trị đã tính (bộ đọc không được lấy)
}
/** Tệp .xlsx tối thiểu dựng bằng tay (không qua thư viện bảng tính). `sharedStrings` đưa chữ vào sharedStrings.xml thay vì inline. */
export function xlsx(rows: XCell[][], o: { extra?: Record<string, string | Uint8Array>; dimension?: string; sheetXml?: string; level?: 0 | 6 } = {}): Buffer {
  const sheetRows = rows.map((r, i) => `<row r="${i + 1}">${r.map((v, j) => cellXml(v, `${col(j)}${i + 1}`)).join('')}</row>`).join('');
  const sheet = o.sheetXml ?? `<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${o.dimension ? `<dimension ref="${o.dimension}"/>` : ''}<sheetData>${sheetRows}</sheetData></worksheet>`;
  const files: Record<string, Uint8Array> = {
    '[Content_Types].xml': strToU8('<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/></Types>'),
    '_rels/.rels': strToU8('<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="x" Target="xl/workbook.xml"/></Relationships>'),
    'xl/workbook.xml': strToU8('<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="S1" sheetId="1" r:id="rId1"/><sheet name="S2" sheetId="2" r:id="rId2"/></sheets></workbook>'),
    'xl/_rels/workbook.xml.rels': strToU8('<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="x" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="x" Target="worksheets/sheet2.xml"/></Relationships>'),
    'xl/worksheets/sheet1.xml': strToU8(sheet),
    'xl/worksheets/sheet2.xml': strToU8('<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>TRANG-HAI-KHONG-DOC</t></is></c></row></sheetData></worksheet>'),
  };
  for (const [k, v] of Object.entries(o.extra ?? {})) files[k] = typeof v === 'string' ? strToU8(v) : v;
  return Buffer.from(zipSync(files, { level: o.level ?? 6 }));
}
/** Dòng tiêu đề KiotViet cộng các dòng dữ liệu `[sku, tên, nhóm, giá bán, giá vốn, đvt, tồn]`. */
export const kiot = (data: XCell[][], o: Parameters<typeof xlsx>[1] = {}): Buffer => xlsx([KIOT_HEADER, ...data], o);
export const csv = (lines: string[], o: { bom?: boolean } = {}): Buffer => Buffer.from(`${o.bom ? '﻿' : ''}${lines.join('\r\n')}\r\n`, 'utf8');

export interface ImportOpts { filename?: string; contentType?: string; dryRun?: boolean | null; key?: string | null; origin?: string | null }
let n = 0;
export const newKey = () => `import-key-${String(++n).padStart(6, '0')}-${Math.random().toString(36).slice(2, 10)}`;
/** Gửi tệp import: multipart một phần `file`; `dryRun` mặc định true, `null` là bỏ tham số; xác nhận (false) mặc định kèm Idempotency-Key mới. */
export function importFile(t: AuthApp, cookie: string | undefined, file: Buffer | null, o: ImportOpts = {}): Test {
  const dry = o.dryRun === undefined ? true : o.dryRun;
  let r = http(t).post(`/api/v1/admin/products/import${dry === null ? '' : `?dry_run=${dry}`}`);
  if (cookie) r = r.set('Cookie', cookie);
  if (o.origin !== null) r = r.set('Origin', o.origin ?? ORIGIN);
  const key = o.key === undefined ? (dry === false ? newKey() : null) : o.key;
  if (key) r = r.set('Idempotency-Key', key);
  if (file) r = r.attach('file', file, { filename: o.filename ?? 'hang-moi.xlsx', contentType: o.contentType });
  return r;
}
