import { Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import {
  AppLogger, AuditService, Clock, ConfigService, DomainError, EventsService, IdempotencyService, TransactionService, type SessionContext, type Tx,
} from '../platform';
import { REVIEW_WINDOW_MS, SCOPE } from './config';
import { REVIEW_COLS, UUID_RE, isUnique, type ReviewRow } from './db';
import { DepsService, type Facts } from './deps.service';
import { ImageService } from './image.service';
import type { CreateBody, PatchBody } from './policy';
import { ViewService, type OwnerView } from './view.service';

export type NotEligible = 'already_reviewed' | 'not_purchased' | 'not_delivered' | 'window_expired';
export type Decision = { ok: true; order_item_id: string } | { ok: false; reason: NotEligible };

/**
 * Điều kiện được đánh giá (REV-REQ-20261006-103135296 BR2, BR3), thứ tự ưu tiên: already_reviewed, not_purchased, not_delivered, window_expired. Cửa sổ 90 ngày tính đến ĐÚNG `delivered_at` + 90 x 24 giờ (bao gồm);
 * nhiều dòng đơn thì chọn dòng giao gần nhất còn trong cửa sổ. Hàm thuần: bên gọi đã đọc dữ kiện ngoài giao dịch.
 */
export function decide(f: Facts, alreadyReviewed: boolean, now: Date): Decision {
  if (alreadyReviewed) return { ok: false, reason: 'already_reviewed' };
  if (!f.delivered.length) return { ok: false, reason: f.undelivered ? 'not_delivered' : 'not_purchased' };
  const inWindow = f.delivered
    .filter((d) => d.delivered_at.getTime() + REVIEW_WINDOW_MS >= now.getTime())
    .sort((a, b) => b.delivered_at.getTime() - a.delivered_at.getTime() || a.order_item_id.localeCompare(b.order_item_id));
  if (inWindow.length) return { ok: true, order_item_id: inWindow[0].order_item_id };
  return { ok: false, reason: f.undelivered ? 'not_delivered' : 'window_expired' }; // BR3 xét theo thứ tự: bước 4 (còn đơn chưa giao) đứng trước bước 5 (mọi dòng đã giao quá 90 ngày)
}

const canonical = (v: unknown): unknown =>
  Array.isArray(v) ? v.map(canonical)
    : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, canonical((v as Record<string, unknown>)[k])]))
      : v;
/** Băm yêu cầu tạo (method, mẫu route, tham số đường dẫn và thân đã chuẩn hóa): cùng khóa khác nội dung thì 422 `idempotency-key-reused` (ADR-017). */
const hashOf = (productId: string, body: CreateBody): string =>
  createHash('sha256').update(`POST\n/api/v1/products/:product_id/reviews\n${JSON.stringify(canonical({ params: { product_id: productId }, body }))}`).digest('hex');

const conflict = (code: string): DomainError => new DomainError('review-conflict', { extra: { code } });

/**
 * Tạo, sửa, xóa đánh giá (REV-REQ-20261006-103134939, ...135385, ...135477; REV-DB mục Giao dịch và khóa 1, 2, 4). Mọi thay đổi trạng thái, ảnh, event (outbox) và audit nằm trong MỘT giao dịch (ADR-011, SB-27, SB-19).
 * Dữ kiện của PRD, ORD đọc NGOÀI giao dịch (DepsService) rồi truyền vào; trong giao dịch chỉ chạm bảng của REV và outbox, audit của platform (không giữ kết nối thứ nhất rồi xin kết nối thứ hai, SB-31).
 * Chủ sở hữu luôn nằm trong điều kiện truy vấn (`user_id` từ phiên, SB-06); đánh giá của người khác, không tồn tại, đã xóa và id sai định dạng cùng 404 (SB-06).
 */
@Injectable()
export class ReviewService {
  private readonly log: AppLogger;
  constructor(
    private readonly transactions: TransactionService, private readonly idem: IdempotencyService, private readonly events: EventsService, private readonly audit: AuditService, private readonly clock: Clock,
    private readonly deps: DepsService, private readonly images: ImageService, private readonly views: ViewService, private readonly config: ConfigService, logger: AppLogger,
  ) {
    this.log = logger.for('review');
  }

  /** Cờ kiểm duyệt trước (REVIEW_PRE_MODERATION, ADR-007): đổi bằng biến môi trường và khởi động lại. */
  private get preModeration(): boolean { return this.config.get<boolean>('REVIEW_PRE_MODERATION'); }

