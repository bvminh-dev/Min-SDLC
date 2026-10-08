import sharp from 'sharp';
import { truncateAll } from '../support/db';
import { createUsrApp, call, setProfile, upload, userWithSession, type UsrApp } from '../support/usr';
import { S3Storage } from '../../src/modules/platform';
import { ORIGIN } from '../support/app';
import { http, q, seedSession } from '../support/auth';
import { animatedWebp, gif, jpegWithExif, padJpeg, php, png, pngClaiming, svgWithScript, webp } from '../support/images';

const OLD_AVATAR = 'avatars/11111111-1111-4111-8111-111111111111.webp';
const KEY_URL = /\/(avatars\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.webp)$/;
const LIMIT = 2_097_152;

describe('USR ảnh đại diện: tải lên, xóa, dọn ảnh mồ côi (USR-REQ-20261006-101003679)', () => {
  let t: UsrApp;
  let T0: Date;
  beforeAll(async () => { t = await createUsrApp(); T0 = t.clock.now(); });
  afterAll(() => t.close());
  beforeEach(async () => { await truncateAll(t.prisma); t.fake.reset(); t.logs.clear(); t.clock.set(T0); });

  const avatarOf = async (id: string) => (await q<{ avatar_url: string | null }>(t, `SELECT avatar_url FROM users WHERE id = '${id}'`))[0].avatar_url;
  const keyOf = (url: string) => url.match(KEY_URL)![1];
  /** Người dùng đang có ảnh `avatars/<uuid>.webp` nằm trong storage. */
  const withAvatar = async (key = OLD_AVATAR, email = 'u1@shop.vn') => {
    const u = await userWithSession(t, { email });
    t.fake.seed(key, await sharp({ create: { width: 8, height: 8, channels: 3, background: '#fff' } }).webp().toBuffer(), t.clock.now());
    await setProfile(t, u.id, { avatar_url: `${t.fake.url}/${t.fake.bucket}/${key}` });
    return u;
  };
  const stored = (url: string) => t.fake.objects.get(keyOf(url))!;

  it('USR-TC-20261006-102053569: tải JPEG có EXIF lưu WebP 512x512 không metadata, xóa ảnh cũ, xóa ảnh; job quét ảnh mồ côi', async () => {
    const u1 = await userWithSession(t, { email: 'u1@shop.vn' });
    const input = await jpegWithExif(800, 450);
    const inMeta = await sharp(input).metadata();
    expect(inMeta.exif).toBeDefined(); // fixture có EXIF thật
    expect(input.includes(Buffer.from('Exif'))).toBe(true);

    const r = await upload(t, u1.cookie, input, { filename: 'me.jpg' });
    expect(r.status).toBe(200);
    expect(Object.keys(r.body)).toEqual(['avatar_url']);
    expect(r.body.avatar_url).toMatch(KEY_URL);
    const obj = stored(r.body.avatar_url);
    expect(obj.contentType).toBe('image/webp');
    const meta = await sharp(obj.body).metadata();
    expect([meta.format, meta.width, meta.height]).toEqual(['webp', 512, 512]);
    expect(meta.exif).toBeUndefined();
    expect(meta.icc).toBeUndefined();
    for (const tag of ['Exif', 'TestCam', 'GPS']) expect([tag, obj.body.includes(Buffer.from(tag))]).toEqual([tag, false]);
    const put = t.fake.requests.find((x) => x.method === 'PUT')!;
    expect(put.headers['content-type']).toBe('image/webp'); // BR5
    expect(put.headers['x-content-type-options']).toBe('nosniff');
    expect(put.headers['cache-control']).toBe('public, max-age=300'); // T19: ảnh đã xóa hết phát trong 5 phút; không immutable
    expect((await call(t, 'get', '/me', { cookie: u1.cookie })).body.avatar_url).toBe(r.body.avatar_url);
    expect(await avatarOf(u1.id)).toBe(r.body.avatar_url);
    expect(JSON.stringify(t.logs.records)).not.toContain('me.jpg'); // tên tệp của client không bao giờ dùng hay ghi

    // thay ảnh: PNG hợp lệ ~300 KB; ảnh cũ bị xóa khỏi storage, chỉ còn một đối tượng
    const u2 = await withAvatar(OLD_AVATAR, 'u2@shop.vn');
    const big = await png(400, 400);
    const r2 = await upload(t, u2.cookie, big, { filename: 'a.png' });
    expect(r2.status).toBe(200);
    expect(keyOf(r2.body.avatar_url)).not.toBe(OLD_AVATAR);
    expect(t.fake.objects.has(OLD_AVATAR)).toBe(false);
    expect(t.fake.keys('avatars/')).toHaveLength(2); // một của u1, một của u2

    // xóa ảnh
    const d = await call(t, 'delete', '/me/avatar', { cookie: u2.cookie });
    expect([d.status, d.text]).toEqual([204, '']);
    expect(await avatarOf(u2.id)).toBeNull();
    expect(t.fake.keys('avatars/')).toHaveLength(1);
  });

  it('USR-TC-20261006-102053569: job usr.sweep-orphan-avatars xóa khóa quá 24 giờ không còn được tham chiếu, qua nhiều trang list', async () => {
    const u1 = await withAvatar(); // OLD_AVATAR đang được dùng (và đã quá 24 giờ sau khi lùi đồng hồ)
    const hour = 3600_000, now = t.clock.now().getTime();
    const orphan = (n: number) => `avatars/22222222-2222-4222-8222-${String(n).padStart(12, '0')}.webp`;
    for (let n = 1; n <= 5; n++) t.fake.seed(orphan(n), Buffer.from('x'), new Date(now - 30 * hour)); // mồ côi quá 24 giờ
    t.fake.seed(orphan(6), Buffer.from('x'), new Date(now - 23 * hour)); // mồ côi nhưng còn mới: có thể đang ghi dở (ADR-018)
    t.fake.seed('avatars/readme.txt', Buffer.from('x'), new Date(now - 90 * hour)); // không phải khóa của USR: không đụng
    t.fake.objects.get(OLD_AVATAR)!.lastModified = new Date(now - 90 * hour);
    t.fake.pageSize = 2;
    expect(await t.jobs.runOnce('usr.sweep-orphan-avatars')).toBe('ran');
    expect(t.fake.keys('avatars/')).toEqual([OLD_AVATAR, orphan(6), 'avatars/readme.txt'].sort());
    expect(t.fake.requests.filter((x) => x.method === 'GET' && x.query['list-type'] === '2').length).toBeGreaterThan(2); // đã đi qua các trang
    expect(await avatarOf(u1.id)).toBeTruthy();
    expect(await t.jobs.runOnce('usr.sweep-orphan-avatars')).toBe('ran'); // idempotent
    expect(t.fake.keys('avatars/')).toHaveLength(3);
  });

  // review USR (HIGH-ish, mất dữ liệu): đổi STORAGE_PUBLIC_BASE_URL (thêm CDN) làm mọi avatar_url cũ không ánh xạ được về khóa; trước đây job coi tất cả là mồ côi và xóa hết ảnh đang dùng.
  it('review USR (USR-TC-20261006-102053569): đổi gốc URL công khai của kho thì job quét báo lỗi và KHÔNG xóa ảnh đang được dùng', async () => {
    const u1 = await withAvatar();
    t.fake.objects.get(OLD_AVATAR)!.lastModified = new Date(t.clock.now().getTime() - 90 * 3600_000); // quá 24 giờ
    const svc = t.avatarSvc as unknown as { storage: S3Storage };
    const real = svc.storage;
    svc.storage = new S3Storage({ endpoint: t.fake.url, bucket: t.fake.bucket, region: 'us-east-1', accessKey: t.fake.accessKey, secretKey: t.fake.secretKey, publicBase: 'https://cdn.example.test' });
    try {
      expect(await t.jobs.runOnce('usr.sweep-orphan-avatars')).toBe('failed');
      expect(t.fake.keys('avatars/')).toEqual([OLD_AVATAR]);
      expect(t.fake.requests.filter((x) => x.method === 'DELETE')).toHaveLength(0);
      expect(await avatarOf(u1.id)).toBeTruthy();
    } finally { svc.storage = real; }
  });

  it('USR-TC-20261006-102053594: tệp giả làm ảnh bị từ chối theo magic bytes; form sai là bad_form; tệp 0 byte là corrupt', async () => {
    const u1 = await withAvatar();
    const before = t.fake.keys();
    for (const [name, content] of [['evil.png', php()], ['anim.gif', gif()], ['x.svg', svgWithScript()]] as const) {
      const r = await upload(t, u1.cookie, content, { filename: name });
      expect([name, r.status, r.body.type, r.body.reason]).toEqual([name, 400, 'urn:ecom:error:image-invalid', 'unsupported_type']);
      expect(r.text).not.toContain(name); // không lặp tên tệp của client
    }
    expect(await avatarOf(u1.id)).toBe(`${t.fake.url}/${t.fake.bucket}/${OLD_AVATAR}`);
    expect(t.fake.keys()).toEqual(before);

    const jpg = await jpegWithExif(64, 64);
    expect((await upload(t, u1.cookie, null, { extraField: true })).body.reason).toBe('bad_form'); // chỉ có phần `note`
    expect((await upload(t, u1.cookie, jpg, { secondFile: jpg })).body.reason).toBe('bad_form'); // hai phần `file`
    expect((await upload(t, u1.cookie, jpg, { extraField: true })).body.reason).toBe('bad_form'); // thừa phần khác
    expect((await upload(t, u1.cookie, jpg, { field: 'avatar' })).body.reason).toBe('bad_form'); // sai tên phần
    const empty = await upload(t, u1.cookie, Buffer.alloc(0));
    expect([empty.status, empty.body.reason]).toEqual([400, 'corrupt']);
    expect(t.fake.keys()).toEqual(before);
    expect((await upload(t, u1.cookie, jpg, { filename: 'virus.exe' })).status).toBe(200); // tên tệp và đuôi không ảnh hưởng
  });

  it('USR-TC-20261006-102053618: tệp quá lớn, ảnh cụt và bom giải nén bị chặn trước khi tốn tài nguyên', async () => {
    const u1 = await userWithSession(t, { email: 'u1@shop.vn' });
    const jpg = await jpegWithExif(64, 64);
    const bytesRead = () => t.logs.records.filter((l) => l.msg?.includes('ảnh đại diện bị từ chối')).map((l) => l.bytes_read as number);

    const over = await upload(t, u1.cookie, padJpeg(jpg, LIMIT + 1)); // vượt đúng một byte
    expect([over.status, over.body.reason]).toEqual([400, 'too_large']);
    expect(bytesRead().at(-1)).toBeLessThanOrEqual(LIMIT + 64 * 1024);

    t.logs.clear();
    const huge = await upload(t, u1.cookie, padJpeg(jpg, 3_500_000)); // thân lớn hơn nhiều: server dừng đọc, không đọc hết
    expect([huge.status, huge.body.reason]).toEqual([400, 'too_large']);
    expect(bytesRead().at(-1)).toBeLessThanOrEqual(LIMIT + 64 * 1024);
    expect(t.fake.keys()).toEqual([]);

    const cut = await upload(t, u1.cookie, jpg.subarray(0, Math.floor(jpg.length * 0.4)));
    expect([cut.status, cut.body.reason]).toEqual([400, 'corrupt']);
    // dữ liệu thừa sau phần kết thúc của định dạng cũng bị từ chối (BR4): ảnh hợp lệ cộng thêm vài byte
    for (const [name, img] of [['png', await png(40, 40)], ['jpeg', jpg], ['webp', await webp(40, 40)]] as const) {
      const extra = await upload(t, u1.cookie, Buffer.concat([img, Buffer.from('<?php echo 1;')]));
      expect([name, extra.status, extra.body.reason]).toEqual([name, 400, 'corrupt']);
    }
    await upload(t, u1.cookie, jpg); // khởi động lạnh bộ xử lý ảnh trước khi đo bộ nhớ
    if (global.gc) global.gc();
    const rssBefore = process.memoryUsage().rss;
    const bomb = await upload(t, u1.cookie, pngClaiming(20000, 20000)); // 400 triệu điểm ảnh khai trong tiêu đề
    const grown = process.memoryUsage().rss - rssBefore;
    expect([bomb.status, bomb.body.reason]).toEqual([400, 'dimensions_exceeded']);
    expect(grown).toBeLessThan(50 * 1024 * 1024); // không cấp bộ nhớ theo kích thước khai báo
    expect(pngClaiming(20000, 20000).length).toBeLessThan(200);
    expect(t.fake.keys('avatars/')).toHaveLength(1); // chỉ ảnh hợp lệ ở bước khởi động
  });

  it('USR-TC-20261006-102053618: xử lý ảnh quá hạn thì từ chối, ảnh hiện có không đổi', async () => {
    const slow = await createUsrApp({ env: { USR_AVATAR_PROCESS_TIMEOUT_MS: '100' } });
    try {
      const u = await userWithSession(slow, { email: 'slow@shop.vn' });
      slow.avatarSvc.process = () => new Promise((resolve) => setTimeout(() => resolve(Buffer.from('x')), 1500));
      const r = await upload(slow, u.cookie, await jpegWithExif(32, 32));
      expect([r.status, r.body.type, r.body.reason]).toEqual([400, 'urn:ecom:error:image-invalid', 'corrupt']);
      expect(slow.fake.keys()).toEqual([]);
    } finally { await slow.close(); }
  });

  it('USR-TC-20261006-102053643: tải ảnh thiếu phiên hoặc thiếu CSRF; ngoại lệ multipart chỉ ở endpoint này', async () => {
    const u1 = await withAvatar();
    const jpg = await jpegWithExif(64, 64);
    const before = t.fake.keys();
    expect((await upload(t, undefined, jpg)).status).toBe(401);
    for (const origin of ['https://evil.example', null]) {
      for (const r of [await upload(t, u1.cookie, jpg, { origin }), await call(t, 'delete', '/me/avatar', { cookie: u1.cookie, origin })]) {
        expect([String(origin), r.status, r.body.type]).toEqual([String(origin), 403, 'urn:ecom:error:csrf_failed']);
      }
    }
    expect(t.fake.keys()).toEqual(before);
    expect(await avatarOf(u1.id)).toBe(`${t.fake.url}/${t.fake.bucket}/${OLD_AVATAR}`);
    // kiểu nội dung khác multipart vẫn 415 (text/plain), multipart ở route khác vẫn 415, JSON vào endpoint ảnh là bad_form
    expect((await http(t).put('/api/v1/me/avatar').set('Cookie', u1.cookie).set('Origin', ORIGIN).set('Content-Type', 'text/plain').send('abc')).status).toBe(415);
    const other = await http(t).patch('/api/v1/me').set('Cookie', u1.cookie).set('Origin', ORIGIN).attach('file', jpg, { filename: 'a.jpg' });
    expect(other.status).toBe(415);
    const asJson = await call(t, 'put', '/me/avatar', { cookie: u1.cookie, body: { file: 'x' } }); // JSON vào endpoint ảnh: thân không phải form tệp, bị schema đóng từ chối
    expect([asJson.status, asJson.body.type]).toEqual([400, 'urn:ecom:error:validation-failed']);
  });

  it('USR-TC-20261006-102053668: tệp đúng 2 MiB, tệp sai đuôi và WebP động đều thành WebP tĩnh 512x512', async () => {
    const u1 = await userWithSession(t, { email: 'u1@shop.vn' });
    const jpg = await jpegWithExif(64, 64);
    const exact = padJpeg(jpg, LIMIT);
    expect(exact.length).toBe(LIMIT);
    expect((await upload(t, u1.cookie, exact)).status).toBe(200);

    const r1 = await upload(t, u1.cookie, jpg, { filename: 'photo.png' });
    expect(r1.status).toBe(200);
    const m1 = await sharp(stored(r1.body.avatar_url).body).metadata();
    expect([m1.format, m1.width, m1.height]).toEqual(['webp', 512, 512]);

    const anim = await animatedWebp(12);
    expect((await sharp(anim, { pages: -1 }).metadata()).pages).toBe(12); // fixture thật sự động
    const r2 = await upload(t, u1.cookie, anim, { filename: 'a.webp' });
    expect(r2.status).toBe(200);
    const out = stored(r2.body.avatar_url).body;
    const m2 = await sharp(out, { pages: -1 }).metadata();
    expect([m2.format, m2.width, m2.height, m2.pages ?? 1]).toEqual(['webp', 512, 512, 1]);
    const px = await sharp(out).raw().toBuffer({ resolveWithObject: true });
    const mid = ((px.info.height >> 1) * px.info.width + (px.info.width >> 1)) * px.info.channels;
    expect([px.data[mid] > 200, px.data[mid + 1] < 60]).toEqual([true, true]); // khung đầu (đỏ), không phải các khung sau (xanh lá)
  });

  it('USR-TC-20261006-102053694: tải thứ 11 trong một cửa sổ cố định 60 phút bị 429; mở lại khi sang cửa sổ mới (ADR-014)', async () => {
    const u1 = await userWithSession(t, { email: 'u1@shop.vn' });
    const small = await png(40, 40);
    let last = '';
    for (let i = 1; i <= 10; i++) {
      const r = await upload(t, u1.cookie, small);
      if (r.status !== 200) throw new Error(`lần ${i}: ${r.status} ${r.text}`);
      last = r.body.avatar_url;
    }
    const r11 = await upload(t, u1.cookie, small);
    expect(r11.status).toBe(429);
    expect(Number(r11.headers['retry-after'])).toBeGreaterThan(0);
    expect(await avatarOf(u1.id)).toBe(last);
    expect(t.fake.keys('avatars/')).toHaveLength(1);
    t.clock.advance(61 * 60_000); // cửa sổ cố định bắt đầu từ lần tải đầu: qua 60 phút là cửa sổ mới, bộ đếm về 0
    const fresh = await seedSession(t, u1.id); // phiên cũ đã quá hạn trượt khi đồng hồ lùi 61 phút
    expect((await upload(t, fresh.cookie, small)).status).toBe(200);
  });

  it('USR-TC-20261006-102053718: xóa ảnh khi chưa có thì vẫn 204; lỗi storage khi ghi không đổi ảnh cũ', async () => {
    const u0 = await userWithSession(t, { email: 'u0@shop.vn' });
    expect((await call(t, 'delete', '/me/avatar', { cookie: u0.cookie })).status).toBe(204);
    expect((await call(t, 'delete', '/me/avatar', { cookie: u0.cookie })).status).toBe(204);

    const u1 = await withAvatar();
    t.fake.failPut = 500;
    const r = await upload(t, u1.cookie, await jpegWithExif(64, 64));
    expect(r.status).toBeGreaterThanOrEqual(500);
    expect(r.headers['content-type']).toContain('application/problem+json');
    expect(await avatarOf(u1.id)).toBe(`${t.fake.url}/${t.fake.bucket}/${OLD_AVATAR}`);
    expect(t.fake.objects.has(OLD_AVATAR)).toBe(true);
    t.fake.failPut = null;
    t.fake.failDelete = 500; // xóa ảnh cũ lỗi không làm hỏng request (BR5): ảnh mồ côi để job quét
    const ok = await upload(t, u1.cookie, await jpegWithExif(64, 64));
    expect(ok.status).toBe(200);
    expect(t.fake.objects.has(OLD_AVATAR)).toBe(true);
  });
});
