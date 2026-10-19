import { Injectable } from '@nestjs/common';
import { AppLogger, AuditService, Clock, PrismaService, currentCorrelationId, type SessionContext } from '../platform';
import { BlocksService } from './blocks.service';
import { BlockCache } from './cache.service';
import { AUDIT_ACTION, AUDIT_MARKS_MAX, EXPORT_ACTION, type Block } from './config';
import { salesCsv, sourcesCsv } from './csv';
import { cacheKey, parseParams, type Params } from './policy';

/**
 * Một yêu cầu của admin (đã qua phiên, role, giới hạn tần suất): tham số (400), bộ nhớ đệm, nguồn (503), rồi audit `dashboard.view` (DSH-REQ-20261006-105126549 BR7, K-16, SB-19, ADR-021).
 * Audit gộp: mỗi admin tối đa MỘT dòng mỗi phút (UTC cắt đến phút); dấu gộp là bộ nhớ tiến trình (DSH-DB), ĐẶT TRƯỚC khi ghi nên sáu khối chạy song song của một lần mở trang không ghi sáu dòng.
 * Chỉ yêu cầu thành công (200) mới ghi; 400, 401, 403, 429, 503 không ghi. Ghi lỗi không chặn việc xem: log `error` `audit-write-failed` kèm `trace_id`, không có số liệu.
 */
@Injectable()
export class DashboardService {
  private readonly log: AppLogger;
  private readonly marks = new Map<string, number>(); // id admin -> phút (UTC) của lần ghi `dashboard.view` gần nhất
  constructor(
    private readonly blocks: BlocksService, private readonly cache: BlockCache, private readonly audit: AuditService, private readonly prisma: PrismaService, private readonly clock: Clock, logger: AppLogger,
  ) { this.log = logger.for('dashboard'); }

  async view(session: SessionContext, block: Block, rawQuery: Record<string, unknown>): Promise<Record<string, unknown>> {
    const { p, body } = await this.read(block, rawQuery);
    await this.record(session, block, p);
    return body;
  }

  /** Tham số (400), rồi bộ nhớ đệm, rồi nguồn (503): dùng chung cho JSON và CSV. */
  private async read(block: Block, rawQuery: Record<string, unknown>): Promise<{ p: Params; body: Record<string, unknown> }> {
    const p = parseParams(block, rawQuery, this.clock.now());
    return { p, body: await this.cache.get(cacheKey(block, p), () => this.load(block, p)) };
  }

  /**
   * Xuất CSV của báo cáo theo nguồn hoặc theo sale (`format=csv`): cùng kiểm tham số, cùng bản đệm (khóa đệm không có `format`) và cùng thứ tự dòng với JSON, nên xuất lặp không thêm truy vấn.
   * Mỗi lần THÀNH CÔNG ghi một dòng `dashboard.export` (không gộp theo phút, không chung dấu với `dashboard.view`, không nội dung số liệu); ghi lỗi không chặn tải, chỉ log `error` (SB-19, T17).
   * Lỗi 400, 403, 429, 503 ném trước khi tới đây nên không có tệp và không có dòng audit.
   */
  async exportCsv(session: SessionContext, block: 'report-sources' | 'report-sales', rawQuery: Record<string, unknown>): Promise<{ filename: string; text: string }> {
    const { p, body } = await this.read(block, rawQuery);
    const r = p.range!;
    const totals = body.totals as { orders: number; revenue: number };
    const sources = block === 'report-sources';
    const csv = sources
      ? sourcesCsv(body.items as Parameters<typeof sourcesCsv>[0], totals)
      : salesCsv(body.items as Parameters<typeof salesCsv>[0], body.website as Parameters<typeof salesCsv>[1], totals);
    await this.write(session, EXPORT_ACTION, block, { report: sources ? 'sources' : 'sales', from: r.from, to: r.to, rows: csv.rows }); // chỉ loại báo cáo, khoảng ngày, số dòng: không số liệu, không tên (T17)
    return { filename: `${sources ? 'bao-cao-nguon-don' : 'bao-cao-sale'}_${r.from}_${r.to}.csv`, text: csv.text };
  }

  private load(block: Block, p: Params): Promise<Record<string, unknown>> {
    const r = p.range!;
    switch (block) {
      case 'revenue': return this.blocks.revenue(r);
      case 'orders': return this.blocks.orderTotals(r);
      case 'customers': return this.blocks.customers(r);
      case 'products': return this.blocks.products();
      case 'low-stock': return this.blocks.lowStock();
      case 'recent-orders': return this.blocks.recentOrders();
      case 'report-revenue': return this.blocks.reportRevenue(r);
      case 'report-orders': return this.blocks.reportOrders(r);
      case 'report-products': return this.blocks.reportProducts(r, p.sort!, p.limit!);
      case 'report-sources': return this.blocks.reportSources(r);
      case 'report-sales': return this.blocks.reportSales(r);
    }
  }

  private async record(session: SessionContext, block: Block, p: Params): Promise<void> {
    const now = this.clock.now();
    const minute = Math.floor(now.getTime() / 60_000);
    if (this.marks.get(session.user_id) === minute) return;
    this.marks.set(session.user_id, minute); // đặt TRƯỚC khi ghi: các khối song song cùng phút thấy dấu ngay
    if (this.marks.size > AUDIT_MARKS_MAX) for (const [k, v] of this.marks) if (v < minute) this.marks.delete(k);
    await this.write(session, AUDIT_ACTION, block, { block, from: p.range?.from ?? null, to: p.range?.to ?? null }); // chỉ khối và khoảng ngày, không nội dung số liệu (T6)
  }

  /** Một dòng audit của admin; ghi lỗi không chặn việc xem hay tải tệp: log `error` `audit-write-failed` kèm `trace_id`, không có số liệu (ADR-021, SB-19). */
  private async write(session: SessionContext, action: string, block: Block, after: Record<string, unknown>): Promise<void> {
    try {
      await this.audit.record(this.prisma, { actor_id: session.user_id, actor_role: 'admin', action, target_type: 'dashboard', target_id: block, after });
    } catch (err) {
      this.log.error('audit-write-failed', { err, action, trace_id: currentCorrelationId() ?? 'none' });
    }
  }
}
