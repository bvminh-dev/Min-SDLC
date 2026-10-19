import { Injectable } from '@nestjs/common';
import type { PrismaClient } from '@prisma/client';
import { Clock } from '../common/clock';
import { currentCorrelationId } from '../common/context';
import type { Tx } from '../db/transaction.service';
import { PrismaService } from '../db/prisma.service';
import { AppLogger } from '../logging/logger';
import { redactDeep } from '../logging/redact';

export interface AuditEntry {
  actor_id?: string | null;
  actor_role: 'guest' | 'customer' | 'staff' | 'sale' | 'admin' | 'system';
  action: string;
  target_type: string;
  target_id: string;
  before?: unknown;
  after?: unknown;
  reason?: string;
}
export interface AuditOptions {
  /** Gộp một dòng mỗi cửa sổ cho cùng (actor_id, action) (xem dashboard, K-16). `key` chỉ để mô tả: khóa thật là (actor_id, action). */
  coalesce?: { key?: string; window?: number };
}

/** Audit đồng bộ cùng giao dịch với thao tác (ADR-021, SB-19): audit lỗi thì thao tác rollback. */
@Injectable()
export class AuditService {
  private readonly log: AppLogger;
  constructor(private readonly prisma: PrismaService, private readonly clock: Clock, logger: AppLogger) {
    this.log = logger.for('audit');
  }

  async record(tx: Tx | PrismaClient, entry: AuditEntry, opts: AuditOptions = {}): Promise<void> {
    const now = this.clock.now();
    const before = JSON.stringify(redactDeep(entry.before ?? null));
    const after = JSON.stringify(redactDeep(entry.after ?? null));
    const actorId = entry.actor_id ?? null;
    const cid = currentCorrelationId() ?? 'none';

    if (opts.coalesce) {
      // Giao dịch ngắn riêng; lỗi audit không chặn việc xem, chỉ log error (ADR-021).
      const windowSeconds = opts.coalesce.window ?? 60;
      try {
        await this.prisma.$executeRaw`
          INSERT INTO audit_logs (actor_id, actor_role, action, target_type, target_id, before, after, reason, correlation_id, created_at)
          SELECT ${actorId}::uuid, ${entry.actor_role}, ${entry.action}, ${entry.target_type}, ${entry.target_id},
                 ${before}::jsonb, ${after}::jsonb, ${entry.reason ?? null}, ${cid}, ${now}::timestamptz
          WHERE NOT EXISTS (
            SELECT 1 FROM audit_logs WHERE actor_id IS NOT DISTINCT FROM ${actorId}::uuid AND action = ${entry.action}
              AND created_at > ${now}::timestamptz - make_interval(secs => ${windowSeconds})
          )`;
      } catch (err) {
        this.log.error('ghi audit gộp thất bại, không chặn thao tác', { err, action: entry.action });
      }
      return;
    }

    await tx.$executeRaw`
      INSERT INTO audit_logs (actor_id, actor_role, action, target_type, target_id, before, after, reason, correlation_id, created_at)
      VALUES (${actorId}::uuid, ${entry.actor_role}, ${entry.action}, ${entry.target_type}, ${entry.target_id},
              ${before}::jsonb, ${after}::jsonb, ${entry.reason ?? null}, ${cid}, ${now}::timestamptz)`;
  }
}
