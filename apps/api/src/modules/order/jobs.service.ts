import { Injectable } from '@nestjs/common';
import { AppLogger, Clock, PrismaService } from '../platform';
import { SWEEP_BATCH } from './config';

/**
 * Job `ord.sweep-code-counters` (ADR-013, ORD-DB mục Mã đơn): mỗi ngày xóa dòng bộ đếm mã đơn có `day` nhỏ hơn ngày hiện tại theo giờ Việt Nam trừ 2 ngày (giao dịch kéo qua nửa đêm vẫn thấy dòng ngày cũ),
 * tối đa 500 dòng mỗi lượt (giới hạn lô), idempotent. Đóng khi không chắc: không tính được ngày hiện tại thì ném lỗi và không xóa gì. Xóa bộ đếm cũ không đổi mã đã cấp (`orders.code` unique).
 */
@Injectable()
export class OrderJobsService {
  private readonly log: AppLogger;
  constructor(private readonly prisma: PrismaService, private readonly clock: Clock, logger: AppLogger) { this.log = logger.for('order'); }

  async sweepCodeCounters(o: { batch?: number } = {}): Promise<{ deleted: number }> {
    const now = this.clock.now();
    if (!(now instanceof Date) || Number.isNaN(now.getTime())) throw new Error('không tính được ngày hiện tại: không xóa bộ đếm nào');
    const today = new Date(now.getTime() + 7 * 3600_000).toISOString().slice(0, 10); // Asia/Ho_Chi_Minh là UTC+7 quanh năm
    const deleted = await this.prisma.$executeRaw`
      DELETE FROM order_code_counters WHERE day IN (
        SELECT day FROM order_code_counters WHERE day < (${today}::date - 2) ORDER BY day LIMIT ${o.batch ?? SWEEP_BATCH})`;
    this.log.info('ord.sweep-code-counters xong', { code: 'ord-sweep-code-counters', deleted });
    return { deleted };
  }
}
