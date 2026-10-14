import { randomUUID } from 'node:crypto';
import { AuthModule } from '../../src/modules/auth/auth.module';
import { EventsService, OutboxRelay, PlatformModule, TransactionService, runWithCorrelation, type EventEnvelope } from '../../src/modules/platform';
import { CleanupService } from '../../src/modules/notification/cleanup.service';
import { ConsumerService } from '../../src/modules/notification/consumer.service';
import { EmailService } from '../../src/modules/notification/email.service';
import { MAIL_TRANSPORT, MailError, type MailMessage, type MailTransport } from '../../src/modules/notification/mail';
import { NotificationModule } from '../../src/modules/notification';
import { createAuthApp, q, seedSession, seedUser, type AuthApp, type SeedUser } from './auth';
import type { FakeSes } from './fake-ses';

export const BASE_URL = 'https://shop.example';
export const FROM = 'no-reply@shop.vn';
export const NTF_ENV = { APP_BASE_URL: BASE_URL, MAIL_FROM: FROM, TRUST_PROXY_HOPS: '1', DB_POOL_MAX: '16' };

export interface Call { at: Date; msg: MailMessage }
export type Script = (MailError | Error | null | 'hang')[];

/** Bộ chuyển thư giả cho test: ghi mọi lời gọi (kèm đồng hồ giả), trả kết quả theo kịch bản (`null` là thành công, lỗi thì ném, `hang` thì treo tới khi bị hủy). Không bao giờ chạm mạng. */
export class FakeMail implements MailTransport {
  readonly calls: Call[] = [];
  /** Kịch bản theo thứ tự lời gọi; hết kịch bản thì dùng `fallback`. */
  script: Script = [];
  fallback: MailError | Error | null = null;
  /** Thời gian trả lời giả (mili giây thật). */
  delayMs = 0;
  constructor(private readonly now: () => Date) {}
  get msgs(): MailMessage[] { return this.calls.map((c) => c.msg); }
  reset(): void { this.calls.length = 0; this.script = []; this.fallback = null; this.delayMs = 0; }
  failAll(code: string, permanent = false): void { this.fallback = new MailError(code, permanent); }
  async send(m: MailMessage, signal?: AbortSignal): Promise<void> {
    this.calls.push({ at: this.now(), msg: m });
    const step = this.script.length ? this.script.shift()! : this.fallback;
    if (step === 'hang') await new Promise<void>((_, rej) => signal?.addEventListener('abort', () => rej(new Error('aborted'))));
    if (this.delayMs) await new Promise((r) => setTimeout(r, this.delayMs));
    if (step) throw step;
  }
}

export interface NtfApp extends AuthApp { mail: FakeMail; email: EmailService; consumer: ConsumerService; cleaner: CleanupService; evts: EventsService }

/** Ứng dụng thật (PlatformModule + AuthModule + NotificationModule), PostgreSQL thật, đồng hồ giả đặt về GIỜ THẬT lúc dựng (cùng đồng hồ với `now()` của CSDL); bộ chuyển thư là bản giả. */
export async function createNtfApp(o: { env?: Record<string, string>; level?: string; extraImports?: any[]; ses?: FakeSes } = {}): Promise<NtfApp> {
  const holder: { mail?: FakeMail } = {};
  const proxy: MailTransport = { send: (m, s) => holder.mail!.send(m, s) };
  // `ses`: dùng bộ chuyển thư THẬT (SesTransport ký SigV4) nói chuyện với SES giả trong tiến trình; không có thì bộ chuyển thư giả ghi lời gọi (FakeMail)
  const sesEnv: Record<string, string> = o.ses ? { SES_ENDPOINT: o.ses.url, SES_REGION: o.ses.region, SES_ACCESS_KEY: o.ses.accessKey, SES_SECRET_KEY: o.ses.secretKey } : {};
  const t = await createAuthApp({ imports: [PlatformModule, AuthModule, NotificationModule, ...(o.extraImports ?? [])], controllers: [], level: o.level ?? 'info', env: { ...NTF_ENV, ...sesEnv, ...(o.env ?? {}) }, overrides: o.ses ? [] : [{ provide: MAIL_TRANSPORT, useValue: proxy }] });
  t.clock.set(new Date(Math.floor(Date.now() / 1000) * 1000));
  const mail = (holder.mail = new FakeMail(() => t.clock.now()));
  return Object.assign(t, { mail, email: t.app.get(EmailService), consumer: t.app.get(ConsumerService), cleaner: t.app.get(CleanupService), evts: t.app.get(EventsService) });
}

export interface NtfUser extends SeedUser { cookie: string }
let nth = 0;
/** Người dùng có phiên, tạo thẳng trong CSDL. Mặc định customer đã xác minh email. */
export async function mkUser(t: AuthApp, o: { role?: 'customer' | 'staff' | 'admin'; verified?: boolean; name?: string; email?: string; status?: 'active' | 'locked' } = {}): Promise<NtfUser> {
  const u = await seedUser(t, { email: o.email ?? `ntf${++nth}-${randomUUID().slice(0, 6)}@shop.vn`, role: o.role ?? 'customer', verified: o.verified, name: o.name, status: o.status });
  return { ...u, cookie: (await seedSession(t, u.id)).cookie };
}

export const CODE = '7K3M9Q2XH4TB';
export const OID = '11111111-1111-4111-8111-111111111111';

