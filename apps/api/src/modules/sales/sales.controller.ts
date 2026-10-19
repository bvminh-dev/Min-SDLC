import { Controller, Get, Post, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { Action, CurrentSession, RateLimit, Roles, Validate, ValidBody, ValidParams, ValidQuery, type SessionContext } from '../platform';
import { LIMITS } from './config';
import { CreateService, keyOf } from './create.service';
import { codeParams, listQuery, lookupQuery, orderBody, shippingQuery, type ListQuery, type LookupQuery, type OrderBody, type ShippingQuery } from './policy';
import { ReadService } from './read.service';

/** Mọi phản hồi của SAL có dữ liệu cá nhân của khách (họ tên, điện thoại, địa chỉ) hoặc số tiền riêng: không lưu đệm (SB-08, SAL-SEC T14). */
const noStore = (res: Response): void => { res.setHeader('Cache-Control', 'no-store'); };

/**
 * Bán hàng hộ (SAL-API): chỉ `sale` và `admin` (guest 401, customer và staff 403, ADR-026, SB-05); `created_by` luôn lấy từ PHIÊN (SB-45), thân đóng không nhận trường tiền hay người tạo (SB-23).
 * Không endpoint nào nhận event hay đọc bảng của module khác (T15). `GET /sales/orders/:code` đứng sau `GET /sales/orders` cùng một bộ đếm bậc C theo người dùng.
 */
@Controller('sales')
export class SalesController {
  constructor(private readonly creates: CreateService, private readonly reads: ReadService) {}

  @Post('orders') @Action('Tạo đơn hộ cho khách (sale, admin; staff không đặt hộ)') @Roles('sale', 'admin') @RateLimit(LIMITS.create) @Validate({ body: orderBody })
  async create(@CurrentSession() s: SessionContext, @ValidBody() b: OrderBody, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    noStore(res);
    const key = keyOf(req);
    const r = await this.creates.create(s, key, b);
    res.status(r.status); // 201 đơn mới, 200 phát lại (`replayed` = true)
    if (r.body.replayed) res.setHeader('Idempotent-Replayed', 'true');
    return r.body;
  }

  @Get('customers/lookup') @Action('Tra khách có sẵn theo điện thoại hoặc email (bản che) khi lập đơn hộ') @Roles('sale', 'admin') @RateLimit(LIMITS.lookup) @Validate({ query: lookupQuery })
  lookup(@CurrentSession() s: SessionContext, @ValidQuery() q: LookupQuery, @Res({ passthrough: true }) res: Response) { noStore(res); return this.reads.lookup(s, q); }

  @Get('shipping-options') @Action('Xem phương thức vận chuyển và phí khi lập đơn hộ') @Roles('sale', 'admin') @RateLimit(LIMITS.read) @Validate({ query: shippingQuery })
  shipping(@ValidQuery() q: ShippingQuery, @Res({ passthrough: true }) res: Response) { noStore(res); return this.reads.shippingOptions(q); }

  @Get('orders') @Action('Xem danh sách đơn hộ (Đơn của tôi: sale chỉ đơn mình tạo, admin mọi đơn hộ)') @Roles('sale', 'admin') @RateLimit(LIMITS.read) @Validate({ query: listQuery })
  list(@CurrentSession() s: SessionContext, @ValidQuery() q: ListQuery, @Res({ passthrough: true }) res: Response) { noStore(res); return this.reads.list(s, q); }

  @Get('orders/:code') @Action('Xem chi tiết đơn hộ (sale chỉ đơn mình tạo, admin mọi đơn hộ)') @Roles('sale', 'admin') @RateLimit(LIMITS.read) @Validate({ params: codeParams })
  detail(@CurrentSession() s: SessionContext, @ValidParams() p: { code: string }, @Res({ passthrough: true }) res: Response) { noStore(res); return this.reads.detail(s, p.code); }
}
