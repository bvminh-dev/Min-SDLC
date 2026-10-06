import type { INestApplication, Type } from '@nestjs/common';
import { DiscoveryService, Reflector } from '@nestjs/core';
import { ProblemFilter } from '../errors/problem.filter';
import { CsrfGuard } from './csrf.guard';
import { RateLimitGuard } from './rate-limit';
import { AuthGuard, IS_PUBLIC, ROLES, SYSTEM_ENDPOINT, type SystemEndpointOptions } from './session';
import { VALIDATE, ValidationInterceptor } from './validation';

/** Thành phần toàn cục bắt buộc phải có trong ứng dụng để mọi route đều qua giới hạn tần suất, CSRF, quyền, schema và bộ lọc lỗi (flow PRJ). */
const GLOBAL_PARTS: Type[] = [RateLimitGuard, CsrfGuard, AuthGuard, ValidationInterceptor, ProblemFilter];

interface Route { id: string; handler: object; cls: Type }

/** Mọi route của ứng dụng đang chạy (mọi module đã nạp), dạng `GET /api/v1/...`. */
function listRoutes(app: INestApplication, prefix: string): Route[] {
  const out: Route[] = [];
  for (const w of app.get(DiscoveryService).getControllers()) {
    const cls = w.metatype as Type | null;
    const inst = w.instance as Record<string, unknown> | null;
    if (!cls || !inst) continue;
    const base = String(Reflect.getMetadata('path', cls) ?? '');
    for (const name of Object.getOwnPropertyNames(Object.getPrototypeOf(inst))) {
      const handler = inst[name];
      if (typeof handler !== 'function' || name === 'constructor') continue;
      const path = Reflect.getMetadata('path', handler);
      const method = Reflect.getMetadata('method', handler);
      if (path === undefined || method === undefined) continue;
      const verb = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'ALL', 'OPTIONS', 'HEAD'][method] ?? String(method);
      const id = `${verb} ${prefix}/${[base, path].map((s) => String(s).replace(/^\/+|\/+$/g, '')).filter(Boolean).join('/')}`.replace(/\/$/, '');
      out.push({ id, handler, cls });
    }
  }
  return out;
}
export const routeIds = (app: INestApplication, prefix = '/api/v1'): string[] => listRoutes(app, prefix).map((r) => r.id);

/**
 * Test quét route (chạy ở CI trên AppModule thật, PRJ-REQ-20261006-095422650 BR4, BR5, BR12): trả danh sách vi phạm.
 *  - ứng dụng thiếu một thành phần toàn cục (giới hạn tần suất, CSRF, guard quyền, schema, bộ lọc lỗi);
 *  - route thiếu khai báo quyền (@Public, @Roles, @SystemEndpoint);
 *  - @SystemEndpoint thiếu verifier;
 *  - thiếu @Validate (schema zod cho params, query, body).
 * Giới hạn tần suất bậc C và CSRF áp mặc định cho mọi route bởi guard toàn cục nên chỉ cần kiểm guard có mặt; bậc khác khai bằng @RateLimit.
 * Rỗng nghĩa là sạch.
 */
export function auditRoutes(app: INestApplication, prefix = '/api/v1'): string[] {
  const reflector = app.get(Reflector);
  const out: string[] = [];
  const present = new Set(app.get(DiscoveryService).getProviders().map((w) => w.metatype));
  for (const part of GLOBAL_PARTS) if (!present.has(part)) out.push(`ứng dụng thiếu ${part.name} toàn cục (nạp PlatformModule)`);
  for (const { id, handler, cls } of listRoutes(app, prefix)) {
    const targets = [handler as () => void, cls];
    const isPublic = reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets);
    const roles = reflector.getAllAndOverride<string[]>(ROLES, targets);
    const sys = reflector.getAllAndOverride<SystemEndpointOptions | undefined>(SYSTEM_ENDPOINT, targets);
    if (sys && typeof sys.verifier !== 'function') out.push(`${id}: @SystemEndpoint thiếu verifier`);
    else if (!isPublic && !roles?.length && !sys) out.push(`${id}: thiếu khai báo quyền (@Public, @Roles hoặc @SystemEndpoint)`);
    if (!reflector.getAllAndOverride(VALIDATE, targets)) out.push(`${id}: thiếu schema kiểm (@Validate)`);
  }
  return out;
}
