import { Controller, Get, HttpCode, Patch, Post, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { z } from 'zod';
import {
  Action, ConfigService, CurrentSession, Public, RateLimit, Roles, Validate, ValidBody, ValidParams, ValidQuery, clientIp, type SessionContext,
} from '../platform';
import { AdminUsersService, type ListQuery } from './admin.service';
import { AuthService } from './auth.service';
import { SESSION_COOKIE } from './config';
import { SESSION_COOKIE_OPTS as COOKIE_OPTS, setSessionCookie } from './session.http';
import { adminListQuery, emailOnlyBody, idParams, lockBody, loginBody, registerBody, resetBody, roleBody, tokenBody } from './policy';
import { readCookie, type AuthRequest } from './session.resolver';

const REGISTER_MESSAGE = 'Chúng tôi đã nhận đăng ký. Hãy kiểm tra email để xác minh rồi đăng nhập.';
const FORGOT_MESSAGE = 'Nếu email này có tài khoản, chúng tôi đã gửi hướng dẫn đặt lại mật khẩu.';
const HOUR = 3600;
const ADMIN_RL = { tier: 'D', limit: 30, windowSeconds: 60, group: 'auth:admin-users' } as const; // SB-14 bậc D: 30 mỗi phút mỗi quản trị, chung bốn endpoint
const noBody = {} as const;

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService, private readonly config: ConfigService) {}
  private ip(req: Request): string { return clientIp(req, this.config.get('TRUST_PROXY_HOPS')); }

  @Post('register') @Action('Đăng ký tài khoản') @HttpCode(202) @Public() @RateLimit({ tier: 'A', limit: 10, windowSeconds: HOUR }) @Validate({ body: registerBody })
  async register(@ValidBody() b: { email: string; password: string; full_name: string }) {
    await this.auth.register(b);
    return { message: REGISTER_MESSAGE };
  }

  @Post('verify-email') @Action('Xác minh email bằng liên kết') @HttpCode(200) @Public() @RateLimit({ tier: 'A', limit: 30, windowSeconds: HOUR }) @Validate({ body: tokenBody })
  async verify(@ValidBody() b: { token: string }) {
    await this.auth.verifyEmail(b.token);
    return { verified: true };
  }

  @Post('verify-email/resend') @Action('Gửi lại email xác minh') @HttpCode(202) @Roles('customer') @Validate(noBody)
  resend(@CurrentSession() s: SessionContext) { return this.auth.resendVerification(s.user_id); }

  @Post('login') @Action('Đăng nhập') @HttpCode(200) @Public() @RateLimit({ tier: 'A', limit: 10, windowSeconds: 60 }) @Validate({ body: loginBody })
  async login(@ValidBody() b: { email: string; password: string }, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const r = await this.auth.login(b, { ip: this.ip(req), cookieToken: readCookie(req.headers.cookie, SESSION_COOKIE) });
    setSessionCookie(res, r.token); // cookie phiên (SB-04), dùng chung với USR đổi mật khẩu
    return { user: r.user };
  }

  @Post('logout') @Action('Đăng xuất (phiên hiện tại)') @HttpCode(204) @Roles('customer', 'staff', 'sale', 'admin') @Validate(noBody)
  async logout(@Req() req: AuthRequest, @Res({ passthrough: true }) res: Response) {
    await this.auth.logout(req.authSession!.session_id);
    res.cookie(SESSION_COOKIE, '', { ...COOKIE_OPTS, maxAge: 0 }); // xóa cookie: Max-Age=0
  }

  @Get('session') @Action('Xem thông tin và hạn của phiên hiện tại') @Roles('customer', 'staff', 'sale', 'admin') @Validate(noBody)
  session(@Req() req: AuthRequest) {
    const s = req.authSession!;
    return { user: s.user, idle_expires_at: s.idle_expires_at.toISOString(), absolute_expires_at: s.absolute_expires_at.toISOString() };
  }

  @Post('password/forgot') @Action('Quên mật khẩu (yêu cầu liên kết đặt lại)') @HttpCode(202) @Public() @RateLimit({ tier: 'A', limit: 20, windowSeconds: HOUR }) @Validate({ body: emailOnlyBody })
  forgot(@ValidBody() b: { email: string }) {
    this.auth.forgotPassword(b.email);
    return { message: FORGOT_MESSAGE };
  }

  @Post('password/reset') @Action('Đặt lại mật khẩu bằng token') @HttpCode(200) @Public() @RateLimit({ tier: 'A', limit: 10, windowSeconds: HOUR }) @Validate({ body: resetBody })
  async reset(@ValidBody() b: { token: string; new_password: string }, @Req() req: Request) {
    await this.auth.resetPassword(b, { ip: this.ip(req) });
    return { ok: true };
  }
}

@Controller('admin/users')
export class AdminUsersController {
  constructor(private readonly admin: AdminUsersService) {}

  @Get() @Action('Xem danh sách người dùng (lọc, tìm theo email)') @Roles('admin') @RateLimit(ADMIN_RL) @Validate({ query: adminListQuery })
  list(@ValidQuery() q: ListQuery) { return this.admin.list(q); }

  @Patch(':id/role') @Action('Đổi role người dùng') @HttpCode(200) @Roles('admin') @RateLimit(ADMIN_RL) @Validate({ params: idParams, body: roleBody })
  role(@CurrentSession() s: SessionContext, @ValidParams() p: { id: string }, @ValidBody() b: { role: 'customer' | 'staff' | 'sale' | 'admin' }) { return this.admin.changeRole(s, p.id, b.role); }

  @Post(':id/lock') @Action('Khóa tài khoản người dùng') @HttpCode(200) @Roles('admin') @RateLimit(ADMIN_RL) @Validate({ params: idParams, body: lockBody })
  lock(@CurrentSession() s: SessionContext, @ValidParams() p: { id: string }, @ValidBody() b: { reason?: string }) { return this.admin.lock(s, p.id, b.reason); }

  @Post(':id/unlock') @Action('Mở khóa tài khoản người dùng') @HttpCode(200) @Roles('admin') @RateLimit(ADMIN_RL) @Validate({ params: idParams, body: z.object({}).strict() })
  unlock(@CurrentSession() s: SessionContext, @ValidParams() p: { id: string }) { return this.admin.unlock(s, p.id); }
}
