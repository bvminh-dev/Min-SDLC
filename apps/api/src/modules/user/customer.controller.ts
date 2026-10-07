import { Controller, Get, UseInterceptors } from '@nestjs/common';
import { Action, CurrentSession, RateLimit, Roles, Validate, ValidParams, ValidQuery, type SessionContext } from '../platform';
import { LIMITS, NoStoreInterceptor } from './http';
import { LookupService } from './lookup.service';
import { idParams, lookupQuery } from './policy';

const BY_EMAIL = 'Tra cứu hồ sơ khách theo email (staff: bản che; admin: đầy đủ kèm địa chỉ)';
const BY_ID = 'Tra cứu hồ sơ khách theo id (chỉ admin: đầy đủ kèm địa chỉ)'; // hàng ma trận riêng (BR1): staff 403, không audit

/** Tra cứu khách (USR-REQ-20261006-101004117): staff chỉ theo email (bản che), admin theo email hoặc id (đầy đủ). Hai endpoint chung bộ đếm bậc D 30 lần mỗi phút. */
@Controller('admin/customers')
@UseInterceptors(NoStoreInterceptor)
export class CustomerController {
  constructor(private readonly lookup: LookupService) {}

  @Get() @Action(BY_EMAIL) @Roles('staff', 'admin') @RateLimit(LIMITS.lookup) @Validate({ query: lookupQuery })
  byEmail(@CurrentSession() s: SessionContext, @ValidQuery() q: { email: string }) { return this.lookup.byEmail(s, q.email); }

  // Staff nhận 403 từ guard trước khi có bất kỳ truy vấn User nào và không có audit.
  @Get(':id') @Action(BY_ID) @Roles('admin') @RateLimit(LIMITS.lookup) @Validate({ params: idParams })
  byId(@CurrentSession() s: SessionContext, @ValidParams() p: { id: string }) { return this.lookup.byId(s, p.id); }
}
