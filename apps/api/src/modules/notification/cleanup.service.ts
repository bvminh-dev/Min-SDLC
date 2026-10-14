import { Injectable } from '@nestjs/common';
import { AppLogger, TransactionService } from '../platform';
import { CLEANUP_BATCH, CLEANUP_BUDGET_MS, EMAIL_RETENTION_DAYS, NOTIFICATION_RETENTION_DAYS } from './config';

export interface CleanupOptions {
  /** Mốc "bây giờ" để tính hạn; bỏ trống là `now()` của CSDL (đường chạy thật). */
  now?: Date;
  signal?: AbortSignal;
  budgetMs?: number;
  /** Số dòng tối đa mỗi lô (mặc định 1000); chỉ test dùng để thử giới hạn lô. */
  batch?: number;
}

/**
 * Hàm dọn dữ liệu quá hạn của NTF (NTF-REQ-20261006-103208460 BR9, -103208551 BR10; ADR-022): `notifications` 180 ngày, `email_deliveries` 90 ngày kể từ `created_at`, theo lô 1000 dòng, mỗi lô một giao dịch ngắn,
 * có hạn thời gian cho cả lượt (SB-34; hết hạn thì lượt sau làm tiếp), ghi log số bản ghi đã xóa. Bảng của module khác do module chủ dọn (SB-35), nên không nằm trong job dọn của platform.
 */
@Injectable()
export class CleanupService {
  private readonly log: AppLogger;
  constructor(private readonly transactions: TransactionService, logger: AppLogger) {
    this.log = logger.for('notification');
  }

  async run(o: CleanupOptions = {}): Promise<{ notifications: number; email_deliveries: number }> {
    const start = Date.now(), budget = o.budgetMs ?? CLEANUP_BUDGET_MS, batch = o.batch ?? CLEANUP_BATCH;
    const sweep = async (table: 'notifications' | 'email_deliveries'): Promise<number> => {
      let total = 0;
      while (!o.signal?.aborted && Date.now() - start < budget) {
        const n = await this.transactions.run((tx) => table === 'notifications'
          ? tx.$executeRaw`DELETE FROM notifications WHERE id IN (SELECT id FROM notifications WHERE created_at < COALESCE(${o.now ?? null}::timestamptz, now()) - make_interval(days => ${NOTIFICATION_RETENTION_DAYS}::int) ORDER BY created_at, id LIMIT ${batch} FOR UPDATE SKIP LOCKED)`
          : tx.$executeRaw`DELETE FROM email_deliveries WHERE id IN (SELECT id FROM email_deliveries WHERE created_at < COALESCE(${o.now ?? null}::timestamptz, now()) - make_interval(days => ${EMAIL_RETENTION_DAYS}::int) ORDER BY created_at, id LIMIT ${batch} FOR UPDATE SKIP LOCKED)`);
        total += n;
        if (n < batch) break;
      }
      return total;
    };
    const notifications = await sweep('notifications');
    const email_deliveries = await sweep('email_deliveries');
    // khóa `deliveries`, không `email_deliveries`: tên trường chứa "email" bị bộ che của platform thay bằng [REDACTED] (SB-18)
    this.log.info('notification.cleanup xong', { code: 'notification-cleanup', notifications, deliveries: email_deliveries });
    return { notifications, email_deliveries };
  }
}
