import { Controller, Get, HttpCode, Post } from '@nestjs/common';
import { Action, CurrentSession, RateLimit, Roles, Validate, ValidBody, ValidParams, ValidQuery, type SessionContext } from '../platform';
import { CancelService } from './cancel.service';
import { LIMITS } from './http';
import { adminListQuery, cancelBody, codeParams, listQuery, type AdminListQuery, type CancelBody, type ListQuery } from './policy';
import { ReadService } from './read.service';

type Params = { code: string };

/**
 * Đơn của customer, chi tiết và lịch sử cho customer, staff, admin, hủy cho customer và admin (ORD-API mục Endpoint). Không có endpoint nào để staff đổi hay hủy đơn, không có
 * route nhận event hay gọi `createPending`, `confirmCod`, `lockForHandoff`: chuyển trạng thái khác chỉ do event hoặc giao diện module (ORD-SEC T9).
 */
@Controller('orders')
export class OrderController {
  constructor(private readonly reads: ReadService, private readonly cancels: CancelService) {}

  @Get() @Action('Xem danh sách đơn của mình (lọc theo trạng thái)') @Roles('customer') @RateLimit(LIMITS.read) @Validate({ query: listQuery })
  list(@CurrentSession() s: SessionContext, @ValidQuery() q: ListQuery) { return this.reads.listMine(s, q); }

  @Get(':code') @Action('Xem chi tiết đơn') @Roles('customer', 'staff', 'admin') @RateLimit(LIMITS.read) @Validate({ params: codeParams })
  detail(@CurrentSession() s: SessionContext, @ValidParams() p: Params) { return this.reads.detail(s, p.code); }

  @Get(':code/status-history') @Action('Xem lịch sử trạng thái đơn') @Roles('customer', 'staff', 'admin') @RateLimit(LIMITS.read) @Validate({ params: codeParams })
  history(@CurrentSession() s: SessionContext, @ValidParams() p: Params) { return this.reads.history(s, p.code); }

  @Post(':code/cancel') @Action('Hủy đơn (trước khi giao)') @HttpCode(200) @Roles('customer', 'admin') @RateLimit(LIMITS.cancel) @Validate({ params: codeParams, body: cancelBody })
  cancel(@CurrentSession() s: SessionContext, @ValidParams() p: Params, @ValidBody() b: CancelBody) { return this.cancels.cancel(s, p.code, b.reason); }
}

/** Danh sách mọi đơn cho staff và admin: bậc D 30 mỗi phút mỗi người (ADR-014). Tìm chỉ theo `code`, không theo email, tên hay điện thoại (SB-08). */
@Controller('admin/orders')
export class AdminOrderController {
  constructor(private readonly reads: ReadService) {}

  @Get() @Action('Xem danh sách mọi đơn, lọc trạng thái, tìm theo mã đơn') @Roles('staff', 'admin') @RateLimit(LIMITS.admin) @Validate({ query: adminListQuery })
  list(@ValidQuery() q: AdminListQuery) { return this.reads.listAll(q); }
}
