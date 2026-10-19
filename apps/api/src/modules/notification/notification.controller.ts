import { Controller, Get, HttpCode, Post } from '@nestjs/common';
import { Action, CurrentSession, RateLimit, Roles, Validate, ValidBody, ValidParams, ValidQuery, type SessionContext } from '../platform';
import { LIMITS } from './config';
import { emptyBody, idParams, listQuery, readAllBody, type ListQuery, type ReadAllBody } from './policy';
import { ReadService } from './read.service';

/**
 * Bốn endpoint cho customer, staff, admin, chỉ trên dữ liệu của CHÍNH MÌNH (NTF-API): `user_id` lấy từ phiên, không nhận từ client. Bậc C (120 mỗi phút mỗi người, chung một bộ đếm). Không có route
 * tạo, sửa, xóa thông báo, nhận event hay đọc EmailDelivery (T1, T6): thông báo chỉ do handler event của module này tạo. Chống CSRF của hai POST do guard toàn cục của platform (ADR-016).
 */
@Controller('notifications')
export class NotificationController {
  constructor(private readonly reads: ReadService) {}

  @Get() @Action('Xem lịch sử thông báo của mình (lọc đọc hoặc chưa đọc, theo loại)') @Roles('customer', 'staff', 'sale', 'admin') @RateLimit(LIMITS.all) @Validate({ query: listQuery })
  list(@CurrentSession() s: SessionContext, @ValidQuery() q: ListQuery) { return this.reads.list(s.user_id, q); }

  @Get('unread-count') @Action('Xem số thông báo chưa đọc') @Roles('customer', 'staff', 'sale', 'admin') @RateLimit(LIMITS.all) @Validate({})
  count(@CurrentSession() s: SessionContext) { return this.reads.count(s.user_id); }

  @Post('read-all') @Action('Đánh dấu tất cả thông báo đã đọc') @HttpCode(200) @Roles('customer', 'staff', 'sale', 'admin') @RateLimit(LIMITS.all) @Validate({ body: readAllBody })
  readAll(@CurrentSession() s: SessionContext, @ValidBody() b: ReadAllBody) { return this.reads.markAll(s.user_id, b.up_to); }

  @Post(':id/read') @Action('Đánh dấu một thông báo đã đọc') @HttpCode(200) @Roles('customer', 'staff', 'sale', 'admin') @RateLimit(LIMITS.all) @Validate({ params: idParams, body: emptyBody })
  read(@CurrentSession() s: SessionContext, @ValidParams() p: { id: string }) { return this.reads.markRead(s.user_id, p.id); }
}
