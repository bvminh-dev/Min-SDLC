import sharp from 'sharp';
import { S3Storage } from '../../src/modules/platform';
import { truncateAll } from '../support/db';
import { jpegWithExif } from '../support/images';
import { createReview, createRevApp, eligible, imageRows, seedImageRow, uploadImage, world, call, type RevApp, type World } from '../support/rev';
import { describeRealS3, purgeKeys, waitForBucket, type S3Cfg } from '../support/real-s3';

// Bằng chứng trên kho S3 THẬT (MinIO của docker compose) cho ảnh đánh giá: bật bằng STORAGE_TEST_ENDPOINT, không thì bỏ qua và nói rõ lý do (describeRealS3).
describeRealS3('REV ảnh đánh giá trên MinIO thật', (cfg: S3Cfg) => {
  let t: RevApp, w: World;
  let direct: S3Storage;
  beforeAll(async () => { direct = await waitForBucket(cfg); t = await createRevApp({ s3: cfg, env: { REVIEW_PRE_MODERATION: 'false' } }); });
  afterAll(async () => { await purgeKeys(direct, ['reviews/']); await t.close(); });
  beforeEach(async () => { await truncateAll(t.prisma); await purgeKeys(direct, ['reviews/']); t.clock.set(new Date(Math.floor(Date.now() / 1000) * 1000)); w = await world(t); });

  it('REV-TC-20261006-104524858: JPEG có EXIF GPS tải qua API thành WebP không metadata ở kho thật, URL công khai đọc không chữ ký (đúng loại, cache ngắn), hiện ở danh sách công khai; job dọn xóa ảnh mồ côi quá 24 giờ khỏi kho thật', async () => {
    const big = await sharp({ create: { width: 3000, height: 2000, channels: 3, background: '#4488cc' } }).jpeg().withExif({ IFD0: { Make: 'TestCam' }, IFD3: { GPSLatitudeRef: 'N', GPSLatitude: '10/1 46/1 997/100' } }).toBuffer();
    const r = await uploadImage(t, w.a.cookie, big);
    expect([r.status, r.body.width, r.body.height]).toEqual([201, 1600, 1067]);
    expect(r.body.url).toMatch(/^http.*\/reviews\/[0-9a-f-]{36}\.webp$/);
    const got = await fetch(r.body.url);
    expect([got.status, got.headers.get('content-type'), got.headers.get('cache-control')]).toEqual([200, 'image/webp', 'public, max-age=300']);
    const body = Buffer.from(await got.arrayBuffer());
    const meta = await sharp(body).metadata();
    expect([meta.format, meta.exif, meta.width, meta.height]).toEqual(['webp', undefined, 1600, 1067]);
    expect(body.includes(Buffer.from('TestCam'))).toBe(false);
    await eligible(t, w.a, w.p1);
    const rev = await createReview(t, w.a.cookie, w.p1, { rating: 5, image_ids: [r.body.image_id] });
    expect([rev.status, rev.body.status, rev.body.images[0].url]).toEqual([201, 'published', r.body.url]);
    expect((await call(t, 'get', `/products/${w.p1}/reviews`)).body.items[0].images[0]).toEqual({ url: r.body.url, width: 1600, height: 1067 });
    // mồ côi: ảnh chưa gắn quá 24 giờ (giờ giả tiến 25 giờ; LastModified của kho thật là giờ thật nên job dọn theo cột của CSDL)
    const small = await uploadImage(t, w.a.cookie, await jpegWithExif(64, 64));
    expect(small.status).toBe(201);
    t.clock.set(new Date(Date.now() + 25 * 3600_000));
    const gone = await seedImageRow(t, w.a.id, null, null, 30 * 3600_000, { noObject: true });
    await direct.put((await imageRows(t, `id = '${gone.id}'`))[0].storage_key, Buffer.from('x'), { contentType: 'image/webp' });
    expect(await t.images.sweep({ now: t.clock.now() })).toEqual({ removed: 2, failed: 0 });
    expect((await direct.list('reviews/')).map((o) => o.key)).toHaveLength(1); // chỉ còn ảnh đã gắn vào đánh giá
    expect((await fetch(small.body.url)).status).toBe(404);
    expect((await fetch(r.body.url)).status).toBe(200);
  });
});
