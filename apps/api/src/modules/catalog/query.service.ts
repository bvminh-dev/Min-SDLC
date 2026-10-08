import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { DomainError, OBJECT_STORAGE, PrismaService, paginate, toPage, type ObjectStorage, type PaginationQuery } from '../platform';
import type { AdminListQuery, BrowseQuery, SearchQuery } from './policy';
import { UUID_RE, likeEscape, searchTerms } from './text';

export type ProductStatus = 'draft' | 'active' | 'archived';
interface Filter { status?: ProductStatus; categoryId?: string; minPrice?: number; maxPrice?: number; q?: string }

const AVG = Prisma.sql`CASE WHEN p.rating_count > 0 THEN round(p.rating_sum::numeric / p.rating_count, 1)::float8 END`;
const FIRST_IMAGE = Prisma.sql`(SELECT i.storage_key FROM product_images i WHERE i.product_id = p.id ORDER BY i.position LIMIT 1)`;

/** Điều kiện lọc dùng chung cho danh sách công khai, tìm kiếm và danh sách quản trị. Mọi giá trị là tham số, `status` do mã đặt, không lấy từ client ở endpoint công khai (SB-11, T3, T5). */
function where(f: Filter): Prisma.Sql {
  const c: Prisma.Sql[] = [];
  if (f.status) c.push(Prisma.sql`p.status = ${f.status}::product_status`);
  // danh mục gồm mọi hậu duệ (tối đa 3 cấp); id đúng định dạng nhưng không có thì ra rỗng (BR6)
  if (f.categoryId) c.push(Prisma.sql`p.category_id IN (WITH RECURSIVE t(id) AS (SELECT id FROM categories WHERE id = ${f.categoryId}::uuid UNION ALL SELECT c.id FROM categories c JOIN t ON c.parent_id = t.id) SELECT id FROM t)`);
  if (f.minPrice !== undefined) c.push(Prisma.sql`p.price >= ${f.minPrice}`);
  if (f.maxPrice !== undefined) c.push(Prisma.sql`p.price <= ${f.maxPrice}`);
  if (f.q !== undefined) {
    const terms = searchTerms(f.q);
    c.push(terms.length ? Prisma.join(terms.map((t) => Prisma.sql`p.search_text LIKE ${`%${likeEscape(t)}%`}`), ' AND ') : Prisma.sql`FALSE`);
  }
  return c.length ? Prisma.sql`WHERE ${Prisma.join(c, ' AND ')}` : Prisma.empty;
}

const ORDER: Record<string, Prisma.Sql> = {
  newest: Prisma.sql`p.published_at DESC, p.id DESC`,
  price_asc: Prisma.sql`p.price ASC, p.id ASC`,
  price_desc: Prisma.sql`p.price DESC, p.id DESC`,
};

/** Đọc sản phẩm: công khai (chỉ `active`) và quản trị (mọi trạng thái). Không có nhánh ghi. */
@Injectable()
export class QueryService {
  constructor(private readonly prisma: PrismaService, @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage) {}

  private url = (key: string | null): string | null => (key ? this.storage.urlFor(key) : null);
  private page = <T>(items: T[], total: bigint[], q: PaginationQuery) => toPage(items, Number(total[0]?.valueOf() ?? 0), q);

  /** Danh sách công khai và tìm kiếm: cùng dạng mục (BR5 của danh sách), `relevance` chỉ khi có `q` (tên bắt đầu bằng từ khóa trước). */
  async browse(q: BrowseQuery | SearchQuery) {
    const search = 'q' in q ? q.q : undefined;
    const f: Filter = { status: 'active', categoryId: q.category_id, minPrice: q.min_price, maxPrice: q.max_price, q: search };
    const first = search ? searchTerms(search)[0] : undefined;
    const order = q.sort === 'relevance' && first !== undefined
      ? Prisma.sql`CASE WHEN p.search_text LIKE ${`${likeEscape(first)}%`} THEN 0 ELSE 1 END, p.published_at DESC, p.id DESC`
      : ORDER[q.sort === 'relevance' ? 'newest' : q.sort];
    const { skip, take } = paginate(q);
    const w = where(f);
    const [rows, total] = await Promise.all([
      this.prisma.$queryRaw<{ id: string; name: string; price: bigint; rating_avg: number | null; rating_count: number; category_id: string; category_name: string; image_key: string | null }[]>`
        SELECT p.id, p.name, p.price, ${AVG} AS rating_avg, p.rating_count, c.id AS category_id, c.name AS category_name, ${FIRST_IMAGE} AS image_key
        FROM products p JOIN categories c ON c.id = p.category_id ${w} ORDER BY ${order} LIMIT ${take} OFFSET ${skip}`,
      this.prisma.$queryRaw<{ n: bigint }[]>`SELECT count(*) AS n FROM products p ${w}`,
    ]);
    return this.page(rows.map((r) => ({
      id: r.id, name: r.name, price: Number(r.price), image_url: this.url(r.image_key), category: { id: r.category_id, name: r.category_name }, rating_avg: r.rating_avg, rating_count: r.rating_count,
    })), total.map((t) => t.n), q);
  }

