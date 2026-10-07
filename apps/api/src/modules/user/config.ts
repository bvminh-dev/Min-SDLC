// Biến cấu hình của USR (ADR-007, USR-API mục Giao tiếp giữa module: object storage S3 cho ảnh đại diện, ADR-010, ADR-018): nạp vào schema chung lúc import module.
import { z } from 'zod';
import { cfg, registerConfigSchema, type ConfigVar } from '../platform';

// Bí mật không có giá trị mặc định thật: rỗng chỉ chấp nhận ở dev (module bắt buộc đủ ở staging và prod, xem storage/storage.ts).
const secret = (): ConfigVar => ({ zod: z.string(), sensitive: true, default: '', requiredOutsideDev: true });

export const USER_VARS = {
  /** URL gốc của dịch vụ S3 tương thích (kiểu path: <endpoint>/<bucket>/<khóa>). Rỗng chỉ ở dev: tải ảnh đại diện trả 503. */
  STORAGE_ENDPOINT: { ...cfg.string({ default: '' }), requiredOutsideDev: true },
  STORAGE_BUCKET: cfg.string({ default: 'ecom-media' }),
  STORAGE_REGION: cfg.string({ default: 'us-east-1' }),
  STORAGE_ACCESS_KEY: secret(),
  STORAGE_SECRET_KEY: secret(),
  /** Gốc URL công khai của ảnh (CDN); rỗng thì dùng <endpoint>/<bucket>. */
  STORAGE_PUBLIC_BASE_URL: cfg.string({ default: '' }),
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
