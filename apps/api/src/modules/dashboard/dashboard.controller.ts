import { Controller, Get, Header, Req, Res, UseGuards } from '@nestjs/common';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { Action, CurrentSession, Roles, Validate, type SessionContext } from '../platform';
import type { Block } from './config';
import { DashboardService } from './dashboard.service';
import { DashboardRateGuard } from './guard';

// Schema của route chỉ để test quét route thấy có khai báo; việc kiểm tham số thật nằm ở `policy.ts` (lỗi 400 phải mang `type` `invalid-parameter` của DSH, không phải `validation-failed`).
const ANY_QUERY = z.any();
const NO_STORE = 'private, no-store'; // số liệu tài chính của admin không được lưu ở trình duyệt chung hay proxy

/**
 * Mười một endpoint chỉ đọc, CHỈ admin (staff, customer 403, chưa đăng nhập 401: guard toàn cục của platform, SB-05, SB-07); giới hạn tần suất bậc D chung một khóa mỗi admin (`DashboardRateGuard`).
 * Không có tham số đường dẫn nên không có xung đột đăng ký tuyến, không có id (không có IDOR).
 */
@Controller('admin')
@UseGuards(DashboardRateGuard)
export class DashboardController {
  constructor(private readonly svc: DashboardService) {}

  private run(s: SessionContext, req: Request, block: Block) { return this.svc.view(s, block, req.query as Record<string, unknown>); }

  @Get('dashboard/revenue') @Action('Xem tổng doanh thu và hoàn tiền thất bại cần xử lý') @Roles('admin') @Header('Cache-Control', NO_STORE) @Validate({ query: ANY_QUERY })
  revenue(@CurrentSession() s: SessionContext, @Req() req: Request) { return this.run(s, req, 'revenue'); }

  @Get('dashboard/orders') @Action('Xem tổng số đơn theo trạng thái') @Roles('admin') @Header('Cache-Control', NO_STORE) @Validate({ query: ANY_QUERY })
  orders(@CurrentSession() s: SessionContext, @Req() req: Request) { return this.run(s, req, 'orders'); }

  @Get('dashboard/customers') @Action('Xem tổng số khách hàng') @Roles('admin') @Header('Cache-Control', NO_STORE) @Validate({ query: ANY_QUERY })
  customers(@CurrentSession() s: SessionContext, @Req() req: Request) { return this.run(s, req, 'customers'); }

  @Get('dashboard/products') @Action('Xem tổng số sản phẩm theo trạng thái') @Roles('admin') @Header('Cache-Control', NO_STORE) @Validate({ query: ANY_QUERY })
  products(@CurrentSession() s: SessionContext, @Req() req: Request) { return this.run(s, req, 'products'); }

  @Get('dashboard/low-stock') @Action('Xem sản phẩm tồn thấp trên dashboard') @Roles('admin') @Header('Cache-Control', NO_STORE) @Validate({ query: ANY_QUERY })
  lowStock(@CurrentSession() s: SessionContext, @Req() req: Request) { return this.run(s, req, 'low-stock'); }

  @Get('dashboard/recent-orders') @Action('Xem đơn hàng gần đây trên dashboard') @Roles('admin') @Header('Cache-Control', NO_STORE) @Validate({ query: ANY_QUERY })
  recentOrders(@CurrentSession() s: SessionContext, @Req() req: Request) { return this.run(s, req, 'recent-orders'); }

  @Get('reports/revenue') @Action('Xem báo cáo doanh thu theo khoảng ngày') @Roles('admin') @Header('Cache-Control', NO_STORE) @Validate({ query: ANY_QUERY })
  reportRevenue(@CurrentSession() s: SessionContext, @Req() req: Request) { return this.run(s, req, 'report-revenue'); }

  @Get('reports/orders') @Action('Xem báo cáo đơn hàng theo khoảng ngày') @Roles('admin') @Header('Cache-Control', NO_STORE) @Validate({ query: ANY_QUERY })
  reportOrders(@CurrentSession() s: SessionContext, @Req() req: Request) { return this.run(s, req, 'report-orders'); }

  @Get('reports/products') @Action('Xem báo cáo sản phẩm bán chạy') @Roles('admin') @Header('Cache-Control', NO_STORE) @Validate({ query: ANY_QUERY })
  reportProducts(@CurrentSession() s: SessionContext, @Req() req: Request) { return this.run(s, req, 'report-products'); }

  /** `format=csv` (chỉ hai báo cáo tính lương): tệp do server dựng; mọi lỗi (400, 403, 429, 503) ném trước nên vẫn là problem+json, không bao giờ là tệp lỗi. */
  private async csvOr(s: SessionContext, req: Request, res: Response, block: 'report-sources' | 'report-sales') {
    if (!Object.prototype.hasOwnProperty.call(req.query, 'format')) return this.run(s, req, block);
    const f = await this.svc.exportCsv(s, block, req.query as Record<string, unknown>);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${f.filename}"`); // tên chỉ gồm chữ cố định và hai ngày đã kiểm: không có chữ của người dùng (T19); `nosniff` do app-setup đặt cho mọi phản hồi
    return f.text;
  }

  @Get('reports/sources') @Action('Xem hoặc xuất CSV báo cáo số đơn và doanh thu theo nguồn đơn') @Roles('admin') @Header('Cache-Control', NO_STORE) @Validate({ query: ANY_QUERY })
  reportSources(@CurrentSession() s: SessionContext, @Req() req: Request, @Res({ passthrough: true }) res: Response) { return this.csvOr(s, req, res, 'report-sources'); }

  @Get('reports/sales') @Action('Xem hoặc xuất CSV báo cáo số đơn và doanh thu theo sale (kèm dòng khách tự đặt)') @Roles('admin') @Header('Cache-Control', NO_STORE) @Validate({ query: ANY_QUERY })
  reportSales(@CurrentSession() s: SessionContext, @Req() req: Request, @Res({ passthrough: true }) res: Response) { return this.csvOr(s, req, res, 'report-sales'); }
}
