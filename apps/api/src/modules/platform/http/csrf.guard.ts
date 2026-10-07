import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { ConfigService } from '../config/config';
import { DomainError } from '../errors/registry';
import { SYSTEM_ENDPOINT } from './session';

const UNSAFE = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * Chống CSRF (ADR-016, SB-13): với POST, PUT, PATCH, DELETE có kèm cookie hoặc có header `Origin`, `Origin` (hoặc `Referer` nếu thiếu)
 * phải thuộc danh sách CORS_ALLOWED_ORIGINS; thiếu hoặc lạ trả 403 `csrf_failed`. Không cookie và không Origin (máy gọi máy) thì không kiểm;
 * trình duyệt luôn gửi Origin cho POST chéo nguồn nên đăng nhập CSRF (AUTH-SEC T8) vẫn bị chặn. @SystemEndpoint miễn (xác thực bằng chữ ký).
 * Cookie SameSite=Lax do AUTH đặt khi cấp phiên; thân chỉ nhận application/json ở app-setup (415).
 */
@Injectable()
export class CsrfGuard implements CanActivate {
  private readonly allowed: Set<string>;
  constructor(private readonly reflector: Reflector, config: ConfigService) {
    this.allowed = new Set(config.get('CORS_ALLOWED_ORIGINS'));
  }

  canActivate(ctx: ExecutionContext): boolean {
    if (ctx.getType() !== 'http') return true;
    const req = ctx.switchToHttp().getRequest<Request>();
    if (!UNSAFE.has(req.method) || !(req.headers.cookie || req.headers.origin)) return true;
    if (this.reflector.getAllAndOverride(SYSTEM_ENDPOINT, [ctx.getHandler(), ctx.getClass()])) return true;
    let origin = req.headers.origin;
    if (!origin && typeof req.headers.referer === 'string') {
      try { origin = new URL(req.headers.referer).origin; } catch { origin = undefined; }
    }
    if (!origin || !this.allowed.has(origin)) throw new DomainError('csrf_failed');
    return true;
  }
}