  /** Chi tiết công khai: draft, archived, không tồn tại và id sai định dạng cùng một 404 (T3). Không có `status`, `version`. */
  async publicDetail(id: string) {
    if (!UUID_RE.test(id)) throw new DomainError('not-found');
    const [p] = await this.prisma.$queryRaw<{ id: string; name: string; sku: string; price: bigint; description: string | null; rating_avg: number | null; rating_count: number; category_id: string }[]>`
      SELECT p.id, p.name, p.sku, p.price, p.description, ${AVG} AS rating_avg, p.rating_count, p.category_id FROM products p WHERE p.id = ${id}::uuid AND p.status = 'active'`;
    if (!p) throw new DomainError('not-found');
    const [images, path] = await Promise.all([this.images(p.id), this.categoryPath(p.category_id)]);
    const self = path.at(-1)!;
    return {
      id: p.id, name: p.name, sku: p.sku, price: Number(p.price), description: p.description, images: images.map((i) => ({ id: i.id, url: i.url })),
      category: { id: self.id, name: self.name, slug: self.slug, path: path.slice(0, -1).map((c) => ({ id: c.id, name: c.name })) }, rating_avg: p.rating_avg, rating_count: p.rating_count,
    };
  }

  /** Chuỗi danh mục từ gốc tới danh mục chứa sản phẩm (phần tử cuối là chính nó). */
  private async categoryPath(categoryId: string): Promise<{ id: string; name: string; slug: string }[]> {
    return this.prisma.$queryRaw`
      WITH RECURSIVE a(id, name, slug, parent_id, n) AS (
        SELECT id, name, slug, parent_id, 1 FROM categories WHERE id = ${categoryId}::uuid
        UNION ALL SELECT c.id, c.name, c.slug, c.parent_id, a.n + 1 FROM categories c JOIN a ON c.id = a.parent_id)
      SELECT id, name, slug FROM a ORDER BY n DESC`;
  }

  async images(productId: string): Promise<{ id: string; url: string; position: number }[]> {
    const rows = await this.prisma.$queryRaw<{ id: string; storage_key: string; position: number }[]>`SELECT id, storage_key, position FROM product_images WHERE product_id = ${productId}::uuid ORDER BY position`;
    return rows.map((r) => ({ id: r.id, url: this.storage.urlFor(r.storage_key), position: r.position }));
  }

  /** Danh sách quản trị (staff, admin): mọi trạng thái, mới cập nhật trước (BR2). */
  async adminList(q: AdminListQuery) {
    const w = where({ status: q.status as ProductStatus | undefined, categoryId: q.category_id, q: q.q });
    const { skip, take } = paginate(q);
    const [rows, total] = await Promise.all([
      this.prisma.$queryRaw<{ id: string; name: string; sku: string; price: bigint; status: ProductStatus; category_id: string; category_name: string; image_key: string | null; updated_at: Date }[]>`
        SELECT p.id, p.name, p.sku, p.price, p.status, c.id AS category_id, c.name AS category_name, ${FIRST_IMAGE} AS image_key, p.updated_at
        FROM products p JOIN categories c ON c.id = p.category_id ${w} ORDER BY p.updated_at DESC, p.id DESC LIMIT ${take} OFFSET ${skip}`,
      this.prisma.$queryRaw<{ n: bigint }[]>`SELECT count(*) AS n FROM products p ${w}`,
    ]);
    return this.page(rows.map((r) => ({
      id: r.id, name: r.name, sku: r.sku, price: Number(r.price), status: r.status, category: { id: r.category_id, name: r.category_name }, image_url: this.url(r.image_key), updated_at: r.updated_at,
    })), total.map((t) => t.n), q);
  }

  /** Chi tiết quản trị (mọi trạng thái, có `version`); dùng cả cho phản hồi tạo và sửa. Không tồn tại hoặc id sai định dạng là 404 (BR5). */
  async adminDetail(id: string) {
    if (!UUID_RE.test(id)) throw new DomainError('not-found');
    const [p] = await this.prisma.$queryRaw<{ id: string; name: string; sku: string; price: bigint; description: string | null; status: ProductStatus; version: number; published_at: Date | null; rating_avg: number | null; rating_count: number; category_id: string; category_name: string; created_at: Date; updated_at: Date }[]>`
      SELECT p.id, p.name, p.sku, p.price, p.description, p.status, p.version, p.published_at, ${AVG} AS rating_avg, p.rating_count, c.id AS category_id, c.name AS category_name, p.created_at, p.updated_at
      FROM products p JOIN categories c ON c.id = p.category_id WHERE p.id = ${id}::uuid`;
    if (!p) throw new DomainError('not-found');
    return {
      id: p.id, name: p.name, sku: p.sku, category_id: p.category_id, category: { id: p.category_id, name: p.category_name }, price: Number(p.price), description: p.description,
      status: p.status, version: p.version, published_at: p.published_at, images: await this.images(p.id), rating_avg: p.rating_avg, rating_count: p.rating_count, created_at: p.created_at, updated_at: p.updated_at,
    };
  }
}
