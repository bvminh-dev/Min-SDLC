import { CallHandler, ExecutionContext, Injectable, NestInterceptor, SetMetadata, createParamDecorator } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import type { Observable } from 'rxjs';
import { z } from 'zod';
import { DomainError, type ProblemErrorItem } from '../errors/registry';

export interface RouteSchemas { params?: z.ZodTypeAny; query?: z.ZodTypeAny; body?: z.ZodTypeAny }
export const VALIDATE = 'platform:validate';
/** Mọi endpoint khai schema zod cho params, query, body (SB-11); thiếu khóa nào thì khóa đó phải rỗng. Test quét route bắt endpoint thiếu @Validate. */
export const Validate = (s: RouteSchemas) => SetMetadata(VALIDATE, s);

const EMPTY = z.object({}).strict();
type Req = Request & { validated?: { params: unknown; query: unknown; body: unknown } };

/** Chuyển lỗi zod sang { field, code }; không lặp lại giá trị client gửi (BR5). */
export function zodItems(err: z.ZodError): ProblemErrorItem[] {
  const out: ProblemErrorItem[] = [];
  for (const i of err.issues) {
    if (i.code === 'unrecognized_keys') for (const k of i.keys) out.push({ field: [...i.path, k].join('.'), code: i.code });
    else out.push({ field: i.path.join('.') || '(root)', code: i.code });
  }
  return out;
}

@Injectable()
export class ValidationInterceptor implements NestInterceptor {
  constructor(private readonly reflector: Reflector) {}

  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (ctx.getType() !== 'http') return next.handle();
    const schemas = this.reflector.getAllAndOverride<RouteSchemas | undefined>(VALIDATE, [ctx.getHandler(), ctx.getClass()]);
    if (!schemas) return next.handle();
    const req = ctx.switchToHttp().getRequest<Req>();
    const errors: ProblemErrorItem[] = [];
    const run = <T>(schema: z.ZodTypeAny | undefined, value: unknown, prefix: string): T | undefined => {
      const r = (schema ?? EMPTY).safeParse(value ?? {});
      if (r.success) return r.data as T;
      errors.push(...zodItems(r.error).map((e) => ({ ...e, field: e.field === '(root)' ? prefix : `${e.field}` })));
      return undefined;
    };
    const params = run(schemas.params, req.params, 'params');
    const query = run(schemas.query, req.query, 'query');
    const body = run(schemas.body, req.body, 'body');
    if (errors.length) throw new DomainError('validation-failed', { errors });
    req.validated = { params, query, body };
    return next.handle();
  }
}

const pick = (key: 'params' | 'query' | 'body') => createParamDecorator((_: unknown, ctx: ExecutionContext) => ctx.switchToHttp().getRequest<Req>().validated?.[key]);
/** Giá trị đã qua schema (đã ép kiểu, đã loại trường lạ). Dùng thay @Query/@Body/@Param. */
export const ValidParams = pick('params');
export const ValidQuery = pick('query');
export const ValidBody = pick('body');
