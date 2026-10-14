import { Injectable } from '@nestjs/common';
import { AuthApi } from '../auth';
import { AppLogger, Clock, EventsService, SKIP, type EventEnvelope, type Tx } from '../platform';
import { MAX_RECIPIENTS } from './config';
import { EmailService } from './email.service';
import { planEvent, type Plan } from './templates';

const CONSUMER = 'NTF'; // `consumer` của ProcessedEvent (NTF-REQ-20261006-103208460 BR2)
/** Mười sáu event đi qua outbox có NTF trong Consumers của events.md (nhận qua bus nội bộ, ADR-011). */
export const OUTBOX_EVENTS = [
  'OrderCreated', 'OrderConfirmed', 'OrderCancelled', 'OrderExpired', 'OrderShipped', 'OrderDelivered', 'OrderReturned',
  'PaymentSucceeded', 'PaymentFailed', 'RefundSucceeded', 'RefundFailed', 'ShipmentFailed',
  'UserRegistered', 'UserLocked', 'PasswordChanged', 'LowStockDetected',
] as const;
/** Hai event mang token thô: phát in-process sau commit, không qua outbox (K-14). */
export const TOKEN_EVENT_TYPES = ['EmailVerificationRequested', 'PasswordResetRequested'] as const;

interface Prepared { plan: Plan; recipients: string[] }

/**
 * Consumer `NTF` của 18 event (NTF-REQ-20261006-103208460 BR1 đến BR9). Mỗi event hai pha (xem `PreparedHandler`): `prepare` kiểm dạng payload và hỏi AUTH (`getUserContact`, `listActiveUserIdsByRole`)
 * NGOÀI giao dịch (SB-31); `handle` ghi `notifications` rồi (nếu thông báo chèn được) `email_deliveries` trong CÙNG giao dịch với dòng `processed_events` do `EventsService.deliver` chèn (BR7, SB-27).
 * Event không hợp lệ hay người nhận không tồn tại: không ghi gì, ghi log, coi như đã xử lý (BR8a). Lỗi tạm thời của AUTH hay CSDL: ném lỗi cho relay giao lại (BR8b). Không có endpoint nhận event (T6).
 */
@Injectable()
export class ConsumerService {
  private readonly log: AppLogger;
  constructor(private readonly events: EventsService, private readonly auth: AuthApi, private readonly clock: Clock, private readonly email: EmailService, logger: AppLogger) {
    this.log = logger.for('notification');
  }

  register(): void {
    for (const type of OUTBOX_EVENTS) {
      this.events.subscribePrepared<Prepared>(CONSUMER, type, { prepare: (e) => this.prepare(e), handle: (tx, e, p) => this.handle(tx, e, p) });
    }
    for (const type of TOKEN_EVENT_TYPES) this.events.subscribeRaw(CONSUMER, type, (e) => this.email.handleToken(e));
  }

  private async prepare(env: EventEnvelope): Promise<Prepared | typeof SKIP> {
    const planned = planEvent(env, this.clock.now());
    if (!planned.ok) {
      // chỉ mã uuid hợp lệ và mã event; không payload, không giá trị sai (SB-18)
      this.log.error('event không hợp lệ, bỏ qua', { code: 'event-invalid', event_type: env.type, event_id: env.event_id, ...planned.refs });
      return SKIP;
    }
    const { plan } = planned;
    if (plan.audience.kind === 'owner') {
      const userId = plan.audience.userId;
      const contact = await this.auth.getUserContact(userId); // lỗi tạm thời ném ra: relay giao lại, không để lại ProcessedEvent
      if (!contact) {
        this.log.warn('người nhận không tồn tại, bỏ qua', { code: 'recipient-not-found', event_type: env.type, event_id: env.event_id, user_id: userId });
        return SKIP;
      }
      return { plan, recipients: [userId] };
    }
    const ids = await this.auth.listActiveUserIdsByRole(plan.audience.roles, MAX_RECIPIENTS);
    if (ids.length === 0) {
      this.log.warn('không có người nhận hợp lệ, bỏ qua', { code: 'no-recipients', event_type: env.type, event_id: env.event_id });
      return SKIP;
    }
    if (ids.length >= MAX_RECIPIENTS) this.log.warn('đạt trần người nhận, người còn lại không được báo', { code: 'recipients-capped', event_type: env.type, event_id: env.event_id, cap: MAX_RECIPIENTS });
    return { plan, recipients: ids };
  }

  private async handle(tx: Tx, env: EventEnvelope, { plan, recipients }: Prepared): Promise<void> {
    for (const note of plan.notes) this.log.warn('trường tùy chọn của event sai dạng, dùng nội dung chung', { code: note, event_type: env.type, event_id: env.event_id });
    const due = this.clock.now();
    for (const userId of recipients) {
      let inserted = true;
      const n = plan.notification;
      if (n) {
        // ON CONFLICT DO NOTHING không nêu đích: bắt cả unique (user_id, dedupe_key) lẫn hai unique một phần "một thông báo chưa đọc mỗi sản phẩm hay mỗi hoàn tiền" (BR4), do CSDL bảo đảm
        const rows = await tx.$queryRaw<{ id: string }[]>`
          INSERT INTO notifications (user_id, type, title, body, link, data, event_id, dedupe_key)
          VALUES (${userId}::uuid, ${n.type}::notification_type, ${n.title}, ${n.body}, ${n.link}, ${JSON.stringify(n.data)}::jsonb, ${env.event_id}::uuid, ${n.dedupeKey})
          ON CONFLICT DO NOTHING RETURNING id`;
        inserted = rows.length > 0;
      }
      // email chỉ khi thông báo trong ứng dụng chèn được (bản ghi bị bỏ vì trùng khóa tự nhiên thì không có email thứ hai, NTF-DB mục 1); loại không có thông báo (account_locked) dùng khóa riêng của email
      const m = plan.email;
      if (inserted && m) {
        await tx.$executeRaw`
          INSERT INTO email_deliveries (user_id, type, data, event_id, dedupe_key, next_attempt_at)
          VALUES (${userId}::uuid, ${m.type}::email_type, ${JSON.stringify(m.data)}::jsonb, ${env.event_id}::uuid, ${m.dedupeKey}, ${due}::timestamptz)
          ON CONFLICT DO NOTHING`;
      }
    }
  }
}
