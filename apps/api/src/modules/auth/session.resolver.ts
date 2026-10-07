import { Injectable } from '@nestjs/common';
import type { Request } from 'express';
import { Clock, PrismaService, type SessionContext, type SessionResolver } from '../platform';
import { SESSION_COOKIE, SESSION_IDLE_MS, SESSION_TOUCH_MS } from './config';
import { TOKEN_FORMAT, hashToken } from './crypto';

export interface AuthSessionInfo {
  session_id: string;
  idle_expires_at: Date;
  absolute_expires_at: Date;
  user: { id: string; email: string; full_name: string; role: SessionContext['role']; email_verified: boolean };
}
export type AuthRequest = Request & { authSession?: AuthSessionInfo; sessionExpired?: boolean };

/** Đường dẫn thăm dò phiên: không gia hạn hạn trượt (REQ-808 BR7). */
const PROBE = /\/auth\/session$/;

export const readCookie = (header: string | undefined, name: string): string | null => {
  for (const part of (header ?? '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return null;
};

interface Row {
  id: string; user_id: string; status: string; expires_at: Date; absolute_expires_at: Date; last_seen_at: Date;
  role: SessionContext['role']; user_status: string; email_verified_at: Date | null; email: string; full_name: string;
}

/**
 * Triển khai SessionResolver của AUTH (ADR-012, đảo phụ thuộc). Mỗi request: tra băm token, kiểm hạn theo thời gian lúc đọc
 * (không dựa vào job dọn), lấy role từ bảng users (đổi role có hiệu lực ngay), gia hạn hạn trượt tối đa mỗi phút.
 */
@Injectable()
export class AuthSessionResolver implements SessionResolver {
  constructor(private readonly prisma: PrismaService, private readonly clock: Clock) {}

  async resolve(req: Request): Promise<SessionContext | null> {
    const r = req as AuthRequest;
    const token = readCookie(req.headers.cookie, SESSION_COOKIE);
    if (!token || !TOKEN_FORMAT.test(token)) return null;
    const rows = await this.prisma.$queryRaw<Row[]>`
      SELECT s.id, s.user_id, s.status, s.expires_at, s.absolute_expires_at, s.last_seen_at,
             u.role, u.status AS user_status, u.email_verified_at, u.email::text AS email, u.full_name
      FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = ${hashToken(token)}`;
    const s = rows[0];
    if (!s || s.status === 'revoked') return null;
    const now = this.clock.now();
    // `expired` do job dọn đánh dấu (chỉ vì quá hạn): vẫn báo `session_expired`, không đổi thành `unauthenticated` sau giờ dọn
    if (s.status === 'expired' || s.expires_at <= now || s.absolute_expires_at <= now) { r.sessionExpired = true; return null; }
    if (s.user_status === 'locked') return null;

    let idle = s.expires_at;
    if (!PROBE.test(req.path) && now.getTime() - s.last_seen_at.getTime() >= SESSION_TOUCH_MS) {
      idle = new Date(Math.min(now.getTime() + SESSION_IDLE_MS, s.absolute_expires_at.getTime()));
      await this.prisma.$executeRaw`
        UPDATE sessions SET last_seen_at = ${now}::timestamptz, expires_at = ${idle}::timestamptz, updated_at = ${now}::timestamptz
        WHERE id = ${s.id}::uuid AND last_seen_at < ${new Date(now.getTime() - SESSION_TOUCH_MS)}::timestamptz`;
    }
    const email_verified = s.email_verified_at !== null;
    r.authSession = {
      session_id: s.id, idle_expires_at: idle, absolute_expires_at: s.absolute_expires_at,
      user: { id: s.user_id, email: s.email, full_name: s.full_name, role: s.role, email_verified },
    };
    return { user_id: s.user_id, role: s.role, email_verified, display_name: s.full_name };
  }
}
