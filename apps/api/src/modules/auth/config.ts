// Biến cấu hình của AUTH (ADR-007, AUTH-DB mục "Biến cấu hình"): nạp vào schema chung của platform lúc import module.
import { cfg, registerConfigSchema } from '../platform';

export const AUTH_VARS = {
  ARGON2_MEMORY_KIB: cfg.int({ default: 19456, min: 8 }),
  ARGON2_TIME_COST: cfg.int({ default: 2, min: 1 }),
  ARGON2_PARALLELISM: cfg.int({ default: 1, min: 1, max: 16 }),
  AUTH_MAX_ACTIVE_SESSIONS: cfg.int({ default: 10, min: 1 }),
};
registerConfigSchema(AUTH_VARS);

export interface AuthConfig {
  ARGON2_MEMORY_KIB: number;
  ARGON2_TIME_COST: number;
  ARGON2_PARALLELISM: number;
  AUTH_MAX_ACTIVE_SESSIONS: number;
}

// Hằng số nghiệp vụ đã chốt ở spec (đổi phải chạy sdlc-impact): SB-02, SB-04, SB-03, SB-26.
export const LOGIN_LOCK_THRESHOLD = 5;
export const LOGIN_WINDOW_MS = 15 * 60_000;
export const LOGIN_LOCK_MS = 15 * 60_000;
export const SESSION_IDLE_MS = 30 * 60_000;
export const SESSION_ABSOLUTE_MS = 7 * 24 * 3600_000;
export const SESSION_TOUCH_MS = 60_000;
export const RESET_TOKEN_MS = 30 * 60_000;
export const VERIFY_TOKEN_MS = 24 * 3600_000;
export const RESEND_COOLDOWN_MS = 60_000;
export const RESEND_PER_HOUR = 5;
export const FORGOT_PER_EMAIL_HOUR = 5;
export const HOUR_MS = 3600_000;
export const RETENTION_DAYS = 30;
export const SESSION_COOKIE = 'sid';
