import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { currentCorrelationId, runWithCorrelation } from '../common/context';
import { TransactionService, txStore, type Tx } from '../db/transaction.service';
import { AppLogger } from '../logging/logger';

export interface DomainEventInput {
  type: string;
  aggregate_type: string;
  aggregate_id: string;
  payload: Record<string, unknown>;
}
/** Phong bì event (ADR-011): event_id chính là OutboxEvent.id. */
export interface EventEnvelope extends DomainEventInput {
  event_id: string;
  occurred_at: string;
  correlation_id: string;
}
export type EventHandler = (tx: Tx, event: EventEnvelope) => Promise<void>;
/** Kết quả của `prepare` khi event không cần xử lý (không hợp lệ, người nhận không tồn tại): coi như đã xử lý, không ghi gì, không giao lại. */
export const SKIP: unique symbol = Symbol('events.skip');
/**
 * Consumer hai pha cho handler phải hỏi module khác (AUTH) trước khi ghi (SB-31, ADR-012): `prepare` chạy NGOÀI giao dịch (có thể gọi giao diện module khác, ném lỗi tạm thời để relay giao lại),
 * `handle` chạy TRONG giao dịch cùng dòng `processed_events`. Không giữ kết nối thứ nhất rồi xin kết nối thứ hai (hold-and-wait, L71, L87).
 */
export interface PreparedHandler<T> {
  prepare: (event: EventEnvelope) => Promise<T | typeof SKIP>;
  handle: (tx: Tx, event: EventEnvelope, prepared: T) => Promise<void>;
}

/** Hai event mang token thô: không đi outbox, phát in-process sau commit, best-effort (K-14, SB-27). */
export const TOKEN_EVENTS: ReadonlySet<string> = new Set(['EmailVerificationRequested', 'PasswordResetRequested']);

export class ProgrammingError extends Error {
  constructor(message: string) { super(message); this.name = 'ProgrammingError'; }
}

const wrongPath: EventHandler = async () => { throw new ProgrammingError('consumer hai pha hoặc raw chỉ chạy qua EventsService.deliver hay phát in-process'); };

export interface Subscription {
  consumer: string;
  /** Handler thường (một giao dịch với processed_events). Consumer hai pha (`prepared`) và thuần bộ nhớ (`raw`) có handler ném lỗi lập trình: phải đi qua `deliver` hay `dispatchInProcess`. */
  handler: EventHandler;
  prepared?: PreparedHandler<any>;
  /** Chỉ cho hai event token (phát in-process sau commit, không giao lại): tự quản giao dịch và hạn thử, không có ProcessedEvent. */
  raw?: (event: EventEnvelope) => Promise<void>;
}

@Injectable()
export class EventsService {
  private readonly subs = new Map<string, Subscription[]>();
  private readonly log: AppLogger;
  private inProcess = 0;
  constructor(private readonly transactions: TransactionService, logger: AppLogger) {
    this.log = logger.for('events');
  }

  /** Ghi một dòng outbox_events trong cùng giao dịch với thay đổi trạng thái; rollback thì không có event (SB-27). */
  async publish(tx: Tx, event: DomainEventInput): Promise<string> {
    if (TOKEN_EVENTS.has(event.type)) throw new ProgrammingError(`${event.type} chỉ được phát bằng publishAfterCommit (K-14)`);
    const id = randomUUID();
    await tx.$executeRaw`
      INSERT INTO outbox_events (id, type, aggregate_type, aggregate_id, payload, correlation_id, occurred_at)
      VALUES (${id}::uuid, ${event.type}, ${event.aggregate_type}, ${event.aggregate_id}, ${JSON.stringify(event.payload)}::jsonb,
              ${currentCorrelationId() ?? 'none'}, clock_timestamp())`; // clock_timestamp, không now(): now() đứng yên trong giao dịch nên hai event cùng giao dịch (OrderCreated rồi OrderConfirmed của đơn COD) bằng `occurred_at` và relay sắp theo `id` uuid ngẫu nhiên có thể đảo thứ tự
    return id;
  }

  /** Chỉ cho EmailVerificationRequested và PasswordResetRequested. Không ghi bảng nào, không log payload. */
  publishAfterCommit(event: DomainEventInput): void {
    if (!TOKEN_EVENTS.has(event.type)) throw new ProgrammingError(`publishAfterCommit chỉ nhận ${[...TOKEN_EVENTS].join(', ')}`);
    const env: EventEnvelope = { ...event, event_id: randomUUID(), occurred_at: new Date().toISOString(), correlation_id: currentCorrelationId() ?? 'none' };
    const run = () => { this.inProcess++; void this.dispatchInProcess(env).finally(() => { this.inProcess--; }); };
    const store = txStore.getStore();
    if (store) store.afterCommit.push(run);
    else setImmediate(run);
  }

