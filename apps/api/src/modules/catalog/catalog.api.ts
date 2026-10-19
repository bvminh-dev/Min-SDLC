import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { OBJECT_STORAGE, PrismaService, type ObjectStorage } from '../platform';
import { ACTIVE_ID_LIMIT, BATCH_LIMIT, SEARCH_LIMIT, SEARCH_Q_MAX } from './config';
import { UUID_RE, likeEscape, searchTerms } from './text';

export interface CartProduct { product_id: string; name: string; sku: string; price: number; image_url: string | null; sellable: boolean }
/** SAL (đơn hộ): `cost_price` chỉ ở trong tiến trình, KHÔNG BAO GIỜ ra HTTP cho sale, staff hay customer (SB-42). */
export interface SaleProduct { product_id: string; name: string; sku: string; price: number; cost_price: number | null; sellable: boolean }
export interface ProductSummary { product_id: string; name: string; sku: string; image_url: string | null; status: 'draft' | 'active' | 'archived' }

const FIRST_IMAGE = Prisma.sql`(SELECT i.storage_key FROM product_images i WHERE i.product_id = p.id ORDER BY i.position LIMIT 1)`;
function ids(list: string[], max: number, name: string): string[] {
  if (!Array.isArray(list) || list.length > max) throw new RangeError(`${name}: tối đa ${max} id mỗi lần gọi`); // từ chối cả lời gọi, không trả một phần
  return [...new Set(list.filter((x) => typeof x === 'string' && UUID_RE.test(x)).map((x) => x.toLowerCase()))]; // id sai định dạng hay không tồn tại thì không có trong kết quả
}
function limitOf(n: number, max: number, name: string): number {
  if (!Number.isInteger(n) || n < 1 || n > max) throw new RangeError(`${name}: limit phải là số nguyên từ 1 đến ${max}`);
  return n;
}

/**
 * Giao diện nội bộ PRD phơi ra cho module khác (ADR-012, bảng "Giao diện module" của architecture.md, PRD-API mục Giao tiếp giữa module): phương thức trong tiến trình, chỉ đọc, không nhận `tx`.
 * Chữ ký là bản chốt của PRD; bên gọi (CRT, INV, REV, DSH) dùng đúng chữ ký này.
 */
@Injectable()
export class CatalogApi {
  constructor(private readonly prisma: PrismaService, @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage) {}

  private url = (key: string | null): string | null => (key ? this.storage.urlFor(key) : null);

  /** CRT: dữ liệu để dựng giỏ theo lô (tối đa 100 id); `sellable` = true chỉ khi sản phẩm `active`. */
  async getForCart(productIds: string[]): Promise<CartProduct[]> {
    const list = ids(productIds, BATCH_LIMIT, 'getForCart');
    if (!list.length) return [];
    const rows = await this.prisma.$queryRaw<{ id: string; name: string; sku: string; price: bigint; status: string; image_key: string | null }[]>`
      SELECT p.id, p.name, p.sku, p.price, p.status, ${FIRST_IMAGE} AS image_key FROM products p WHERE p.id = ANY(${list}::uuid[]) ORDER BY p.id`;
    return rows.map((r) => ({ product_id: r.id, name: r.name, sku: r.sku, price: Number(r.price), image_url: this.url(r.image_key), sellable: r.status === 'active' }));
  }

  /**
   * SAL: dòng đơn hộ theo lô (tối đa 100 id, quá thì RangeError, không trả một phần); `sellable` = `active`; `cost_price` số hoặc null để SAL chụp `cost_snapshot` và truyền sang `OrderApi.createHo`.
   * Không có endpoint HTTP tương ứng và kết quả không được đưa vào phản hồi của sale (PRD-API mục Giao tiếp giữa module, SB-42).
   */
  async getForSale(productIds: string[]): Promise<SaleProduct[]> {
    const list = ids(productIds, BATCH_LIMIT, 'getForSale');
    if (!list.length) return [];
    const rows = await this.prisma.$queryRaw<{ id: string; name: string; sku: string; price: bigint; cost_price: bigint | null; status: string }[]>`
      SELECT p.id, p.name, p.sku, p.price, p.cost_price, p.status FROM products p WHERE p.id = ANY(${list}::uuid[]) ORDER BY p.id`;
    return rows.map((r) => ({ product_id: r.id, name: r.name, sku: r.sku, price: Number(r.price), cost_price: r.cost_price === null ? null : Number(r.cost_price), sellable: r.status === 'active' }));
  }

