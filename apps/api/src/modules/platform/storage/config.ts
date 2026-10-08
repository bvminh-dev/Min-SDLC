// Biến cấu hình kho object S3 (ADR-007, ADR-010, ADR-018): kho là phần dùng chung của platform (USR ảnh đại diện, PRD ảnh sản phẩm, REV ảnh đánh giá), nạp vào schema chung lúc import platform.
import { z } from 'zod';
import { cfg, registerConfigSchema, type ConfigVar } from '../config/config';

// Bí mật không có giá trị mặc định thật: rỗng chỉ chấp nhận ở dev (staging và prod bắt buộc đủ, xem storage/factory.ts).
const secret = (): ConfigVar => ({ zod: z.string(), sensitive: true, default: '', requiredOutsideDev: true });

export const STORAGE_VARS = {
  /** URL gốc của dịch vụ S3 tương thích (kiểu path: <endpoint>/<bucket>/<khóa>). Rỗng chỉ ở dev: tải ảnh trả 503. */
  STORAGE_ENDPOINT: { ...cfg.string({ default: '' }), requiredOutsideDev: true },
  STORAGE_BUCKET: cfg.string({ default: 'ecom-media' }),
  STORAGE_REGION: cfg.string({ default: 'us-east-1' }),
  STORAGE_ACCESS_KEY: secret(),
  STORAGE_SECRET_KEY: secret(),
  /** Gốc URL công khai của ảnh (CDN); rỗng thì dùng <endpoint>/<bucket>. */
  STORAGE_PUBLIC_BASE_URL: cfg.string({ default: '' }),
};
registerConfigSchema(STORAGE_VARS);