  subscribe(consumer: string, type: string, handler: EventHandler): void {
    const list = this.subs.get(type) ?? [];
    list.push({ consumer, handler });
    this.subs.set(type, list);
  }
  /** Consumer hai pha (xem `PreparedHandler`): chống trùng theo `event_id` vẫn do `deliver`. */
  subscribePrepared<T>(consumer: string, type: string, h: PreparedHandler<T>): void {
    const list = this.subs.get(type) ?? [];
    list.push({ consumer, handler: wrongPath, prepared: h });
    this.subs.set(type, list);
  }

  /** Chỉ cho event token: handler thuần bộ nhớ, chạy sau commit của bên phát (best-effort, không qua outbox, không ProcessedEvent). Đăng ký cho event đi outbox là lỗi lập trình. */
  subscribeRaw(consumer: string, type: string, run: (event: EventEnvelope) => Promise<void>): void {
    if (!TOKEN_EVENTS.has(type)) throw new ProgrammingError(`subscribeRaw chỉ nhận ${[...TOKEN_EVENTS].join(', ')}`);
    const list = this.subs.get(type) ?? [];
    list.push({ consumer, handler: wrongPath, raw: run });
    this.subs.set(type, list);
  }

  /** Chờ mọi event token đã lên lịch (và đang chạy) xử lý xong: cho test, không dùng ở mã chạy thật. */
  async idle(): Promise<void> {
    await new Promise<void>((r) => setImmediate(r)); // đường không giao dịch dùng setImmediate
    while (this.inProcess > 0) await new Promise<void>((r) => setTimeout(r, 5));
  }

  consumersFor(type: string): readonly Subscription[] { return this.subs.get(type) ?? []; }

  /**
   * Giao một event cho một consumer, idempotent (SB-27): chèn ProcessedEvent (consumer, event_id) ON CONFLICT DO NOTHING
   * cùng giao dịch với handler; trùng thì bỏ qua; handler lỗi thì rollback cả dòng ProcessedEvent.
   */
  deliver(sub: Subscription, env: EventEnvelope): Promise<'processed' | 'skipped'> {
    if (sub.raw) throw new ProgrammingError('consumer raw không đi qua outbox');
    return runWithCorrelation(env.correlation_id, async () => {
      // Payload không phải đối tượng (null, mảng, chuỗi, số): handler không phải lo, nền bác trước khi gọi `prepare` hay `handle`, log mã event (không log payload) và đánh dấu đã xử lý để relay không giao lại tới hết lượt thử (L85)
      if (!isPayloadObject(env.payload)) return this.skipMalformed(sub, env);
      // Pha chuẩn bị ngoài giao dịch (có thể gọi module khác); lỗi tạm thời ném ra cho relay giao lại, không để lại ProcessedEvent.
      const prepared = sub.prepared ? await sub.prepared.prepare(env) : undefined;
      if (prepared === SKIP) return 'skipped' as const;
      return this.transactions.run(async (tx) => {
        const rows = await tx.$queryRaw<{ id: string }[]>`
          INSERT INTO processed_events (consumer, event_id) VALUES (${sub.consumer}, ${env.event_id}::uuid)
          ON CONFLICT (consumer, event_id) DO NOTHING RETURNING id`;
        if (rows.length === 0) return 'skipped' as const;
        if (sub.prepared) await sub.prepared.handle(tx, env, prepared);
        else await sub.handler(tx, env);
        return 'processed' as const;
      });
    });
  }

  private async skipMalformed(sub: Subscription, env: EventEnvelope): Promise<'skipped'> {
    this.log.warn('payload của event không phải đối tượng, bỏ qua và đánh dấu đã xử lý (lỗi của bên phát)', { event_id: env.event_id, event_type: env.type, consumer: sub.consumer });
    await this.transactions.run((tx) => tx.$executeRaw`
      INSERT INTO processed_events (consumer, event_id) VALUES (${sub.consumer}, ${env.event_id}::uuid) ON CONFLICT (consumer, event_id) DO NOTHING`);
    return 'skipped';
  }

  private async dispatchInProcess(env: EventEnvelope): Promise<void> {
    await runWithCorrelation(env.correlation_id, async () => {
      for (const sub of this.consumersFor(env.type)) {
        try {
          if (sub.raw) await sub.raw(env);
          else await this.transactions.run((tx) => sub.handler(tx, env));
        } catch (err) {
          // best-effort: mất thì khách bấm gửi lại. Không log payload (token).
          this.log.error('handler event token thất bại', { err, event_type: env.type, consumer: sub.consumer });
        }
      }
    });
  }
}

const isPayloadObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
