import { Unzip, UnzipInflate } from 'fflate';
import { IMPORT_MAX_UNCOMPRESSED, IMPORT_SHEET_MAX_CELLS, IMPORT_SHEET_MAX_COL, IMPORT_SHEET_MAX_ROW } from './config';

/**
 * Đọc tệp import sản phẩm (ADR-025, PRD-REQ-20261015-092431191 BR3, BR4, BR8; SB-43): .xlsx hoặc .csv thành bảng ô, không diễn giải công thức, không tải gì từ nội dung tệp.
 * Thư viện giải nén: `fflate` 0.8.3 (MIT, không phụ thuộc gói nào); phần đọc xlsx tự viết trên XML chuỗi (không DTD, không thực thể tự định nghĩa, không liên kết ngoài).
 * ponytail: chạy trên luồng chính; trần 5 MB, 50 MB giải nén và 20 yêu cầu mỗi giờ mỗi admin chặn lạm dụng, chuyển sang worker khi cần.
 */
export type ImportReason = 'unsupported_type' | 'too_large' | 'too_many_rows' | 'macro' | 'uncompressed_too_large' | 'header_invalid' | 'corrupt' | 'bad_form';
export class ImportFileError extends Error {
  /** `inflated`: số byte đã giải nén khi dừng (chỉ log, để đo việc dừng ngay khi vượt trần). */
  constructor(readonly reason: ImportReason, readonly missing?: string[], readonly inflated?: number) { super(reason); }
}

/** Ô đã đọc: `formula` là ô công thức của xlsx (không bao giờ lấy giá trị), `num` là ô số, `text` là ô chữ (CSV chỉ có chữ). */
export type Cell = { t: 'empty' } | { t: 'text'; s: string } | { t: 'num'; n: number } | { t: 'formula' };
export interface ImportTable { headers: string[]; rows: { row: number; cells: Cell[] }[] }

const EMPTY: Cell = { t: 'empty' };
export const REQUIRED_HEADERS = ['Mã hàng', 'Tên hàng'] as const;
const norm = (s: string): string => s.normalize('NFC').trim().toLowerCase();

/** Điểm vào: kiểm phần mở rộng, nội dung thật, giải nén có trần, rồi trả bảng (dòng tiêu đề tách riêng, dòng trống bị bỏ, số dòng dữ liệu <= `maxRows`). */
export function parseImportFile(buf: Buffer, filename: string, maxRows: number): ImportTable {
  const ext = /\.(xlsx|csv)$/i.exec(filename)?.[1].toLowerCase();
  if (!ext) throw new ImportFileError('unsupported_type'); // .xls, .xlsm và mọi loại khác
  if (buf.length === 0) throw new ImportFileError('corrupt');
  const raw = ext === 'xlsx' ? readXlsx(buf, maxRows) : readCsv(buf, maxRows);
  return toTable(raw);
}

interface RawRow { row: number; cells: Cell[] }
const blank = (cells: Cell[]): boolean => cells.every((c) => c.t === 'empty' || (c.t === 'text' && c.s.trim() === ''));

function toTable(raw: RawRow[]): ImportTable {
  const head = raw[0];
  if (!head) throw new ImportFileError('header_invalid', [...REQUIRED_HEADERS]);
  const headers = head.cells.map((c) => (c.t === 'text' ? c.s.trim() : c.t === 'num' ? String(c.n) : ''));
  const have = new Set(headers.map(norm));
  const missing = REQUIRED_HEADERS.filter((h) => !have.has(norm(h)));
  if (missing.length) throw new ImportFileError('header_invalid', missing);
  return { headers, rows: raw.slice(1) };
}

