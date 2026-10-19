import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createHash } from 'node:crypto';
import type { Request, Response } from 'express';
import {
  AppLogger, AuditService, Clock, ConfigService, DomainError, IdempotencyService, PrismaService, UploadError, isIdempotencyKey, readSingleFile, requestHash, type SessionContext, type Tx,
} from '../platform';
import { COST_MAX } from './config';
import { ImportFileError, parseImportFile, type Cell, type ImportTable } from './import-file';
import { searchTextOf } from './text';

// Cột theo mẫu KiotViet (PRD-REQ-20261015-092431191 BR4). ĐVT, Tồn kho và cột lạ được đọc nhưng không ghi (ADR-025).
const COLS = { sku: 'Mã hàng', name: 'Tên hàng', category: 'Nhóm hàng', price: 'Giá bán', cost: 'Giá vốn' } as const;
const norm = (s: string): string => s.normalize('NFC').trim().toLowerCase();
const KNOWN = new Set(Object.values(COLS).map(norm));
const WRITE_CHUNK = 50; // số dòng mỗi câu ghi (một câu INSERT hoặc UPDATE theo lô, không SAVEPOINT từng dòng: dữ liệu đã kiểm trùng CHECK của DB nên chỉ còn lỗi hạ tầng, hủy cả giao dịch)
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001F\u007F]/;
// nửa cặp thay thế lẻ (PostgreSQL không lưu được): `String.prototype.isWellFormed` chưa có trong lib của TS 5.9
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;
const FORMULA_START = /^[=+\-@\t\r\n]/;
// khoảng trắng Unicode (\s gồm NBSP, U+FEFF), ký tự điều khiển, zero-width và ký tự định hướng chữ đứng đầu ô: bỏ đi trước khi kiểm ký tự công thức (SB-43: ` =cmd`, NBSP+`@x` vẫn là công thức khi mở bằng bảng tính)
// eslint-disable-next-line no-control-regex
const LEADING_BLANK = /^[\s\u0000-\u001F\u007F-\u009F\u00AD\u061C\u180E\u200B-\u200F\u202A-\u202E\u2060-\u2064\u2066-\u2069\uFEFF]+/;
const BAD_TEXT_CODE: Record<string, string> = { sku: 'sku_invalid', name: 'name_invalid', category: 'category_invalid' };
const SKU_RE = /^[A-Za-z0-9_-]{3,40}$/; // kiểm trên chuỗi gốc, TRƯỚC khi viết hoa (ſ, ı, dấu Kelvin không thành ASCII nhờ đổi hoa thường)
const clip = (s: string, n = 64): string => [...s].slice(0, n).join('');

export interface RowError { field: string; code: string; message: string }
export interface ReportRow { row: number; sku: string; action: 'create' | 'update' | 'unchanged' | 'error'; errors: RowError[]; changes?: Record<string, { old: string | number | null; new: string | number | null }> }
export interface ImportReport {
  dry_run: boolean;
  summary: { total_rows: number; created: number; updated: number; unchanged: number; errors: number };
  ignored_columns: string[];
  rows: ReportRow[];
}

interface Existing { id: string; sku: string; version: number; status: string; name: string; category_id: string; price: number; cost_price: number | null }
interface Planned extends ReportRow {
  next?: { name: string; category_id: string; price: number; cost: number | null };
  existing?: Existing;
}
interface Parsed { row: number; sku: string; skuOk: boolean; name?: string; path?: string; price?: number; cost?: number; errors: RowError[] }

interface Tree { roots: Map<string, string>; children: Map<string, Map<string, string>>; names: Map<string, string> }
const buildTree = (rows: { id: string; name: string; parent_id: string | null }[]): Tree => {
  const t: Tree = { roots: new Map(), children: new Map(), names: new Map() };
  for (const c of rows) {
    t.names.set(c.id, c.name);
    if (!c.parent_id) t.roots.set(norm(c.name), c.id);
    else (t.children.get(c.parent_id) ?? t.children.set(c.parent_id, new Map()).get(c.parent_id)!).set(norm(c.name), c.id);
  }
  return t;
};
/** Ghép đường dẫn `A>>B>>C` với cây có sẵn từ gốc xuống (không tạo danh mục): trả id hoặc đoạn đầu tiên không khớp (BR7). */
function matchCategory(path: string, t: Tree): { id: string } | { missing: string } {
  const segs = path.split('>>').map((s) => s.trim());
  let id: string | undefined;
  for (let d = 0; d < segs.length; d++) {
    const key = norm(segs[d]);
    id = d === 0 ? t.roots.get(key) : t.children.get(id!)?.get(key);
    if (!id || d >= 3) return { missing: clip(segs[d], 100) }; // thiếu đoạn nào, đoạn rỗng, hoặc sâu quá 3 cấp
  }
  return { id: id! };
}

