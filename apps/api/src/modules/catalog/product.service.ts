import { Injectable } from '@nestjs/common';
import { AuditService, Clock, DomainError, EventsService, TransactionService, type SessionContext, type Tx } from '../platform';
import { isForeignKey, isUnique } from './db';
import type { ProductCreate, ProductPatch } from './policy';
import { QueryService, type ProductStatus } from './query.service';
import { UUID_RE, searchTextOf } from './text';

interface Row { id: string; category_id: string; name: string; sku: string; description: string | null; price: bigint; cost_price: bigint | null; status: ProductStatus; version: number; published_at: Date | null }
const SKU_KEY = /^Key \(sku\)=/;
const actorOf = (s: SessionContext) => ({ actor_id: s.user_id, actor_role: s.role });
const num = (v: bigint | number | null): number | null => (v === null ? null : Number(v));
// Bản chụp cho audit: có `cost_price` (audit chỉ admin đọc, SB-42; before/after giá vốn truy vết đổi giá vốn nhầm).
const snapshot = (r: Pick<Row, 'name' | 'sku' | 'category_id' | 'description'> & { price: bigint | number; cost_price: bigint | number | null }) => ({ name: r.name, sku: r.sku, category_id: r.category_id, price: Number(r.price), cost_price: num(r.cost_price), description: r.description });
const categoryMissing = () => new DomainError('validation-failed', { errors: [{ field: 'category_id', code: 'not_found' }] });

/**
 * Ghi sản phẩm (PRD-DB mục Giao dịch và khóa 1 đến 3, 11; PRD-REQ ...550, ...571, ...613, ...634). Mọi ghi chạy trong MỘT giao dịch ngắn có khóa dòng sản phẩm
 * (`FOR UPDATE`), kèm audit cùng giao dịch (SB-19) và, khi đổi trạng thái, dòng outbox cùng giao dịch (ADR-011, SB-27). `status` chỉ đổi ở `publish` và `archive` (T9).
 */
@Injectable()
export class ProductService {
  constructor(
    private readonly transactions: TransactionService, private readonly audit: AuditService, private readonly events: EventsService,
    private readonly clock: Clock, private readonly queries: QueryService,
  ) {}

  /** Khóa dòng sản phẩm; không tồn tại hoặc id sai định dạng là 404 (BR8). */
  private async lock(tx: Tx, id: string): Promise<Row> {
    if (!UUID_RE.test(id)) throw new DomainError('not-found');
    const [p] = await tx.$queryRaw<Row[]>`SELECT id, category_id, name, sku, description, price, cost_price, status, version, published_at FROM products WHERE id = ${id}::uuid FOR UPDATE`;
    if (!p) throw new DomainError('not-found');
    return p;
  }

