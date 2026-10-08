// Biến cấu hình của USR (ADR-007). Kho object S3 (STORAGE_*) là phần dùng chung của platform (platform/storage/config.ts).
import { cfg, registerConfigSchema } from '../platform';

export const USER_VARS = {
  /** Hạn thời gian xử lý một ảnh (USR-SEC T9). */
  USR_AVATAR_PROCESS_TIMEOUT_MS: cfg.int({ default: 10_000, min: 50 }),
};
registerConfigSchema(USER_VARS);

// Hằng số nghiệp vụ đã chốt ở spec (đổi phải chạy sdlc-impact).
export const ADDRESS_LIMIT = 10; // SB-33
export const AVATAR_MAX_BYTES = 2_097_152; // 2 MiB (USR-REQ-20261006-101003679 BR2)
export const AVATAR_MAX_PIXELS = 25_000_000; // ADR-018
export const AVATAR_SIZE = 512; // ADR-018
export const AVATAR_ORPHAN_AGE_MS = 24 * 3600_000; // ADR-018
export const AVATAR_CACHE_CONTROL = 'public, max-age=300'; // ADR-018, USR-SEC T19: ảnh đã xóa hết phát trong 5 phút (không immutable)
export const ADDRESS_PURGE_DAYS = 30; // ADR-022
