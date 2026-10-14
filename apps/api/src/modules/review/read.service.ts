import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { ProductSummary } from '../catalog';
import { Clock, ConfigService, DomainError, PrismaService, toPage, type SessionContext } from '../platform';
import { UUID_RE, type ReviewRow } from './db';
import { DepsService } from './deps.service';
import type { AdminListQuery, MineListQuery, PublicListQuery } from './policy';
import { REVIEW_COLS } from './db';
import { decide, type NotEligible } from './review.service';
import { ViewService, bare, type ImageView } from './view.service';

const iso = (d: Date | null): string | null => (d ? d.toISOString() : null);
const skipOf = (page: number, limit: number): number => (page - 1) * limit;

/**
 * Đọc đánh giá (REV-REQ-20261006-103135566, ...135655, ...135744, ...135296; REV-DB mục 5 và 6): công khai chỉ `status = 'published'` và KHÔNG BAO GIỜ chọn `user_id`, `order_item_id`, `moderation_reason`
 * vào kết quả công khai (SB-08); của chủ luôn có `user_id` từ phiên trong truy vấn (SB-06) và `status <> 'deleted'`; hàng đợi admin chỉ admin. Dữ kiện của PRD, AUTH đọc theo lô, ngoài truy vấn của REV (không join, SB-35).
 * Trang vượt quá trang cuối trả danh sách rỗng mà không chạy OFFSET (không đẩy số lớn vào PostgreSQL).
 */
@Injectable()
export class ReadService {
  constructor(private readonly prisma: PrismaService, private readonly deps: DepsService, private readonly views: ViewService, private readonly clock: Clock, private readonly config: ConfigService) {}
  private get preModeration(): boolean { return this.config.get<boolean>('REVIEW_PRE_MODERATION'); }

  /** Danh sách công khai của một sản phẩm `active` (404 cùng nội dung cho không tồn tại, `draft`, `archived`, id sai định dạng). */
  async publicList(productId: string, q: PublicListQuery) {
    if (!UUID_RE.test(productId)) throw new DomainError('not-found');
    const pid = productId.toLowerCase();
    const prod = (await this.deps.products([pid])).get(pid);
    if (!prod || prod.status !== 'active') throw new DomainError('not-found');
    const dist = await this.prisma.$queryRaw<{ rating: number; n: number }[]>`
      SELECT rating::int AS rating, count(*)::int AS n FROM reviews WHERE product_id = ${pid}::uuid AND status = 'published'::review_status GROUP BY rating`;
    const distribution: Record<string, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    for (const d of dist) distribution[String(d.rating)] = d.n;
    const count = Object.values(distribution).reduce((a, b) => a + b, 0);
    const sum = Object.entries(distribution).reduce((a, [k, n]) => a + Number(k) * n, 0);
    const avg = count === 0 ? null : Math.floor((20 * sum + count) / (2 * count)) / 10; // nửa lên một chữ số thập phân bằng số nguyên (3.75 thành 3.8, 4.5 giữ 4.5), không sai số số thực
    const total = q.rating ? distribution[String(q.rating)] : count;
    let rows: { id: string; rating: number; comment: string | null; user_id: string; published_at: Date; edited_at: Date | null }[] = [];
    const skip = skipOf(q.page, q.limit);
    if (skip < total) {
      const order = q.sort === 'highest' ? Prisma.sql`rating DESC, published_at DESC, id DESC` : q.sort === 'lowest' ? Prisma.sql`rating ASC, published_at DESC, id DESC` : Prisma.sql`published_at DESC, id DESC`;
      const byRating = q.rating ? Prisma.sql`AND rating = ${q.rating}` : Prisma.empty;
      // Chọn đúng các cột công khai: không `user_id` ra khỏi hàm này (chỉ để tra tên), không `order_item_id`, không `moderation_reason`, không `status`.
      rows = await this.prisma.$queryRaw(Prisma.sql`
        SELECT id, rating::int AS rating, comment, user_id, published_at, edited_at FROM reviews
        WHERE product_id = ${pid}::uuid AND status = 'published'::review_status ${byRating} ORDER BY ${order} LIMIT ${q.limit} OFFSET ${skip}`);
    }
    const [images, names] = await Promise.all([this.views.imagesOf(rows.map((r) => r.id)), this.deps.names(rows.map((r) => r.user_id))]);
    const items = rows.map((r) => ({
      id: r.id, rating: r.rating, comment: r.comment, images: bare(images.get(r.id) ?? []),
      reviewer: { display_name: names.get(r.user_id)?.display_name ?? 'Khách hàng', avatar_url: names.get(r.user_id)?.avatar_url ?? null },
      verified_purchase: true, published_at: iso(r.published_at), edited_at: iso(r.edited_at),
    }));
    return { ...toPage(items, total, q), summary: { count, avg, distribution } };
  }

  /** Điều kiện được đánh giá của chính mình (không thay cho kiểm lúc tạo). 404 khi sản phẩm không tồn tại, `draft`, `archived`. */
  async eligibility(s: SessionContext, productId: string): Promise<{ eligible: boolean; reason: NotEligible | null }> {
    const pid = UUID_RE.test(productId) ? productId.toLowerCase() : null;
    const facts = await this.deps.facts(s.user_id, pid);
    if (!pid || !facts.product || facts.product.status !== 'active') throw new DomainError('not-found');
    const [existing] = await this.prisma.$queryRaw<{ id: string }[]>`SELECT id FROM reviews WHERE user_id = ${s.user_id}::uuid AND product_id = ${pid}::uuid AND status <> 'deleted'::review_status LIMIT 1`;
    const d = decide(facts, !!existing, this.clock.now());
    return d.ok ? { eligible: true, reason: null } : { eligible: false, reason: d.reason };
  }

