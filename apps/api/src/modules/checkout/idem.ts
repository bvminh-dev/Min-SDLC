import { createHash } from 'node:crypto';
import type { Request } from 'express';
import { DomainError } from '../platform';
import { IDEMPOTENCY_KEY_RE } from './config';

/**
 * Idempotency-Key của đặt hàng (ADR-017, SB-40): 8 đến 64 ký tự [A-Za-z0-9_-]; thiếu hay sai định dạng là 400 `idempotency-key-required`. CHK gọi `IdempotencyService.run` từ service thay vì decorator `@Idempotent`
 * vì phản hồi phát lại phải là 200 kèm `replayed` = true (decorator phát lại nguyên trạng thái 201 và thân đã lưu), và vì khóa tư vấn theo người dùng, bộ chặn hold-and-wait của CHK nằm trước giao dịch của khóa.
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
/** Băm yêu cầu (method, mẫu route, tham số đường dẫn và thân): cùng khóa khác nội dung (kể cả khác `session_id`) thì 422 `idempotency-key-reused` (CHK-REQ ...105052272 BR13). */
export const hashOf = (route: string, input: unknown): string => createHash('sha256').update(`POST\n${route}\n${JSON.stringify(canonical(input ?? null))}`).digest('hex');

/** Bộ đếm hạn chế số giao dịch đặt hàng chạy đồng thời: mỗi giao dịch giữ MỘT kết nối rồi gọi `lockForCheckout` của CRT (PRD, INV đọc bằng kết nối thứ hai), nên N giao dịch cùng chờ kết nối thứ hai làm cạn pool (hold-and-wait, ADR-012, SB-31). Tối đa ⌊pool / 2⌋ giao dịch (ít nhất 1) luôn chừa kết nối cho lời gọi thứ hai. */
export class Gate {
  private active = 0;
  private readonly waiting: (() => void)[] = [];
  constructor(readonly size: number) {}
  async acquire(): Promise<() => void> {
    if (this.active >= this.size) await new Promise<void>((res) => this.waiting.push(res));
    else this.active++;
    let done = false;
    return () => { if (done) return; done = true; const next = this.waiting.shift(); if (next) next(); else this.active--; };
  }
}
