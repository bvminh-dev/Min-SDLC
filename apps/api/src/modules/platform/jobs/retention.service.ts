import { Injectable } from '@nestjs/common';
import { Client } from 'pg';
import { ConfigService } from '../config/config';
import { toPgConfig } from '../db/pg-config';
import { Clock } from '../common/clock';
import { PrismaService } from '../db/prisma.service';
import { AppLogger } from '../logging/logger';

const BATCH = 1000;

/**
 * Job dọn dữ liệu quá hạn của platform (ADR-022, PRJ-REQ-20261006-095422563 BR15): mỗi bảng một giao dịch ngắn theo lô,
 * log số bản ghi đã xóa. Bảng của module khác do module chủ dọn (SB-35).
 */
@Injectable()
export class RetentionService {
  private readonly log: AppLogger;
  constructor(private readonly prisma: PrismaService, private readonly clock: Clock, private readonly config: ConfigService, logger: AppLogger) {
    this.log = logger.for('retention');
  }

  async run(now: Date = this.clock.now()): Promise<Record<string, number>> {
    const counts: Record<string, number> = {};
    const loop = async (table: string, del: () => Promise<number>) => {
      let total = 0;
      for (let n = await del(); n > 0; n = await del()) total += n;
      counts[table] = total;
      this.log.info('retention đã xóa', { table, deleted: total });
    };
    await loop('outbox_events', () => this.prisma.$executeRaw`
      DELETE FROM outbox_events WHERE id IN (SELECT id FROM outbox_events
        WHERE dispatched_at IS NOT NULL AND dispatched_at < ${now}::timestamptz - interval '14 days' LIMIT ${BATCH})`);
    await loop('processed_events', () => this.prisma.$executeRaw`
      DELETE FROM processed_events WHERE id IN (SELECT id FROM processed_events
        WHERE processed_at < ${now}::timestamptz - interval '30 days' LIMIT ${BATCH})`);
    await loop('idempotency_keys', () => this.prisma.$executeRaw`
      DELETE FROM idempotency_keys WHERE id IN (SELECT id FROM idempotency_keys WHERE expires_at < ${now}::timestamptz LIMIT ${BATCH})`);
    // audit_logs: chỉ vai trò app_retention xóa được (trigger kiểm vai trò đăng nhập, SB-32). Có RETENTION_DATABASE_URL thì dùng kết nối riêng đó.
    const url = this.config.get('RETENTION_DATABASE_URL');
    const sql = `DELETE FROM audit_logs WHERE id IN (SELECT id FROM audit_logs WHERE created_at < $1::timestamptz - interval '12 months' LIMIT ${BATCH})`;
    if (url) {
      const c = new Client(toPgConfig(url));
      await c.connect();
      try { await loop('audit_logs', async () => (await c.query(sql, [now])).rowCount ?? 0); } finally { await c.end(); }
    } else {
      await loop('audit_logs', () => this.prisma.$executeRaw`
        DELETE FROM audit_logs WHERE id IN (SELECT id FROM audit_logs WHERE created_at < ${now}::timestamptz - interval '12 months' LIMIT ${BATCH})`);
    }
    return counts;
  }

  /** Bộ đếm giới hạn tần suất: cửa sổ quá một giờ không còn dùng. */
  async rateLimitGc(now: Date = this.clock.now()): Promise<number> {
    return this.prisma.$executeRaw`DELETE FROM rate_limit_counters WHERE window_start < ${now}::timestamptz - interval '1 hour'`;
  }
}
