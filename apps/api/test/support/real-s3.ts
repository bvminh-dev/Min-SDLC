import { S3Storage } from '../../src/modules/platform';

/**
 * Kho S3 THẬT (MinIO của docker compose, hoặc AWS S3) cho bộ test "S3 thật" của USR.
 * Bật bằng STORAGE_TEST_ENDPOINT (ví dụ http://localhost:9210; `docker compose up -d minio minio-bucket minio-policy`); khóa và bucket mặc định khớp docker-compose.yml.
 * Không đặt biến này thì các bộ test đó BỎ QUA và nói rõ lý do (`describeRealS3`), không im lặng xanh.
 */
export interface S3Cfg { endpoint: string; bucket: string; region: string; accessKey: string; secretKey: string }

export function realS3(env: NodeJS.ProcessEnv = process.env): S3Cfg | null {
  if (!env.STORAGE_TEST_ENDPOINT) return null;
  return {
    endpoint: env.STORAGE_TEST_ENDPOINT,
    bucket: env.STORAGE_TEST_BUCKET ?? 'ecom-test',
    region: env.STORAGE_TEST_REGION ?? 'us-east-1',
    accessKey: env.STORAGE_TEST_ACCESS_KEY ?? 'ecom-minio',
    secretKey: env.STORAGE_TEST_SECRET_KEY ?? 'ecom-minio-local',
  };
}

export const SKIP_REASON = 'BỎ QUA bộ test S3 thật: chưa đặt STORAGE_TEST_ENDPOINT (docker compose up -d minio minio-bucket minio-policy; STORAGE_TEST_ENDPOINT=http://localhost:9210). Các TC tương ứng chỉ có bằng chứng từ S3 giả.';

/** `describe` chỉ chạy khi có kho thật; không thì báo lý do ra stderr và đánh dấu skip (Jest đếm vào "skipped"). */
export function describeRealS3(name: string, fn: (cfg: S3Cfg) => void): void {
  const cfg = realS3();
  if (cfg) return describe(name, () => fn(cfg));
  process.stderr.write(`\n[test] ${name}: ${SKIP_REASON}\n`);
  describe.skip(`${name} (${SKIP_REASON})`, () => it('bỏ qua', () => undefined));
}

/** Chờ kho thật sẵn sàng (container vừa lên) và bucket đã có; lỗi nêu cách dựng. */
export async function waitForBucket(cfg: S3Cfg, timeoutMs = 30_000): Promise<S3Storage> {
  const s3 = new S3Storage(cfg);
  const end = Date.now() + timeoutMs;
  let last = '';
  while (Date.now() < end) {
    try { await s3.list('avatars/'); return s3; } catch (e) { last = (e as Error).message; await new Promise((r) => setTimeout(r, 500)); }
  }
  throw new Error(`kho S3 thật ${cfg.endpoint} bucket ${cfg.bucket} không dùng được (${last}): docker compose up -d minio minio-bucket minio-policy`);
}

/** Xóa mọi đối tượng dưới các tiền tố (kho thật không được reset giữa các test như S3 giả). */
export async function purgeKeys(s3: S3Storage, prefixes: string[]): Promise<void> {
  for (const prefix of prefixes) for (const o of await s3.list(prefix)) await s3.delete(o.key);
}
export const purgeAvatars = (s3: S3Storage): Promise<void> => purgeKeys(s3, ['avatars/']);
