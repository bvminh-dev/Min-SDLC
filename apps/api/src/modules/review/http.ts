import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import type { Request, Response } from 'express';
import type { Observable } from 'rxjs';
import { DomainError } from '../platform';

const KEY_RE = /^[A-Za-z0-9_-]{8,64}$/;

/** Phản hồi chứa nội dung của riêng người dùng hay của hàng đợi admin mang `Cache-Control: no-store` (SB-08, REV-API). */
@Injectable()
export class NoStoreInterceptor implements NestInterceptor {
  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    ctx.switchToHttp().getResponse<Response>().setHeader('Cache-Control', 'no-store');
    return next.handle();
  }
}

/**
 * Idempotency-Key của tạo đánh giá (ADR-017, SB-40): 8 đến 64 ký tự [A-Za-z0-9_-]; thiếu hay sai định dạng là 400 `idempotency-key-required`. REV gọi `IdempotencyService.run` từ service thay vì decorator `@Idempotent`
 * vì dữ kiện của PRD, ORD phải đọc TRƯỚC giao dịch của khóa (decorator giữ giao dịch suốt handler: gọi module khác khi đang giữ kết nối là hold-and-wait, SB-31, ADR-012).
 */
export function keyOf(req: Request): string {
  const h = req.headers['idempotency-key'];
  const k = Array.isArray(h) ? h[0] : h;
  if (!k || !KEY_RE.test(k)) throw new DomainError('idempotency-key-required');
  return k;
}
