import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import type { Response } from 'express';
import type { Observable } from 'rxjs';
import type { RateLimitOptions } from '../platform';

/** Phản hồi chứa dữ liệu cá nhân mang `Cache-Control: no-store` (SB-08, USR-REQ ...419 BR4). */
@Injectable()
export class NoStoreInterceptor implements NestInterceptor {
  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    ctx.switchToHttp().getResponse<Response>().setHeader('Cache-Control', 'no-store');
    return next.handle();
  }
}

export const ALL_ROLES = ['customer', 'staff', 'sale', 'admin'] as const;

/** Bảng bậc SB-14 cho USR (USR-API mục Giới hạn tần suất). */
export const LIMITS = {
  read: { tier: 'C', limit: 120, windowSeconds: 60 },
  profileWrite: { tier: 'B', limit: 120, windowSeconds: 60 },
  avatarUpload: { tier: 'B', limit: 10, windowSeconds: 3600 },
  avatarDelete: { tier: 'B', limit: 120, windowSeconds: 60 },
  addressWrite: { tier: 'B', limit: 120, windowSeconds: 60, group: 'usr:address-write' }, // thêm, sửa, xóa dùng chung một bộ đếm
  lookup: { tier: 'D', limit: 30, windowSeconds: 60, group: 'usr:customer-lookup' }, // hai endpoint tra cứu chung một bộ đếm
} as const satisfies Record<string, RateLimitOptions>;