const err = (field: string, code: string, label: string, text: string): RowError => ({ field, code, message: `${label}: ${text}` });

/** Đọc ô chữ: công thức, chữ bắt đầu bằng = + - @ tab xuống dòng (kể cả sau khoảng trắng, NBSP, zero-width), chữ có NUL hoặc nửa cặp thay thế lẻ (không lưu được vào jsonb của báo cáo: xác nhận sẽ 500) bị từ chối cả dòng, không lưu giá trị đó (BR8, SB-43, SB-11). */
function textCell(c: Cell | undefined, field: string, label: string, errors: RowError[]): string | undefined {
  if (!c || c.t === 'empty') return undefined;
  if (c.t === 'formula') { errors.push(err(field, 'formula_rejected', label, 'ô công thức không được nhận')); return undefined; }
  const s = c.t === 'num' ? String(c.n) : c.s;
  if (s.includes('\u0000') || LONE_SURROGATE.test(s)) { errors.push(err(field, BAD_TEXT_CODE[field], label, 'chứa ký tự không hợp lệ (NUL hoặc nửa cặp ký tự)')); return undefined; }
  if (FORMULA_START.test(s) || FORMULA_START.test(s.replace(LEADING_BLANK, ''))) { errors.push(err(field, 'formula_rejected', label, 'giá trị bắt đầu bằng ký tự công thức (= + - @ hoặc tab) không được nhận')); return undefined; }
  return s;
}
/** Đọc ô số nguyên thuần min..max: ô xlsx có giá trị nguyên hoặc chữ chỉ gồm chữ số; dấu phân cách, số thập phân, chữ, số âm là lỗi `invalidCode`. */
function numCell(c: Cell | undefined, field: string, label: string, min: number, max: number, invalidCode: string, errors: RowError[]): number | undefined {
  if (!c || c.t === 'empty') return undefined;
  const bad = (): undefined => { errors.push(err(field, invalidCode, label, `không phải số nguyên từ ${min.toLocaleString('vi-VN')} đến ${max.toLocaleString('vi-VN')}`)); return undefined; };
  if (c.t === 'formula') { errors.push(err(field, 'formula_rejected', label, 'ô công thức không được nhận')); return undefined; }
  let n: number;
  if (c.t === 'num') n = c.n;
  else {
    const s = c.s.trim();
    if (s === '') return undefined;
    if (/^[=@]/.test(s)) { errors.push(err(field, 'formula_rejected', label, 'giá trị bắt đầu bằng ký tự công thức không được nhận')); return undefined; }
    if (!/^\d{1,15}$/.test(s)) return bad();
    n = Number(s);
  }
  return Number.isInteger(n) && n >= min && n <= max ? n : bad();
}

/** Bước 1 (chỉ đọc tệp, chưa chạm CSDL): kiểm từng dòng theo quy tắc của tạo, sửa sản phẩm (BR6). Dòng trống đã bị bỏ ở bộ đọc. */
function prepare(t: ImportTable): Parsed[] {
  const idx = new Map<string, number>();
  t.headers.forEach((h, i) => { if (!idx.has(norm(h))) idx.set(norm(h), i); });
  const at = (cells: Cell[], col: string): Cell | undefined => { const i = idx.get(norm(col)); return i === undefined ? undefined : cells[i]; };
  return t.rows.map(({ row, cells }) => {
    const errors: RowError[] = [];
    const rawSku = textCell(at(cells, COLS.sku), 'sku', COLS.sku, errors);
    let sku = clip((rawSku ?? '').trim()), skuOk = false;
    if (rawSku !== undefined) {
      const s = rawSku.trim();
      if (SKU_RE.test(s)) { sku = s.toUpperCase(); skuOk = true; } else errors.push(err('sku', 'sku_invalid', COLS.sku, 'chỉ gồm chữ, số, - và _, dài 3 đến 40 ký tự'));
    } else if (!errors.length) errors.push(err('sku', 'sku_invalid', COLS.sku, 'bắt buộc'));
    let name = textCell(at(cells, COLS.name), 'name', COLS.name, errors);
    if (name !== undefined) {
      name = name.normalize('NFC').trim();
      if (name === '') name = undefined;
      else if (LONE_SURROGATE.test(name) || CONTROL.test(name) || [...name].length > 200) { errors.push(err('name', 'name_invalid', COLS.name, 'tối đa 200 ký tự, không có ký tự điều khiển')); name = undefined; }
    }
    const path = textCell(at(cells, COLS.category), 'category', COLS.category, errors)?.trim() || undefined;
    const price = numCell(at(cells, COLS.price), 'price', COLS.price, 1, 1_000_000_000, 'price_invalid', errors);
    const cost = numCell(at(cells, COLS.cost), 'cost_price', COLS.cost, 0, COST_MAX, 'cost_price_invalid', errors);
    return { row, sku, skuOk, name, path, price, cost, errors };
  });
}

