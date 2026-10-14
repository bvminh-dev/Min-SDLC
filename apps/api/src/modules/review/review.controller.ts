import { Controller, Delete, Get, HttpCode, Patch, Post, Req, Res, UseInterceptors } from '@nestjs/common';
import type { Request, Response } from 'express';
import { Action, CurrentSession, Public, RateLimit, Roles, Validate, ValidBody, ValidParams, ValidQuery, allowMultipart, type SessionContext } from '../platform';
import { LIMITS } from './config';
import { ImageService } from './image.service';
import { NoStoreInterceptor, keyOf } from './http';
import { ModerationService } from './moderation.service';
import {
  adminListQuery, createBody, emptyBody, idParams, mineListQuery, patchBody, productParams, publicListQuery, reasonBody,
  type AdminListQuery, type CreateBody, type MineListQuery, type PatchBody, type PublicListQuery, type ReasonBody,
} from './policy';
import { ReadService } from './read.service';
import { ReviewService } from './review.service';

allowMultipart('POST', '/api/v1/review-images'); // ngoại lệ hẹp của quy tắc chỉ nhận application/json (ADR-016): vẫn qua giới hạn tần suất, CSRF (Origin) và quyền

type Id = { id: string };
type ProductId = { product_id: string };

/**
 * Endpoint của REV (REV-API mục Endpoint). Thứ tự kiểm do platform: giới hạn tần suất, phiên (401), CSRF (403), role theo ma trận (403), schema (400, trường lạ `unknown_field`), rồi Idempotency-Key (chỉ tạo), tìm tài nguyên kèm
 * điều kiện sở hữu (404), trạng thái (409). `user_id` và role chỉ từ phiên, không endpoint nào nhận `user_id`, `order_item_id`, `status` hay `moderated_by` từ client (SB-05). Không có route nhận hay phát event (T21).
 */
@Controller()
export class ReviewController {
  constructor(private readonly reviews: ReviewService, private readonly reads: ReadService, private readonly images: ImageService) {}

  @Post('products/:product_id/reviews') @Action('Tạo đánh giá sản phẩm (người đã nhận hàng)') @Roles('customer') @RateLimit(LIMITS.create) @UseInterceptors(NoStoreInterceptor) @Validate({ params: productParams, body: createBody })
  async create(@CurrentSession() s: SessionContext, @ValidParams() p: ProductId, @ValidBody() b: CreateBody, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const out = await this.reviews.create(s, keyOf(req), p.product_id, b);
    if (out.replayed) res.setHeader('Idempotent-Replayed', 'true'); // gửi lại cùng khóa: đúng phản hồi cũ (trạng thái và thân đã lưu)
    res.status(out.status);
    return out.body;
  }

  @Get('products/:product_id/review-eligibility') @Action('Kiểm điều kiện được đánh giá sản phẩm (mua có xác minh)') @Roles('customer') @RateLimit(LIMITS.eligibility) @UseInterceptors(NoStoreInterceptor) @Validate({ params: productParams })
  eligibility(@CurrentSession() s: SessionContext, @ValidParams() p: ProductId) { return this.reads.eligibility(s, p.product_id); }

  @Post('review-images') @Action('Tải ảnh đính kèm đánh giá') @Roles('customer') @RateLimit(LIMITS.upload) @UseInterceptors(NoStoreInterceptor) @Validate({})
  upload(@CurrentSession() s: SessionContext, @Req() req: Request, @Res({ passthrough: true }) res: Response) { return this.images.upload(s.user_id, req, res); }

  @Patch('reviews/:id') @Action('Sửa đánh giá của mình') @Roles('customer') @RateLimit(LIMITS.edit) @UseInterceptors(NoStoreInterceptor) @Validate({ params: idParams, body: patchBody })
  edit(@CurrentSession() s: SessionContext, @ValidParams() p: Id, @ValidBody() b: PatchBody) { return this.reviews.edit(s, p.id, b); }

