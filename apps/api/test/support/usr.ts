import type { Test } from 'supertest';
import { PlatformModule } from '../../src/modules/platform';
import { AuthModule } from '../../src/modules/auth/auth.module';
import { AddressService } from '../../src/modules/user/address.service';
import { AvatarService } from '../../src/modules/user/avatar.service';
import { UserModule } from '../../src/modules/user/user.module';
import { JobRunner } from '../../src/modules/platform';
import { ORIGIN } from './app';
import { FakeS3 } from './fake-s3';
import type { S3Cfg } from './real-s3';
import { createAuthApp, http, q, seedSession, seedUser, type AuthApp, type SeedUser } from './auth';

export interface UsrApp extends AuthApp { fake: FakeS3; /** Kho đang dùng: S3 giả trong tiến trình hoặc kho thật (`s3`). */ storage: S3Cfg; addressSvc: AddressService; avatarSvc: AvatarService; jobs: JobRunner }

/** Ứng dụng thật (PlatformModule + AuthModule + UserModule), PostgreSQL thật, client S3 thật của USR nói chuyện với dịch vụ S3 giả trong tiến trình. */
export async function createUsrApp(o: { env?: Record<string, string>; level?: string; noStorage?: boolean; s3?: S3Cfg } = {}): Promise<UsrApp> {
  const fake = new FakeS3();
  await fake.start();
  const cfg: S3Cfg = o.s3 ?? { endpoint: fake.url, bucket: fake.bucket, region: 'us-east-1', accessKey: fake.accessKey, secretKey: fake.secretKey };
  const storage: Record<string, string> = o.noStorage ? {} : { STORAGE_ENDPOINT: cfg.endpoint, STORAGE_BUCKET: cfg.bucket, STORAGE_REGION: cfg.region, STORAGE_ACCESS_KEY: cfg.accessKey, STORAGE_SECRET_KEY: cfg.secretKey };
  const t = await createAuthApp({ imports: [PlatformModule, AuthModule, UserModule], controllers: [], level: o.level, env: { TRUST_PROXY_HOPS: '1', ...storage, ...(o.env ?? {}) } });
  const closeBase = t.close;
  return Object.assign(t, {
    fake, storage: cfg, addressSvc: t.app.get(AddressService), avatarSvc: t.app.get(AvatarService), jobs: t.app.get(JobRunner),
    close: async () => { await closeBase(); await fake.stop(); },
  });
}

export interface CallOpts {
  cookie?: string;
  /** Mặc định ORIGIN hợp lệ cho POST, PUT, PATCH, DELETE; `null` là không gửi header Origin. */
  origin?: string | null;
  /** Mặc định application/json khi có thân; `null` là không đặt. */
  contentType?: string | null;
  ip?: string;
  body?: unknown;
}
/** Gọi API bằng JSON, ghi mặc định có Origin hợp lệ. */
export function call(t: AuthApp, method: 'get' | 'post' | 'put' | 'patch' | 'delete', path: string, o: CallOpts = {}): Test {
  let r = http(t)[method](`/api/v1${path}`);
  if (o.cookie) r = r.set('Cookie', o.cookie);
  if (method !== 'get' && o.origin !== null) r = r.set('Origin', o.origin ?? ORIGIN);
  if (o.ip) r = r.set('X-Forwarded-For', o.ip);
  const body = o.body === undefined ? undefined : typeof o.body === 'string' ? o.body : JSON.stringify(o.body);
  if (body !== undefined && o.contentType !== null) r = r.set('Content-Type', o.contentType ?? 'application/json');
  return body === undefined ? r : r.send(body);
}

/** Tải ảnh multipart: một phần `file` (tên và đuôi tùy ý, vì chỉ nội dung quyết định). */
export function upload(t: AuthApp, cookie: string | undefined, file: Buffer | null, o: { filename?: string; field?: string; origin?: string | null; extraField?: boolean; secondFile?: Buffer } = {}): Test {
  let r = http(t).put('/api/v1/me/avatar');
  if (cookie) r = r.set('Cookie', cookie);
  if (o.origin !== null) r = r.set('Origin', o.origin ?? ORIGIN);
  if (o.extraField) r = r.field('note', 'x');
  if (file) r = r.attach(o.field ?? 'file', file, { filename: o.filename ?? 'me.bin' });
  if (o.secondFile) r = r.attach('file', o.secondFile, { filename: 'second.bin' });
  return r;
}