/** Bước 2: quyết định tạo, sửa, không đổi hay lỗi cho từng dòng, theo sản phẩm và danh mục hiện có (BR5, BR7, BR9). */
function decide(parsed: Parsed[], existing: Map<string, Existing>, tree: Tree): Planned[] {
  const first = new Map<string, number>();
  return parsed.map((p): Planned => {
    const errors = [...p.errors];
    const out: Planned = { row: p.row, sku: p.sku, action: 'error', errors };
    if (p.skuOk) {
      const dup = first.get(p.sku);
      if (dup !== undefined) { errors.push(err('sku', 'duplicate_in_file', COLS.sku, `trùng với dòng ${dup}`)); return out; }
      first.set(p.sku, p.row);
    }
    const cur = p.skuOk ? existing.get(p.sku) : undefined;
    if (cur?.status === 'archived') errors.push(err('sku', 'product_archived', COLS.sku, 'sản phẩm đã lưu trữ, không cập nhật được'));
    let categoryId: string | undefined;
    if (p.path !== undefined) {
      const m = matchCategory(p.path, tree);
      if ('id' in m) categoryId = m.id; else errors.push(err('category', 'category_not_found', COLS.category, `không tìm thấy "${m.missing}"`));
    } else if (p.skuOk && !cur && !p.errors.some((e) => e.field === 'category')) errors.push(err('category', 'category_required', COLS.category, 'bắt buộc với sản phẩm mới'));
    if (p.skuOk && !cur) {
      if (p.name === undefined && !p.errors.some((e) => e.field === 'name')) errors.push(err('name', 'name_required', COLS.name, 'bắt buộc với sản phẩm mới'));
      if (p.price === undefined && !p.errors.some((e) => e.field === 'price')) errors.push(err('price', 'price_required', COLS.price, 'bắt buộc với sản phẩm mới'));
    }
    if (errors.length || !p.skuOk) return out;
    if (!cur) { out.action = 'create'; out.next = { name: p.name!, category_id: categoryId!, price: p.price!, cost: p.cost ?? null }; return out; }
    // Ô trống giữ nguyên giá trị hiện có (BR5): import không dùng để xóa giá vốn.
    const next = { name: p.name ?? cur.name, category_id: categoryId ?? cur.category_id, price: p.price ?? cur.price, cost: p.cost ?? cur.cost_price };
    const changes: NonNullable<ReportRow['changes']> = {};
    if (next.name !== cur.name) changes.name = { old: cur.name, new: next.name };
    if (next.category_id !== cur.category_id) changes.category = { old: tree.names.get(cur.category_id) ?? null, new: tree.names.get(next.category_id) ?? null };
    if (next.price !== cur.price) changes.price = { old: cur.price, new: next.price };
    if (next.cost !== cur.cost_price) changes.cost_price = { old: cur.cost_price, new: next.cost };
    out.existing = cur; out.next = next;
    if (Object.keys(changes).length) { out.action = 'update'; out.changes = changes; } else out.action = 'unchanged';
    return out;
  });
}

const summarize = (plan: Planned[]): ImportReport['summary'] => ({
  total_rows: plan.length, created: plan.filter((r) => r.action === 'create').length, updated: plan.filter((r) => r.action === 'update').length,
  unchanged: plan.filter((r) => r.action === 'unchanged').length, errors: plan.filter((r) => r.action === 'error').length,
});
const toReport = (dryRun: boolean, t: ImportTable, plan: Planned[]): ImportReport => ({
  dry_run: dryRun, summary: summarize(plan), ignored_columns: t.headers.filter((h) => h !== '' && !KNOWN.has(norm(h))),
  rows: plan.map(({ row, sku, action, errors, changes }) => ({ row, sku, action, errors, ...(changes ? { changes } : {}) })),
});