/** Giao một event cho mọi consumer đã đăng ký (cùng đường với relay: `EventsService.deliver`), với `event_id` tùy ý để thử giao lại. */
export async function emit(t: AuthApp, type: string, payload: Record<string, unknown>, eventId: string = randomUUID()): Promise<string> {
  const events = t.app.get(EventsService);
  const env: EventEnvelope = { event_id: eventId, type, aggregate_type: 'x', aggregate_id: String(payload.order_id ?? randomUUID()), payload, occurred_at: new Date().toISOString(), correlation_id: 'test-corr' };
  await runWithCorrelation(env.correlation_id, async () => { for (const sub of events.consumersFor(type)) if (sub.consumer === 'NTF') await events.deliver(sub, env); });
  return eventId;
}
/** Phát event qua outbox rồi chạy relay (đường thật), trả `event_id`. */
export async function viaOutbox(t: AuthApp, type: string, payload: Record<string, unknown>, now: Date = new Date(Date.now() + 1000)): Promise<string> {
  const events = t.app.get(EventsService);
  const id = await t.app.get(TransactionService).run((tx) => events.publish(tx, { type, aggregate_type: 'x', aggregate_id: String(payload.order_id ?? randomUUID()), payload }));
  await t.app.get(OutboxRelay).runOnce(now);
  return id;
}

export interface Notif { id: string; user_id: string; type: string; title: string; body: string; link: string | null; data: any; status: string; read_at: Date | null; event_id: string; dedupe_key: string; created_at: Date; channel: string }
export interface Mail { id: string; user_id: string; type: string; delivery_status: string; delivery_reason: string | null; attempts: number; next_attempt_at: Date | null; sent_at: Date | null; event_id: string; dedupe_key: string; data: any; created_at: Date }
export const notesOf = (t: AuthApp, userId?: string): Promise<Notif[]> =>
  q<Notif>(t, `SELECT id, user_id, type::text AS type, title, body, link, data, status::text AS status, read_at, event_id, dedupe_key, created_at, channel::text AS channel FROM notifications ${userId ? `WHERE user_id = '${userId}'` : ''} ORDER BY created_at, id`);
export const mailsOf = (t: AuthApp, userId?: string): Promise<Mail[]> =>
  q<Mail>(t, `SELECT id, user_id, type::text AS type, delivery_status::text AS delivery_status, delivery_reason, attempts, next_attempt_at, sent_at, event_id, dedupe_key, data, created_at FROM email_deliveries ${userId ? `WHERE user_id = '${userId}'` : ''} ORDER BY created_at, id`);
export const count = async (t: AuthApp, table: string, where = 'TRUE'): Promise<number> => (await q<{ n: number }>(t, `SELECT count(*)::int AS n FROM ${table} WHERE ${where}`))[0].n;
export const processedOf = (t: AuthApp) => q<{ consumer: string; event_id: string }>(t, `SELECT consumer, event_id FROM processed_events ORDER BY processed_at, id`);

/** Dòng thông báo dựng thẳng trong CSDL (fixture) với thời điểm tạo tùy ý. */
export async function seedNote(t: AuthApp, userId: string, o: { type?: string; status?: 'unread' | 'read'; at?: Date; readAt?: Date | null; title?: string; body?: string; link?: string | null; data?: object; dedupe?: string } = {}): Promise<string> {
  const at = o.at ?? t.clock.now();
  const status = o.status ?? 'unread';
  const readAt = status === 'read' ? (o.readAt ?? at) : null;
  const [r] = await t.prisma.$queryRaw<{ id: string }[]>`
    INSERT INTO notifications (user_id, type, title, body, link, data, status, read_at, event_id, dedupe_key, created_at, updated_at)
    VALUES (${userId}::uuid, ${o.type ?? 'order_created'}::notification_type, ${o.title ?? 'Tiêu đề'}, ${o.body ?? 'Nội dung'}, ${o.link === undefined ? '/orders' : o.link}, ${JSON.stringify(o.data ?? {})}::jsonb,
            ${status}::notification_status, ${readAt}::timestamptz, ${randomUUID()}::uuid, ${o.dedupe ?? `seed:${randomUUID()}`}, ${at}::timestamptz, ${at}::timestamptz) RETURNING id`;
  return r.id;
}
/** Dòng email dựng thẳng (fixture). */
export async function seedMail(t: AuthApp, userId: string, o: { type?: string; status?: 'pending' | 'sent' | 'failed' | 'skipped'; at?: Date; sentAt?: Date | null; next?: Date | null; attempts?: number; data?: object; reason?: string | null } = {}): Promise<string> {
  const at = o.at ?? t.clock.now();
  const status = o.status ?? 'pending';
  const secret = o.type === 'password_reset' || o.type === 'email_verification';
  const next = o.next === undefined ? (status === 'pending' && !secret ? at : null) : o.next;
  const [r] = await t.prisma.$queryRaw<{ id: string }[]>`
    INSERT INTO email_deliveries (user_id, type, delivery_status, delivery_reason, attempts, next_attempt_at, sent_at, event_id, dedupe_key, data, created_at, updated_at)
    VALUES (${userId}::uuid, ${o.type ?? 'order_created'}::email_type, ${status}::email_delivery_status, ${o.reason ?? null}, ${o.attempts ?? (status === 'sent' ? 1 : 0)}, ${next}::timestamptz, ${status === 'sent' ? (o.sentAt ?? at) : null}::timestamptz,
            ${randomUUID()}::uuid, ${`seed:${randomUUID()}`}, ${JSON.stringify(o.data ?? (secret ? {} : { order_code: CODE, amount: 350000 }))}::jsonb, ${at}::timestamptz, ${at}::timestamptz) RETURNING id`;
  return r.id;
}

export const logsOf = (t: AuthApp, level?: string) => t.logs.records.filter((r) => (level ? r.level === level : true) && r.module === 'notification');
export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
export { q };
export { truncateAll } from './db';
