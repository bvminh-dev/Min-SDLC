import { S3Storage } from '../../src/modules/platform';
import { truncateAll } from '../support/db';
import { NOW0, q } from '../support/auth';
import { createUsrApp, call, upload, userWithSession, type UsrApp } from '../support/usr';
import { realS3, purgeAvatars, waitForBucket, type S3Cfg } from '../support/real-s3';
import { jpegWithExif, png } from '../support/images';

// USR-SEC T19 (ảnh đã xóa hoặc thay): chạy với S3 giả (luôn) và với MinIO thật (khi đặt STORAGE_TEST_ENDPOINT, xem support/real-s3.ts).
const real = realS3();
const backends: { name: string; s3?: S3Cfg }[] = [{ name: 'S3 giả' }, ...(real ? [{ name: 'MinIO thật', s3: real }] : [])];
if (!real) process.stderr.write('\n[test] USR T19 (USR-TC-20261007-080907024) chỉ chạy với S3 giả: chưa đặt STORAGE_TEST_ENDPOINT, nên chưa có bằng chứng từ kho S3 thật (docker compose up -d minio minio-bucket minio-policy).\n');

describe.each(backends)('USR T19: ảnh đã xóa hoặc thay hết phát, job quét không xóa ảnh đang dùng ($name)', ({ name, s3 }) => {
  let t: UsrApp;
  let direct: S3Storage;
  beforeAll(async () => {
    t = await createUsrApp({ s3 });
    direct = s3 ? await waitForBucket(s3) : new S3Storage(t.storage);
  }, 60_000);
  afterAll(() => t.close());
  beforeEach(async () => { await truncateAll(t.prisma); t.fake.reset(); await purgeAvatars(direct); t.logs.clear(); t.clock.set(new Date(NOW0)); }); // giờ thật: LastModified của kho thật là giờ thật

  const avatarOf = async (id: string) => (await q<{ avatar_url: string | null }>(t, `SELECT avatar_url FROM users WHERE id = '${id}'`))[0].avatar_url;
  const keys = async () => (await direct.list('avatars/')).map((o) => o.key).sort();
  const uuidKey = (n: number) => `avatars/33333333-3333-4333-8333-${String(n).padStart(12, '0')}.webp`;

  it(`USR-TC-20261007-080907024: lệnh ghi mang Cache-Control public, max-age=300 (không immutable) và ảnh phát lại đúng header đó (${name})`, async () => {
    const u1 = await userWithSession(t, { email: 'u1@shop.vn' });
    const r = await upload(t, u1.cookie, await jpegWithExif(64, 64));
    expect(r.status).toBe(200);
    if (!s3) {
      const put = t.fake.requests.find((x) => x.method === 'PUT')!;
      expect(put.headers['cache-control']).toBe('public, max-age=300');
    }
    const res = await fetch(r.body.avatar_url); // phát công khai, không chữ ký
    expect(res.status).toBe(200);
    const cc = res.headers.get('cache-control') ?? '';
    expect(cc).toMatch(/(^|,\s*)public(,|$)/);
    expect(cc).not.toMatch(/immutable/);
    expect(Number(cc.match(/max-age=(\d+)/)?.[1])).toBe(300);
  });

  it(`USR-TC-20261007-080907024: ảnh bị thay hay bị xóa thì URL cũ trả 404 ngay ở kho (${name})`, async () => {
    const u1 = await userWithSession(t, { email: 'u1@shop.vn' });
    const first = (await upload(t, u1.cookie, await jpegWithExif(64, 64))).body.avatar_url as string;
    expect((await fetch(first)).status).toBe(200);
    const second = (await upload(t, u1.cookie, await png(64, 64))).body.avatar_url as string;
    expect(second).not.toBe(first);
    expect((await fetch(first)).status).toBe(404); // thay: ảnh cũ hết phát ở kho; bản còn nằm ở cache chỉ sống tối đa max-age (300 giây)
    expect((await fetch(second)).status).toBe(200);
    expect((await call(t, 'delete', '/me/avatar', { cookie: u1.cookie })).status).toBe(204);
    expect((await fetch(second)).status).toBe(404);
    expect(await avatarOf(u1.id)).toBeNull();
    expect(await keys()).toEqual([]);
  });

  it(`USR-TC-20261007-080907024: đổi gốc URL công khai thì job quét báo lỗi, không xóa gì; trả gốc cũ thì xóa đúng ảnh mồ côi và giữ ảnh đang dùng (${name})`, async () => {
    const u1 = await userWithSession(t, { email: 'u1@shop.vn' });
    const inUse = (await upload(t, u1.cookie, await jpegWithExif(64, 64))).body.avatar_url as string;
    await direct.put(uuidKey(1), Buffer.from('orphan'), { contentType: 'image/webp' });
    t.clock.advance(25 * 3600_000); // ảnh mồ côi quá 24 giờ theo đồng hồ của ứng dụng; ảnh đang dùng cũng quá 24 giờ
    const svc = t.avatarSvc as unknown as { storage: S3Storage };
    const original = svc.storage;
    svc.storage = new S3Storage({ ...t.storage, publicBase: 'https://cdn.example.test' });
    try {
      expect(await t.jobs.runOnce('usr.sweep-orphan-avatars')).toBe('failed');
      expect(await keys()).toHaveLength(2); // không xóa gì
      if (!s3) expect(t.fake.requests.filter((x) => x.method === 'DELETE')).toHaveLength(0);
      expect((await fetch(inUse)).status).toBe(200);
      expect(await avatarOf(u1.id)).toBe(inUse);
    } finally { svc.storage = original; }
    expect(await t.jobs.runOnce('usr.sweep-orphan-avatars')).toBe('ran');
    expect(await keys()).toEqual([inUse.slice(inUse.indexOf('avatars/'))]);
    expect((await fetch(inUse)).status).toBe(200);
  });
});
