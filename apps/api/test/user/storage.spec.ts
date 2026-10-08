import { ConfigError, loadConfig } from '../../src/modules/platform';
import { S3Storage, createStorage, sha256Hex, signV4 } from '../../src/modules/platform';
import { baseEnv } from '../support/app';
import { testDbUrl, truncateAll } from '../support/db';
import { FakeS3 } from '../support/fake-s3';
import { call, createUsrApp, setProfile, upload, userWithSession } from '../support/usr';
import { jpegWithExif } from '../support/images';
import { q } from '../support/auth';

// Ví dụ công bố trong tài liệu AWS Signature Version 4 cho S3 (khóa ví dụ của AWS, không phải bí mật thật): kiểm bộ ký độc lập với chính mã đang kiểm.
const EXAMPLE = { region: 'us-east-1', accessKey: 'AKIAIOSFODNN7EXAMPLE', secretKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY', amzDate: '20130524T000000Z' }; // scan-secrets:allow khóa ví dụ của tài liệu AWS
const EMPTY = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';

describe('USR kho ảnh S3: chữ ký SigV4, client S3, cấu hình (USR-REQ-20261006-101003679 BR5, BR6)', () => {
  it('USR-TC-20261006-102053718: bộ ký SigV4 khớp bốn ví dụ trong tài liệu AWS (GET, PUT, query rỗng, query nhiều khóa)', () => {
    const base = { ...EXAMPLE, host: 'examplebucket.s3.amazonaws.com' };
    expect(signV4({ ...base, method: 'GET', path: '/test.txt', headers: { range: 'bytes=0-9', 'x-amz-content-sha256': EMPTY, 'x-amz-date': EXAMPLE.amzDate }, payloadHash: EMPTY }).signature)
      .toBe('f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41');
    const body = 'Welcome to Amazon S3.';
    expect(signV4({ ...base, method: 'PUT', path: '/test$file.text', payloadHash: sha256Hex(body), headers: { date: 'Fri, 24 May 2013 00:00:00 GMT', 'x-amz-date': EXAMPLE.amzDate, 'x-amz-storage-class': 'REDUCED_REDUNDANCY', 'x-amz-content-sha256': sha256Hex(body) } }).signature)
      .toBe('98ad721746da40c64f1a55b78f14c238d841ea1380cd77a1b5971af0ece108bd');
    expect(signV4({ ...base, method: 'GET', path: '/', query: { lifecycle: '' }, headers: { 'x-amz-content-sha256': EMPTY, 'x-amz-date': EXAMPLE.amzDate }, payloadHash: EMPTY }).signature)
      .toBe('fea454ca298b7da1c68078a5d1bdbfbbe0d65c699e0f91ac7a200a0136783543');
    expect(signV4({ ...base, method: 'GET', path: '/', query: { 'max-keys': '2', prefix: 'J' }, headers: { 'x-amz-content-sha256': EMPTY, 'x-amz-date': EXAMPLE.amzDate }, payloadHash: EMPTY }).signature)
      .toBe('34b48302e7b5fa45bde8084f4b7868a86f0a534bc59db6670ed5711ef69dc6f7');
    // công cụ hỏng thì đỏ: đổi khóa bí mật hay ngày thì chữ ký phải đổi
    const a = signV4({ ...base, method: 'GET', path: '/test.txt', headers: {}, payloadHash: EMPTY }).signature;
    expect(signV4({ ...base, secretKey: `${EXAMPLE.secretKey}x`, method: 'GET', path: '/test.txt', headers: {}, payloadHash: EMPTY }).signature).not.toBe(a);
    expect(signV4({ ...base, amzDate: '20130525T000000Z', method: 'GET', path: '/test.txt', headers: {}, payloadHash: EMPTY }).signature).not.toBe(a);
  });

  describe('client S3 chạy thật qua HTTP với dịch vụ S3 giả', () => {
    let fake: FakeS3;
    let s3: S3Storage;
    const make = (secretKey = fake.secretKey) => new S3Storage({ endpoint: fake.url, bucket: fake.bucket, region: 'us-east-1', accessKey: fake.accessKey, secretKey });
    beforeAll(async () => { fake = new FakeS3(); await fake.start(); s3 = make(); });
    afterAll(() => fake.stop());
    beforeEach(() => fake.reset());

    it('USR-TC-20261006-102053718: ghi, xóa idempotent, list nhiều trang; kho từ chối chữ ký sai mà lỗi không lộ bí mật', async () => {
      await s3.put('avatars/a b+c.webp', Buffer.from('xyz'), { contentType: 'image/webp', headers: { 'x-content-type-options': 'nosniff' } });
      expect(fake.objects.get('avatars/a b+c.webp')).toMatchObject({ contentType: 'image/webp' });
      expect(fake.objects.get('avatars/a b+c.webp')!.headers['x-content-type-options']).toBe('nosniff');
      fake.pageSize = 2;
      for (let i = 0; i < 5; i++) await s3.put(`avatars/k${i}.webp`, Buffer.from('1'), { contentType: 'image/webp' });
      await s3.put('other/x.webp', Buffer.from('1'), { contentType: 'image/webp' });
      const listed = await s3.list('avatars/');
      expect(listed.map((o) => o.key).sort()).toEqual(['avatars/a b+c.webp', 'avatars/k0.webp', 'avatars/k1.webp', 'avatars/k2.webp', 'avatars/k3.webp', 'avatars/k4.webp']);
      expect(listed.every((o) => o.lastModified instanceof Date && !Number.isNaN(o.lastModified.getTime()))).toBe(true);
      expect(fake.requests.filter((r) => r.query['list-type'] === '2').length).toBe(3); // 6 đối tượng, trang 2 đối tượng
      await s3.delete('avatars/k0.webp');
      await s3.delete('avatars/k0.webp'); // lần hai: không lỗi
      expect(fake.objects.has('avatars/k0.webp')).toBe(false);
      const bad = make('sai-bi-mat-khac');
      const err = await bad.put('avatars/x.webp', Buffer.from('1'), { contentType: 'image/webp' }).then(() => null, (e: Error) => e);
      expect(err?.message).toBe('storage PUT 403');
      expect(String(err?.message)).not.toMatch(/sai-bi-mat|fake-secret|SignatureDoesNotMatch/);
      expect(fake.objects.has('avatars/x.webp')).toBe(false);
      expect(s3.urlFor('avatars/k.webp')).toBe(`${fake.url}/${fake.bucket}/avatars/k.webp`);
      expect(s3.keyOf(s3.urlFor('avatars/k.webp'))).toBe('avatars/k.webp');
      expect(s3.keyOf('https://evil.example/avatars/k.webp')).toBeNull();
      const cdn = new S3Storage({ endpoint: fake.url, bucket: fake.bucket, region: 'r', accessKey: 'a', secretKey: 'b', publicBase: 'https://cdn.example.test/' });
      expect(cdn.urlFor('avatars/k.webp')).toBe('https://cdn.example.test/avatars/k.webp');
    });
  });

  // review USR: SB-09 (https ở staging/prod) và endpoint có đường dẫn con (chữ ký sai âm thầm: chỉ lộ khi tải ảnh đầu tiên lỗi 503).
  it('review USR (USR-TC-20261006-102053718): endpoint kho phải là gốc, https ở staging và prod; dev cho http', () => {
    const keys = { STORAGE_ACCESS_KEY: 'k'.repeat(20), STORAGE_SECRET_KEY: 's'.repeat(40) };
    const tls = `${testDbUrl()}?sslmode=require`;
    const make = (env: Record<string, string>) => createStorage(loadConfig({ ...baseEnv(env), ...keys }));
    expect(() => make({ STORAGE_ENDPOINT: 'http://127.0.0.1:9000' })).not.toThrow(); // dev
    for (const bad of ['not a url', 'http://127.0.0.1:9000/minio', 'https://s3.example.test/?x=1']) {
      expect(() => make({ STORAGE_ENDPOINT: bad })).toThrow(ConfigError);
    }
    const stg = { APP_ENV: 'staging', DATABASE_URL: tls, RETENTION_DATABASE_URL: tls };
    expect(() => make({ ...stg, STORAGE_ENDPOINT: 'http://s3.example.test' })).toThrow(ConfigError);
    expect(() => make({ ...stg, STORAGE_ENDPOINT: 'https://s3.example.test' })).not.toThrow();
  });

  it('USR-TC-20261006-102053718: staging và prod bắt buộc đủ biến kho ảnh (nêu tên biến, không in giá trị); dev để trống thì tải ảnh trả 503', async () => {
    const tls = `${testDbUrl()}?sslmode=require`;
    const staging = { ...baseEnv({ APP_ENV: 'staging', DATABASE_URL: tls }), RETENTION_DATABASE_URL: tls };
    const err = (() => { try { loadConfig(staging); return null; } catch (e) { return e as ConfigError; } })();
    expect(err).toBeInstanceOf(ConfigError);
    expect(err!.problems.map((p) => p.name).sort()).toEqual(['STORAGE_ACCESS_KEY', 'STORAGE_ENDPOINT', 'STORAGE_SECRET_KEY']);
    expect(err!.format()).not.toContain(tls);
    expect(() => loadConfig({ ...staging, STORAGE_ENDPOINT: 'https://s3.example.test', STORAGE_ACCESS_KEY: 'k'.repeat(20), STORAGE_SECRET_KEY: 's'.repeat(40) })).not.toThrow();
    expect(() => loadConfig(baseEnv())).not.toThrow(); // dev: để trống được
    // đặt endpoint mà thiếu khóa: dừng ngay lúc dựng kho, nêu đúng tên biến thiếu
    const cfg = loadConfig(baseEnv({ STORAGE_ENDPOINT: 'http://127.0.0.1:1' }));
    expect(() => createStorage(cfg)).toThrow(ConfigError);

    const t = await createUsrApp({ noStorage: true });
    try {
      await truncateAll(t.prisma);
      const u = await userWithSession(t, { email: 'u1@shop.vn' });
      const r = await upload(t, u.cookie, await jpegWithExif(32, 32));
      expect([r.status, r.body.type]).toEqual([503, 'urn:ecom:error:service-unavailable']);
      expect((await q(t, `SELECT avatar_url FROM users WHERE id = '${u.id}'`))[0].avatar_url).toBeNull();
      await setProfile(t, u.id, { avatar_url: 'https://cdn.example.test/avatars/x.webp' });
      expect((await call(t, 'delete', '/me/avatar', { cookie: u.cookie })).status).toBe(204); // xóa ảnh không cần kho
    } finally { await t.close(); }
  });
});
