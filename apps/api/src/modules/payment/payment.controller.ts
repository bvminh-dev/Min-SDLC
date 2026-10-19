import { Controller, Get, HttpCode, Post, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { Action, CurrentSession, Public, RateLimit, RawStrings, Roles, Validate, ValidBody, ValidParams, ValidQuery, type SessionContext } from '../platform';
import { CodService } from './cod.service';
import { LIMITS, ipOf } from './http';
import { keyOf } from './idem';
import {
  adminListQuery, codBody, emptyBody, idParams, ipnQuery, myListQuery, refundBody, refundQueueQuery,
  type AdminListQuery, type CodBody, type MyListQuery, type RefundBody, type RefundQueueQuery,
} from './policy';
import { ReadService } from './read.service';
import { RefundService } from './refund.service';
import { StartService } from './start.service';
import { WebhookService } from './webhook.service';
import type { IpnReply } from './vnpay';

type Id = { id: string };
type Replayable<T> = { replayed: boolean; status: number; body: T };
/** Phản hồi của endpoint có Idempotency-Key: gửi lại cùng khóa trả đúng trạng thái và thân đã lưu, kèm `Idempotent-Replayed`. */
function reply<T>(res: Response, out: Replayable<T>): T {
  if (out.replayed) res.setHeader('Idempotent-Replayed', 'true');
  res.status(out.status);
  return out.body;
}

/**
 * Thanh toán của customer (bắt đầu, thử lại, xem) và thao tác của staff, admin trên một Payment (ghi nhận thu COD, hoàn tiền toàn phần). KHÔNG có route nhận event, tạo Payment, đổi trạng thái từ địa chỉ quay về của cổng
 * hay sửa lịch sử (PAY-SEC T5, T9): tạo, đóng, hoàn tiền tự động chỉ do event và job. Số tiền, địa chỉ quay về và khóa ký không bao giờ nhận từ client (body đóng, SB-23).
 */
@Controller('payments')
export class PaymentController {
  constructor(private readonly starts: StartService, private readonly reads: ReadService, private readonly cod: CodService, private readonly refunds: RefundService) {}

  @Get() @Action('Xem danh sách thanh toán của mình') @Roles('customer') @RateLimit(LIMITS.read) @Validate({ query: myListQuery })
  list(@CurrentSession() s: SessionContext, @ValidQuery() q: MyListQuery) { return this.reads.myList(s, q); }

  @Get(':id') @Action('Xem chi tiết thanh toán của mình') @Roles('customer') @RateLimit(LIMITS.read) @Validate({ params: idParams })
  detail(@CurrentSession() s: SessionContext, @ValidParams() p: Id) { return this.reads.myDetail(s, p.id); }

  @Post(':id/initiate') @Action('Bắt đầu thanh toán online qua VNPay') @HttpCode(200) @Roles('customer') @RateLimit(LIMITS.start) @Validate({ params: idParams, body: emptyBody })
  async initiate(@CurrentSession() s: SessionContext, @ValidParams() p: Id, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    return reply(res, await this.starts.start(s, p.id, keyOf(req), 'initiate'));
  }

  @Post(':id/retry') @Action('Thử lại thanh toán online') @HttpCode(200) @Roles('customer') @RateLimit(LIMITS.start) @Validate({ params: idParams, body: emptyBody })
  async retry(@CurrentSession() s: SessionContext, @ValidParams() p: Id, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    return reply(res, await this.starts.start(s, p.id, keyOf(req), 'retry'));
  }

  @Post(':id/cod-collect') @Action('Ghi nhận đã thu tiền COD') @HttpCode(200) @Roles('staff', 'admin') @RateLimit(LIMITS.collect) @Validate({ params: idParams, body: codBody })
  collect(@CurrentSession() s: SessionContext, @ValidParams() p: Id, @ValidBody() b: CodBody) { return this.cod.collect(s, p.id, b.collected_amount, b.note); }

  @Post(':id/refunds') @Action('Hoàn tiền thủ công toàn phần') @Roles('admin') @RateLimit(LIMITS.refund) @Validate({ params: idParams, body: refundBody })
  async refund(@CurrentSession() s: SessionContext, @ValidParams() p: Id, @ValidBody() b: RefundBody, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    return reply(res, await this.refunds.manual(s, p.id, b.reason, keyOf(req)));
  }
}

/** Thử lại hoàn tiền thất bại: chỉ admin, chuyển chính Refund đó về `requested`. */
@Controller('refunds')
export class RefundController {
  constructor(private readonly refunds: RefundService) {}

  @Post(':id/retry') @Action('Thử lại hoàn tiền thất bại') @Roles('admin') @RateLimit(LIMITS.refund) @Validate({ params: idParams, body: emptyBody })
  async retry(@CurrentSession() s: SessionContext, @ValidParams() p: Id, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    return reply(res, await this.refunds.retry(s, p.id, keyOf(req)));
  }
}

/** Xem mọi thanh toán và hàng đợi hoàn tiền (staff, admin): chỉ đọc, bậc D, không có tham số tìm theo dữ liệu cá nhân (SB-08). */
@Controller('admin')
export class AdminPaymentController {
  constructor(private readonly reads: ReadService) {}

  @Get('payments') @Action('Xem danh sách mọi thanh toán (lọc trạng thái, phương thức, mã đơn)') @Roles('staff', 'admin') @RateLimit(LIMITS.admin) @Validate({ query: adminListQuery })
  list(@ValidQuery() q: AdminListQuery) { return this.reads.adminList(q); }

  @Get('payments/:id') @Action('Xem chi tiết thanh toán (mã giao dịch cổng, lượt thử, webhook, hoàn tiền)') @Roles('staff', 'admin') @RateLimit(LIMITS.admin) @Validate({ params: idParams })
  detail(@ValidParams() p: Id) { return this.reads.adminDetail(p.id); }

  @Get('refunds') @Action('Xem danh sách hoàn tiền (hàng đợi hoàn tiền thất bại)') @Roles('staff', 'admin') @RateLimit(LIMITS.admin) @Validate({ query: refundQueueQuery })
  refunds(@ValidQuery() q: RefundQueueQuery) { return this.reads.refundQueue(q); }
}

/**
 * IPN của VNPay: cổng gọi bằng GET với tham số `vnp_*`, không phiên, không CSRF (ADR-016); quyền dựa hoàn toàn vào chữ ký HMAC-SHA512, kiểm trong service để mọi lời gọi (kể cả sai chữ ký) có một dòng nhật ký (PAY-REQ ...513 BR8).
 * Khai `@Public` vì ma trận ghi guest = Y cho hàng này (kiểm lệch ma trận bắt `@Public`); an toàn nhờ chữ ký. Luôn HTTP 200 với JSON `RspCode` (ngoại lệ có chủ đích của problem+json, ADR-006); vượt bậc E theo IP là 429 từ guard.
 */
@Controller('webhooks/vnpay')
export class IpnController {
  constructor(private readonly webhook: WebhookService) {}

  @Get('ipn') @Action('Nhận webhook IPN của VNPay (cổng gọi, xác thực bằng chữ ký)') @Public() @RawStrings() @RateLimit(LIMITS.ipn) @Validate({ query: ipnQuery })
  ipn(@ValidQuery() q: unknown, @Req() req: Request): Promise<IpnReply> { return this.webhook.handle(q, ipOf(req)); }
}
