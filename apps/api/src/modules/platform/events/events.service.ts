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

/** Hai event mang token thô: không đi outbox, phát in-process sau commit, best-effort (K-14, SB-27). */
export const TOKEN_EVENTS: ReadonlySet<string> = new Set(['EmailVerificationRequested', 'PasswordResetRequested']);

export class ProgrammingError extends Error {
  constructor(message: string) { super(message); this.name = 'ProgrammingError'; }
}

interface Subscription { consumer: string; handler: EventHandler }

@Injectable()
export class EventsService {
  private readonly subs = new Map<string, Subscription[]>();
  private readonly log: AppLogger;
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
              ${currentCorrelationId() ?? 'none'}, now())`;
    return id;
  }

  /** Chỉ cho EmailVerificationRequested và PasswordResetRequested. Không ghi bảng nào, không log payload. */
  publishAfterCommit(event: DomainEventInput): void {
    if (!TOKEN_EVENTS.has(event.type)) throw new ProgrammingError(`publishAfterCommit chỉ nhận ${[...TOKEN_EVENTS].join(', ')}`);
    const env: EventEnvelope = { ...event, event_id: randomUUID(), occurred_at: new Date().toISOString(), correlation_id: currentCorrelationId() ?? 'none' };
    const run = () => void this.dispatchInProcess(env);
    const store = txStore.getStore();
    if (store) store.afterCommit.push(run);
    else setImmediate(run);
  }

  subscribe(consumer: string, type: string, handler: EventHandler): void {
    const list = this.subs.get(type) ?? [];
    list.push({ consumer, handler });
    this.subs.set(type, list);
  }
  consumersFor(type: string): readonly Subscription[] { return this.subs.get(type) ?? []; }

  /**
   * Giao một event cho một consumer, idempotent (SB-27): chèn ProcessedEvent (consumer, event_id) ON CONFLICT DO NOTHING
   * cùng giao dịch với handler; trùng thì bỏ qua; handler lỗi thì rollback cả dòng ProcessedEvent.
   */
  deliver(sub: Subscription, env: EventEnvelope): Promise<'processed' | 'skipped'> {
    return runWithCorrelation(env.correlation_id, () =>
      this.transactions.run(async (tx) => {
        const rows = await tx.$queryRaw<{ id: string }[]>`
          INSERT INTO processed_events (consumer, event_id) VALUES (${sub.consumer}, ${env.event_id}::uuid)
          ON CONFLICT (consumer, event_id) DO NOTHING RETURNING id`;
        if (rows.length === 0) return 'skipped' as const;
        await sub.handler(tx, env);
        return 'processed' as const;
      }),
    );
  }

  private async dispatchInProcess(env: EventEnvelope): Promise<void> {
    await runWithCorrelation(env.correlation_id, async () => {
      for (const sub of this.consumersFor(env.type)) {
        try {
          await this.transactions.run((tx) => sub.handler(tx, env));
        } catch (err) {
          // best-effort: mất thì khách bấm gửi lại. Không log payload (token).
          this.log.error('handler event token thất bại', { err, event_type: env.type, consumer: sub.consumer });
        }
      }
    });
  }
}
