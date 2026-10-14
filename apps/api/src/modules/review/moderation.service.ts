import { Injectable } from '@nestjs/common';
import { AppLogger, AuditService, Clock, DomainError, EventsService, TransactionService, type SessionContext } from '../platform';
import { MODERATION, type ModerationName } from './config';
import { REVIEW_COLS, UUID_RE, type ReviewRow } from './db';

/**
 * Duyệt, từ chối, ẩn, bỏ ẩn (REV-REQ-20261006-103135835; REV-DB mục Giao dịch và khóa 3, SB-24, SB-19): MỘT giao dịch: khóa dòng (`FOR UPDATE`), kiểm trạng thái hiện tại thuộc cột Từ của bảng chuyển
 * (`MODERATION`: sai thì 409 `invalid_review_state`, không audit, không event), `UPDATE ... WHERE status = :cũ`, audit và event cùng giao dịch (audit hay outbox lỗi thì cả chuyển rollback). Hai admin cùng lúc:
 * khóa dòng xếp thứ tự, bên sau thấy trạng thái mới và nhận 409; chỉ một event. `rating` của event lấy từ dòng ĐÃ KHÓA (ca chủ vừa sửa điểm). Chỉ admin (ma trận quyền); không sửa nội dung.
 */
@Injectable()
export class ModerationService {
  private readonly log: AppLogger;
  constructor(private readonly transactions: TransactionService, private readonly audit: AuditService, private readonly events: EventsService, private readonly clock: Clock, logger: AppLogger) {
    this.log = logger.for('review');
  }

  async act(s: SessionContext, name: ModerationName, id: string, reason?: string): Promise<{ id: string; status: string }> {
    if (!UUID_RE.test(id)) throw new DomainError('not-found');
    const t = MODERATION[name];
    return this.transactions.run(async (tx) => {
      const [cur] = await tx.$queryRaw<ReviewRow[]>`SELECT ${REVIEW_COLS} FROM reviews WHERE id = ${id}::uuid FOR UPDATE`;
      if (!cur || cur.status === 'deleted') throw new DomainError('not-found');
      if (!(t.from as readonly string[]).includes(cur.status)) throw new DomainError('review-conflict', { extra: { code: 'invalid_review_state' } });
      const now = this.clock.now();
      const why = t.reason ? (reason ?? null) : null; // bỏ ẩn và duyệt xóa lý do (NULL); từ chối, ẩn ghi lý do
      const [row] = await tx.$queryRaw<ReviewRow[]>`
        UPDATE reviews SET status = ${t.to}::review_status, moderated_by = ${s.user_id}::uuid, moderated_at = ${now}::timestamptz, moderation_reason = ${why},
          published_at = CASE WHEN ${t.to === 'published'}::boolean THEN COALESCE(published_at, ${now}::timestamptz) ELSE published_at END, updated_at = ${now}::timestamptz
        WHERE id = ${cur.id}::uuid AND status = ${cur.status}::review_status RETURNING ${REVIEW_COLS}`;
      if (!row) throw new DomainError('review-conflict', { extra: { code: 'invalid_review_state' } }); // lưới an toàn thứ hai sau khóa dòng
      await this.audit.record(tx, {
        actor_id: s.user_id, actor_role: 'admin', action: `review.${name}`, target_type: 'review', target_id: cur.id,
        before: { status: cur.status, product_id: cur.product_id }, after: { status: row.status, product_id: cur.product_id }, ...(why ? { reason: why } : {}),
      });
      if (t.event) await this.events.publish(tx, { type: t.event, aggregate_type: 'review', aggregate_id: cur.id, payload: { review_id: cur.id, product_id: cur.product_id, rating: row.rating } });
      this.log.info('đánh giá đã kiểm duyệt', { code: 'review-moderated', review_id: cur.id, action: name, status_before: cur.status, status: row.status, reason_length: why ? [...why].length : 0 }); // không ghi nội dung bình luận hay lý do
      return { id: cur.id, status: row.status };
    });
  }
}
