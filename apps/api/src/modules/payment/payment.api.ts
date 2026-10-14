import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../platform';

export interface RevenueRange { from: Date; to: Date }
export type RevenueBucket = 'hour' | 'day' | 'month';
export interface RevenueTotals { gross: number; refunded: number; net: number; payment_count: number }
export interface Revenue { totals: RevenueTotals; by_method: { vnpay: RevenueTotals; cod: RevenueTotals }; series: (RevenueTotals & { bucket_start: string })[] }

const BUCKETS: readonly RevenueBucket[] = ['hour', 'day', 'month'];
const SERIES_MAX_BUCKETS = 1000;
const inDbDates = (d: Date): boolean => d.getUTCFullYear() >= 1 && d.getUTCFullYear() <= 9999;
const zero = (): RevenueTotals => ({ gross: 0, refunded: 0, net: 0, payment_count: 0 });
const add = (t: RevenueTotals, kind: 'g' | 'r', sum: number, count: number): void => {
  if (kind === 'g') { t.gross += sum; t.payment_count += count; } else t.refunded += sum;
  t.net = t.gross - t.refunded;
};

/**
 * Giao diện nội bộ PAY phơi ra cho module khác (ADR-012, ADR-020, bảng "Giao diện module" của architecture.md, hàng DSH | PAY): chỉ đọc, không `tx`, không endpoint HTTP, không event.
 * DSH lấy MỌI số tiền từ đây (SB-23): `gross` là Payment `succeeded` hoặc `refunded` theo `paid_at`; `refunded` là Refund `succeeded` theo `resolved_at` ĐÃ đưa Payment sang `refunded` (hoàn giao dịch của chính Payment, kể cả
 * `late_payment` do StockCommitFailed); Refund `late_payment` của Payment đã đóng và `duplicate_payment` không trừ vì tiền đó chưa vào doanh thu; `net` = `gross` - `refunded`. Một câu truy vấn mỗi lời gọi (nhất quán).
 */
@Injectable()
export class PaymentApi {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Doanh thu trong khoảng UTC nửa mở `[from, to)`: tổng, theo phương thức và (khi có `bucket`) theo mốc UTC (không bỏ mốc rỗng, tối đa 1000 mốc). Đầu vào sai ném `RangeError` (lỗi lập trình của bên gọi);
   * lỗi CSDL được ném nguyên để DSH trả 503, không bao giờ trả 0 thay số thật (SB-39).
   */
  async getRevenue(range: RevenueRange, bucket?: RevenueBucket): Promise<Revenue> {
    if (!range || !(range.from instanceof Date) || !(range.to instanceof Date) || Number.isNaN(range.from.getTime()) || Number.isNaN(range.to.getTime()) || range.to < range.from || !inDbDates(range.from) || !inDbDates(range.to)) {
      throw new RangeError('range_utc phải là [from, to) hợp lệ với from không sau to, năm 1 đến 9999');
    }
    if (bucket !== undefined && !BUCKETS.includes(bucket)) throw new RangeError(`bucket phải thuộc ${BUCKETS.join(', ')}`);
    const series = new Map<string, RevenueTotals>();
    if (bucket) {
      for (let t = new Date(this.floor(range.from, bucket)); t < range.to; t = this.next(t, bucket)) {
        if (series.size >= SERIES_MAX_BUCKETS) throw new RangeError(`khoảng và bucket cho quá ${SERIES_MAX_BUCKETS} mốc`); // kiểm TRƯỚC khi chạy truy vấn
        series.set(this.key(t), zero());
      }
    }
    const unit = bucket ?? 'month';
    const u = Prisma.raw(`'${unit}'`); // hằng đã kiểm theo danh sách BUCKETS, không có đầu vào người dùng
    const rows = await this.prisma.$queryRaw<{ k: 'g' | 'r'; m: 'vnpay' | 'cod'; b: string; s: bigint; c: bigint }[]>(Prisma.sql`
      WITH g AS (
        SELECT method::text AS m, amount AS a, to_char(date_trunc(${u}, paid_at AT TIME ZONE 'UTC'), 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS b FROM payments
        WHERE status IN ('succeeded', 'refunded') AND paid_at >= ${range.from}::timestamptz AND paid_at < ${range.to}::timestamptz
      ), r AS (
        SELECT p.method::text AS m, f.amount AS a, to_char(date_trunc(${u}, f.resolved_at AT TIME ZONE 'UTC'), 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS b
        FROM refunds f JOIN payments p ON p.id = f.payment_id JOIN payment_attempts t ON t.id = f.attempt_id
        WHERE f.status = 'succeeded' AND p.status = 'refunded' AND t.provider_txn_no = p.provider_ref AND f.resolved_at >= ${range.from}::timestamptz AND f.resolved_at < ${range.to}::timestamptz
      )
      SELECT 'g' AS k, m, b, sum(a) AS s, count(*) AS c FROM g GROUP BY m, b
      UNION ALL SELECT 'r', m, b, sum(a), 0 FROM r GROUP BY m, b`);
    const totals = zero(), by = { vnpay: zero(), cod: zero() };
    for (const r of rows) {
      const sum = Number(r.s), count = Number(r.c);
      add(totals, r.k, sum, count); add(by[r.m], r.k, sum, count);
      if (bucket) add(series.get(r.b) ?? series.set(r.b, zero()).get(r.b)!, r.k, sum, count);
    }
    return { totals, by_method: by, series: [...series.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([bucket_start, t]) => ({ bucket_start, ...t })) };
  }

  /** Số Refund `failed` đang chờ admin xử lý: đã hết lượt tự thử lại (không còn hẹn `next_retry_at`, K-04). */
  async countFailedRefunds(): Promise<number> {
    const [{ n }] = await this.prisma.$queryRaw<{ n: number }[]>`SELECT count(*)::int AS n FROM refunds WHERE status = 'failed'::refund_status AND next_retry_at IS NULL`;
    return n;
  }

  private floor(d: Date, b: RevenueBucket): Date {
    const t = new Date(d);
    t.setUTCMinutes(0, 0, 0);
    if (b !== 'hour') t.setUTCHours(0);
    if (b === 'month') t.setUTCDate(1);
    return t;
  }
  private next(d: Date, b: RevenueBucket): Date {
    const t = new Date(d);
    if (b === 'hour') t.setUTCHours(t.getUTCHours() + 1); else if (b === 'day') t.setUTCDate(t.getUTCDate() + 1); else t.setUTCMonth(t.getUTCMonth() + 1);
    return t;
  }
  private key(d: Date): string { return d.toISOString().replace(/\.\d{3}Z$/, 'Z'); }
}
