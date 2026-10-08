import sharp from 'sharp';
import { S3Storage } from '../../src/modules/platform';
import { truncateAll } from '../support/db';
import { createPrdApp, seedCategory, seedProduct, uploadImage, who, call, type PrdApp } from '../support/prd';
import { describeRealS3, purgeKeys, waitForBucket, type S3Cfg } from '../support/real-s3';
import { jpegWithExif } from '../support/images';

// Bằng chứng trên kho S3 THẬT (MinIO của docker compose) cho ảnh sản phẩm: bật bằng STORAGE_TEST_ENDPOINT, không thì bỏ qua và nói rõ lý do (describeRealS3).
describeRealS3('PRD ảnh sản phẩm trên MinIO thật', (cfg: S3Cfg) => {
  let t: PrdApp;
  let direct: S3Storage;
  beforeAll(async () => { direct = await waitForBucket(cfg); t = await createPrdApp({ s3: cfg }); });
  afterAll(async () => { await purgeKeys(direct, ['products/']); await t.close(); });
  beforeEach(async () => { await truncateAll(t.prisma); await purgeKeys(direct, ['products/']); });

  it('PRD-TC-20261006-100355666: tải JPEG có EXIF qua API lưu đúng loại và cache ngắn ở kho thật, URL công khai đọc không chữ ký, xóa ảnh thì 404; job dọn xóa ảnh mồ côi quá 24 giờ', async () => {
    const admin = await who(t, 'admin');
    const cat = await seedCategory(t, 'Áo');
    const p = await seedProduct(t, { category: cat, status: 'draft' });
    const r = await uploadImage(t, admin.cookie, p, await jpegWithExif(640, 480));
    expect(r.status).toBe(201);
    expect(r.body.url).toMatch(/^http.*\/products\/[0-9a-f-]{36}\.jpg$/);
    const got = await fetch(r.body.url);
    expect([got.status, got.headers.get('content-type'), got.headers.get('cache-control')]).toEqual([200, 'image/jpeg', 'public, max-age=300']);
    const body = Buffer.from(await got.arrayBuffer());
    const meta = await sharp(body).metadata();
    expect([meta.format, meta.exif]).toEqual(['jpeg', undefined]);
    expect(body.includes(Buffer.from('TestCam'))).toBe(false);
    expect((await call(t, 'delete', `/admin/products/${p}/images/${r.body.image_id}`, { cookie: admin.cookie })).status).toBe(204);
    expect((await fetch(r.body.url)).status).toBe(404);
    // mồ côi: PUT qua kho thật rồi job quét với đồng hồ tiến 25 giờ (LastModified của kho thật là giờ thật)
    const keep = await seedProduct(t, { category: cat, status: 'draft' });
    expect((await uploadImage(t, admin.cookie, keep, await jpegWithExif(64, 64))).status).toBe(201);
    await direct.put('products/11111111-1111-4111-8111-111111111111.jpg', Buffer.from('x'), { contentType: 'image/jpeg' });
    t.clock.set(new Date(Date.now() + 25 * 3600_000));
    expect(await t.images.sweepOrphans()).toBe(1);
    expect((await direct.list('products/')).map((o) => o.key)).toHaveLength(1);
  });
});