// ---------------------------------------------------------------- CSV
function readCsv(buf: Buffer, maxRows: number): RawRow[] {
  if (buf.includes(0)) throw new ImportFileError('unsupported_type');
  let text: string;
  try { text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(buf); } catch { throw new ImportFileError('unsupported_type'); }
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const firstLine = text.slice(0, Math.max(0, text.search(/\r|\n/)) || text.length);
  const delim = (firstLine.match(/;/g)?.length ?? 0) > (firstLine.match(/,/g)?.length ?? 0) ? ';' : ',';
  const rows: RawRow[] = [];
  let line = 1, i = 0, data = 0;
  const n = text.length;
  while (i < n) {
    const startLine = line;
    const cells: string[] = [];
    for (;;) {
      let v = '';
      if (text[i] === '"') {
        i++;
        for (;;) {
          if (i >= n) break;
          if (text[i] === '"') { if (text[i + 1] === '"') { v += '"'; i += 2; continue; } i++; break; }
          if (text[i] === '\n') line++;
          v += text[i++];
        }
        while (i < n && text[i] !== delim && text[i] !== '\n' && text[i] !== '\r') v += text[i++]; // rác sau dấu nháy đóng: giữ lại, không bỏ im lặng
      } else {
        while (i < n && text[i] !== delim && text[i] !== '\n' && text[i] !== '\r') v += text[i++];
      }
      cells.push(v);
      if (text[i] === delim) { i++; continue; }
      break;
    }
    if (text[i] === '\r') i++;
    if (text[i] === '\n') { i++; line++; }
    const cs: Cell[] = cells.map((s) => (s === '' ? EMPTY : { t: 'text', s }));
    if (!blank(cs)) {
      if (rows.length > 0 && ++data > maxRows) throw new ImportFileError('too_many_rows');
      rows.push({ row: startLine, cells: cs });
    }
  }
  return rows;
}