  /** INV, REV: tên, sku, ảnh đại diện và trạng thái theo lô (tối đa 100 id), mọi trạng thái. Không có giá hay mô tả. */
  async getSummaries(productIds: string[]): Promise<ProductSummary[]> {
    const list = ids(productIds, BATCH_LIMIT, 'getSummaries');
    if (!list.length) return [];
    const rows = await this.prisma.$queryRaw<{ id: string; name: string; sku: string; status: ProductSummary['status']; image_key: string | null }[]>`
      SELECT p.id, p.name, p.sku, p.status, ${FIRST_IMAGE} AS image_key FROM products p WHERE p.id = ANY(${list}::uuid[]) ORDER BY p.id`;
    return rows.map((r) => ({ product_id: r.id, name: r.name, sku: r.sku, image_url: this.url(r.image_key), status: r.status }));
  }

  /** INV: id sản phẩm khớp `q` theo tên và sku, cùng cách chuẩn hóa với tìm kiếm công khai (ADR-019), mọi trạng thái (INV giữ kho của cả sản phẩm đã ngừng bán), tối đa `limit` <= 200. */
  async searchProductIds(q: string, limit: number): Promise<string[]> {
    const n = limitOf(limit, SEARCH_LIMIT, 'searchProductIds');
    if (typeof q === 'string' && [...q].length > SEARCH_Q_MAX) throw new RangeError(`searchProductIds: q tối đa ${SEARCH_Q_MAX} ký tự (như tìm kiếm công khai)`); // mỗi từ là một tham số truy vấn: q dài vô hạn làm vỡ giới hạn tham số của PostgreSQL
    const terms = searchTerms(String(q ?? ''));
    if (!terms.length) return [];
    const cond = Prisma.join(terms.map((t) => Prisma.sql`p.search_text LIKE ${`%${likeEscape(t)}%`}`), ' AND ');
    const rows = await this.prisma.$queryRaw<{ id: string }[]>`SELECT p.id FROM products p WHERE ${cond} ORDER BY p.id LIMIT ${n}`;
    return rows.map((r) => r.id);
  }

  /** INV: `product_id` của sản phẩm `active` theo `id` tăng dần, từ sau `afterId`, tối đa `limit` <= 500 (đối soát, tạo bù hàng kho). */
  async listActiveProductIds(afterId: string | undefined, limit: number): Promise<string[]> {
    const n = limitOf(limit, ACTIVE_ID_LIMIT, 'listActiveProductIds');
    if (afterId !== undefined && !UUID_RE.test(afterId)) throw new RangeError('listActiveProductIds: after_id phải là uuid');
    const rows = await this.prisma.$queryRaw<{ id: string }[]>`
      SELECT id FROM products WHERE status = 'active' AND (${afterId ?? null}::uuid IS NULL OR id > ${afterId ?? null}::uuid) ORDER BY id LIMIT ${n}`;
    return rows.map((r) => r.id);
  }

  /** DSH: số sản phẩm theo trạng thái (không có sản phẩm nào thì cả ba bằng 0). Không trả tên hay trường cá nhân. */
  async countByStatus(): Promise<{ draft: number; active: number; archived: number }> {
    const rows = await this.prisma.$queryRaw<{ status: 'draft' | 'active' | 'archived'; n: bigint }[]>`SELECT status, count(*) AS n FROM products GROUP BY status`;
    const out = { draft: 0, active: 0, archived: 0 };
    for (const r of rows) out[r.status] = Number(r.n);
    return out;
  }
}