  /** Danh mục phải tồn tại; khóa chia sẻ để xóa danh mục chạy đua phải chờ (khóa ngoại phân xử nốt, TC xóa đua với chuyển sản phẩm vào). */
  private async requireCategory(tx: Tx, id: string): Promise<void> {
    const [c] = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM categories WHERE id = ${id}::uuid FOR KEY SHARE`;
    if (!c) throw categoryMissing();
  }

  async create(actor: SessionContext, b: ProductCreate) {
    const now = this.clock.now();
    let id: string;
    try {
      id = await this.transactions.run(async (tx) => {
        await this.requireCategory(tx, b.category_id);
        const [row] = await tx.$queryRaw<Row[]>`
          INSERT INTO products (category_id, name, sku, description, price, cost_price, search_text, created_at, updated_at)
          VALUES (${b.category_id}::uuid, ${b.name}, ${b.sku}, ${b.description || null}, ${b.price}, ${b.cost_price ?? null}, ${searchTextOf(b.name, b.sku)}, ${now}::timestamptz, ${now}::timestamptz)
          RETURNING id, category_id, name, sku, description, price, cost_price, status, version, published_at`;
        await this.audit.record(tx, { ...actorOf(actor), action: 'catalog.product.create', target_type: 'product', target_id: row.id, after: { ...snapshot(row), status: 'draft' } });
        return row.id;
      });
    } catch (e) {
      if (isUnique(e, SKU_KEY)) throw new DomainError('product-sku-taken');
      if (isForeignKey(e)) throw categoryMissing();
      throw e;
    }
    return this.queries.adminDetail(id, true); // chỉ admin gọi create và update (SB-42)
  }

  /** Sửa một phần kèm `version` đang giữ (khóa lạc quan, SB-30). Thứ tự: 404, archived, version, sku đã khóa (409), rồi ràng buộc dữ liệu. */
  async update(actor: SessionContext, id: string, b: ProductPatch) {
    const now = this.clock.now();
    try {
      await this.transactions.run(async (tx) => {
        const cur = await this.lock(tx, id);
        if (cur.status === 'archived') throw new DomainError('product-archived');
        if (b.version !== cur.version) throw new DomainError('product-version-conflict');
        if (b.sku !== undefined && b.sku !== cur.sku && cur.status !== 'draft') throw new DomainError('product-sku-locked');
        if (b.category_id !== undefined && b.category_id !== cur.category_id) await this.requireCategory(tx, b.category_id);
        const next = {
          name: b.name ?? cur.name, sku: b.sku ?? cur.sku, category_id: b.category_id ?? cur.category_id,
          price: b.price ?? Number(cur.price), cost_price: b.cost_price === undefined ? num(cur.cost_price) : b.cost_price, description: b.description === undefined ? cur.description : b.description || null,
        };
        const before = snapshot(cur), after = snapshot({ ...next });
        const changed = (Object.keys(after) as (keyof typeof after)[]).filter((k) => after[k] !== before[k]);
        // `WHERE version = :đang-giữ AND status IN (...)` là lưới an toàn thứ hai sau khóa dòng
        const n = await tx.$executeRaw`
          UPDATE products SET category_id = ${next.category_id}::uuid, name = ${next.name}, sku = ${next.sku}, description = ${next.description}, price = ${next.price}, cost_price = ${next.cost_price},
            search_text = ${searchTextOf(next.name, next.sku)}, version = version + 1, updated_at = ${now}::timestamptz
          WHERE id = ${id}::uuid AND version = ${b.version} AND status IN ('draft', 'active')`;
        if (n === 0) throw new DomainError('product-version-conflict');
        await this.audit.record(tx, {
          ...actorOf(actor), action: 'catalog.product.update', target_type: 'product', target_id: id,
          before: Object.fromEntries(changed.map((k) => [k, before[k]])), after: Object.fromEntries(changed.map((k) => [k, after[k]])),
        });
      });
    } catch (e) {
      if (isUnique(e, SKU_KEY)) throw new DomainError('product-sku-taken');
      if (isForeignKey(e)) throw categoryMissing();
      throw e;
    }
    return this.queries.adminDetail(id, true); // chỉ admin gọi create và update (SB-42)
  }

  /** draft thành active: đủ điều kiện (tên, sku, giá do CHECK của DB giữ; danh mục do khóa ngoại; có ít nhất 1 ảnh), ghi `published_at` và ProductActivated qua outbox cùng giao dịch (BR5). */
  async publish(actor: SessionContext, id: string) {
    const now = this.clock.now();
    return this.transactions.run(async (tx) => {
      const cur = await this.lock(tx, id);
      if (cur.status === 'archived') throw new DomainError('product-archived');
      if (cur.status !== 'draft') throw new DomainError('conflict'); // đã active: công bố lại là 409, không phát event lần hai
      const [{ n }] = await tx.$queryRaw<{ n: bigint }[]>`SELECT count(*) AS n FROM product_images WHERE product_id = ${id}::uuid`; // dưới khóa dòng nên không chạy đua với xóa ảnh
      const missing = [...(Number(n) < 1 ? ['images'] : [])];
      if (missing.length) throw new DomainError('product-not-publishable', { extra: { missing } });
      const [row] = await tx.$queryRaw<{ version: number; published_at: Date }[]>`
        UPDATE products SET status = 'active', published_at = ${now}::timestamptz, version = version + 1, updated_at = ${now}::timestamptz
        WHERE id = ${id}::uuid AND status = 'draft' RETURNING version, published_at`;
      await this.events.publish(tx, { type: 'ProductActivated', aggregate_type: 'product', aggregate_id: id, payload: { product_id: id } });
      await this.audit.record(tx, { ...actorOf(actor), action: 'catalog.product.publish', target_type: 'product', target_id: id, before: { status: 'draft' }, after: { status: 'active', price: Number(cur.price) } });
      return { id, status: 'active' as const, published_at: row.published_at, version: row.version };
    });
  }

  /** active hoặc draft thành archived (trạng thái cuối), ProductArchived qua outbox cùng giao dịch (BR4). */
  async archive(actor: SessionContext, id: string) {
    const now = this.clock.now();
    return this.transactions.run(async (tx) => {
      const cur = await this.lock(tx, id);
      if (cur.status === 'archived') throw new DomainError('product-archived');
      const [row] = await tx.$queryRaw<{ version: number }[]>`
        UPDATE products SET status = 'archived', version = version + 1, updated_at = ${now}::timestamptz WHERE id = ${id}::uuid AND status = ${cur.status}::product_status RETURNING version`;
      await this.events.publish(tx, { type: 'ProductArchived', aggregate_type: 'product', aggregate_id: id, payload: { product_id: id } });
      await this.audit.record(tx, { ...actorOf(actor), action: 'catalog.product.archive', target_type: 'product', target_id: id, before: { status: cur.status }, after: { status: 'archived' } });
      return { id, status: 'archived' as const, version: row.version };
    });
  }
}