type Db = Pick<Tx, '$queryRaw'>;
const loadExisting = async (db: Db, skus: string[], lock: boolean): Promise<Map<string, Existing>> => {
  const rows = await db.$queryRaw<{ id: string; sku: string; version: number; status: string; name: string; category_id: string; price: bigint; cost_price: bigint | null }[]>`
    SELECT id, sku, version, status, name, category_id, price, cost_price FROM products WHERE sku = ANY(${skus}::text[]) ORDER BY sku ${lock ? Prisma.sql`FOR UPDATE` : Prisma.empty}`;
  return new Map(rows.map((r) => [r.sku, { ...r, price: Number(r.price), cost_price: r.cost_price === null ? null : Number(r.cost_price) }]));
};
const loadTree = async (db: Db): Promise<Tree> => buildTree(await db.$queryRaw`SELECT id, name, parent_id FROM categories`);

/**
 * Import sản phẩm .xlsx hoặc .csv (ADR-025, PRD-REQ-20261015-092431191, PRD-DB mục Import): hai bước trên cùng một tệp, `dry_run=true` chỉ đọc, `dry_run=false` ghi các dòng hợp lệ trong MỘT giao dịch.
 * Nội dung ô không bao giờ vào log (SB-42, SB-43): log chỉ có số dòng, mã lỗi và số byte.
 */
@Injectable()
export class ImportService {
  private readonly log: AppLogger;
  constructor(
    private readonly prisma: PrismaService, private readonly idem: IdempotencyService, private readonly audit: AuditService, private readonly clock: Clock,
    private readonly config: ConfigService, logger: AppLogger,
  ) {
    this.log = logger.for('catalog');
  }

  /** Đọc thân multipart có trần byte (dừng đọc ngay khi vượt) rồi phân tích tệp; mọi lỗi tệp là 400 `import-file-invalid` kèm `reason`, trước khi xử lý dòng nào. */
  private async read(req: Request, res: Response): Promise<{ table: ImportTable; hash: string; filename: string }> {
    let bytes = 0;
    try {
      const { file, filename } = await readSingleFile(req, res, this.config.get<number>('PRD_IMPORT_MAX_BYTES'), (n) => { bytes = n; });
      const table = parseImportFile(file, filename, this.config.get<number>('PRD_IMPORT_MAX_ROWS'));
      return { table, hash: createHash('sha256').update(file).digest('hex'), filename };
    } catch (e) {
      const reason = e instanceof UploadError || e instanceof ImportFileError ? e.reason : null;
      if (!reason) throw e;
      this.log.warn('tệp import sản phẩm bị từ chối', { reason, bytes_read: bytes, ...(e instanceof ImportFileError && e.inflated !== undefined ? { inflated_bytes: e.inflated } : {}) }); // không tên tệp, không nội dung
      throw new DomainError('import-file-invalid', { extra: { reason, ...(e instanceof ImportFileError && e.missing ? { missing: e.missing } : {}) } });
    }
  }

  async run(actor: SessionContext, dryRun: boolean, req: Request, res: Response): Promise<ImportReport> {
    const header = req.headers['idempotency-key'];
    const key = Array.isArray(header) ? header[0] : header;
    if (!dryRun && !isIdempotencyKey(key)) throw new DomainError('idempotency-key-required'); // trước khi đọc tệp
    const { table, hash, filename } = await this.read(req, res);
    const parsed = prepare(table);

    if (dryRun) { // không mở giao dịch ghi, không audit, không đụng IdempotencyKey (BR2)
      const plan = decide(parsed, await loadExisting(this.prisma, parsed.filter((p) => p.skuOk).map((p) => p.sku), false), await loadTree(this.prisma));
      return this.finish(table, plan, true);
    }
    const out = await this.idem.run(
      { scope: 'prd:product-import', userId: actor.user_id, key: key as string, requestHash: requestHash('POST', '/api/v1/admin/products/import', { dry_run: false, file: hash }) },
      async (tx) => {
        // Khóa dòng của mọi sku đã có theo thứ tự sku (hai lần import song song không bế tắc), rồi kiểm lại với dữ liệu đã khóa (BR2).
        const plan = decide(parsed, await loadExisting(tx, parsed.filter((p) => p.skuOk).map((p) => p.sku), true), await loadTree(tx));
        await this.write(tx, plan);
        const report = this.finish(table, plan, false);
        await this.audit.record(tx, {
          actor_id: actor.user_id, actor_role: actor.role, action: 'catalog.product.import', target_type: 'product_import', target_id: key as string,
          after: {
            file_name: [...filename].filter((c) => !CONTROL.test(c)).slice(0, 255).join(''), // chỉ để ghi và hiển thị, không dùng làm đường dẫn (BR11)
            created: report.summary.created, updated: report.summary.updated, unchanged: report.summary.unchanged, errors: report.summary.errors,
            price_changes: plan.filter((r) => r.action === 'update' && (r.changes?.price || r.changes?.cost_price)).slice(0, 2000)
              .map((r) => ({ sku: r.sku, ...(r.changes?.price ? { price: r.changes.price } : {}), ...(r.changes?.cost_price ? { cost_price: r.changes.cost_price } : {}) })),
          },
        });
        return { status: 200, body: report };
      },
    );
    if (out.replayed) res.setHeader('Idempotent-Replayed', 'true');
    return out.body;
  }

