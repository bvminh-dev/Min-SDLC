import { Injectable } from '@nestjs/common';
import { AuditService, Clock, DomainError, PrismaService, TransactionService, type SessionContext, type Tx } from '../platform';
import { MAX_DEPTH } from './config';
import { isForeignKey, isUnique } from './db';
import type { CategoryCreate, CategoryPatch } from './policy';
import { UUID_RE, fold, slugify } from './text';

export interface CategoryDto { id: string; name: string; slug: string; parent_id: string | null; depth: number }

const NAME_KEY = /lower\(name\)/; // chỉ mục unique (parent_id, lower(name)) và (lower(name)) cho danh mục gốc
const SLUG_KEY = /^Key \(slug\)=/;

/** Danh mục (PRD-DB mục 5, 6; PRD-REQ-20261006-095502484, ...507, ...529): cây tối đa 3 cấp, slug sinh một lần, mọi ghi cùng giao dịch với audit (SB-19). */
@Injectable()
export class CategoryService {
  constructor(private readonly prisma: PrismaService, private readonly transactions: TransactionService, private readonly audit: AuditService, private readonly clock: Clock) {}

  /** Cây phẳng: cha trước con, anh em theo tên (không phân biệt hoa thường và dấu); `product_count` là số sản phẩm `active` gồm danh mục con (BR3). Không đệm: đọc luôn mới (BR6 cho phép tối đa 60 giây). */
  async tree(): Promise<(CategoryDto & { product_count: number })[]> {
    const [cats, counts] = await Promise.all([
      this.prisma.$queryRaw<CategoryDto[]>`SELECT id, name, slug, parent_id, depth FROM categories`,
      this.prisma.$queryRaw<{ category_id: string; n: bigint }[]>`SELECT category_id, count(*) AS n FROM products WHERE status = 'active' GROUP BY category_id`,
    ]);
    const own = new Map(counts.map((c) => [c.category_id, Number(c.n)]));
    const kids = new Map<string | null, CategoryDto[]>();
    for (const c of cats) kids.set(c.parent_id, [...(kids.get(c.parent_id) ?? []), c]);
    for (const list of kids.values()) list.sort((a, b) => (fold(a.name) < fold(b.name) ? -1 : fold(a.name) > fold(b.name) ? 1 : a.id < b.id ? -1 : 1));
    const out: (CategoryDto & { product_count: number })[] = [];
    const walk = (parent: string | null): number => {
      let sum = 0;
      for (const c of kids.get(parent) ?? []) {
        const slot = { ...c, product_count: 0 };
        out.push(slot); // cha trước con
        slot.product_count = (own.get(c.id) ?? 0) + walk(c.id);
        sum += slot.product_count;
      }
      return sum;
    };
    walk(null);
    return out;
  }

  /** Slug còn trống: `ao`, rồi `ao-2`, `ao-3`... (BR4). Hai yêu cầu cùng slug: unique của DB phân xử, bên gọi thử lại. */
  private async freeSlug(tx: Tx, base: string): Promise<string> {
    const rows = await tx.$queryRaw<{ slug: string }[]>`SELECT slug FROM categories WHERE slug = ${base} OR slug LIKE ${`${base}-%`}`; // base chỉ gồm [a-z0-9-]
    const used = new Set(rows.map((r) => r.slug));
    if (!used.has(base)) return base;
    for (let n = 2; ; n++) if (!used.has(`${base}-${n}`)) return `${base}-${n}`;
  }