  @Delete('reviews/:id') @Action('Xóa đánh giá (chủ hoặc admin)') @HttpCode(204) @Roles('customer', 'admin') @RateLimit(LIMITS.remove) @Validate({ params: idParams })
  async remove(@CurrentSession() s: SessionContext, @ValidParams() p: Id): Promise<void> { await this.reviews.remove(s, p.id); }

  @Get('products/:product_id/reviews') @Action('Xem đánh giá công khai của sản phẩm') @Public() @RateLimit(LIMITS.publicRead) @Validate({ params: productParams, query: publicListQuery })
  publicList(@ValidParams() p: ProductId, @ValidQuery() q: PublicListQuery) { return this.reads.publicList(p.product_id, q); }

  @Get('me/reviews') @Action('Xem đánh giá của tôi (danh sách và chi tiết)') @Roles('customer') @RateLimit(LIMITS.mine) @UseInterceptors(NoStoreInterceptor) @Validate({ query: mineListQuery })
  mine(@CurrentSession() s: SessionContext, @ValidQuery() q: MineListQuery) { return this.reads.mine(s, q); }

  @Get('me/reviews/:id') @Action('Xem đánh giá của tôi (danh sách và chi tiết)') @Roles('customer') @RateLimit(LIMITS.mine) @UseInterceptors(NoStoreInterceptor) @Validate({ params: idParams })
  mineOne(@CurrentSession() s: SessionContext, @ValidParams() p: Id) { return this.reads.mineOne(s, p.id); }
}

/** Kiểm duyệt: CHỈ admin (staff, customer 403, SB-05, SB-07). Một bộ đếm chung bậc D cho hàng đợi và mọi thao tác. Admin không có route sửa nội dung (chỉ duyệt, từ chối, ẩn, bỏ ẩn, xóa). */
@Controller('admin/reviews')
export class AdminReviewController {
  constructor(private readonly reads: ReadService, private readonly moderation: ModerationService) {}

  @Get() @Action('Xem hàng đợi và danh sách đánh giá để kiểm duyệt') @Roles('admin') @RateLimit(LIMITS.admin) @UseInterceptors(NoStoreInterceptor) @Validate({ query: adminListQuery })
  list(@ValidQuery() q: AdminListQuery) { return this.reads.admin(q); }

  @Post(':id/approve') @Action('Duyệt đánh giá chờ duyệt') @HttpCode(200) @Roles('admin') @RateLimit(LIMITS.admin) @Validate({ params: idParams, body: emptyBody })
  approve(@CurrentSession() s: SessionContext, @ValidParams() p: Id) { return this.moderation.act(s, 'approve', p.id); }

  @Post(':id/reject') @Action('Từ chối đánh giá chờ duyệt') @HttpCode(200) @Roles('admin') @RateLimit(LIMITS.admin) @Validate({ params: idParams, body: reasonBody })
  reject(@CurrentSession() s: SessionContext, @ValidParams() p: Id, @ValidBody() b: ReasonBody) { return this.moderation.act(s, 'reject', p.id, b.reason); }

  @Post(':id/hide') @Action('Ẩn đánh giá đã đăng') @HttpCode(200) @Roles('admin') @RateLimit(LIMITS.admin) @Validate({ params: idParams, body: reasonBody })
  hide(@CurrentSession() s: SessionContext, @ValidParams() p: Id, @ValidBody() b: ReasonBody) { return this.moderation.act(s, 'hide', p.id, b.reason); }

  @Post(':id/unhide') @Action('Bỏ ẩn đánh giá (hidden về published)') @HttpCode(200) @Roles('admin') @RateLimit(LIMITS.admin) @Validate({ params: idParams, body: emptyBody })
  unhide(@CurrentSession() s: SessionContext, @ValidParams() p: Id) { return this.moderation.act(s, 'unhide', p.id); }
}
