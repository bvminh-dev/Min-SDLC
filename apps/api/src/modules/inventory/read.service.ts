import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { CatalogApi } from '../catalog';
import { AppLogger, DomainError, PrismaService, toPage } from '../platform';
import { AVAILABILITY_MAX_IDS, DEFAULT_SEARCH_IDS, SUMMARY_MAX } from './config';
import { UUID_RE, toItem, type ItemRow, type Product } from './item';
import type { ListQuery, LowStockQuery, MovementsQuery } from './policy';

type Page = { page: number; limit: number };
const offsetOf = (q: Page) => (q.page - 1) * q.limit;
const COLS = Prisma.sql`id, product_id, on_hand, reserved, low_stock_threshold, archived_at, version, updated_at`;

/** Đọc (INV-API: danh sách, tồn thấp, chi tiết, lịch sử, xem còn hàng công khai) và ba giao diện đọc nội bộ. Chỉ đọc: không khóa ghi, không gọi PRD khi đang cầm khóa. */
@Injectable()
export class ReadService {
  private readonly log: AppLogger;
  constructor(private readonly prisma: PrismaService, private readonly catalog: CatalogApi, logger: AppLogger) {
    this.log = logger.for('inventory');
  }

  /** Tên, sku theo lô (tối đa 100 id) từ giao diện đọc của PRD; PRD không trả được thì `product` là null và các số vẫn đúng. */
  private async products(ids: string[]): Promise<Map<string, Product>> {
    const out = new Map<string, Product>();
    if (!ids.length) return out;
    try {
      for (const p of await this.catalog.getSummaries(ids)) out.set(p.product_id, { name: p.name, sku: p.sku });
    } catch (err) {
      this.log.warn('không đọc được tên sản phẩm từ PRD', { err });
    }
    return out;
  }

  private shape(r: ItemRow, p: Map<string, Product>) {
    return { ...toItem(r), product: p.get(r.product_id) ?? null, updated_at: r.updated_at };
  }

  private async page(where: Prisma.Sql, order: Prisma.Sql, q: Page) {
    const [{ n }] = await this.prisma.$queryRaw<{ n: bigint }[]>`SELECT count(*) AS n FROM stock_items WHERE ${where}`;
    const rows = await this.prisma.$queryRaw<ItemRow[]>`SELECT ${COLS} FROM stock_items WHERE ${where} ORDER BY ${order} LIMIT ${q.limit} OFFSET ${offsetOf(q)}`;
    const p = await this.products(rows.map((r) => r.product_id));
    return { items: rows.map((r) => this.shape(r, p)), total: Number(n) };
  }

  async list(q: ListQuery) {
    const conds: Prisma.Sql[] = [Prisma.sql`TRUE`];
    if (q.archived) conds.push(q.archived === 'true' ? Prisma.sql`archived_at IS NOT NULL` : Prisma.sql`archived_at IS NULL`);
    if (q.q) {
      // `q` đi qua PRD (INV không lưu tên): tối đa 200 product_id, từ khóa quá rộng thì cắt ở 200 sản phẩm đầu của PRD (đã chốt, mặc định)
      let ids: string[] = [];
      try { ids = await this.catalog.searchProductIds(q.q, DEFAULT_SEARCH_IDS); } catch (err) { this.log.warn('tìm qua PRD thất bại', { err }); throw new DomainError('service-unavailable'); }
      if (!ids.length) return toPage([], 0, q);
      conds.push(Prisma.sql`product_id = ANY(${ids}::uuid[])`);
    }
    const order = q.sort === 'available_asc' ? Prisma.sql`(on_hand - reserved) ASC, id DESC` : Prisma.sql`updated_at DESC, id DESC`;
    const r = await this.page(Prisma.join(conds, ' AND '), order, q);
    return toPage(r.items, r.total, q);
  }

  /** Chỉ sản phẩm chưa ngừng bán có available <= ngưỡng, available tăng dần, `product_id` tăng dần làm khóa phụ. */
  async lowStock(q: LowStockQuery) {
    const r = await this.page(Prisma.sql`archived_at IS NULL AND on_hand - reserved <= low_stock_threshold`, Prisma.sql`(on_hand - reserved) ASC, product_id ASC`, q);
    return toPage(r.items, r.total, q);
  }

  async detail(productId: string) {
    if (!UUID_RE.test(productId)) throw new DomainError('not-found');
    const [r] = await this.prisma.$queryRaw<ItemRow[]>`SELECT ${COLS} FROM stock_items WHERE product_id = ${productId.toLowerCase()}::uuid`;
    if (!r) throw new DomainError('not-found');
    return this.shape(r, await this.products([r.product_id]));
  }

