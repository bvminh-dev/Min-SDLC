import { Controller, Delete, Get, HttpCode, Patch, Post } from '@nestjs/common';
import { Action, CurrentSession, RateLimit, Roles, Validate, ValidBody, ValidParams, ValidQuery, type SessionContext } from '../platform';
import { CouponService } from './coupon.service';
import { LIMITS } from './config';
import { createBody, idParams, listQuery, noQuery, patchBody, type CreateBody, type ListQuery, type PatchBody } from './policy';

type Params = { id: string };

/** Quản trị coupon: CHỈ admin (staff và customer 403, SB-05, SB-07; PRM-API mục Endpoint). Bậc D 30 mỗi phút mỗi người, mọi endpoint chung một bộ đếm (ADR-014). PRM không có endpoint cho khách. */
@Controller('admin/coupons')
export class AdminCouponController {
  constructor(private readonly coupons: CouponService) {}

  @Post() @Action('Tạo coupon') @Roles('admin') @RateLimit(LIMITS.admin) @Validate({ body: createBody })
  create(@CurrentSession() s: SessionContext, @ValidBody() b: CreateBody) { return this.coupons.create(s, b); }

  @Get() @Action('Xem danh sách và chi tiết coupon (quản trị)') @Roles('admin') @RateLimit(LIMITS.admin) @Validate({ query: listQuery })
  list(@ValidQuery() q: ListQuery) { return this.coupons.list(q); }

  @Get(':id') @Action('Xem danh sách và chi tiết coupon (quản trị)') @Roles('admin') @RateLimit(LIMITS.admin) @Validate({ params: idParams, query: noQuery })
  detail(@ValidParams() p: Params) { return this.coupons.detail(p.id); }

  @Patch(':id') @Action('Sửa coupon (giá trị, điều kiện, hạn, số lượt)') @Roles('admin') @RateLimit(LIMITS.admin) @Validate({ params: idParams, body: patchBody })
  update(@CurrentSession() s: SessionContext, @ValidParams() p: Params, @ValidBody() b: PatchBody) { return this.coupons.update(s, p.id, b); }

  @Delete(':id') @Action('Xóa coupon (xóa mềm)') @HttpCode(204) @Roles('admin') @RateLimit(LIMITS.admin) @Validate({ params: idParams })
  async remove(@CurrentSession() s: SessionContext, @ValidParams() p: Params) { await this.coupons.remove(s, p.id); }

  @Post(':id/disable') @Action('Bật và tắt coupon') @HttpCode(200) @Roles('admin') @RateLimit(LIMITS.admin) @Validate({ params: idParams })
  disable(@CurrentSession() s: SessionContext, @ValidParams() p: Params) { return this.coupons.setEnabled(s, p.id, false); }

  @Post(':id/enable') @Action('Bật và tắt coupon') @HttpCode(200) @Roles('admin') @RateLimit(LIMITS.admin) @Validate({ params: idParams })
  enable(@CurrentSession() s: SessionContext, @ValidParams() p: Params) { return this.coupons.setEnabled(s, p.id, true); }
}
