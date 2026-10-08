import { Controller, Get, HttpCode, Patch, Post } from '@nestjs/common';
import { Action, CurrentSession, RateLimit, Roles, Validate, ValidBody, ValidParams, ValidQuery, type SessionContext } from '../platform';
import { LIMITS } from './http';
import { MethodService } from './method.service';
import {
  adminListQuery, codeParams, createMethodBody, emptyBody, failBody, idParams, listQuery, patchMethodBody, quoteBody, shipBody, stateBody, trackingBody,
  type AdminListQuery, type CreateMethodBody, type FailBody, type ListQuery, type PatchMethodBody, type QuoteBody, type ShipBody, type StateBody, type TrackingBody,
} from './policy';
import { ReadService } from './read.service';
import { ShipmentService } from './shipment.service';

type Id = { id: string };
type Code = { code: string };

/** Quản trị phương thức vận chuyển: CHỈ admin (staff, customer 403, SB-05, SB-07). Bậc D, đọc và ghi chung một bộ đếm (SHP-API). */
@Controller('admin/shipping/methods')
export class AdminShippingMethodController {
  constructor(private readonly methods: MethodService) {}

  @Get() @Action('Xem danh sách mọi phương thức vận chuyển (kể cả đã tắt)') @Roles('admin') @RateLimit(LIMITS.adminMethods) @Validate({ query: adminListQuery })
  list(@ValidQuery() q: AdminListQuery) { return this.methods.listAll(q); }

  @Post() @Action('Tạo và sửa phương thức vận chuyển') @Roles('admin') @RateLimit(LIMITS.adminMethods) @Validate({ body: createMethodBody })
  create(@CurrentSession() s: SessionContext, @ValidBody() b: CreateMethodBody) { return this.methods.create(s, b); }

  @Patch(':id') @Action('Tạo và sửa phương thức vận chuyển') @Roles('admin') @RateLimit(LIMITS.adminMethods) @Validate({ params: idParams, body: patchMethodBody })
  update(@CurrentSession() s: SessionContext, @ValidParams() p: Id, @ValidBody() b: PatchMethodBody) { return this.methods.update(s, p.id, b); }

  @Post(':id/enable') @Action('Bật hoặc tắt phương thức vận chuyển') @HttpCode(200) @Roles('admin') @RateLimit(LIMITS.adminMethods) @Validate({ params: idParams, body: stateBody })
  enable(@CurrentSession() s: SessionContext, @ValidParams() p: Id, @ValidBody() b: StateBody) { return this.methods.setActive(s, p.id, true, b.version); }

  @Post(':id/disable') @Action('Bật hoặc tắt phương thức vận chuyển') @HttpCode(200) @Roles('admin') @RateLimit(LIMITS.adminMethods) @Validate({ params: idParams, body: stateBody })
  disable(@CurrentSession() s: SessionContext, @ValidParams() p: Id, @ValidBody() b: StateBody) { return this.methods.setActive(s, p.id, false, b.version); }
}

/**
 * Phương thức đang bật và báo phí cho customer; vận đơn của đơn (customer của mình, staff, admin); thao tác của staff và admin. Không có route nhận event hay tạo, hủy vận đơn, không có
 * route sửa hay xóa lịch sử, không có route cho giao diện nội bộ (SHP-SEC T11, T13): tạo và hủy vận đơn chỉ do event của ORD.
 */
@Controller('shipping')
export class ShippingController {
  constructor(private readonly methods: MethodService, private readonly shipments: ShipmentService, private readonly reads: ReadService) {}

  @Get('methods') @Action('Xem các phương thức vận chuyển đang áp dụng') @Roles('customer') @Validate({})
  async active() { return { items: await this.methods.listActive() }; }

  @Post('quote') @Action('Báo phí vận chuyển theo phương thức, thành phố và tạm tính') @HttpCode(200) @Roles('customer') @RateLimit(LIMITS.quote) @Validate({ body: quoteBody })
  quote(@ValidBody() b: QuoteBody) { return this.methods.quote(b); }

  @Get('shipments') @Action('Xem danh sách vận đơn (lọc theo trạng thái, mã đơn, mã vận đơn)') @Roles('staff', 'admin') @RateLimit(LIMITS.list) @Validate({ query: listQuery })
  list(@ValidQuery() q: ListQuery) { return this.reads.list(q); }

  @Get('orders/:code/shipment') @Action('Xem trạng thái và chi tiết vận đơn của một đơn') @Roles('customer', 'staff', 'admin') @RateLimit(LIMITS.lookup) @Validate({ params: codeParams })
  detail(@CurrentSession() s: SessionContext, @ValidParams() p: Code) { return this.reads.detail(s, p.code); }

  @Get('orders/:code/shipment/history') @Action('Xem lịch sử trạng thái vận đơn') @Roles('customer', 'staff', 'admin') @RateLimit(LIMITS.lookup) @Validate({ params: codeParams })
  history(@CurrentSession() s: SessionContext, @ValidParams() p: Code) { return this.reads.history(s, p.code); }

  @Post('orders/:code/shipment/ship') @Action('Bàn giao vận đơn và nhập mã vận đơn') @HttpCode(200) @Roles('staff', 'admin') @RateLimit(LIMITS.write) @Validate({ params: codeParams, body: shipBody })
  ship(@CurrentSession() s: SessionContext, @ValidParams() p: Code, @ValidBody() b: ShipBody) { return this.shipments.ship(s, p.code, b); }

  @Patch('orders/:code/shipment/tracking-number') @Action('Sửa mã vận đơn đã nhập') @Roles('staff', 'admin') @RateLimit(LIMITS.write) @Validate({ params: codeParams, body: trackingBody })
  tracking(@CurrentSession() s: SessionContext, @ValidParams() p: Code, @ValidBody() b: TrackingBody) { return this.shipments.changeTracking(s, p.code, b); }

  @Post('orders/:code/shipment/deliver') @Action('Xác nhận giao xong, báo giao thất bại, xác nhận hàng hoàn về kho') @HttpCode(200) @Roles('staff', 'admin') @RateLimit(LIMITS.write) @Validate({ params: codeParams, body: emptyBody })
  deliver(@CurrentSession() s: SessionContext, @ValidParams() p: Code) { return this.shipments.deliver(s, p.code); }

  @Post('orders/:code/shipment/fail') @Action('Xác nhận giao xong, báo giao thất bại, xác nhận hàng hoàn về kho') @HttpCode(200) @Roles('staff', 'admin') @RateLimit(LIMITS.write) @Validate({ params: codeParams, body: failBody })
  fail(@CurrentSession() s: SessionContext, @ValidParams() p: Code, @ValidBody() b: FailBody) { return this.shipments.fail(s, p.code, b); }

  @Post('orders/:code/shipment/return') @Action('Xác nhận giao xong, báo giao thất bại, xác nhận hàng hoàn về kho') @HttpCode(200) @Roles('staff', 'admin') @RateLimit(LIMITS.write) @Validate({ params: codeParams, body: emptyBody })
  returned(@CurrentSession() s: SessionContext, @ValidParams() p: Code) { return this.shipments.returned(s, p.code); }
}
