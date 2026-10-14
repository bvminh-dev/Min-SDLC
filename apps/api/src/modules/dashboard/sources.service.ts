import { Injectable } from '@nestjs/common';
import { AppLogger, ConfigService, DomainError, currentCorrelationId } from '../platform';
import { MAX_INFLIGHT_PER_SOURCE, SOURCES, type Source } from './config';

/**
 * Cổng gọi nguồn (DSH-REQ-20261006-105126549 BR5, SB-39): mỗi lời gọi tới một module nguồn có hạn `DASHBOARD_SOURCE_TIMEOUT_MS`; quá hạn hoặc nguồn ném lỗi (kể cả `RangeError`, lỗi CSDL) thì ném
 * `dashboard-source-unavailable` kèm `source`, không có chi tiết nội bộ (SB-20; câu SQL, stack chỉ ở log). Không bao giờ trả 0 hay mảng rỗng thay cho lỗi.
 * `Promise.race` không hủy truy vấn đang chạy, nên mỗi nguồn có bộ đếm lời gọi ĐANG CHẠY (tính tới khi truy vấn thật sự xong, không tới khi quá hạn): chạm `MAX_INFLIGHT_PER_SOURCE`
 * thì từ chối ngay (503) thay vì dồn thêm truy vấn vào nguồn đang chậm làm cạn pool (L71, L87, L117). Không giữ kết nối hay giao dịch nào khi chờ.
 */
@Injectable()
export class SourceGate {
  private readonly log: AppLogger;
  private readonly inflight: Record<Source, number> = { ORD: 0, PRD: 0, INV: 0, USR: 0, PAY: 0 };
  constructor(private readonly config: ConfigService, logger: AppLogger) { this.log = logger.for('dashboard'); }

  /** Số lời gọi đang chạy của từng nguồn (test kiểm rò sau khi quá hạn). */
  pending(): Record<Source, number> { return { ...this.inflight }; }

  async call<T>(source: Source, fn: () => Promise<T>): Promise<T> {
    if (!SOURCES.includes(source)) throw new Error(`nguồn không hợp lệ: ${source}`);
    if (this.inflight[source] >= MAX_INFLIGHT_PER_SOURCE) {
      this.log.warn('nguồn đang quá tải, từ chối lời gọi', { source, inflight: this.inflight[source] });
      throw this.unavailable(source);
    }
    const ms = this.config.get<number>('DASHBOARD_SOURCE_TIMEOUT_MS');
    this.inflight[source] += 1;
    let work: Promise<T>;
    try { work = Promise.resolve(fn()); } catch (err) { work = Promise.reject(err); }
    work.then(() => { this.inflight[source] -= 1; }, () => { this.inflight[source] -= 1; }); // đếm tới khi truy vấn thật sự xong; không có unhandled rejection
    let timer: NodeJS.Timeout | undefined;
    const deadline = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error(`quá hạn ${ms} ms`)), ms); });
    try {
      return await Promise.race([work, deadline]);
    } catch (err) {
      this.log.error('nguồn dashboard lỗi hoặc quá hạn', { source, err, trace_id: currentCorrelationId() ?? 'none' });
      throw this.unavailable(source);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  private unavailable(source: Source): DomainError { return new DomainError('dashboard-source-unavailable', { extra: { source } }); }
}
