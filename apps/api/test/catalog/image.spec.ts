import sharp from 'sharp';
import { truncateAll } from '../support/db';
import { auditOf, call, count, createPrdApp, seedCategory, seedProduct, uploadImage, who, type PrdApp, type Who } from '../support/prd';
import { q } from '../support/auth';
import { S3Storage } from '../../src/modules/platform';
import { jpegWithExif, padJpeg, php, png, pngClaiming, svgWithScript, webp } from '../support/images';

const MB5 = 5_242_880;
const KEY = /^products\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png|webp)$/;

describe('PRD ảnh sản phẩm: tải lên, sắp xếp, xóa, dọn ảnh mồ côi (PRD-REQ-20261006-095502592)', () => {
  let t: PrdApp;
  let admin: Who, staff: Who, cat: string;
  beforeAll(async () => { t = await createPrdApp(); });
  afterAll(() => t.close());
  beforeEach(async () => {
    await truncateAll(t.prisma); t.fake.reset(); t.logs.clear();
    [admin, staff] = [await who(t, 'admin'), await who(t, 'staff')];
    cat = await seedCategory(t, 'Áo');
  });
  const up = (id: string, file: Buffer | null, o: { cookie?: string | null; filename?: string } = {}) => uploadImage(t, o.cookie === null ? undefined : (o.cookie ?? admin.cookie), id, file, { filename: o.filename });
  const detail = async (id: string) => (await call(t, 'get', `/admin/products/${id}`, { cookie: admin.cookie })).body;
  const keyOf = (url: string) => url.slice(url.indexOf('/products/') + 1);

  it('PRD-TC-20261006-100355666: admin tải JPEG 800 KB (khóa ngẫu nhiên không chứa tên tệp, đã re-encode, vị trí 1), rồi đổi thứ tự [C, A, B]: ảnh đại diện là C; audit từng thao tác', async () => {
    const id = await seedProduct(t, { category: cat, status: 'draft' });
    const input = padJpeg(await jpegWithExif(640, 480), 800 * 1024);
    const r = await up(id, input, { filename: 'Ảnh gốc của khách.JPG' });
    expect(r.status).toBe(201);
    expect(r.body.position).toBe(1);
    const key = keyOf(r.body.url);
    expect(key).toMatch(KEY);
    expect(key).not.toMatch(/anh|goc|jpg.*jpg/i);
    const obj = t.fake.objects.get(key)!;
    expect(obj.contentType).toBe('image/jpeg');
    expect(obj.body.length).toBeLessThan(input.length); // đã xử lý lại, không phải bản gốc
    expect(obj.body.includes(Buffer.from('TestCam'))).toBe(false);
    const put = t.fake.requests.find((x) => x.method === 'PUT')!;
    expect([put.headers['x-content-type-options'], put.headers['cache-control']]).toEqual(['nosniff', 'public, max-age=300']);
    expect(JSON.stringify(t.logs.records)).not.toContain('Ảnh gốc');
    // ba ảnh [A, B, C] rồi đổi thứ tự
    const b = await up(id, await png(100, 80)), c = await up(id, await webp(90, 90));
    expect([b.body.position, c.body.position]).toEqual([2, 3]);
    expect(keyOf(b.body.url)).toMatch(/\.png$/); expect(keyOf(c.body.url)).toMatch(/\.webp$/); // giữ định dạng
    const [A, B, C] = [r.body.image_id, b.body.image_id, c.body.image_id];
    const o = await call(t, 'put', `/admin/products/${id}/images/order`, { cookie: admin.cookie, body: { image_ids: [C, A, B] } });
    expect(o.status).toBe(200);
    expect((await detail(id)).images.map((i: any) => i.id)).toEqual([C, A, B]);
    const list = (await call(t, 'get', '/admin/products', { cookie: admin.cookie })).body.items[0];
    expect(list.image_url).toBe(c.body.url);
    expect((await auditOf(t, 'catalog.product.image.add')).length).toBe(3);
    expect((await auditOf(t, 'catalog.product.image.reorder')).length).toBe(1);
    // danh sách thứ tự sai tập: thiếu, dư, trùng, id lạ
    for (const ids of [[C, A], [C, A, B, B], [C, A, '11111111-1111-4111-8111-111111111111'], [C, C, A]]) {
      expect([JSON.stringify(ids), (await call(t, 'put', `/admin/products/${id}/images/order`, { cookie: admin.cookie, body: { image_ids: ids } })).status]).toEqual([JSON.stringify(ids), 400]);
    }
    expect((await detail(id)).images.map((i: any) => i.id)).toEqual([C, A, B]);
    // xóa ảnh giữa: vị trí dồn lại, tệp bị xóa khỏi kho
    const del = await call(t, 'delete', `/admin/products/${id}/images/${A}`, { cookie: admin.cookie });
    expect(del.status).toBe(204);
    expect((await detail(id)).images.map((i: any) => [i.id, i.position])).toEqual([[C, 1], [B, 2]]);
    expect(t.fake.objects.has(key)).toBe(false);
  });

  it('PRD-TC-20261006-100355691: tải bị từ chối: sai nội dung (shell.php đổi tên), SVG, quá 5 MB, ảnh thứ 9, xóa ảnh cuối của sản phẩm đang bán, sai quyền; storage không có khóa mới', async () => {
    const draft = await seedProduct(t, { category: cat, status: 'draft' });
    const full = await seedProduct(t, { category: cat, status: 'draft', images: 8 });
    const one = await seedProduct(t, { category: cat, status: 'active', images: 1 });
    const arch = await seedProduct(t, { category: cat, status: 'archived', images: 1 });
    const keysBefore = t.fake.keys();
    const bad = async (file: Buffer, reason: string, filename = 'a.jpg') => {
      const r = await up(draft, file, { filename });
      expect([reason, r.status, r.body.type, r.body.reason]).toEqual([reason, 400, 'urn:ecom:error:image-invalid', reason]);
    };
    await bad(php(), 'unsupported_type', 'a.jpg');
    await bad(svgWithScript(), 'unsupported_type', 'a.svg');
    // 6 MB: máy chủ ngừng đọc ở giới hạn và đóng kết nối sau phản hồi (Connection: close, upload.ts) nên khách đang ghi dở có thể thấy EPIPE hay ECONNRESET trước thân 400 (cuộc đua TCP, chập chờn 1 trên 782 test ở lượt chạy review SHP);
    // lý do too_large kiểm chính xác ở PRD-TC-20261006-100355716 (5 MB cộng 1 byte, không đua).
    await bad(padJpeg(await jpegWithExif(64, 64), 6 * 1024 * 1024), 'too_large').catch((e: Error) => { if (!/EPIPE|ECONNRESET/.test(String(e?.message ?? e))) throw e; });
    await bad(Buffer.alloc(0), 'corrupt');
    const jpg = await jpegWithExif(200, 200);
    await bad(jpg.subarray(0, Math.floor(jpg.length * 0.4)), 'corrupt'); // ảnh cụt
    expect((await uploadImage(t, admin.cookie, draft, null)).status).toBe(400); // không có phần `file`
    expect((await uploadImage(t, admin.cookie, draft, jpg, { field: 'avatar' })).status).toBe(400); // sai tên phần
    expect(t.fake.keys()).toEqual(keysBefore);
    expect(await count(t, 'product_images', `product_id = '${draft}'`)).toBe(0);
    const ninth = await up(full, jpg);
    expect([ninth.status, ninth.body.type]).toEqual([409, 'urn:ecom:error:product-image-limit']);
    expect(t.fake.keys()).toEqual(keysBefore); // ảnh thứ 9 chưa chạm kho
    const [last] = (await detail(one)).images;
    const del = await call(t, 'delete', `/admin/products/${one}/images/${last.id}`, { cookie: admin.cookie });
    expect([del.status, del.body.type]).toEqual([409, 'urn:ecom:error:product-last-image']);
    expect(await count(t, 'product_images', `product_id = '${one}'`)).toBe(1);
    expect(t.fake.objects.has(keyOf(last.url))).toBe(true);
    expect((await up(draft, jpg, { cookie: staff.cookie })).status).toBe(403);
    expect((await up(draft, jpg, { cookie: null })).status).toBe(401);
    expect((await up('abc', jpg)).status).toBe(404);
    expect((await up('11111111-1111-4111-8111-111111111111', jpg)).status).toBe(404);
    expect((await up(arch, jpg)).body.type).toBe('urn:ecom:error:product-archived');
    expect(t.fake.keys()).toEqual(keysBefore);
    // ảnh cuối của bản nháp xóa được; xóa ảnh không thuộc sản phẩm hay id lạ là 404
    const d2 = await seedProduct(t, { category: cat, status: 'draft', images: 1 });
    const [img] = (await detail(d2)).images;
    expect((await call(t, 'delete', `/admin/products/${d2}/images/${last.id}`, { cookie: admin.cookie })).status).toBe(404);
    expect((await call(t, 'delete', `/admin/products/${d2}/images/abc`, { cookie: admin.cookie })).status).toBe(404);
    expect((await call(t, 'delete', `/admin/products/${d2}/images/${img.id}`, { cookie: staff.cookie })).status).toBe(403);
    expect((await call(t, 'delete', `/admin/products/${d2}/images/${img.id}`, { cookie: admin.cookie })).status).toBe(204);
    // storage lỗi: 503, không có dòng ảnh
    t.fake.failPut = 500;
    const fail = await up(draft, jpg);
    expect([fail.status, fail.body.type]).toEqual([503, 'urn:ecom:error:service-unavailable']);
    expect(await count(t, 'product_images', `product_id = '${draft}'`)).toBe(0);
  });

  it('PRD-TC-20261006-100355716: tệp đúng 5 MB nhận, 5 MB cộng 1 byte bị 400 (dừng đọc không quá 5 MB + 64 KB); xóa rồi tải lại khi có 8 ảnh; EXIF GPS bị bỏ', async () => {
    const id = await seedProduct(t, { category: cat, status: 'draft' });
    const jpg = await jpegWithExif(160, 90);
    const exact = padJpeg(jpg, MB5);
    expect(exact.length).toBe(MB5);
    expect((await up(id, exact)).status).toBe(201);
    t.logs.clear();
    const over = await up(id, padJpeg(jpg, MB5 + 1));
    expect([over.status, over.body.reason]).toEqual([400, 'too_large']);
    const read = t.logs.records.filter((l) => l.msg?.includes('ảnh sản phẩm bị từ chối')).map((l) => l.bytes_read as number);
    expect(read.at(-1)).toBeLessThanOrEqual(MB5 + 64 * 1024);
    expect(await count(t, 'product_images', `product_id = '${id}'`)).toBe(1);
    // EXIF GPS không còn trong ảnh đã lưu
    const stored = t.fake.objects.get(keyOf((await detail(id)).images[0].url))!;
    const meta = await sharp(stored.body).metadata();
    expect(meta.exif).toBeUndefined();
    for (const tag of ['Exif', 'TestCam', 'GPS']) expect([tag, stored.body.includes(Buffer.from(tag))]).toEqual([tag, false]);
    // 8 ảnh: ảnh thứ 9 bị chặn; xóa 1 rồi tải 1 thì còn 8
    const eight = await seedProduct(t, { category: cat, status: 'draft', images: 8 });
    expect((await up(eight, jpg)).status).toBe(409);
    const [first] = (await detail(eight)).images;
    expect((await call(t, 'delete', `/admin/products/${eight}/images/${first.id}`, { cookie: admin.cookie })).status).toBe(204);
    expect((await up(eight, jpg)).status).toBe(201);
    expect((await detail(eight)).images.map((i: any) => i.position)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    // đua: hai tải song song vào sản phẩm còn 7 ảnh, chỉ một thắng
    const seven = await seedProduct(t, { category: cat, status: 'draft', images: 7 });
    const [a, b] = await Promise.all([up(seven, jpg), up(seven, jpg)]);
    expect([a.status, b.status].sort()).toEqual([201, 409]);
    expect(await count(t, 'product_images', `product_id = '${seven}'`)).toBe(8);
    expect(t.fake.keys('products/').length).toBe(await count(t, 'product_images')); // ảnh thua cuộc đã bị xóa khỏi kho
  }, 60_000);

  it('PRD-TC-20261006-120604408: PNG 30 megapixel bị 400 image-invalid trước khi giải mã đầy đủ (không lưu gì, bộ nhớ không tăng đột biến); 25 megapixel nhận, cạnh dài không quá 1600', async () => {
    const id = await seedProduct(t, { category: cat, status: 'draft' });
    const big = await sharp({ create: { width: 6000, height: 5000, channels: 3, background: '#336699' } }).png().toBuffer();
    expect(big.length).toBeLessThan(MB5);
    await up(id, await jpegWithExif(32, 32)); // khởi động lạnh bộ xử lý ảnh trước khi đo bộ nhớ
    const keys = t.fake.keys(), rows = await count(t, 'product_images');
    if (global.gc) global.gc();
    const rssBefore = process.memoryUsage().rss;
    const r = await up(id, big);
    const bomb = await up(id, pngClaiming(20000, 20000)); // 400 triệu điểm ảnh khai trong tiêu đề
    const grown = process.memoryUsage().rss - rssBefore;
    expect([r.status, r.body.type, r.body.reason]).toEqual([400, 'urn:ecom:error:image-invalid', 'dimensions_exceeded']);
    expect([bomb.status, bomb.body.reason]).toEqual([400, 'dimensions_exceeded']);
    expect(grown).toBeLessThan(80 * 1024 * 1024); // không cấp bộ nhớ theo kích thước khai báo
    expect(t.fake.keys()).toEqual(keys);
    expect(await count(t, 'product_images')).toBe(rows);
    const edge = await sharp({ create: { width: 5000, height: 5000, channels: 3, background: '#993366' } }).png().toBuffer(); // đúng 25 megapixel
    const ok = await up(id, edge);
    expect(ok.status).toBe(201);
    const [row] = await q<{ width: number; height: number; bytes: number; content_type: string }>(t, `SELECT width, height, bytes, content_type FROM product_images WHERE id = '${ok.body.image_id}'`);
    expect([row.width, row.height, row.content_type]).toEqual([1600, 1600, 'png']);
    expect(row.bytes).toBe(t.fake.objects.get(keyOf(ok.body.url))!.body.length);
    const wide = await up(id, await sharp({ create: { width: 3200, height: 800, channels: 3, background: '#000' } }).jpeg().toBuffer());
    expect((await q<{ width: number; height: number }>(t, `SELECT width, height FROM product_images WHERE id = '${wide.body.image_id}'`))[0]).toEqual({ width: 1600, height: 400 });
  }, 60_000);

  describe('job prd.sweep-orphan-images (ADR-013, ADR-018; đóng khi không chắc, bài học L52). TC PRD-TC-20261007-104006678 (xóa đúng, lô 500) và PRD-TC-20261007-104007745 (đóng khi không chắc), PRD-SEC T7', () => {
    const DAY = 24 * 3600_000;
    const old = (key: string, ageMs = 2 * DAY) => t.fake.seed(key, Buffer.from('x'), new Date(t.clock.now().getTime() - ageMs));
    const deletes = () => t.fake.requests.filter((r) => r.method === 'DELETE').length;

    it('PRD-TC-20261007-104006678: xóa ảnh mồ côi quá 24 giờ, giữ ảnh đang dùng, ảnh còn mới và khóa lạ; chạy lại không xóa thêm', async () => {
      const p = await seedProduct(t, { category: cat, images: 2 }); // 2 ảnh đang dùng, mới
      const used = t.fake.keys('products/');
      await q(t, `UPDATE product_images SET storage_key = storage_key WHERE product_id = '${p}'`);
      old('products/11111111-1111-4111-8111-111111111111.jpg'); // mồ côi cũ
      old('products/22222222-2222-4222-8222-222222222222.webp', DAY + 1000); // vừa quá 24 giờ
      old('products/33333333-3333-4333-8333-333333333333.png', DAY - 60_000); // chưa đủ 24 giờ
      old('products/not-ours.txt'); // khóa không do PRD sinh
      old('avatars/44444444-4444-4444-8444-444444444444.webp'); // của USR
      for (const k of used) old(k, 5 * DAY); // ảnh đang dùng dù cũ
      expect(await t.images.sweepOrphans()).toBe(2);
      expect(t.fake.keys().sort()).toEqual([...used, 'products/33333333-3333-4333-8333-333333333333.png', 'products/not-ours.txt', 'avatars/44444444-4444-4444-8444-444444444444.webp'].sort());
      expect(await t.images.sweepOrphans()).toBe(0);
    });

    it('PRD-TC-20261007-104006678: (PRD-DB mục 13) mỗi lượt xóa tối đa 500 ảnh mồ côi (giới hạn lô), lượt sau xóa nốt; ảnh đang dùng không bị đụng', async () => {
      const p = await seedProduct(t, { category: cat, images: 1 });
      const used = t.fake.keys('products/');
      for (const k of used) old(k, 5 * DAY);
      for (let i = 0; i < 502; i++) old(`products/${crypto.randomUUID()}.jpg`);
      expect(await t.images.sweepOrphans()).toBe(500);
      expect(deletes()).toBe(500);
      expect(await t.images.sweepOrphans()).toBe(2);
      expect(t.fake.keys('products/')).toEqual(used);
      expect(await count(t, 'product_images', `product_id = '${p}'`)).toBe(1);
    });

    it('PRD-TC-20261007-104007745: nguồn tham chiếu rỗng hay lỗi thì job dừng và báo lỗi, không có lệnh xóa nào (không mất ảnh đang dùng)', async () => {
      old('products/11111111-1111-4111-8111-111111111111.jpg');
      old('products/22222222-2222-4222-8222-222222222222.jpg');
      // bảng product_images rỗng (sai CSDL, bị làm rỗng) mà kho có ảnh cũ: không biết ảnh nào còn dùng thì không xóa gì
      await expect(t.images.sweepOrphans()).rejects.toThrow(/dừng/);
      expect(deletes()).toBe(0);
      expect(t.fake.keys('products/')).toHaveLength(2);
      // CSDL lỗi giữa chừng: job ném lỗi, không xóa
      const spy = jest.spyOn(t.prisma, '$queryRaw').mockRejectedValue(new Error('db down'));
      try { await expect(t.images.sweepOrphans()).rejects.toThrow('db down'); } finally { spy.mockRestore(); }
      expect(deletes()).toBe(0);
      // kho lỗi khi liệt kê
      t.fake.pageSize = 1; t.fake.failDelete = 500;
      await seedProduct(t, { category: cat, images: 1 });
      await expect(t.images.sweepOrphans()).rejects.toThrow(/storage DELETE 500/);
    });

    it('PRD-TC-20261007-104007745: đổi STORAGE_PUBLIC_BASE_URL (thêm CDN) thì job vẫn dùng khóa trong bảng: không xóa ảnh đang dùng, chỉ xóa mồ côi thật', async () => {
      await seedProduct(t, { category: cat, images: 2 });
      const used = t.fake.keys('products/');
      for (const k of used) old(k, 5 * DAY);
      const orphan = 'products/11111111-1111-4111-8111-111111111111.jpg';
      old(orphan);
      const svc = t.images as unknown as { storage: S3Storage };
      const real = svc.storage;
      svc.storage = new S3Storage({ endpoint: t.fake.url, bucket: t.fake.bucket, region: 'us-east-1', accessKey: t.fake.accessKey, secretKey: t.fake.secretKey, publicBase: 'https://cdn.example.test' });
      try {
        expect(await t.images.sweepOrphans()).toBe(1); // chỉ mồ côi thật; ảnh đang dùng (URL cũ không còn khớp gốc mới) vẫn còn
        expect(t.fake.keys('products/')).toEqual(used);
        expect(await t.images.sweepOrphans()).toBe(0);
        expect(deletes()).toBe(1);
      } finally { svc.storage = real; }
    });
  });
});
