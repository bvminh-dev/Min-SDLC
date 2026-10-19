import { CallHandler, ExecutionContext, Injectable, NestInterceptor, SetMetadata, UseInterceptors, applyDecorators, createParamDecorator } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { createHash } from 'node:crypto';
import type { Request, Response } from 'express';
import { Observable, firstValueFrom, of } from 'rxjs';
import { Clock } from '../common/clock';
import { TransactionService, type Tx } from '../db/transaction.service';
import { DomainError } from '../errors/registry';
import type { SessionContext } from './session';

const KEY_RE = /^[A-Za-z0-9_-]{8,64}$/;
export const isIdempotencyKey = (k: unknown): k is string => typeof k === 'string' && KEY_RE.test(k); // cho endpoint chỉ cần khóa ở một chế độ (import PRD: dry_run=false)
const TTL_MS = 24 * 3600 * 1000;

export interface IdempotentResult<T> { replayed: boolean; status: number; body: T }

const canonical = (v: unknown): unknown =>
  Array.isArray(v) ? v.map(canonical)
    : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, canonical((v as Record<string, unknown>)[k])]))
      : v;
export const requestHash = (method: string, route: string, body: unknown): string =>
  createHash('sha256').update(`${method}\n${route}\n${JSON.stringify(canonical(body ?? null))}`).digest('hex');

/**
 * Idempotency-Key (ADR-017, SB-40): bản ghi khóa nằm cùng giao dịch với thao tác nên hai yêu cầu đồng thời cùng khóa được
 * tuần tự hóa bởi ràng buộc duy nhất (scope, user_id, key); yêu cầu sau thấy bản ghi đã commit và nhận lại phản hồi.
 */
@Injectable()
export class IdempotencyService {
  constructor(private readonly transactions: TransactionService, private readonly clock: Clock) {}

  async run<T>(
    p: { scope: string; userId: string; key: string; requestHash: string },
    fn: (tx: Tx) => Promise<{ status: number; body: T }>,
  ): Promise<IdempotentResult<T>> {
    return this.transactions.run(async (tx) => {
      const now = this.clock.now();
      const expires = new Date(now.getTime() + TTL_MS);
      // Khóa đã hết hạn coi như chưa có (job dọn chạy theo lô nên có thể chưa xóa kịp).
      await tx.$executeRaw`DELETE FROM idempotency_keys WHERE scope = ${p.scope} AND user_id = ${p.userId}::uuid AND key = ${p.key} AND expires_at < ${now}::timestamptz`;
      const ins = await tx.$queryRaw<{ id: string }[]>`
        INSERT INTO idempotency_keys (scope, user_id, key, request_hash, response, expires_at)
        VALUES (${p.scope}, ${p.userId}::uuid, ${p.key}, ${p.requestHash}, '{}'::jsonb, ${expires}::timestamptz)
        ON CONFLICT (scope, user_id, key) DO NOTHING RETURNING id`;
      if (ins.length === 0) {
        const [row] = await tx.$queryRaw<{ request_hash: string; response: { status: number; body: T } }[]>`
          SELECT request_hash, response FROM idempotency_keys WHERE scope = ${p.scope} AND user_id = ${p.userId}::uuid AND key = ${p.key}`;
        if (row.request_hash !== p.requestHash) throw new DomainError('idempotency-key-reused');
        return { replayed: true, status: row.response.status, body: row.response.body };
      }
      const r = await fn(tx);
      const stored = JSON.stringify({ status: r.status, body: r.body ?? null });
      await tx.$executeRaw`UPDATE idempotency_keys SET response = ${stored}::jsonb, updated_at = ${now}::timestamptz WHERE id = ${ins[0].id}::uuid`;
      return { replayed: false, status: r.status, body: r.body };
    });
  }
}

export const IDEMPOTENT = 'platform:idempotent';
type Req = Request & { session?: SessionContext; tx?: Tx };

@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  constructor(private readonly reflector: Reflector, private readonly idem: IdempotencyService) {}

  async intercept(ctx: ExecutionContext, next: CallHandler): Promise<Observable<unknown>> {
    const opts = this.reflector.get<{ scope: string }>(IDEMPOTENT, ctx.getHandler());
    const http = ctx.switchToHttp();
    const req = http.getRequest<Req>();
    const res = http.getResponse<Response>();
    const header = req.headers['idempotency-key'];
    const key = Array.isArray(header) ? header[0] : header;
    if (!key || !KEY_RE.test(key)) throw new DomainError('idempotency-key-required');
    if (!req.session) throw new DomainError('unauthenticated');

    const httpCode = Reflect.getMetadata('__httpCode__', ctx.getHandler()) as number | undefined;
    const status = httpCode ?? (req.method === 'POST' ? 201 : 200);
    const out = await this.idem.run(
      { scope: opts.scope, userId: req.session.user_id, key, requestHash: requestHash(req.method, req.route?.path ?? req.path, { params: req.params, body: req.body }) }, // tham số đường dẫn là một phần nội dung (cùng khóa, cùng thân, khác sản phẩm là yêu cầu khác)
      async (tx) => {
        req.tx = tx; // handler lấy tx qua @DbTx() để ghi nghiệp vụ cùng giao dịch với khóa
        return { status, body: await firstValueFrom(next.handle(), { defaultValue: null }) };
      },
    );
    if (out.replayed) {
      res.setHeader('Idempotent-Replayed', 'true');
      res.status(out.status);
    }
    return of(out.body);
  }
}

/** Đánh dấu endpoint cần Idempotency-Key (CHK đặt hàng, PAY, INV, REV). Handler dùng @DbTx() để ghi trong giao dịch của khóa. */
export const Idempotent = (o: { scope: string }) => applyDecorators(SetMetadata(IDEMPOTENT, o), UseInterceptors(IdempotencyInterceptor));
export const DbTx = createParamDecorator((_: unknown, ctx: ExecutionContext) => ctx.switchToHttp().getRequest<Req>().tx);