  private finish(table: ImportTable, plan: Planned[], dryRun: boolean): ImportReport {
    const report = toReport(dryRun, table, plan);
    this.log.info('import sản phẩm', { dry_run: dryRun, ...report.summary });
    return report;
  }

  /** Ghi theo lô: tạo bằng INSERT ... ON CONFLICT (sku) DO NOTHING (dòng thua cuộc song song là `sku_conflict`, không bao giờ 500), sửa bằng UPDATE có kiểm `version` đã khóa. Lỗi hạ tầng ném ra, giao dịch hủy cả lô. */
  private async write(tx: Tx, plan: Planned[]): Promise<void> {
    const now = this.clock.now();
    const conflict = (r: Planned): void => { r.action = 'error'; r.errors.push(err('sku', 'sku_conflict', COLS.sku, 'sản phẩm vừa được tạo hoặc đổi ở nơi khác, thử lại')); delete r.changes; };
    const creates = plan.filter((r) => r.action === 'create'), updates = plan.filter((r) => r.action === 'update');
    for (let i = 0; i < creates.length; i += WRITE_CHUNK) {
      const c = creates.slice(i, i + WRITE_CHUNK);
      const done = await this.insertChunk(tx, c, now);
      for (const r of c) if (!done.has(r.sku)) conflict(r);
    }
    for (let i = 0; i < updates.length; i += WRITE_CHUNK) {
      const c = updates.slice(i, i + WRITE_CHUNK);
      const done = await this.updateChunk(tx, c, now);
      for (const r of c) if (!done.has(r.existing!.id)) conflict(r);
    }
  }

  protected async insertChunk(tx: Tx, c: Planned[], now: Date): Promise<Set<string>> {
    const rows = await tx.$queryRaw<{ sku: string }[]>`
      INSERT INTO products (category_id, name, sku, price, cost_price, search_text, created_at, updated_at)
      SELECT v.category_id::uuid, v.name, v.sku, v.price::bigint, NULLIF(v.cost, '')::bigint, v.st, ${now}::timestamptz, ${now}::timestamptz
      FROM unnest(${c.map((r) => r.next!.category_id)}::text[], ${c.map((r) => r.next!.name)}::text[], ${c.map((r) => r.sku)}::text[], ${c.map((r) => String(r.next!.price))}::text[],
                  ${c.map((r) => (r.next!.cost === null ? '' : String(r.next!.cost)))}::text[], ${c.map((r) => searchTextOf(r.next!.name, r.sku))}::text[]) AS v(category_id, name, sku, price, cost, st)
      ON CONFLICT (sku) DO NOTHING RETURNING sku`;
    return new Set(rows.map((r) => r.sku));
  }

  protected async updateChunk(tx: Tx, c: Planned[], now: Date): Promise<Set<string>> {
    const rows = await tx.$queryRaw<{ id: string }[]>`
      UPDATE products p SET category_id = v.category_id::uuid, name = v.name, price = v.price::bigint, cost_price = NULLIF(v.cost, '')::bigint, search_text = v.st,
        version = p.version + 1, updated_at = ${now}::timestamptz
      FROM unnest(${c.map((r) => r.existing!.id)}::text[], ${c.map((r) => String(r.existing!.version))}::text[], ${c.map((r) => r.next!.category_id)}::text[], ${c.map((r) => r.next!.name)}::text[],
                  ${c.map((r) => String(r.next!.price))}::text[], ${c.map((r) => (r.next!.cost === null ? '' : String(r.next!.cost)))}::text[], ${c.map((r) => searchTextOf(r.next!.name, r.sku))}::text[])
           AS v(id, version, category_id, name, price, cost, st)
      WHERE p.id = v.id::uuid AND p.version = v.version::int AND p.status <> 'archived' RETURNING p.id`;
    return new Set(rows.map((r) => r.id));
  }
}