// ---------------------------------------------------------------- XLSX
const concat = (parts: Uint8Array[]): Uint8Array => {
  const out = new Uint8Array(parts.reduce((s, p) => s + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
};
const SLICE = 4096; // đẩy từng mảnh nhỏ: một mảnh giải nén ra tối đa ~4 MB (tỷ lệ deflate <= 1032:1), bộ nhớ không vượt trần quá một đệm nhỏ
const KEEP = /^xl\/(workbook\.xml|_rels\/workbook\.xml\.rels|sharedStrings\.xml|worksheets\/[^/]+\.xml)$/i;

/** Giải nén streaming: dừng NGAY khi tổng byte giải nén vượt trần (không giải nén hết rồi mới đo), nhận diện macro, chỉ giữ các phần cần đọc. */
function unzip(buf: Buffer): Map<string, string> {
  const kept = new Map<string, Uint8Array>();
  let total = 0, macro = false;
  let failure = null as ImportFileError | null; // gán trong callback của fflate: ép kiểu để TS không thu hẹp về null
  const zip = new Unzip((f) => {
    if (failure) return;
    if (/(^|\/)vbaProject\.bin$/i.test(f.name)) macro = true;
    const keep = KEEP.test(f.name);
    const chunks: Uint8Array[] = [];
    f.ondata = (err, data, final) => {
      if (failure) return;
      if (err) { failure = new ImportFileError('corrupt'); return; }
      total += data.length;
      if (total > IMPORT_MAX_UNCOMPRESSED) { failure = new ImportFileError('uncompressed_too_large', undefined, total); f.terminate(); return; }
      if (keep) chunks.push(data);
      if (final && keep) kept.set(f.name, concat(chunks));
    };
    f.start();
  });
  zip.register(UnzipInflate);
  try {
    for (let o = 0; o < buf.length && !failure; o += SLICE) zip.push(buf.subarray(o, Math.min(o + SLICE, buf.length)), o + SLICE >= buf.length);
  } catch { throw failure ?? new ImportFileError('corrupt'); }
  if (failure) throw failure;
  if (macro) throw new ImportFileError('macro');
  const dec = new TextDecoder('utf-8');
  return new Map([...kept].map(([k, v]) => [k.toLowerCase(), dec.decode(v)]));
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
// ST_Xstring của OOXML: `_x000D_` là ký tự U+000D (ký tự điều khiển giấu trong chuỗi vẫn bị kiểm công thức và ký tự điều khiển).
const decode = (s: string): string => s
  .replace(/&(?:#(\d+)|#x([0-9a-fA-F]+)|(amp|lt|gt|quot|apos));/g, (_m, d: string, h: string, e: string) => {
    if (e) return ENTITIES[e];
    const cp = d ? Number(d) : parseInt(h, 16);
    return cp <= 0x10ffff ? String.fromCodePoint(cp) : '�';
  })
  .replace(/_x([0-9a-fA-F]{4})_/g, (_m, h: string) => String.fromCharCode(parseInt(h, 16)));
const attr = (a: string, name: string): string | undefined => new RegExp(`(?:^|\\s)${name}="([^"]*)"`).exec(a)?.[1];

/**
 * Quét TUYẾN TÍNH các phần tử `<name ...>...</name>` hoặc `<name .../>` bằng indexOf (không regex lười `[\s\S]*?`: thẻ mở không đóng làm regex chạy bình phương, SB-43).
 * Thẻ mở mà không tìm thấy `>` hay thẻ đóng là tệp hỏng (`corrupt`). `from`, `to`: vị trí của phần tử trong chuỗi gốc.
 */
function* elements(xml: string, name: string): Generator<{ attrs: string; inner: string; from: number; to: number }> {
  const open = `<${name}`, close = `</${name}>`;
  for (let i = 0; ;) {
    i = xml.indexOf(open, i);
    if (i < 0) return;
    const c = xml.charCodeAt(i + open.length); // sau tên phải là khoảng trắng, > hoặc /: `<c` không khớp `<cols`
    if (c !== 62 && c !== 47 && c !== 32 && c !== 9 && c !== 10 && c !== 13) { i += open.length; continue; }
    const gt = xml.indexOf('>', i + open.length);
    if (gt < 0) throw new ImportFileError('corrupt');
    if (xml.charCodeAt(gt - 1) === 47) { yield { attrs: xml.slice(i + open.length, gt - 1), inner: '', from: i, to: gt + 1 }; i = gt + 1; continue; }
    const end = xml.indexOf(close, gt + 1);
    if (end < 0) throw new ImportFileError('corrupt');
    yield { attrs: xml.slice(i + open.length, gt), inner: xml.slice(gt + 1, end), from: i, to: end + close.length };
    i = end + close.length;
  }
}
const first = (xml: string, name: string): { attrs: string; inner: string } | undefined => elements(xml, name).next().value;
const withoutPhonetic = (xml: string): string => { let out = '', last = 0; for (const e of elements(xml, 'rPh')) { out += xml.slice(last, e.from); last = e.to; } return out + xml.slice(last); };
const textOf = (xml: string): string => { let s = ''; for (const e of elements(withoutPhonetic(xml), 't')) s += decode(e.inner); return s; };

function sharedStrings(xml: string | undefined): string[] {
  if (!xml) return [];
  const out: string[] = [];
  for (const e of elements(xml, 'si')) out.push(textOf(e.inner));
  return out;
}

/** Trang tính đầu tiên theo thứ tự trong workbook.xml (không theo tên tệp). */
function firstSheetPath(files: Map<string, string>): string {
  const wb = files.get('xl/workbook.xml');
  if (!wb) throw new ImportFileError('corrupt');
  const sheet = first(wb, 'sheet')?.attrs;
  const rid = sheet && /(?:^|\s)r:id="([^"]*)"/.exec(sheet)?.[1];
  const rels = files.get('xl/_rels/workbook.xml.rels') ?? '';
  let target: string | undefined;
  for (const m of elements(rels, 'Relationship')) if (attr(m.attrs, 'Id') === rid) target = attr(m.attrs, 'Target');
  if (!target) throw new ImportFileError('corrupt');
  const path = (target.startsWith('/') ? target.slice(1) : `xl/${target}`).toLowerCase();
  if (!files.has(path)) throw new ImportFileError('corrupt');
  return path;
}

/** Chỉ số cột (A = 0) từ tham chiếu ô; -1 nếu không có chữ cột. Cột dài bất thường (`ZZZZZZ2`) không làm gì ngoài số lớn: nơi gọi so với `IMPORT_SHEET_MAX_COL` trước khi cấp mảng. */
const colIndex = (ref: string): number => {
  const letters = /^[A-Za-z]+/.exec(ref)?.[0];
  if (!letters) return -1;
  if (letters.length > 3) return Infinity; // quá XFD (cột cuối của Excel)
  let n = 0;
  for (const ch of letters) n = n * 26 + ch.toUpperCase().charCodeAt(0) - 64;
  return n - 1;
};

function readXlsx(buf: Buffer, maxRows: number): RawRow[] {
  if (!(buf.length >= 4 && buf[0] === 0x50 && buf[1] === 0x4b && buf[2] === 3 && buf[3] === 4)) throw new ImportFileError('unsupported_type'); // chữ ký zip PK\x03\x04, không tin đuôi hay Content-Type
  const files = unzip(buf);
  const xml = files.get(firstSheetPath(files))!;
  const sst = sharedStrings(files.get('xl/sharedstrings.xml'));
  // Chiều khai quá số dòng tối đa của Excel là tệp giả: từ chối trước khi quét (PRD-TC-20261015-093100429).
  const dim = /(\d+)$/.exec(attr(first(xml, 'dimension')?.attrs ?? '', 'ref') ?? '');
  if (dim && Number(dim[1]) > IMPORT_SHEET_MAX_ROW) throw new ImportFileError('too_many_rows');
  const rows: RawRow[] = [];
  const maxRowTags = Math.min(IMPORT_SHEET_MAX_ROW, (maxRows + 1) * 10); // trần SỐ thẻ <row> (kể cả dòng trống có định dạng) và SỐ ô: tệp nhỏ không được bắt vòng đọc chạy lâu
  let seq = 0, data = 0, rowTags = 0, cellTags = 0;
  for (const rm of elements(xml, 'row')) {
    if (++rowTags > maxRowTags) throw new ImportFileError('too_many_rows');
    seq = Number(attr(rm.attrs, 'r')) || seq + 1;
    const cells: Cell[] = [];
    let next = 0;
    for (const cm of elements(rm.inner, 'c')) {
      if (++cellTags > IMPORT_SHEET_MAX_CELLS) throw new ImportFileError('too_many_rows');
      const ref = attr(cm.attrs, 'r');
      const col = ref ? colIndex(ref) : next;
      if (col < 0) throw new ImportFileError('corrupt');
      next = col + 1;
      const cell = cellOf(attr(cm.attrs, 't'), cm.inner, sst);
      if (col >= IMPORT_SHEET_MAX_COL) { if (cell.t !== 'empty') throw new ImportFileError('corrupt'); continue; } // ô dữ liệu ngoài 64 cột là tệp giả; ô trống có định dạng thì bỏ qua
      cells[col] = cell;
    }
    for (let k = 0; k < cells.length; k++) cells[k] ??= EMPTY;
    if (blank(cells)) continue;
    if (rows.length > 0 && ++data > maxRows) throw new ImportFileError('too_many_rows'); // dừng ngay, không phân tích hết các dòng còn lại
    rows.push({ row: seq, cells });
  }
  return rows;
}

function cellOf(t: string | undefined, inner: string, sst: string[]): Cell {
  if (/<f[\s>/]/.test(inner)) return { t: 'formula' }; // ô công thức: không lấy giá trị đã tính (BR8)
  if (t === 'inlineStr') { const s = textOf(first(inner, 'is')?.inner ?? ''); return s === '' ? EMPTY : { t: 'text', s }; }
  const v = first(inner, 'v')?.inner;
  if (v === undefined) return EMPTY;
  if (t === 's') { const s = sst[Number(v)]; return s === undefined || s === '' ? EMPTY : { t: 'text', s }; }
  if (t === 'str' || t === 'e' || t === 'd' || t === 'b') { const s = decode(v); return s === '' ? EMPTY : { t: 'text', s }; }
  const n = Number(v);
  return Number.isNaN(n) ? { t: 'text', s: decode(v) } : { t: 'num', n };
}
