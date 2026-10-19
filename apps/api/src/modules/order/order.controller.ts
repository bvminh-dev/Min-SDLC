import { Controller, Get, HttpCode, Patch, Post } from '@nestjs/common';
import { Action, CurrentSession, RateLimit, Roles, Validate, ValidBody, ValidParams, ValidQuery, type SessionContext } from '../platform';
import { CancelService } from './cancel.service';
import { LIMITS } from './http';
import {
  adminListQuery, cancelBody, codeParams, idParams, listQuery, noQuery, sourceCreateBody, sourcePatchBody, sourcesQuery,
  type AdminListQuery, type CancelBody, type ListQuery, type SourceCreateBody, type SourcePatchBody, type SourcesQuery,
} from './policy';
import { ReadService } from './read.service';
import { SourcesService } from './sources.service';

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

  @Get(':code') @Action('Xem chi tiết đơn') @Roles('customer', 'staff', 'sale', 'admin') @RateLimit(LIMITS.read) @Validate({ params: codeParams })
  detail(@CurrentSession() s: SessionContext, @ValidParams() p: Params) { return this.reads.detail(s, p.code); }

  @Get(':code/status-history') @Action('Xem lịch sử trạng thái đơn') @Roles('customer', 'staff', 'sale', 'admin') @RateLimit(LIMITS.read) @Validate({ params: codeParams })
  history(@CurrentSession() s: SessionContext, @ValidParams() p: Params) { return this.reads.history(s, p.code); }

  @Post(':code/cancel') @Action('Hủy đơn (trước khi giao)') @HttpCode(200) @Roles('customer', 'admin') @RateLimit(LIMITS.cancel) @Validate({ params: codeParams, body: cancelBody })
  cancel(@CurrentSession() s: SessionContext, @ValidParams() p: Params, @ValidBody() b: CancelBody) { return this.cancels.cancel(s, p.code, b.reason); }
}

/** Danh sách mọi đơn cho staff, sale (chỉ đơn của mình) và admin: bậc D 30 mỗi phút mỗi người (ADR-014). Tìm chỉ theo `code`, lọc theo `source`, `created_by`, không theo email, tên hay điện thoại (SB-08). */
@Controller('admin/orders')
export class AdminOrderController {
  constructor(private readonly reads: ReadService) {}

  @Get() @Action('Xem danh sách mọi đơn, lọc trạng thái, tìm theo mã đơn') @Roles('staff', 'sale', 'admin') @RateLimit(LIMITS.admin) @Validate({ query: adminListQuery })
  list(@CurrentSession() s: SessionContext, @ValidQuery() q: AdminListQuery) { return this.reads.listAll(s, q); }
}

/** Danh mục nguồn đơn cho staff, sale, admin chọn và lọc: chỉ nguồn đang bật, bậc C (ORD-REQ-20261015-092748678). */
@Controller('order-sources')
export class OrderSourcesController {
  constructor(private readonly sources: SourcesService) {}

  @Get() @Action('Xem danh mục nguồn đơn đang bật (chọn nguồn khi tạo đơn hộ, lọc đơn)') @Roles('staff', 'sale', 'admin') @RateLimit(LIMITS.read) @Validate({ query: sourcesQuery })
  list(@CurrentSession() s: SessionContext, @ValidQuery() q: SourcesQuery) { return this.sources.listFor(s, q.include_inactive === undefined ? undefined : q.include_inactive === 'true'); }
}

/** Quản trị danh mục nguồn đơn: CHỈ admin, bậc D (30 mỗi phút mỗi người), thao tác ghi kiểm `Origin` và `application/json` (nền), mỗi lần ghi một audit. Không có xóa (v1 chỉ tắt). */
@Controller('admin/order-sources')
export class AdminOrderSourcesController {
  constructor(private readonly sources: SourcesService) {}

  @Get() @Action('Thêm, sửa tên và thứ tự, tắt và bật nguồn đơn') @Roles('admin') @RateLimit(LIMITS.admin) @Validate({ query: noQuery })
  list() { return this.sources.listAdmin(); }

  @Post() @Action('Thêm, sửa tên và thứ tự, tắt và bật nguồn đơn') @Roles('admin') @RateLimit(LIMITS.admin) @Validate({ body: sourceCreateBody })
  create(@CurrentSession() s: SessionContext, @ValidBody() b: SourceCreateBody) { return this.sources.create(s, b); }

  @Patch(':id') @Action('Thêm, sửa tên và thứ tự, tắt và bật nguồn đơn') @Roles('admin') @RateLimit(LIMITS.admin) @Validate({ params: idParams, body: sourcePatchBody })
  update(@CurrentSession() s: SessionContext, @ValidParams() p: { id: string }, @ValidBody() b: SourcePatchBody) { return this.sources.update(s, p.id, b); }
}