  async create(actor: SessionContext, b: CategoryCreate): Promise<CategoryDto> {
    const now = this.clock.now();
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.transactions.run(async (tx) => {
          let depth = 1;
          if (b.parent_id) {
            const [p] = await tx.$queryRaw<{ depth: number }[]>`SELECT depth FROM categories WHERE id = ${b.parent_id}::uuid FOR SHARE`;
            if (!p) throw new DomainError('validation-failed', { errors: [{ field: 'parent_id', code: 'not_found' }] });
            depth = p.depth + 1;
            if (depth > MAX_DEPTH) throw new DomainError('category-too-deep');
          }
          const slug = await this.freeSlug(tx, slugify(b.name));
          const [row] = await tx.$queryRaw<CategoryDto[]>`
            INSERT INTO categories (name, slug, parent_id, depth, created_at, updated_at)
            VALUES (${b.name}, ${slug}, ${b.parent_id ?? null}::uuid, ${depth}, ${now}::timestamptz, ${now}::timestamptz)
            RETURNING id, name, slug, parent_id, depth`;
          await this.audit.record(tx, { actor_id: actor.user_id, actor_role: actor.role, action: 'catalog.category.create', target_type: 'category', target_id: row.id, after: { name: row.name, slug: row.slug, parent_id: row.parent_id, depth: row.depth } });
          return row;
        });
      } catch (e) {
        if (isUnique(e, SLUG_KEY) && attempt < 5) continue;
        if (isUnique(e, NAME_KEY)) throw new DomainError('category-name-taken');
        throw e;
      }
    }
  }

  async update(actor: SessionContext, id: string, b: CategoryPatch): Promise<CategoryDto> {
    if (!UUID_RE.test(id)) throw new DomainError('not-found');
    const now = this.clock.now();
    try {
      return await this.transactions.run(async (tx) => {
        const target = b.parent_id === undefined ? null : b.parent_id; // chỉ khóa cha mới khi đổi nhánh
        const ids = [id, ...(target ? [target] : [])];
        // khóa danh mục cần sửa và cha mới theo id tăng dần (tránh bế tắc, PRD-DB mục Giao dịch và khóa 5)
        const locked = await tx.$queryRaw<(CategoryDto)[]>`SELECT id, name, slug, parent_id, depth FROM categories WHERE id = ANY(${ids}::uuid[]) ORDER BY id FOR UPDATE`;
        const cur = locked.find((r) => r.id === id);
        if (!cur) throw new DomainError('not-found');
        let parentId = cur.parent_id, depth = cur.depth;
        if (b.parent_id !== undefined && b.parent_id !== cur.parent_id) {
          if (b.parent_id === null) { parentId = null; depth = 1; }
          else {
            const parent = locked.find((r) => r.id === b.parent_id);
            if (!parent) throw new DomainError('validation-failed', { errors: [{ field: 'parent_id', code: 'not_found' }] });
            // vòng: danh mục này là cha mới hay tổ tiên của cha mới (truy vấn đệ quy giới hạn bước, T13)
            const chain = await tx.$queryRaw<{ id: string }[]>`
              WITH RECURSIVE a(id, parent_id, n) AS (
                SELECT id, parent_id, 1 FROM categories WHERE id = ${parent.id}::uuid
                UNION ALL SELECT c.id, c.parent_id, a.n + 1 FROM categories c JOIN a ON c.id = a.parent_id WHERE a.n <= ${MAX_DEPTH})
              SELECT id FROM a`;
            if (chain.some((r) => r.id === id)) throw new DomainError('category-cycle');
            parentId = parent.id; depth = parent.depth + 1;
          }
        }
        const sub = await tx.$queryRaw<{ id: string; depth: number }[]>`
          WITH RECURSIVE d(id, depth) AS (
            SELECT id, depth FROM categories WHERE id = ${id}::uuid
            UNION ALL SELECT c.id, c.depth FROM categories c JOIN d ON c.parent_id = d.id)
          SELECT id, depth FROM d`;
        const height = Math.max(...sub.map((r) => r.depth)) - cur.depth;
        if (depth + height > MAX_DEPTH) throw new DomainError('category-too-deep');
        const name = b.name ?? cur.name;
        if (name === cur.name && parentId === cur.parent_id) return cur; // không đổi gì: không audit
        const [row] = await tx.$queryRaw<CategoryDto[]>`
          UPDATE categories SET name = ${name}, parent_id = ${parentId}::uuid, depth = ${depth}, updated_at = ${now}::timestamptz
          WHERE id = ${id}::uuid RETURNING id, name, slug, parent_id, depth`;
        // ponytail: không khóa cả nhánh con; tạo con song song với chuyển nhánh có thể để depth con lệch (vẫn trong 1..3 nhờ CHECK), khóa nhánh khi thành vấn đề
        if (depth !== cur.depth) {
          await tx.$executeRaw`UPDATE categories SET depth = depth + ${depth - cur.depth}, updated_at = ${now}::timestamptz WHERE id = ANY(${sub.map((r) => r.id).filter((x) => x !== id)}::uuid[])`;
        }
        await this.audit.record(tx, {
          actor_id: actor.user_id, actor_role: actor.role, action: 'catalog.category.update', target_type: 'category', target_id: id,
          before: { name: cur.name, parent_id: cur.parent_id, depth: cur.depth }, after: { name: row.name, parent_id: row.parent_id, depth: row.depth },
        });
        return row;
      });
    } catch (e) {
      if (isUnique(e, NAME_KEY)) throw new DomainError('category-name-taken');
      throw e;
    }
  }

  async remove(actor: SessionContext, id: string): Promise<void> {
    if (!UUID_RE.test(id)) throw new DomainError('not-found');
    try {
      await this.transactions.run(async (tx) => {
        const [cur] = await tx.$queryRaw<CategoryDto[]>`SELECT id, name, slug, parent_id, depth FROM categories WHERE id = ${id}::uuid FOR UPDATE`;
        if (!cur) throw new DomainError('not-found');
        const reasons = await this.reasons(tx, id);
        if (reasons.length) throw new DomainError('category-not-empty', { extra: { reasons } });
        await tx.$executeRaw`DELETE FROM categories WHERE id = ${id}::uuid`;
        await this.audit.record(tx, { actor_id: actor.user_id, actor_role: actor.role, action: 'catalog.category.delete', target_type: 'category', target_id: id, before: { name: cur.name, slug: cur.slug, parent_id: cur.parent_id, depth: cur.depth } });
      });
    } catch (e) {
      // chạy đua: sản phẩm hoặc danh mục con vào giữa lúc đếm và xóa, khóa ngoại RESTRICT phân xử (PRD-DB mục 6)
      if (isForeignKey(e)) throw new DomainError('category-not-empty', { extra: { reasons: await this.reasons(this.prisma, id) } });
      throw e;
    }
  }

  /** Lý do không xóa được: có danh mục con, có sản phẩm (mọi trạng thái, kể cả `archived`); trả đủ cả hai khi cùng xảy ra (BR2). */
  private async reasons(db: Pick<Tx, '$queryRaw'>, id: string): Promise<string[]> {
    const [r] = await db.$queryRaw<{ children: bigint; products: bigint }[]>`
      SELECT (SELECT count(*) FROM categories WHERE parent_id = ${id}::uuid) AS children, (SELECT count(*) FROM products WHERE category_id = ${id}::uuid) AS products`;
    return [...(Number(r.children) ? ['has_children'] : []), ...(Number(r.products) ? ['has_products'] : [])];
  }
}
