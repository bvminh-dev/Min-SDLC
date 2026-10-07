import type { Request, Response } from 'express';
import { SESSION_COOKIE } from './config';
import type { AuthRequest } from './session.resolver';

/** Cookie phiên: không Max-Age, HttpOnly, Secure, SameSite=Lax (SB-04). Một nơi duy nhất để AUTH và module cấp phiên mới (USR đổi mật khẩu) dùng chung. */
export const SESSION_COOKIE_OPTS = { httpOnly: true, secure: true, sameSite: 'lax', path: '/' } as const;
export const setSessionCookie = (res: Response, token: string): void => { res.cookie(SESSION_COOKIE, token, SESSION_COOKIE_OPTS); };
/** Id phiên của request hiện tại (bộ giải phiên của AUTH đã điền), để module khác truyền vào `AuthApi.changePassword`. */
export const currentSessionId = (req: Request): string | undefined => (req as AuthRequest).authSession?.session_id;
