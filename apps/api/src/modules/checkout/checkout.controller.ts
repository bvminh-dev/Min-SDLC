import { Controller, Delete, Get, HttpCode, Post, Put, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { Action, CurrentSession, RateLimit, Roles, Validate, ValidBody, ValidParams, type SessionContext } from '../platform';
import { LIMITS } from './config';
import { keyOf } from './idem';
import { addressBody, couponBody, emptyBody, idParams, paymentBody, placeBody, shippingBody, type AddressBody, type CouponBody, type PaymentBody, type PlaceBody, type ShippingBody } from './policy';
import { PlaceService } from './place.service';
import { SelectService } from './select.service';
import { SessionService } from './session.service';
import { ViewService } from './view.service';

type Id = { id: string };
/** Mọi phản hồi của CHK có dữ liệu cá nhân (địa chỉ) hoặc số tiền riêng của khách: không lưu đệm (SB-08, CHK-SEC T10). */
const noStore = (res: Response): void => { res.setHeader('Cache-Control', 'no-store'); };

/**
 * Checkout của customer (CHK-API): phiên lấy theo `{id}` KÈM điều kiện sở hữu `user_id` từ PHIÊN đăng nhập (SB-06: phiên của người khác cùng 404 với không có, không IDOR); chỉ customer (khách chưa đăng nhập 401, staff, admin 403, SB-05);
 * `email_verified` kiểm ở server (SB-26). Không endpoint nào nhận trường tiền, dòng hàng, địa chỉ hay dữ liệu thẻ (body đóng, SB-23). Không có route nhận event hay đổi trạng thái phiên từ ngoài (T16).
 */
@Controller('checkout/sessions')
export class CheckoutController {
  constructor(private readonly sessions: SessionService, private readonly views: ViewService, private readonly selects: SelectService, private readonly places: PlaceService) {}

  @Post() @Action('Bắt đầu phiên checkout từ giỏ (cần email đã xác minh)') @Roles('customer') @RateLimit(LIMITS.create) @Validate({ body: emptyBody })
  async create(@CurrentSession() s: SessionContext, @Res({ passthrough: true }) res: Response) {
    noStore(res);
    const r = await this.sessions.create(s);
    res.status(r.created ? 201 : 200); // 201 phiên mới, 200 trả lại phiên `open` cũ (BR4)
    return r.body;
  }

  @Get(':id') @Action('Xem lại đơn trước khi đặt') @Roles('customer') @RateLimit(LIMITS.view) @Validate({ params: idParams })
  view(@CurrentSession() s: SessionContext, @ValidParams() p: Id, @Res({ passthrough: true }) res: Response) { noStore(res); return this.views.view(s, p.id); }

  @Put(':id/address') @Action('Chọn địa chỉ giao hàng cho phiên checkout') @Roles('customer') @RateLimit(LIMITS.select) @Validate({ params: idParams, body: addressBody })
  address(@CurrentSession() s: SessionContext, @ValidParams() p: Id, @ValidBody() b: AddressBody, @Res({ passthrough: true }) res: Response) { noStore(res); return this.selects.address(s, p.id, b); }

  @Get(':id/shipping-options') @Action('Chọn phương thức vận chuyển và xem phí theo địa chỉ') @Roles('customer') @RateLimit(LIMITS.select) @Validate({ params: idParams })
  shippingOptions(@CurrentSession() s: SessionContext, @ValidParams() p: Id, @Res({ passthrough: true }) res: Response) { noStore(res); return this.views.shippingOptions(s, p.id); }

  @Put(':id/shipping-method') @Action('Chọn phương thức vận chuyển và xem phí theo địa chỉ') @Roles('customer') @RateLimit(LIMITS.select) @Validate({ params: idParams, body: shippingBody })
  shipping(@CurrentSession() s: SessionContext, @ValidParams() p: Id, @ValidBody() b: ShippingBody, @Res({ passthrough: true }) res: Response) { noStore(res); return this.selects.shipping(s, p.id, b); }

  @Put(':id/payment-method') @Action('Chọn phương thức thanh toán (VNPay hoặc COD)') @Roles('customer') @RateLimit(LIMITS.select) @Validate({ params: idParams, body: paymentBody })
  payment(@CurrentSession() s: SessionContext, @ValidParams() p: Id, @ValidBody() b: PaymentBody, @Res({ passthrough: true }) res: Response) { noStore(res); return this.selects.payment(s, p.id, b); }

  @Put(':id/coupon') @Action('Áp và gỡ mã giảm giá ở checkout') @Roles('customer') @RateLimit(LIMITS.coupon) @Validate({ params: idParams, body: couponBody })
  coupon(@CurrentSession() s: SessionContext, @ValidParams() p: Id, @ValidBody() b: CouponBody, @Res({ passthrough: true }) res: Response) { noStore(res); return this.selects.coupon(s, p.id, b); }

  @Delete(':id/coupon') @Action('Áp và gỡ mã giảm giá ở checkout') @HttpCode(204) @Roles('customer') @RateLimit(LIMITS.select) @Validate({ params: idParams })
  async removeCoupon(@CurrentSession() s: SessionContext, @ValidParams() p: Id): Promise<void> { await this.selects.removeCoupon(s, p.id); }

  @Post(':id/place-order') @Action('Đặt hàng và tạo đơn') @Roles('customer') @RateLimit(LIMITS.place) @Validate({ params: idParams, body: placeBody })
  async place(@CurrentSession() s: SessionContext, @ValidParams() p: Id, @ValidBody() b: PlaceBody, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    noStore(res);
    const key = keyOf(req);
    const r = await this.places.place(s, p.id, key, b);
    res.status(r.status); // 201 đơn mới, 200 phát lại (`replayed` = true)
    if (r.body.replayed) res.setHeader('Idempotent-Replayed', 'true');
    return r.body;
  }

  @Delete(':id') @Action('Hủy phiên checkout và hết hạn phiên (khách hủy; job hết hạn là tác nhân hệ thống)') @HttpCode(204) @Roles('customer') @RateLimit(LIMITS.cancel) @Validate({ params: idParams })
  async remove(@CurrentSession() s: SessionContext, @ValidParams() p: Id): Promise<void> { await this.sessions.remove(s.user_id, p.id); }
}
