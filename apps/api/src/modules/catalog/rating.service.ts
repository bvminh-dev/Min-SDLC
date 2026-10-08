import { Injectable } from '@nestjs/common';
import { AppLogger, EventsService, type EventEnvelope, type Tx } from '../platform';
import { UUID_RE } from './text';

export const RATING_EVENTS = ['ReviewPublished', 'ReviewHidden', 'ReviewUnpublished', 'ReviewDeleted', 'ReviewRatingChanged'] as const;
const COUNT_DOWN = new Set(['ReviewHidden', 'ReviewUnpublished', 'ReviewDeleted']);
const isRating = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= 5;

/**
 * Điểm đánh giá (PRD-REQ-20261006-095502739, PRD-DB mục Giao dịch và khóa 7): consumer `catalog` của event REV qua outbox, tác nhân `system`, không có HTTP.
 * Chống trùng hai lớp: ProcessedEvent theo `event_id` (EventsService.deliver mở giao dịch và chèn trước khi gọi handler) và `counted` theo `review_id`.
 * Mọi cập nhật tổng là tương đối (một câu UPDATE) nên hai event song song không mất cập nhật; trừ theo `rating` đã lưu, không theo payload.
 */
@Injectable()
export class RatingService {
  private readonly log: AppLogger;
  constructor(private readonly events: EventsService, logger: AppLogger) {
    this.log = logger.for('catalog');
  }

  register(): void {
    for (const type of RATING_EVENTS) this.events.subscribe('catalog', type, (tx, e) => this.handle(tx, e));
  }

  async handle(tx: Tx, e: EventEnvelope): Promise<void> {
    const p = e.payload;
    const reviewId = typeof p.review_id === 'string' && UUID_RE.test(p.review_id) ? p.review_id : null;
    const productId = typeof p.product_id === 'string' && UUID_RE.test(p.product_id) ? p.product_id : null;
    const skip = (reason: string) => this.log.warn('bỏ qua event điểm đánh giá', { event_type: e.type, event_id: e.event_id, reason }); // không ghi nội dung payload
    if (!reviewId) return skip('review_id không hợp lệ');

    if (e.type === 'ReviewPublished') {
      if (!productId) return skip('product_id không hợp lệ');
      if (!isRating(p.rating)) return skip('rating ngoài 1..5');
      const [prod] = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM products WHERE id = ${productId}::uuid`;
      if (!prod) return skip('sản phẩm không tồn tại');
      // chèn mới, hoặc bật lại bản chiếu đang ẩn (counted = false) với điểm mới; đã counted thì không đổi gì
      const [r] = await tx.$queryRaw<{ product_id: string }[]>`
        INSERT INTO product_review_ratings (review_id, product_id, rating, counted) VALUES (${reviewId}::uuid, ${productId}::uuid, ${p.rating}, true)
        ON CONFLICT (review_id) DO UPDATE SET counted = true, rating = EXCLUDED.rating, updated_at = now() WHERE product_review_ratings.counted = false
        RETURNING product_id`;
      if (r) await tx.$executeRaw`UPDATE products SET rating_count = rating_count + 1, rating_sum = rating_sum + ${p.rating} WHERE id = ${r.product_id}::uuid`;
      return;
    }

    if (COUNT_DOWN.has(e.type)) {
      const [r] = await tx.$queryRaw<{ product_id: string; rating: number }[]>`
        UPDATE product_review_ratings SET counted = false, updated_at = now() WHERE review_id = ${reviewId}::uuid AND counted RETURNING product_id, rating`;
      if (r) await tx.$executeRaw`UPDATE products SET rating_count = rating_count - 1, rating_sum = rating_sum - ${r.rating} WHERE id = ${r.product_id}::uuid`;
      else if (!(await tx.$queryRaw<unknown[]>`SELECT 1 FROM product_review_ratings WHERE review_id = ${reviewId}::uuid`).length) skip('review_id chưa từng thấy ReviewPublished');
      return;
    }

    // ReviewRatingChanged: đang tính thì `rating_sum` đổi theo (mới - cũ), đang ẩn thì chỉ cập nhật điểm đã lưu
    if (!isRating(p.new_rating)) return skip('new_rating ngoài 1..5');
    const [cur] = await tx.$queryRaw<{ product_id: string; rating: number; counted: boolean }[]>`SELECT product_id, rating, counted FROM product_review_ratings WHERE review_id = ${reviewId}::uuid FOR UPDATE`;
    if (!cur) return skip('review_id chưa từng thấy ReviewPublished');
    await tx.$executeRaw`UPDATE product_review_ratings SET rating = ${p.new_rating}, updated_at = now() WHERE review_id = ${reviewId}::uuid`;
    if (cur.counted) await tx.$executeRaw`UPDATE products SET rating_sum = rating_sum + ${p.new_rating - cur.rating} WHERE id = ${cur.product_id}::uuid`;
  }
}
