// Điểm vào công khai DUY NHẤT của module auth: module khác chỉ import từ đây (SB-35, check:boundaries).
// `AuthApi` là giao diện gọi đồng bộ cho USR, NTF, REV (architecture.md, bảng Giao diện module).
export { AuthModule } from './auth.module';
export {
  AuthApi, type ChangePasswordResult, type DisplayName, type ProfilePatch, type UserContact, type UserView,
} from './auth.api';
export { createAdmin, type CreateAdminResult } from './create-admin';
export { SESSION_COOKIE_OPTS, currentSessionId, setSessionCookie } from './session.http';
