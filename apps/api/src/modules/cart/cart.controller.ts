import { Controller, Delete, Get, HttpCode, Patch, Post, Put, Res } from '@nestjs/common';
import type { Response } from 'express';
import { Action, CurrentSession, RateLimit, Roles, Validate, ValidBody, ValidParams, type SessionContext } from '../platform';
import { LIMITS } from './config';
import { addBody, couponBody, emptyBody, itemParams, patchBody, shippingBody, type AddBody, type CouponBody, type PatchBody, type ShippingBody } from './policy';
import { ReadService } from './read.service';
import { WriteService } from './write.service';

/**
 * Giỏ hàng của customer (CRT-API): giỏ lấy từ PHIÊN, không có id giỏ ở đường dẫn nên không có IDOR ở cấp giỏ; `{item_id}` luôn tìm kèm điều kiện sở hữu. Chỉ customer (khách chưa đăng nhập 401,
 * staff, admin 403, SB-05); tài khoản chưa xác minh email vẫn dùng được (chặn đặt hàng là việc của CHK, SB-26). Không endpoint nào nhận trường tiền (SB-23). Không có route nhận event, tạo
 * giỏ rời, hay gọi giao diện nội bộ cho CHK (T12).
 */
@Controller('cart')
export class CartController {
  constructor(private readonly reads: ReadService, private readonly writes: WriteService) {}

  @Get() @Action('Xem giỏ, tạm tính, huy hiệu giỏ và cập nhật giá') @Roles('customer') @RateLimit(LIMITS.view) @Validate({})
  view(@CurrentSession() s: SessionContext) { return this.reads.view(s.user_id); }

  @Get('summary') @Action('Xem giỏ, tạm tính, huy hiệu giỏ và cập nhật giá') @Roles('customer') @RateLimit(LIMITS.summary) @Validate({})
  summary(@CurrentSession() s: SessionContext) { return this.reads.summary(s.user_id); }

  @Post('refresh-prices') @Action('Xem giỏ, tạm tính, huy hiệu giỏ và cập nhật giá') @HttpCode(200) @Roles('customer') @RateLimit(LIMITS.write) @Validate({ body: emptyBody })
  refresh(@CurrentSession() s: SessionContext) { return this.writes.refreshPrices(s.user_id); }

  @Post('items') @Action('Thêm sản phẩm vào giỏ') @Roles('customer') @RateLimit(LIMITS.write) @Validate({ body: addBody })
  async add(@CurrentSession() s: SessionContext, @ValidBody() b: AddBody, @Res({ passthrough: true }) res: Response) {
    const r = await this.writes.add(s.user_id, b);
    res.status(r.created ? 201 : 200); // 201 dòng mới, 200 gộp vào dòng cũ (BR9)
    return r.body;
  }

  @Patch('items/:item_id') @Action('Đổi số lượng của một dòng trong giỏ') @Roles('customer') @RateLimit(LIMITS.write) @Validate({ params: itemParams, body: patchBody })
  update(@CurrentSession() s: SessionContext, @ValidParams() p: { item_id: string }, @ValidBody() b: PatchBody) { return this.writes.update(s.user_id, p.item_id, b.quantity); }

  @Delete('items/:item_id') @Action('Xóa một sản phẩm khỏi giỏ') @HttpCode(204) @Roles('customer') @RateLimit(LIMITS.write) @Validate({ params: itemParams })
  async removeItem(@CurrentSession() s: SessionContext, @ValidParams() p: { item_id: string }): Promise<void> { await this.writes.removeItem(s.user_id, p.item_id); }

  @Delete() @Action('Làm trống giỏ') @HttpCode(204) @Roles('customer') @RateLimit(LIMITS.write) @Validate({})
  async clear(@CurrentSession() s: SessionContext): Promise<void> { await this.writes.clear(s.user_id); }

  @Put('coupon') @Action('Áp và gỡ mã giảm giá trên giỏ') @Roles('customer') @RateLimit(LIMITS.coupon) @Validate({ body: couponBody })
  applyCoupon(@CurrentSession() s: SessionContext, @ValidBody() b: CouponBody) { return this.writes.applyCoupon(s.user_id, b); }

  @Delete('coupon') @Action('Áp và gỡ mã giảm giá trên giỏ') @HttpCode(204) @Roles('customer') @RateLimit(LIMITS.write) @Validate({})
  async removeCoupon(@CurrentSession() s: SessionContext): Promise<void> { await this.writes.removeCoupon(s.user_id); }

  @Put('shipping') @Action('Chọn phương thức vận chuyển và xem phí trên giỏ') @Roles('customer') @RateLimit(LIMITS.shipping) @Validate({ body: shippingBody })
  selectShipping(@CurrentSession() s: SessionContext, @ValidBody() b: ShippingBody) { return this.writes.selectShipping(s.user_id, b); }
}
