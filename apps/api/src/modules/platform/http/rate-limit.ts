import { CanActivate, ExecutionContext, Injectable, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { Clock } from '../common/clock';
import { ConfigService } from '../config/config';
import { PrismaService } from '../db/prisma.service';
import { DomainError } from '../errors/registry';
import { clientIp } from './client-ip';
import { SYSTEM_ENDPOINT, SessionService, type SessionContext } from './session';

export type Tier = 'A' | 'B' | 'C' | 'D' | 'E';
export interface RateLimitOptions {
  tier: Tier;
  limit: number;
  windowSeconds: number;
  /** Khóa đếm; mặc định: người dùng đã đăng nhập hoặc IP. */
  key?: (req: Request, session: SessionContext | null) => string;
  /** Nhiều endpoint chung một bộ đếm (ví dụ ghi sổ địa chỉ, hai endpoint tra cứu khách): cùng `group` thì cùng bucket; mặc định mỗi route một bucket. */
  group?: string;
}
export const RATE_LIMIT = 'platform:rate-limit';
export const SKIP_RATE_LIMIT = 'platform:skip-rate-limit';
export const RateLimit = (o: RateLimitOptions) => SetMetadata(RATE_LIMIT, o);
export const SkipRateLimit = () => SetMetadata(SKIP_RATE_LIMIT, true);

/** Mặc định của bậc E cho endpoint @SystemEndpoint không khai @RateLimit (PAY chốt số riêng theo SB-14). */
const TIER_E_DEFAULT = 300;

/**
 * Kho đếm (ADR-014): bậc A, B, D, E dùng bảng PostgreSQL UNLOGGED (cửa sổ cố định, đúng giữa các instance);
 * bậc C dùng bộ nhớ từng instance (xấp xỉ).
 */
@Injectable()
export class RateLimitService {
  private readonly memory = new Map<string, { windowStart: number; count: number }>();
  constructor(private readonly prisma: PrismaService, private readonly clock: Clock) {}

  private windowStart(windowSeconds: number): { start: Date; endMs: number } {
    const ms = windowSeconds * 1000;
    const startMs = Math.floor(this.clock.now().getTime() / ms) * ms;
    return { start: new Date(startMs), endMs: startMs + ms };
  }

  /** Tăng bộ đếm và trả số hiện tại cùng số giây chờ tới hết cửa sổ. */
  async hit(tier: Tier, bucket: string, windowSeconds: number): Promise<{ count: number; retryAfter: number }> {
    const { start, endMs } = this.windowStart(windowSeconds);
    const retryAfter = Math.max(1, Math.ceil((endMs - this.clock.now().getTime()) / 1000));
    if (tier === 'C') {
      const cur = this.memory.get(bucket);
      const count = cur && cur.windowStart === start.getTime() ? cur.count + 1 : 1;
      this.memory.set(bucket, { windowStart: start.getTime(), count });
      if (this.memory.size > 50_000) for (const [k, v] of this.memory) if (v.windowStart < start.getTime()) this.memory.delete(k);
      return { count, retryAfter };
    }
    const rows = await this.prisma.$queryRaw<{ count: number }[]>`
      INSERT INTO rate_limit_counters (bucket, window_start, count) VALUES (${bucket}, ${start}::timestamptz, 1)
      ON CONFLICT (bucket, window_start) DO UPDATE SET count = rate_limit_counters.count + 1
      RETURNING count`;
    return { count: rows[0].count, retryAfter };
  }

  // Hợp đồng đếm theo kết quả (ADR-014): check (không tăng), hit khi thao tác sai, reset khi thành công.
  // ponytail: dùng cửa sổ cố định như các bậc khác; `hitCounter` nhận windowSeconds vì cửa sổ không nằm trong khóa.
  async check(key: string, limit: number, windowSeconds: number): Promise<{ allowed: boolean; retryAfter: number }> {
    const { start, endMs } = this.windowStart(windowSeconds);
    const rows = await this.prisma.$queryRaw<{ count: number }[]>`SELECT count FROM rate_limit_counters WHERE bucket = ${`ctr:${key}`} AND window_start = ${start}::timestamptz`;
    return { allowed: (rows[0]?.count ?? 0) < limit, retryAfter: Math.max(1, Math.ceil((endMs - this.clock.now().getTime()) / 1000)) };
  }
  async hitCounter(key: string, windowSeconds: number): Promise<number> {
    return (await this.hit('A', `ctr:${key}`, windowSeconds)).count;
  }
  /**
   * Đếm NGUYÊN TỬ (ADR-014): một câu UPSERT tăng rồi so với `limit`, không còn khe giữa kiểm và ghi nên các lời gọi song song cũng chỉ qua tối đa `limit` lần.
   * Lần vượt vẫn tăng bộ đếm (cửa sổ cố định, hết cửa sổ tự về 0). Thao tác thành công gọi `refund` để không tính lần đó.
   */
  async take(key: string, limit: number, windowSeconds: number): Promise<{ allowed: boolean; count: number; retryAfter: number }> {
    const { count, retryAfter } = await this.hit('A', `ctr:${key}`, windowSeconds);
    return { allowed: count <= limit, count, retryAfter };
  }
  /** Hoàn lại một lần `take` của cửa sổ hiện tại. ponytail: nếu `take` và `refund` rơi vào hai cửa sổ thì không hoàn (đếm dư tối đa một lần ở cửa sổ cũ, an toàn). */
  async refund(key: string, windowSeconds: number): Promise<void> {
    const { start } = this.windowStart(windowSeconds);
    await this.prisma.$executeRaw`UPDATE rate_limit_counters SET count = GREATEST(count - 1, 0) WHERE bucket = ${`ctr:${key}`} AND window_start = ${start}::timestamptz`;
  }
  async reset(key: string): Promise<void> {
    await this.prisma.$executeRaw`DELETE FROM rate_limit_counters WHERE bucket = ${`ctr:${key}`}`;
  }
}

@Injectable()
export class RateLimitGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly limiter: RateLimitService,
    private readonly config: ConfigService,
    private readonly sessions: SessionService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    if (ctx.getType() !== 'http') return true;
    const targets = [ctx.getHandler(), ctx.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(SKIP_RATE_LIMIT, targets)) return true; // health (BR10)
    const req = ctx.switchToHttp().getRequest<Request>();
    const declared = this.reflector.getAllAndOverride<RateLimitOptions | undefined>(RATE_LIMIT, targets);
    const system = !!this.reflector.getAllAndOverride(SYSTEM_ENDPOINT, targets);
    const tier: Tier = declared?.tier ?? (system ? 'E' : 'C');
    const limit = declared?.limit ?? (system ? TIER_E_DEFAULT : this.config.get('RATE_LIMIT_PER_MINUTE'));
    const windowSeconds = declared?.windowSeconds ?? 60;

    // Người đã đăng nhập đếm theo người, còn lại theo IP; hệ thống luôn theo IP.
    const session = system ? null : await this.sessions.get(req);
    const who = declared?.key?.(req, session) ?? (session ? `u:${session.user_id}` : `ip:${clientIp(req, this.config.get('TRUST_PROXY_HOPS'))}`);
    const route = req.route?.path ?? req.path;
    const { count, retryAfter } = await this.limiter.hit(tier, `${tier}:${declared?.group ?? route}:${who}`, windowSeconds);
    if (count > limit) throw new DomainError('rate-limited', { headers: { 'Retry-After': String(retryAfter) } });
    return true;
  }
}
