import { Injectable } from '@nestjs/common';
import { Clock } from '../common/clock';
import { runWithCorrelation } from '../common/context';
import { ConfigService } from '../config/config';
import { PrismaService } from '../db/prisma.service';
import { TransactionService } from '../db/transaction.service';
import { JOB_ABORT_GRACE_MS, JOB_TIMEOUT_MS } from '../jobs/job-runner';
import { AppLogger } from '../logging/logger';
import { EventsService, type EventEnvelope } from './events.service';

interface Row {
  id: string; type: string; aggregate_type: string; aggregate_id: string; payload: Record<string, unknown>;
  correlation_id: string; occurred_at: Date; attempts: number;
}

/** Hạn thuê dòng event của một lượt relay: phải lớn hơn hạn job + hạn chờ hủy, nếu không lượt khác nhặt lại event khi job cũ còn chạy (SB-34). */
export const LEASE_MS = 2 * (JOB_TIMEOUT_MS + JOB_ABORT_GRACE_MS);
const BATCH = 100;
/** 5, 10, 20, ... giây, tối đa 10 phút (ADR-011). `attempt` = số lần đã lỗi (>= 1). */
export const backoffMs = (attempt: number): number => Math.min(5_000 * 2 ** (attempt - 1), 600_000);

/** Relay outbox (ADR-011, PRJ-DB mục 4): chuyển OutboxEvent chưa phát lên bus nội bộ, ít nhất một lần, thứ tự theo aggregate. */
@Injectable()
export class OutboxRelay {
  private readonly log: AppLogger;
  constructor(
    private readonly prisma: PrismaService,
    private readonly transactions: TransactionService,
    private readonly events: EventsService,
    private readonly config: ConfigService,
    private readonly clock: Clock,
    logger: AppLogger,
  ) {
    this.log = logger.for('outbox');
  }

  async runOnce(now: Date = this.clock.now(), signal?: AbortSignal): Promise<{ picked: number; dispatched: number; failed: number }> {
    const max = this.config.get('OUTBOX_MAX_ATTEMPTS');
    const lease = new Date(now.getTime() + LEASE_MS);
    // Giao dịch ngắn: chọn event cũ nhất của mỗi aggregate (event sau chờ event trước) và chiếm bằng hạn thuê, rồi commit.
    const rows = await this.transactions.run(async (tx) => {
      const picked = await tx.$queryRaw<Row[]>`
        SELECT o.id, o.type, o.aggregate_type, o.aggregate_id, o.payload, o.correlation_id, o.occurred_at, o.attempts
        FROM outbox_events o
        WHERE o.dispatched_at IS NULL AND o.next_attempt_at <= ${now}::timestamptz AND o.attempts < ${max}
          AND NOT EXISTS (
            SELECT 1 FROM outbox_events e
            WHERE e.aggregate_id = o.aggregate_id AND e.dispatched_at IS NULL
              AND (e.occurred_at, e.id) < (o.occurred_at, o.id))
        ORDER BY o.occurred_at, o.id
        LIMIT ${BATCH}
        FOR UPDATE OF o SKIP LOCKED`;
      for (const r of picked) {
        await tx.$executeRaw`UPDATE outbox_events SET next_attempt_at = ${lease}::timestamptz, updated_at = ${now}::timestamptz WHERE id = ${r.id}::uuid`;
      }
      return picked;
    });

    let dispatched = 0, failed = 0;
    // Phát ngoài giao dịch chọn (SB-31), lần lượt theo thứ tự.
    for (const r of rows) {
      if (signal?.aborted) break; // job quá hạn: thôi phát, event còn lại hết hạn thuê rồi lượt sau nhặt
      const env: EventEnvelope = {
        event_id: r.id, type: r.type, aggregate_type: r.aggregate_type, aggregate_id: r.aggregate_id,
        payload: r.payload, occurred_at: r.occurred_at.toISOString(), correlation_id: r.correlation_id,
      };
      let error: unknown;
      for (const sub of this.events.consumersFor(r.type)) {
        try {
          await this.events.deliver(sub, env);
        } catch (e) {
          error = e;
          runWithCorrelation(r.correlation_id, () => this.log.warn('consumer lỗi, sẽ thử lại', { event_id: r.id, consumer: sub.consumer, err: e }));
        }
      }
      if (error === undefined) {
        await this.prisma.$executeRaw`UPDATE outbox_events SET dispatched_at = ${now}::timestamptz, updated_at = ${now}::timestamptz WHERE id = ${r.id}::uuid`;
        dispatched++;
      } else {
        failed++;
        const attempts = r.attempts + 1;
        const next = new Date(now.getTime() + backoffMs(attempts));
        await this.prisma.$executeRaw`UPDATE outbox_events SET attempts = ${attempts}, next_attempt_at = ${next}::timestamptz, updated_at = ${now}::timestamptz WHERE id = ${r.id}::uuid`;
        if (attempts >= max) {
          runWithCorrelation(r.correlation_id, () => this.log.error('outbox event hết lượt thử, dừng thử (xử lý bằng tay)', { event_id: r.id, attempts }));
        }
      }
    }
    return { picked: rows.length, dispatched, failed };
  }

  /** Chỉ báo vận hành: số OutboxEvent kẹt (hết lượt thử, chưa phát). Lớn hơn 0 là cần người xử lý. */
  async stuckCount(): Promise<number> {
    const max = this.config.get('OUTBOX_MAX_ATTEMPTS');
    const [{ n }] = await this.prisma.$queryRaw<{ n: bigint }[]>`SELECT count(*) AS n FROM outbox_events WHERE dispatched_at IS NULL AND attempts >= ${max}`;
    return Number(n);
  }
}
