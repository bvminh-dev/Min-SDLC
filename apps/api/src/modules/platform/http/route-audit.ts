import type { INestApplication, Type } from '@nestjs/common';
import { DiscoveryService, Reflector } from '@nestjs/core';
import { ProblemFilter } from '../errors/problem.filter';
import { CsrfGuard } from './csrf.guard';
import { RateLimitGuard } from './rate-limit';
import { ACTION, AuthGuard, IS_PUBLIC, ROLES, SYSTEM_ENDPOINT, type SystemEndpointOptions } from './session';
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

type Cell = 'Y' | 'own' | '-';
export interface MatrixRow { action: string; requirement: string; guest: Cell; customer: Cell; staff: Cell; admin: Cell; system: Cell }

/** Đọc bảng `Hành động | Requirement | guest | customer | staff | admin | system` của permissions-matrix.md. Không có hàng nào thì rỗng (bên gọi phải coi là lỗi). */
export function parseMatrix(md: string): MatrixRow[] {
  const rows: MatrixRow[] = [];
  for (const line of md.split(/\r?\n/)) {
    const c = line.startsWith('|') ? line.split('|').slice(1, -1).map((x) => x.trim()) : [];
    if (c.length < 7 || !/^[A-Z]{2,4}-REQ-/.test(c[1])) continue;
    const [action, requirement, guest, customer, staff, admin, system] = c;
    rows.push({ action, requirement, guest, customer, staff, admin, system } as MatrixRow);
  }
  return rows;
}

/**
 * Kiểm lệch ma trận (AUTH-REQ-20261006-095515918 BR5, chạy ở CI trên AppModule thật): với route thuộc `scope`, @Action phải trỏ tới một hàng của ma trận
 * và role khai trong code phải khớp hàng đó (guest Y thì @Public; ngược lại @Roles đúng tập customer, staff, admin có Y hoặc own). Hàng của epic (`epic`)
 * không có route nào cũng là lỗi, trừ hàng trong `exempt` (hàng không có endpoint, ví dụ chính guard). Ma trận rỗng hoặc không đọc được là lỗi (đóng khi hỏng).
 */
export function auditPermissions(app: INestApplication, matrixMd: string, opts: { scope: (routeId: string) => boolean; epic?: string; exempt?: string[]; prefix?: string }): string[] {
  const reflector = app.get(Reflector);
  const matrix = parseMatrix(matrixMd);
  if (!matrix.length) return ['ma trận quyền rỗng hoặc không đọc được (không tìm thấy hàng nào có mã requirement)'];
  const byAction = new Map(matrix.map((r) => [r.action, r]));
  const out: string[] = [];
  const used = new Set<string>();
  for (const { id, handler, cls } of listRoutes(app, opts.prefix ?? '/api/v1')) {
    if (!opts.scope(id)) continue;
    const targets = [handler as () => void, cls];
    const label = reflector.getAllAndOverride<string | undefined>(ACTION, targets);
    if (!label) { out.push(`${id}: thiếu @Action (hàng ma trận quyền)`); continue; }
    const row = byAction.get(label);
    if (!row) { out.push(`${id}: @Action("${label}") không có trong permissions-matrix.md`); continue; }
    used.add(label);
    const isPublic = !!reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets);
    const roles = (reflector.getAllAndOverride<string[]>(ROLES, targets) ?? []).slice().sort();
    if (row.guest === 'Y') {
      if (!isPublic) out.push(`${id}: ma trận cho guest (${label}) nhưng code không khai @Public`);
      continue;
    }
    if (isPublic) { out.push(`${id}: code khai @Public nhưng ma trận không cho guest (${label})`); continue; }
    const rowRoles = (['admin', 'customer', 'staff'] as const).filter((r) => row[r] !== '-');
    if (rowRoles.join() !== roles.join()) out.push(`${id}: code cho [${roles.join(', ')}] nhưng ma trận (${label}) cho [${rowRoles.join(', ')}]`);
  }
  if (opts.epic) {
    for (const r of matrix) {
      if (r.requirement.startsWith(`${opts.epic}-REQ-`) && !used.has(r.action) && !(opts.exempt ?? []).includes(r.action)) out.push(`hàng ma trận "${r.action}" của ${opts.epic} không có endpoint nào khai @Action`);
    }
  }
  return out;
}