  async movements(productId: string, q: MovementsQuery) {
    if (!UUID_RE.test(productId)) throw new DomainError('not-found');
    const [item] = await this.prisma.$queryRaw<{ id: string }[]>`SELECT id FROM stock_items WHERE product_id = ${productId.toLowerCase()}::uuid`;
    if (!item) throw new DomainError('not-found');
    // `from` tính cả mốc, `to` không tính (INV-REQ ...637 BR4)
    const conds: Prisma.Sql[] = [Prisma.sql`stock_item_id = ${item.id}::uuid`];
    if (q.type) conds.push(Prisma.sql`type = ANY(${q.type}::movement_type[])`);
    if (q.from) conds.push(Prisma.sql`created_at >= ${q.from}::timestamptz`);
    if (q.to) conds.push(Prisma.sql`created_at < ${q.to}::timestamptz`);
    const where = Prisma.join(conds, ' AND ');
    const [{ n }] = await this.prisma.$queryRaw<{ n: bigint }[]>`SELECT count(*) AS n FROM stock_movements WHERE ${where}`;
    const rows = await this.prisma.$queryRaw<{ id: string; type: string; quantity: number; on_hand_after: number; reason: string | null; note: string | null; actor_id: string | null; actor_name: string | null; ref_type: string | null; ref_id: string | null; created_at: Date }[]>`
      SELECT id, type, quantity, on_hand_after, reason, note, actor_id, actor_name, ref_type, ref_id, created_at
      FROM stock_movements WHERE ${where} ORDER BY created_at DESC, id DESC LIMIT ${q.limit} OFFSET ${offsetOf(q)}`;
    // không trả khóa idempotency (không có cột nào như vậy); `actor.name` là bản chụp lúc ghi, null với dòng cũ chưa có tên (giao diện hiện `actor.id` rút gọn)
    const items = rows.map((r) => ({
      id: r.id, type: r.type, quantity: r.quantity, on_hand_after: r.on_hand_after, reason: r.reason, note: r.note,
      actor: r.actor_id ? { id: r.actor_id, name: r.actor_name } : { id: null, name: 'system' },
      ref: r.ref_type && r.ref_id ? { type: r.ref_type, id: r.ref_id } : null, created_at: r.created_at,
    }));
    return toPage(items, Number(n), q);
  }

  /** Endpoint công khai: chỉ `in_stock`, theo đúng thứ tự `product_ids`; id không có bản ghi (draft, không tồn tại) giống hệt hết hàng (SB-37, K-12). Không chọn cột số nào ra khỏi tầng truy vấn. */
  async inStock(ids: string[]) {
    const rows = await this.prisma.$queryRaw<{ product_id: string; in_stock: boolean }[]>`
      SELECT product_id, (on_hand - reserved > 0 AND archived_at IS NULL) AS in_stock FROM stock_items WHERE product_id = ANY(${ids}::uuid[])`;
    const by = new Map(rows.map((r) => [r.product_id, r.in_stock]));
    return { items: ids.map((id) => ({ product_id: id, in_stock: by.get(id) === true })) };
  }

  /** CRT (đọc theo lô, không `tx`): `{ product_id: available }`, tối đa 100 id; thiếu bản ghi hay sản phẩm ngừng bán là 0. Số chính xác chỉ trong tiến trình (SB-37). */
  async getAvailability(productIds: string[]): Promise<Record<string, number>> {
    if (!Array.isArray(productIds) || productIds.length > AVAILABILITY_MAX_IDS) throw new RangeError(`getAvailability: tối đa ${AVAILABILITY_MAX_IDS} id mỗi lần gọi`);
    const ids = [...new Set(productIds.filter((x) => typeof x === 'string' && UUID_RE.test(x)).map((x) => x.toLowerCase()))];
    const out: Record<string, number> = Object.fromEntries(ids.map((id) => [id, 0]));
    if (!ids.length) return out;
    const rows = await this.prisma.$queryRaw<{ product_id: string; available: number }[]>`
      SELECT product_id, on_hand - reserved AS available FROM stock_items WHERE product_id = ANY(${ids}::uuid[]) AND archived_at IS NULL`;
    for (const r of rows) out[r.product_id] = r.available;
    return out;
  }

  /** DSH (ADR-020, chỉ đọc): tổng số sản phẩm tồn thấp và `limit` dòng đầu (available tăng dần, product_id tăng dần). */
  async getLowStockSummary(limit: number) {
    if (!Number.isInteger(limit) || limit < 1 || limit > SUMMARY_MAX) throw new RangeError(`getLowStockSummary: limit phải là số nguyên từ 1 đến ${SUMMARY_MAX}`);
    const where = Prisma.sql`archived_at IS NULL AND on_hand - reserved <= low_stock_threshold`;
    const [{ n }] = await this.prisma.$queryRaw<{ n: bigint }[]>`SELECT count(*) AS n FROM stock_items WHERE ${where}`;
    const rows = await this.prisma.$queryRaw<{ product_id: string; available: number; low_stock_threshold: number }[]>`
      SELECT product_id, on_hand - reserved AS available, low_stock_threshold FROM stock_items WHERE ${where} ORDER BY (on_hand - reserved) ASC, product_id ASC LIMIT ${limit}`;
    const p = await this.products(rows.map((r) => r.product_id));
    return {
      count: Number(n),
      items: rows.map((r) => ({ product_id: r.product_id, name: p.get(r.product_id)?.name ?? '', sku: p.get(r.product_id)?.sku ?? '', available: r.available, low_stock_threshold: r.low_stock_threshold })),
    };
  }
}