/** Người dùng có phiên: cookie dựng thẳng trong CSDL (nhanh, không qua giới hạn đăng nhập). */
export async function userWithSession(t: AuthApp, o: Parameters<typeof seedUser>[1] = {}): Promise<SeedUser & { cookie: string; sessionId: string }> {
  const u = await seedUser(t, o);
  const s = await seedSession(t, u.id);
  return { ...u, cookie: s.cookie, sessionId: s.id };
}

export const setProfile = (t: AuthApp, id: string, p: { phone?: string | null; avatar_url?: string | null }) =>
  t.prisma.$executeRaw`UPDATE users SET phone = ${p.phone ?? null}, avatar_url = ${p.avatar_url ?? null} WHERE id = ${id}::uuid`;

interface AddrSeed { receiver?: string; phone?: string; line1?: string; ward?: string; district?: string | null; city?: string; isDefault?: boolean; createdAt?: Date; updatedAt?: Date; deletedAt?: Date | null }
let n = 0;
/** Địa chỉ dựng thẳng trong CSDL (fixture). */
export async function seedAddress(t: AuthApp, userId: string, o: AddrSeed = {}): Promise<string> {
  const i = ++n;
  const created = o.createdAt ?? t.clock.now();
  const rows = await t.prisma.$queryRaw<{ id: string }[]>`
    INSERT INTO addresses (user_id, receiver, phone, line1, ward, district, city, is_default, deleted_at, created_at, updated_at)
    VALUES (${userId}::uuid, ${o.receiver ?? `Người nhận ${i}`}, ${o.phone ?? '0901234567'}, ${o.line1 ?? `${i} Lê Lợi`}, ${o.ward ?? 'Bến Nghé'},
            ${o.district === undefined ? 'Quận 1' : o.district}, ${o.city ?? 'TP. Hồ Chí Minh'}, ${o.isDefault ?? false}, ${o.deletedAt ?? null}::timestamptz,
            ${created}::timestamptz, ${(o.updatedAt ?? created)}::timestamptz) RETURNING id`;
  return rows[0].id;
}
/** `count` địa chỉ cho một người; địa chỉ cũ nhất là mặc định. Trả id theo thứ tự tạo (cũ đến mới). */
export async function seedAddresses(t: AuthApp, userId: string, count: number): Promise<string[]> {
  const base = t.clock.now().getTime();
  const ids: string[] = [];
  for (let k = 0; k < count; k++) ids.push(await seedAddress(t, userId, { isDefault: k === 0, createdAt: new Date(base - (count - k) * 60_000) }));
  return ids;
}
export const addressRows = (t: AuthApp, userId: string) =>
  q<{ id: string; is_default: boolean; deleted_at: Date | null; receiver: string; line1: string; phone: string; district: string | null; updated_at: Date }>(
    t, `SELECT id, is_default, deleted_at, receiver, line1, phone::text AS phone, district, updated_at FROM addresses WHERE user_id = '${userId}' ORDER BY created_at, id`);
export const defaultsOf = async (t: AuthApp, userId: string): Promise<string[]> =>
  (await q<{ id: string }>(t, `SELECT id FROM addresses WHERE user_id = '${userId}' AND is_default AND deleted_at IS NULL`)).map((r) => r.id);
export const liveCount = async (t: AuthApp, userId: string): Promise<number> =>
  (await q<{ n: number }>(t, `SELECT count(*)::int AS n FROM addresses WHERE user_id = '${userId}' AND deleted_at IS NULL`))[0].n;
export const auditRows = (t: AuthApp, action: string) =>
  q<{ actor_id: string; actor_role: string; target_type: string; target_id: string; after: any; created_at: Date }>(
    t, `SELECT actor_id, actor_role, target_type, target_id, after, created_at FROM audit_logs WHERE action = '${action}' ORDER BY created_at, id`);
export const VALID_ADDRESS = { receiver: 'Nguyễn An', phone: '0901234567', line1: '12 Lê Lợi', ward: 'Bến Nghé', district: 'Quận 1', city: 'TP. Hồ Chí Minh' };
export const ME_KEYS = ['avatar_url', 'created_at', 'email', 'email_verified', 'full_name', 'id', 'phone', 'role'];
