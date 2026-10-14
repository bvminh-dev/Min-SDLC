import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import type { Request } from 'express';
import { ConfigService, DomainError, RateLimitService, type SessionContext } from '../platform';

/**
 * Giới hạn tần suất bậc D của SB-14 (ADR-014): `DASHBOARD_RATE_LIMIT_PER_MINUTE` mỗi phút mỗi admin trên CẢ chín endpoint (một khóa `dsh:<admin_id>`), kho đếm bảng PostgreSQL của platform
 * nên nhiều instance chung một hạn mức. Đếm NGUYÊN TỬ bằng `take` (một câu UPSERT, không khe giữa kiểm và ghi). Chạy SAU guard toàn cục (phiên 401, role 403) và TRƯỚC schema (400, ADR-016, DSH-API):
 * yêu cầu không qua quyền không tiêu hạn mức của admin. Không giữ giao dịch hay khóa khi gọi nguồn (SB-31).
 */
@Injectable()
export class DashboardRateGuard implements CanActivate {
  constructor(private readonly limiter: RateLimitService, private readonly config: ConfigService) {}
  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const session = (ctx.switchToHttp().getRequest<Request & { session?: SessionContext }>()).session;
    if (!session) throw new DomainError('forbidden'); // guard toàn cục luôn đặt phiên; thiếu thì từ chối (đóng khi lỗi)
    const r = await this.limiter.take(`dsh:${session.user_id}`, this.config.get<number>('DASHBOARD_RATE_LIMIT_PER_MINUTE'), 60);
    if (!r.allowed) throw new DomainError('rate-limited', { headers: { 'Retry-After': String(r.retryAfter) } });
    return true;
  }
}