  private mineItem(r: ReviewRow, images: ImageView[], product: ProductSummary | undefined) {
    const live = r.status === 'pending' || r.status === 'published';
    return {
      id: r.id,
      product: { id: r.product_id, name: product?.name ?? '', image_url: product?.image_url ?? null, status: product?.status ?? 'archived' },
      status: r.status, rating: r.rating, comment: r.comment, images, created_at: r.created_at.toISOString(), edited_at: iso(r.edited_at),
      ...(r.status === 'rejected' || r.status === 'hidden' ? { moderation_reason: r.moderation_reason } : {}),
      can_edit: live, can_delete: true, edit_requires_review: r.status === 'published' && this.preModeration,
    };
  }

  /** Danh sách của chủ: `user_id` từ phiên luôn nằm trong truy vấn, không bao giờ từ tham số; `Cache-Control: no-store` do controller đặt. */
  async mine(s: SessionContext, q: MineListQuery) {
    const byStatus = q.status ? Prisma.sql`AND status = ${q.status}::review_status` : Prisma.empty;
    const [{ n }] = await this.prisma.$queryRaw<{ n: number }[]>(Prisma.sql`SELECT count(*)::int AS n FROM reviews WHERE user_id = ${s.user_id}::uuid AND status <> 'deleted'::review_status ${byStatus}`);
    const skip = skipOf(q.page, q.limit);
    const rows = skip < n ? await this.prisma.$queryRaw<ReviewRow[]>(Prisma.sql`
      SELECT ${REVIEW_COLS} FROM reviews WHERE user_id = ${s.user_id}::uuid AND status <> 'deleted'::review_status ${byStatus}
      ORDER BY created_at DESC, id DESC LIMIT ${q.limit} OFFSET ${skip}`) : [];
    const [images, products] = await Promise.all([this.views.imagesOf(rows.map((r) => r.id)), this.deps.products(rows.map((r) => r.product_id))]);
    return toPage(rows.map((r) => this.mineItem(r, images.get(r.id) ?? [], products.get(r.product_id))), n, q);
  }

  /** Chi tiết của chủ: đánh giá của người khác, không tồn tại, đã xóa và id sai định dạng cùng 404. */
  async mineOne(s: SessionContext, id: string) {
    if (!UUID_RE.test(id)) throw new DomainError('not-found');
    const [r] = await this.prisma.$queryRaw<ReviewRow[]>`SELECT ${REVIEW_COLS} FROM reviews WHERE id = ${id}::uuid AND user_id = ${s.user_id}::uuid AND status <> 'deleted'::review_status`;
    if (!r) throw new DomainError('not-found');
    const [images, products] = await Promise.all([this.views.imagesOf([r.id]), this.deps.products([r.product_id])]);
    return this.mineItem(r, images.get(r.id) ?? [], products.get(r.product_id));
  }

  /** Hàng đợi admin (REV-DB mục 6): `pending` cũ nhất trước, trạng thái khác mới nhất trước; `pending_count` không phụ thuộc bộ lọc. Không email, điện thoại. */
  async admin(q: AdminListQuery) {
    const where = Prisma.sql`status = ${q.status}::review_status${q.product_id ? Prisma.sql` AND product_id = ${q.product_id}::uuid` : Prisma.empty}${q.rating ? Prisma.sql` AND rating = ${q.rating}` : Prisma.empty}`;
    const [{ n }] = await this.prisma.$queryRaw<{ n: number }[]>(Prisma.sql`SELECT count(*)::int AS n FROM reviews WHERE ${where}`);
    const [{ p }] = await this.prisma.$queryRaw<{ p: number }[]>`SELECT count(*)::int AS p FROM reviews WHERE status = 'pending'::review_status`;
    const skip = skipOf(q.page, q.limit);
    const order = q.status === 'pending' ? Prisma.sql`created_at ASC, id ASC` : Prisma.sql`created_at DESC, id DESC`;
    const rows = skip < n ? await this.prisma.$queryRaw<ReviewRow[]>(Prisma.sql`SELECT ${REVIEW_COLS} FROM reviews WHERE ${where} ORDER BY ${order} LIMIT ${q.limit} OFFSET ${skip}`) : [];
    const [images, products, names] = await Promise.all([
      this.views.imagesOf(rows.map((r) => r.id)), this.deps.products(rows.map((r) => r.product_id)), this.deps.names(rows.map((r) => r.user_id)),
    ]);
    const items = rows.map((r) => ({
      id: r.id, status: r.status, rating: r.rating, comment: r.comment, images: bare(images.get(r.id) ?? []), created_at: r.created_at.toISOString(), edited_at: iso(r.edited_at),
      reviewer: { user_id: r.user_id, display_name: names.get(r.user_id)?.display_name ?? 'Khách hàng' },
      product: { id: r.product_id, name: products.get(r.product_id)?.name ?? '' },
      moderation_reason: r.moderation_reason, moderated_at: iso(r.moderated_at),
    }));
    return { ...toPage(items, n, q), pending_count: p };
  }
}
