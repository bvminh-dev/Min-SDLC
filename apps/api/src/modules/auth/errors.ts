import { registerProblem } from '../platform';

// Mã lỗi của AUTH (AUTH-API, ADR-023): `type` = urn:ecom:error:<mã>. `validation-failed`, `unauthenticated`, `session_expired`, `csrf_failed`,
// `forbidden`, `not-found`, `rate-limited`, `unsupported-media-type` là mã nền của platform.
const defs: [string, number, string][] = [
  ['invalid_credentials', 401, 'Invalid credentials'],
  ['invalid_or_expired_token', 400, 'Invalid or expired token'],
  ['invalid_current_password', 400, 'Current password is incorrect'],
  ['already_verified', 409, 'Email already verified'],
  ['cannot_change_own_role', 403, 'Cannot change your own role'],
  ['cannot_lock_self', 403, 'Cannot lock your own account'],
  ['role_unchanged', 409, 'Role unchanged'],
  ['last_admin', 409, 'At least one active admin must remain'],
  ['already_locked', 409, 'Account already locked'],
  ['not_locked', 409, 'Account is not locked'],
];
for (const [code, status, title] of defs) registerProblem({ code, status, title });

export const INVALID_CREDENTIALS_DETAIL = 'Email hoặc mật khẩu không đúng, hoặc tài khoản đang bị khóa tạm thời.';
export const INVALID_TOKEN_DETAIL = 'Liên kết không còn hiệu lực.';
