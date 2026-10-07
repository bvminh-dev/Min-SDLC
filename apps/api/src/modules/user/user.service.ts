import { Injectable } from '@nestjs/common';
import type { Request, Response } from 'express';
import { AuthApi, currentSessionId, setSessionCookie, type UserView } from '../auth';
import { ConfigService, DomainError, clientIp, type SessionContext } from '../platform';
import type { ProfilePatch } from './policy';

/** Hồ sơ trả cho chính chủ: liệt kê từng trường, không bao giờ chép nguyên đối tượng (không có `password_hash`, token, bộ đếm, lý do khóa; USR-REQ ...419 BR1). */
export interface Profile {
  id: string; email: string; email_verified: boolean; full_name: string; phone: string | null; avatar_url: string | null; role: UserView['role']; created_at: Date;
}
export const toProfile = (u: UserView): Profile => ({
  id: u.id, email: u.email, email_verified: u.email_verified, full_name: u.full_name, phone: u.phone || null, avatar_url: u.avatar_url || null, role: u.role, created_at: u.created_at,
});

/** Hồ sơ và đổi mật khẩu: USR không chạm bảng `users`, mọi đọc ghi đi qua AuthApi (USR-API mục Giao tiếp giữa module). */
@Injectable()
export class UserService {
  constructor(private readonly auth: AuthApi, private readonly config: ConfigService) {}

  async getProfile(s: SessionContext): Promise<Profile> {
    const u = await this.auth.getUser(s.user_id);
    if (!u) throw new DomainError('unauthenticated'); // người dùng biến mất giữa chừng: như hết phiên
    return toProfile(u);
  }

  async updateProfile(s: SessionContext, patch: ProfilePatch): Promise<Profile> {
    // chỉ hai khóa hợp lệ đi tiếp; khóa khác (kể cả `role`) đã bị schema từ chối, và AuthApi.updateProfile cũng chỉ ghi ba cột (T2)
    return toProfile(await this.auth.updateProfile(s.user_id, { ...(patch.full_name !== undefined ? { full_name: patch.full_name } : {}), ...(patch.phone !== undefined ? { phone: patch.phone } : {}) }));
  }

  /** Đổi mật khẩu: AUTH làm toàn bộ giao dịch (băm, thu hồi phiên, phiên mới, audit, outbox); USR ánh xạ lỗi và đặt cookie phiên mới (USR-REQ ...591). */
  async changePassword(s: SessionContext, req: Request, res: Response, b: { current_password: string; new_password: string }): Promise<{ ok: true; revoked_sessions: number }> {
    const sessionId = currentSessionId(req);
    if (!sessionId) throw new DomainError('unauthenticated');
    try {
      const r = await this.auth.changePassword(s.user_id, sessionId, b.current_password, b.new_password, { ip: clientIp(req, this.config.get('TRUST_PROXY_HOPS')) });
      setSessionCookie(res, r.new_session.token);
      return { ok: true, revoked_sessions: r.revoked_others };
    } catch (e) {
      // BR2: mật khẩu hiện tại sai là lỗi theo trường 400, không phải 401 (giao diện không hiểu nhầm là hết phiên)
      if (e instanceof DomainError && e.code === 'invalid_current_password') throw new DomainError('validation-failed', { errors: [{ field: 'current_password', code: 'incorrect' }] });
      throw e;
    }
  }
}
