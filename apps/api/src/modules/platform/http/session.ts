import { CanActivate, ExecutionContext, Inject, Injectable, SetMetadata, createParamDecorator } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { DomainError } from '../errors/registry';

/** Phiên hiện tại. Platform định nghĩa, AUTH cài đặt (ADR-012, đảo phụ thuộc): platform không phụ thuộc AUTH. */
export interface SessionContext {
  user_id: string;
  role: 'customer' | 'staff' | 'admin';
  email_verified: boolean;
  /** ADR-012 (đợt 4): chỉ để hiển thị và ghi vết, không dùng phân quyền. */
  display_name?: string;
}
export interface SessionResolver {
  /** Trả null khi không có phiên hợp lệ (guest). Không ném lỗi cho phiên sai. */
  resolve(req: Request): Promise<SessionContext | null>;
}
export const SESSION_RESOLVER = Symbol('SESSION_RESOLVER');

export type Role = SessionContext['role'];
export interface GatewayReply { status: number; body: unknown }
export interface SystemEndpointOptions {
  /** Kiểm chữ ký của tác nhân hệ thống do module chủ cài đặt (SB-05, SB-22). Bắt buộc. */
  verifier: (req: Request) => boolean | Promise<boolean>;
  /** Phản hồi khi chữ ký sai, theo định dạng cổng (ADR-006). Mặc định kiểu VNPay. */
  reject?: GatewayReply;
  /** Phản hồi khi lỗi nội bộ, không lộ chi tiết. */
  internalError?: GatewayReply;
}

export const IS_PUBLIC = 'platform:public';
export const ROLES = 'platform:roles';
export const SYSTEM_ENDPOINT = 'platform:system';
export const Public = () => SetMetadata(IS_PUBLIC, true);
export const Roles = (...roles: Role[]) => SetMetadata(ROLES, roles);
export const SystemEndpoint = (o: SystemEndpointOptions) => SetMetadata(SYSTEM_ENDPOINT, o);

export const DEFAULT_REJECT: GatewayReply = { status: 200, body: { RspCode: '97', Message: 'Invalid signature' } };
export const DEFAULT_INTERNAL: GatewayReply = { status: 200, body: { RspCode: '99', Message: 'Unknown error' } };

export class SystemSignatureError extends Error {}

type Req = Request & { session?: SessionContext; systemEndpoint?: SystemEndpointOptions; sessionPromise?: Promise<SessionContext | null> };

@Injectable()
export class SessionService {
  constructor(@Inject(SESSION_RESOLVER) private readonly resolver: SessionResolver) {}
  /** Giải phiên một lần cho mỗi request (guard giới hạn tần suất và guard quyền cùng dùng). */
  get(req: Request): Promise<SessionContext | null> {
    const r = req as Req;
    return (r.sessionPromise ??= this.resolver.resolve(req));
  }
}

/** Guard toàn cục, mặc định từ chối (SB-05): chỉ @Public, @Roles hoặc @SystemEndpoint (có chữ ký đúng) đi qua. */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private readonly reflector: Reflector, private readonly sessions: SessionService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    if (ctx.getType() !== 'http') return true;
    const targets = [ctx.getHandler(), ctx.getClass()];
    const req = ctx.switchToHttp().getRequest<Req>();
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets)) return true;

    const sys = this.reflector.getAllAndOverride<SystemEndpointOptions | undefined>(SYSTEM_ENDPOINT, targets);
    if (sys) {
      if (typeof sys.verifier !== 'function') throw new DomainError('forbidden');
      req.systemEndpoint = sys; // để bộ lọc lỗi trả theo định dạng của cổng
      if (!(await sys.verifier(req))) throw new SystemSignatureError('chữ ký sai');
      return true;
    }

    const roles = this.reflector.getAllAndOverride<Role[] | undefined>(ROLES, targets);
    if (!roles?.length) throw new DomainError('forbidden'); // endpoint chưa khai quyền: từ chối (test quét route cũng đỏ)
    const session = await this.sessions.get(req);
    if (!session) throw new DomainError('unauthenticated');
    if (!roles.includes(session.role)) throw new DomainError('forbidden');
    req.session = session;
    return true;
  }
}

export const CurrentSession = createParamDecorator((_: unknown, ctx: ExecutionContext) => ctx.switchToHttp().getRequest<Req>().session);
