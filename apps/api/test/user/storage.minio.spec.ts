import sharp from 'sharp';
import { S3Storage } from '../../src/modules/platform';
import { NOW0, q } from '../support/auth';
import { truncateAll } from '../support/db';
import { createUsrApp, call, setProfile, upload, userWithSession, type UsrApp } from '../support/usr';
import { describeRealS3, purgeAvatars, waitForBucket, type S3Cfg } from '../support/real-s3';
import { jpegWithExif, png } from '../support/images';

// Bộ test "S3 thật": client S3 của USR (SigV4 tự viết) nói chuyện với MinIO của docker compose. Không có STORAGE_TEST_ENDPOINT thì bỏ qua và báo lý do (support/real-s3.ts).
describeRealS3('USR kho ảnh trên S3 thật (MinIO): SigV4, list nhiều trang, lỗi ghi, ảnh đại diện từ đầu đến cuối', (cfg: S3Cfg) => {
  let s3: S3Storage;
  beforeAll(async () => { s3 = await waitForBucket(cfg); }, 60_000);
  beforeEach(() => purgeAvatars(s3));
  afterAll(() => purgeAvatars(s3));

  describe('client S3 trực tiếp', () => {
    it('USR-TC-20261006-102053718: ghi khóa có dấu cách và dấu +, đọc lại đúng header đã ghi, xóa idempotent, list quá 1000 đối tượng qua nhiều trang', async () => {
      const key = 'avatars/a b+c.webp';
      await s3.put(key, Buffer.from('xyz'), { contentType: 'image/webp', headers: { 'x-content-type-options': 'nosniff', 'cache-control': 'public, max-age=300' } });
      const got = await fetch(s3.urlFor(key)); // phát công khai, không chữ ký
      expect([got.status, got.headers.get('content-type'), got.headers.get('cache-control'), await got.text()]).toEqual([200, 'image/webp', 'public, max-age=300', 'xyz']);

      const pages: string[] = [];
      const counted = new S3Storage(cfg, (async (url: string, init?: RequestInit) => { if (/list-type=2/.test(String(url))) pages.push(String(url)); return fetch(url, init); }) as typeof fetch);
      const N = 1005; // MinIO trả tối đa 1000 khóa mỗi trang: phải qua continuation-token mới thấy đủ
      for (let i = 0; i < N; i += 25) await Promise.all(Array.from({ length: Math.min(25, N - i) }, (_, j) => s3.put(`avatars/p/${i + j}.webp`, Buffer.from('1'), { contentType: 'image/webp' })));
      const listed = await counted.list('avatars/p/');
      expect(listed).toHaveLength(N);
      expect(new Set(listed.map((o) => o.key)).size).toBe(N);
      expect(pages.length).toBeGreaterThanOrEqual(2);
      expect(pages.some((u) => /continuation-token=/.test(u))).toBe(true);
      expect(listed.every((o) => o.lastModified instanceof Date && !Number.isNaN(o.lastModified.getTime()))).toBe(true);

      await s3.delete(key);
      await s3.delete(key); // lần hai: không lỗi
      expect((await fetch(s3.urlFor(key))).status).toBe(404);
      expect(s3.keyOf(s3.urlFor(key))).toBe(key);
    }, 120_000);

    it('USR-TC-20261006-102053718: MinIO từ chối chữ ký sai (khóa bí mật sai, khóa truy cập sai) mà lỗi không lộ bí mật và không ghi gì', async () => {
      for (const bad of [{ secretKey: 'sai-bi-mat-khac' }, { accessKey: 'khong-co-nguoi-dung' }]) {
        const err = await new S3Storage({ ...cfg, ...bad }).put('avatars/x.webp', Buffer.from('1'), { contentType: 'image/webp' }).then(() => null, (e: Error) => e);
        expect(err?.message).toBe('storage PUT 403');
        expect(String(err?.message)).not.toMatch(/sai-bi-mat|khong-co-nguoi-dung|SignatureDoesNotMatch|InvalidAccessKeyId/);
      }
      expect(await s3.list('avatars/')).toEqual([]);
    });
  });

  describe('ảnh đại diện qua API thật với kho MinIO', () => {
    let t: UsrApp;
    beforeAll(async () => { t = await createUsrApp({ s3: cfg }); }, 60_000);
    afterAll(() => t.close());
    beforeEach(async () => { await truncateAll(t.prisma); t.logs.clear(); t.clock.set(new Date(NOW0)); }); // giờ thật: LastModified của MinIO là giờ thật
    const avatarOf = async (id: string) => (await q<{ avatar_url: string | null }>(t, `SELECT avatar_url FROM users WHERE id = '${id}'`))[0].avatar_url;
    const keysOf = async () => (await s3.list('avatars/')).map((o) => o.key);

    it('USR-TC-20261006-102053569: tải JPEG có EXIF lưu WebP 512x512 không metadata trên MinIO, thay ảnh xóa ảnh cũ, xóa ảnh xóa đối tượng', async () => {
      const u1 = await userWithSession(t, { email: 'u1@shop.vn' });
      const input = await jpegWithExif(800, 450);
      expect(input.includes(Buffer.from('Exif'))).toBe(true); // fixture có EXIF thật
      const r = await upload(t, u1.cookie, input, { filename: 'me.jpg' });
      expect(r.status).toBe(200);
      const url = r.body.avatar_url as string;
      expect(url).toMatch(new RegExp(`^${cfg.endpoint.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}/${cfg.bucket}/avatars/[0-9a-f-]{36}\\.webp$`));
      const got = await fetch(url); // đọc công khai từ MinIO thật, không chữ ký
      expect([got.status, got.headers.get('content-type'), got.headers.get('cache-control')]).toEqual([200, 'image/webp', 'public, max-age=300']);
      const body = Buffer.from(await got.arrayBuffer());
      const meta = await sharp(body).metadata();
      expect([meta.format, meta.width, meta.height]).toEqual(['webp', 512, 512]);
      expect(meta.exif).toBeUndefined();
      expect(meta.icc).toBeUndefined();
      for (const tag of ['Exif', 'TestCam', 'GPS']) expect([tag, body.includes(Buffer.from(tag))]).toEqual([tag, false]);
      expect((await call(t, 'get', '/me', { cookie: u1.cookie })).body.avatar_url).toBe(url);

      const second = (await upload(t, u1.cookie, await png(400, 400), { filename: 'a.png' })).body.avatar_url as string;
      expect(second).not.toBe(url);
      expect((await fetch(url)).status).toBe(404); // ảnh cũ bị xóa khỏi kho
      expect(await keysOf()).toHaveLength(1);

      const d = await call(t, 'delete', '/me/avatar', { cookie: u1.cookie });
      expect([d.status, d.text]).toEqual([204, '']);
      expect(await avatarOf(u1.id)).toBeNull();
      expect(await keysOf()).toEqual([]);
    });

    it('USR-TC-20261006-102053569: job usr.sweep-orphan-avatars trên MinIO xóa khóa mồ côi quá 24 giờ, giữ khóa còn mới và ảnh đang dùng', async () => {
      const u1 = await userWithSession(t, { email: 'u1@shop.vn' });
      const inUse = (await upload(t, u1.cookie, await jpegWithExif(64, 64))).body.avatar_url as string;
      const orphan = (n: number) => `avatars/22222222-2222-4222-8222-${String(n).padStart(12, '0')}.webp`;
      for (let n = 1; n <= 3; n++) await s3.put(orphan(n), Buffer.from('x'), { contentType: 'image/webp' });
      await s3.put('avatars/readme.txt', Buffer.from('x'), { contentType: 'text/plain' }); // không phải khóa của USR: không đụng
      expect(await t.jobs.runOnce('usr.sweep-orphan-avatars')).toBe('ran');
      expect(await keysOf()).toHaveLength(5); // mọi thứ còn mới (dưới 24 giờ): mồ côi có thể đang ghi dở (ADR-018)
      t.clock.advance(25 * 3600_000);
      expect(await t.jobs.runOnce('usr.sweep-orphan-avatars')).toBe('ran');
      expect((await keysOf()).sort()).toEqual([inUse.slice(inUse.indexOf('avatars/')), 'avatars/readme.txt'].sort());
      expect((await fetch(inUse)).status).toBe(200);
    });

    it('USR-TC-20261006-102053718: kho từ chối lệnh ghi (khóa sai) thì tải ảnh trả 5xx problem+json, avatar_url và ảnh cũ không đổi; xóa ảnh khi chưa có vẫn 204', async () => {
      const u0 = await userWithSession(t, { email: 'u0@shop.vn' });
      expect((await call(t, 'delete', '/me/avatar', { cookie: u0.cookie })).status).toBe(204);
      expect((await call(t, 'delete', '/me/avatar', { cookie: u0.cookie })).status).toBe(204);

      const old = 'avatars/11111111-1111-4111-8111-111111111111.webp';
      await s3.put(old, Buffer.from('old'), { contentType: 'image/webp' });
      const u1 = await userWithSession(t, { email: 'u1@shop.vn' });
      await setProfile(t, u1.id, { avatar_url: s3.urlFor(old) });
      const broken = await createUsrApp({ s3: { ...cfg, secretKey: 'sai-bi-mat-khac' } }); // cùng CSDL, cùng người dùng; riêng khóa của kho sai
      try {
        const r = await upload(broken, u1.cookie, await jpegWithExif(64, 64));
        expect(r.status).toBeGreaterThanOrEqual(500);
        expect(r.headers['content-type']).toContain('application/problem+json');
        expect(JSON.stringify(r.body)).not.toMatch(/sai-bi-mat|SignatureDoesNotMatch/);
      } finally { await broken.close(); }
      expect(await avatarOf(u1.id)).toBe(s3.urlFor(old));
      expect(await keysOf()).toEqual([old]);
    });
  });
});