  async create(s: SessionContext, key: string, productId: string, body: CreateBody): Promise<{ replayed: boolean; status: number; body: OwnerView }> {
    const pid = UUID_RE.test(productId) ? productId.toLowerCase() : null;
    const facts = await this.deps.facts(s.user_id, pid); // ngoài giao dịch
    const out = await this.idem.run<OwnerView>({ scope: SCOPE, userId: s.user_id, key, requestHash: hashOf(productId, body) }, async (tx) => {
      if (!pid || !facts.product || facts.product.status !== 'active') throw new DomainError('not-found'); // không tồn tại, draft, archived, sai định dạng: cùng 404
      const [existing] = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM reviews WHERE user_id = ${s.user_id}::uuid AND product_id = ${pid}::uuid AND status <> 'deleted'::review_status LIMIT 1`;
      const d = decide(facts, !!existing, this.clock.now());
      if (!d.ok) throw conflict(d.reason);
      return { status: 201, body: await this.insert(tx, s, pid, d.order_item_id, body) };
    });
    return out;
  }

  private async insert(tx: Tx, s: SessionContext, productId: string, orderItemId: string, body: CreateBody): Promise<OwnerView> {
    const now = this.clock.now();
    let row: ReviewRow;
    try {
      [row] = await tx.$queryRaw<ReviewRow[]>`
        INSERT INTO reviews (user_id, product_id, order_item_id, status, rating, comment, created_at, updated_at)
        VALUES (${s.user_id}::uuid, ${productId}::uuid, ${orderItemId}::uuid, 'pending'::review_status, ${body.rating}, ${body.comment}, ${now}::timestamptz, ${now}::timestamptz)
        RETURNING ${REVIEW_COLS}`;
    } catch (e) {
      if (isUnique(e)) throw conflict('already_reviewed'); // hai yêu cầu song song khóa khác nhau: chỉ mục duy nhất một phần cho đúng một bên thắng
      throw e;
    }
    if (body.image_ids.length) await this.images.attach(tx, row.id, s.user_id, body.image_ids);
    if (!this.preModeration) {
      const [pub] = await tx.$queryRaw<ReviewRow[]>`
        UPDATE reviews SET status = 'published'::review_status, published_at = ${now}::timestamptz, updated_at = ${now}::timestamptz
        WHERE id = ${row.id}::uuid AND status = 'pending'::review_status RETURNING ${REVIEW_COLS}`;
      row = pub;
      await this.events.publish(tx, { type: 'ReviewPublished', aggregate_type: 'review', aggregate_id: row.id, payload: { review_id: row.id, product_id: row.product_id, rating: row.rating } });
    }
    this.log.info('đánh giá đã tạo', { code: 'review-created', review_id: row.id, status: row.status, comment_length: body.comment === null ? 0 : [...body.comment].length }); // không ghi nội dung bình luận (SB-18)
    return this.views.owner(row, (await this.views.imagesOf([row.id], tx)).get(row.id) ?? []);
  }

  /** Sửa một phần (REV-DB mục 2): khóa dòng (`FOR UPDATE`, đúng chủ), kiểm trạng thái, so với giá trị hiện tại (không đổi gì thì trả 200, không ghi), rồi cập nhật cùng event. */
  async edit(s: SessionContext, id: string, b: PatchBody): Promise<OwnerView> {
    if (!UUID_RE.test(id)) throw new DomainError('not-found');
    return this.transactions.run(async (tx) => {
      const [cur] = await tx.$queryRaw<ReviewRow[]>`SELECT ${REVIEW_COLS} FROM reviews WHERE id = ${id}::uuid AND user_id = ${s.user_id}::uuid FOR UPDATE`;
      if (!cur || cur.status === 'deleted') throw new DomainError('not-found');
      if (cur.status !== 'pending' && cur.status !== 'published') throw conflict('review_not_editable'); // hidden, rejected: trạng thái cuối ngoài xóa, bỏ ẩn
      const before = (await this.views.imagesOf([cur.id], tx)).get(cur.id) ?? [];
      const curIds = (await tx.$queryRaw<{ id: string }[]>`SELECT id FROM review_images WHERE review_id = ${cur.id}::uuid ORDER BY position`).map((r) => r.id);
      const rating = b.rating ?? cur.rating;
      const comment = b.comment === undefined ? cur.comment : b.comment;
      const ids = b.image_ids ?? curIds;
      const imagesChanged = ids.length !== curIds.length || ids.some((x, i) => x !== curIds[i]);
      if (rating === cur.rating && comment === cur.comment && !imagesChanged) return this.views.owner(cur, before); // không có gì đổi: không ghi, không event
      const now = this.clock.now();
      const wasPublished = cur.status === 'published';
      const toPending = wasPublished && this.preModeration; // E-22: nội dung mới chỉ hiện công khai sau khi admin duyệt lại (T13)
      const [row] = await tx.$queryRaw<ReviewRow[]>`
        UPDATE reviews SET rating = ${rating}, comment = ${comment}, edited_at = ${wasPublished ? now : cur.edited_at}::timestamptz,
          status = ${toPending ? 'pending' : cur.status}::review_status, updated_at = ${now}::timestamptz
        WHERE id = ${cur.id}::uuid AND status = ${cur.status}::review_status RETURNING ${REVIEW_COLS}`;
      if (imagesChanged) {
        const prev = await this.images.detachAll(tx, cur.id, false);
        await this.images.attach(tx, cur.id, s.user_id, ids, prev);
        await this.images.orphan(tx, prev.filter((x) => !ids.includes(x)));
      }
      if (toPending) {
        await this.events.publish(tx, { type: 'ReviewUnpublished', aggregate_type: 'review', aggregate_id: cur.id, payload: { review_id: cur.id, product_id: cur.product_id, rating: cur.rating } }); // điểm của bản đã đăng, trước khi đổi (R-20)
      } else if (wasPublished && rating !== cur.rating) {
        await this.events.publish(tx, { type: 'ReviewRatingChanged', aggregate_type: 'review', aggregate_id: cur.id, payload: { review_id: cur.id, product_id: cur.product_id, old_rating: cur.rating, new_rating: rating } });
      }
      this.log.info('đánh giá đã sửa', { code: 'review-edited', review_id: cur.id, status: row.status, comment_length: comment === null ? 0 : [...comment].length });
      return this.views.owner(row, (await this.views.imagesOf([row.id], tx)).get(row.id) ?? []);
    });
  }

  /** Xóa (REV-DB mục 4): customer xóa của mình, admin xóa mọi đánh giá; ở mọi trạng thái trừ `deleted` (404). Phát ReviewDeleted một lần; admin xóa ghi audit cùng giao dịch. */
  async remove(s: SessionContext, id: string): Promise<void> {
    if (!UUID_RE.test(id)) throw new DomainError('not-found');
    const admin = s.role === 'admin';
    await this.transactions.run(async (tx) => {
      const [cur] = admin
        ? await tx.$queryRaw<ReviewRow[]>`SELECT ${REVIEW_COLS} FROM reviews WHERE id = ${id}::uuid FOR UPDATE`
        : await tx.$queryRaw<ReviewRow[]>`SELECT ${REVIEW_COLS} FROM reviews WHERE id = ${id}::uuid AND user_id = ${s.user_id}::uuid FOR UPDATE`;
      if (!cur || cur.status === 'deleted') throw new DomainError('not-found');
      const now = this.clock.now();
      const [row] = await tx.$queryRaw<{ id: string }[]>`
        UPDATE reviews SET status = 'deleted'::review_status, deleted_at = ${now}::timestamptz, deleted_by_role = ${admin ? 'admin' : 'customer'}::review_actor_role, updated_at = ${now}::timestamptz
        WHERE id = ${cur.id}::uuid AND status = ${cur.status}::review_status RETURNING id`;
      if (!row) throw new DomainError('not-found'); // lưới an toàn thứ hai sau khóa dòng
      await this.images.detachAll(tx, cur.id, true); // ảnh về chưa gắn, dọn sau 24 giờ
      await this.events.publish(tx, { type: 'ReviewDeleted', aggregate_type: 'review', aggregate_id: cur.id, payload: { review_id: cur.id, product_id: cur.product_id, rating: cur.rating } });
      this.log.info('đánh giá đã xóa', { code: 'review-deleted', review_id: cur.id, status_before: cur.status, by_role: admin ? 'admin' : 'customer' });
      if (admin) {
        await this.audit.record(tx, {
          actor_id: s.user_id, actor_role: 'admin', action: 'review.delete', target_type: 'review', target_id: cur.id,
          before: { status: cur.status, product_id: cur.product_id }, after: { status: 'deleted', product_id: cur.product_id },
        });
      }
    });
  }
}
