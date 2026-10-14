import { createHash } from 'node:crypto';
import type { Request } from 'express';
import { DomainError } from '../platform';
import { IDEMPOTENCY_KEY_RE } from './config';

/**
 * Idempotency-Key của PAY (ADR-017, SB-40): 8 đến 64 ký tự [A-Za-z0-9_-]; thiếu hay sai định dạng là 400 `idempotency-key-required`. PAY gọi `IdempotencyService.run` từ service thay vì decorator `@Idempotent`
 * để đọc đơn của ORD (kết nối thứ hai) TRƯỚC khi mở giao dịch của khóa: giao dịch giữ một kết nối trong lúc chờ khóa dòng thì N yêu cầu song song hết pool khi kết nối thứ hai không còn (hold-and-wait, L87).
 */
export function keyOf(req: Request): string {
  const h = req.headers['idempotency-key'];
  const k = Array.isArray(h) ? h[0] : h;
  if (!k || !IDEMPOTENCY_KEY_RE.test(k)) throw new DomainError('idempotency-key-required');
  return k;
}

const canonical = (v: unknown): unknown =>
  Array.isArray(v) ? v.map(canonical)
    : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, canonical((v as Record<string, unknown>)[k])]))
      : v;
/** Băm yêu cầu (method, mẫu route, tham số đường dẫn và thân): cùng khóa khác nội dung thì 422 `idempotency-key-reused`. */
export const hashOf = (route: string, input: unknown): string => createHash('sha256').update(`POST\n${route}\n${JSON.stringify(canonical(input ?? null))}`).digest('hex');
