import sharp from 'sharp';
import { truncateAll } from '../support/db';
import { gif, jpegWithExif, padJpeg, php, png, pngClaiming, svgWithScript, webp } from '../support/images';
import { freshClock, createReview, createRevApp, eligible, failingTrigger, imageRows, padPng, q, revCount, seedImageRow, seedProduct, seedOrderItem, seedReview, snapshot, uploadImage, world, call, type RevApp, type World } from '../support/rev';

const SEC = 'REV-SEC-20261006-103618395';
const MAX = 5_242_880;

describe('REV ảnh đính kèm (REV-REQ-20261006-103135207)', () => {
  let t: RevApp, w: World;
  beforeAll(async () => { t = await createRevApp(); });
  afterAll(() => t.close());
  beforeEach(async () => { await truncateAll(t.prisma); t.fake.reset(); t.logs.clear(); jest.restoreAllMocks(); freshClock(t); w = await world(t); });
  const stored = (url: string) => t.fake.objects.get(url.slice(url.indexOf('reviews/')))!;
  const upload = async (file: Buffer) => { const r = await uploadImage(t, w.a.cookie, file); expect([r.status, r.text.slice(0, 200)]).toEqual([201, expect.anything()]); return r.body as { image_id: string; url: string; width: number; height: number }; };

  it(`REV-TC-20261006-104524858 ${SEC} T8, T10: tải JPEG lớn có EXIF GPS thành WebP 1600 x 1067 không còn metadata`, async () => {
    const big = await sharp({ create: { width: 3000, height: 2000, channels: 3, background: '#4488cc' } }).jpeg().withExif({ IFD0: { Make: 'TestCam', Model: 'T1' }, IFD3: { GPSLatitudeRef: 'N', GPSLatitude: '10/1 46/1 997/100', GPSLongitudeRef: 'E', GPSLongitude: '106/1 42/1 32/100' } }).toBuffer();
    expect((await sharp(big).metadata()).exif).toBeTruthy();
    const r = await uploadImage(t, w.a.cookie, big);
    expect(r.status).toBe(201);
    expect(r.body.image_id).toMatch(/^[0-9a-f-]{36}$/);
    expect(r.body.url).toMatch(/\/reviews\/[0-9a-f-]{36}\.webp$/);
    expect([r.body.width, r.body.height]).toEqual([1600, 1067]);
    const obj = stored(r.body.url);
    expect(obj.body.subarray(0, 4).toString('latin1')).toBe('RIFF');
    expect(obj.body.subarray(8, 12).toString('latin1')).toBe('WEBP');
    const m = await sharp(obj.body).metadata();
    expect([m.width, m.height, m.exif, m.icc, m.xmp]).toEqual([1600, 1067, undefined, undefined, undefined]);
    expect(obj.body.toString('latin1')).not.toMatch(/TestCam|GPS|Exif/);
    expect([obj.contentType, obj.headers['x-content-type-options'] ?? 'nosniff']).toEqual(['image/webp', 'nosniff']);
    const rows = await imageRows(t);
    expect(rows).toHaveLength(1);
    expect([rows[0].review_id, rows[0].position, rows[0].user_id, rows[0].width, rows[0].height, rows[0].bytes, rows[0].storage_key.startsWith('reviews/')]).toEqual([null, null, w.a.id, 1600, 1067, obj.body.length, true]);
    const small = await uploadImage(t, w.a.cookie, await webp(800, 600)); // ảnh nhỏ giữ nguyên kích thước (không phóng to)
    expect([small.body.width, small.body.height]).toEqual([800, 600]);
    const exif = await uploadImage(t, w.a.cookie, await jpegWithExif(160, 90));
    expect((await sharp(stored(exif.body.url).body).metadata()).exif).toBeUndefined();
  });

  it(`REV-TC-20261006-104524926 gắn ba ảnh theo thứ tự image_ids khi tạo đánh giá`, async () => {
    await eligible(t, w.a, w.p1);
    const [i1, i2, i3] = [await upload(await png(60, 40)), await upload(await png(61, 40)), await upload(await png(62, 40))];
    const r = await createReview(t, w.a.cookie, w.p1, { rating: 4, image_ids: [i3.image_id, i1.image_id] });
    expect(r.status).toBe(201);
    expect(r.body.images.map((x: any) => x.width)).toEqual([62, 60]);
    const rows = await imageRows(t);
    const by = (id: string) => rows.find((x) => x.id === id)!;
    expect([by(i3.image_id).position, by(i3.image_id).review_id, by(i1.image_id).position, by(i1.image_id).review_id, by(i2.image_id).review_id]).toEqual([1, r.body.id, 2, r.body.id, null]);
    const mine = await call(t, 'get', `/me/reviews/${r.body.id}`, { cookie: w.a.cookie });
    expect(mine.body.images.map((x: any) => x.width)).toEqual([62, 60]);
  });

  it(`REV-TC-20261006-104524981 ${SEC} T8: tệp giả đuôi ảnh, GIF, SVG, PDF bị từ chối; polyglot được làm sạch`, async () => {
    const jpg = await jpegWithExif(64, 64);
    const bad: [string, Buffer][] = [['text', Buffer.from('hello')], ['gif', gif()], ['svg', svgWithScript()], ['pdf', Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj\n')], ['php', php()]];
    for (const [name, buf] of bad) {
      const r = await uploadImage(t, w.a.cookie, buf, { filename: 'anh.jpg', contentType: 'image/jpeg' });
      expect([name, r.status, r.body.type, r.body.code, r.body.reason]).toEqual([name, 400, 'urn:ecom:error:image-invalid', 'image_invalid', 'type']);
    }
    expect(t.fake.keys('reviews/')).toEqual([]);
    expect(await imageRows(t)).toEqual([]);
    const poly = await uploadImage(t, w.a.cookie, Buffer.concat([jpg, Buffer.from('<?php system($_GET[1]);?>')]), { filename: 'x.php.jpg' });
    expect(poly.status).toBe(201);
    expect(stored(poly.body.url).body.includes(Buffer.from('<?php'))).toBe(false);
    expect((await sharp(stored(poly.body.url).body).metadata()).format).toBe('webp');
    const empty = await uploadImage(t, w.a.cookie, Buffer.alloc(0));
    expect([empty.status, empty.body.reason]).toEqual([400, 'corrupt']);
    const cut = await uploadImage(t, w.a.cookie, jpg.subarray(0, Math.floor(jpg.length * 0.4)));
    expect([cut.status, cut.body.reason]).toEqual([400, 'corrupt']);
    const wrongField = await uploadImage(t, w.a.cookie, jpg, { field: 'avatar' });
    expect([wrongField.status, wrongField.body.reason]).toEqual([400, 'corrupt']);
    expect(await q(t, 'SELECT 1 FROM review_images')).toHaveLength(1);
  });

  it(`REV-TC-20261006-104525035 ${SEC} T20: gắn ảnh của người khác bị từ chối cùng một lỗi với ảnh không tồn tại, ảnh đã gắn và id sai định dạng`, async () => {
    await eligible(t, w.a, w.p1);
    const ib = await uploadImage(t, w.b.cookie, await png(50, 50));
    const own = await upload(await png(51, 50));
    const first = await createReview(t, w.a.cookie, w.p1, { rating: 3, image_ids: [ib.body.image_id] });
    const u0 = '3f6c1f0e-9d1a-4a55-8d6b-1f2a3b4c5d6e';
    const second = await createReview(t, w.a.cookie, w.p1, { rating: 3, image_ids: [u0] });
    const strip = (b: any) => { const { trace_id: _t, ...rest } = b; return rest; };
    expect([first.status, second.status]).toEqual([400, 400]);
    expect(first.body.errors).toEqual([{ field: 'image_ids', code: 'invalid_image' }]);
    expect(strip(first.body)).toEqual(strip(second.body));
    expect(await revCount(t)).toBe(0);
    const row = (await imageRows(t, `id = '${ib.body.image_id}'`))[0];
    expect([row.review_id, row.user_id]).toEqual([null, w.b.id]);
    for (const bad of ['abc', 7, null]) expect([String(bad), (await createReview(t, w.a.cookie, w.p1, { rating: 3, image_ids: [bad] })).body.errors?.[0]]).toEqual([String(bad), { field: 'image_ids', code: 'invalid_image' }]);
    expect((await createReview(t, w.a.cookie, w.p1, { rating: 3, image_ids: [own.image_id, own.image_id] })).body.errors?.[0]?.code).toBe('invalid_image'); // trùng id
    const ok = await createReview(t, w.a.cookie, w.p1, { rating: 3, image_ids: [own.image_id] });
    expect(ok.status).toBe(201);
    const other = await seedProduct(t, { category: w.cat }); await seedOrderItem(t, w.a.id, other);
    const again = await createReview(t, w.a.cookie, other, { rating: 3, image_ids: [own.image_id] }); // ảnh đã gắn vào đánh giá khác của chính A
    expect([again.status, again.body.errors?.[0]?.code]).toEqual([400, 'invalid_image']);
  });

  it(`REV-TC-20261006-104525092 guest 401, staff và admin 403 khi tải ảnh; Origin lạ hoặc thiếu bị 403 csrf_failed`, async () => {
    const file = await png(60, 60);
    const before = await snapshot(t);
    const [g, s, d] = [await uploadImage(t, undefined, file), await uploadImage(t, w.staff.cookie, file), await uploadImage(t, w.admin.cookie, file)];
    expect([g.status, s.status, d.status]).toEqual([401, 403, 403]);
    for (const origin of ['https://evil.example', null]) {
      const r = await uploadImage(t, w.a.cookie, file, { origin });
      expect([r.status, r.body.type]).toEqual([403, 'urn:ecom:error:csrf_failed']);
    }
    expect(await snapshot(t)).toEqual(before);
    expect(t.fake.keys('reviews/')).toEqual([]);
  });

  it(`REV-TC-20261006-104525146 ${SEC} T19: lỗi kho ảnh trả lỗi chung không lộ chi tiết nội bộ`, async () => {
    t.fake.failPut = 500;
    const r = await uploadImage(t, w.a.cookie, await png(60, 60));
    expect([r.status, r.headers['content-type']]).toEqual([500, expect.stringContaining('application/problem+json')]);
    expect(Object.keys(r.body).sort()).toEqual(['status', 'title', 'trace_id', 'type']);
    expect(JSON.stringify(r.body)).not.toMatch(/s3\.|\/var|stack|sharp|vips|Error:/);
    expect(await imageRows(t)).toEqual([]);
    expect(t.logs.lines.join('\n')).toContain(r.body.trace_id); // log nội bộ kèm cùng trace_id
    t.fake.failPut = null;
    // INSERT lỗi sau khi ghi object: object bị xóa
    await failingTrigger(t, 'review_images', async () => {
      const bad = await uploadImage(t, w.a.cookie, await png(60, 60));
      expect(bad.status).toBe(500);
      expect(t.fake.keys('reviews/')).toEqual([]);
    });
  });

  it(`REV-TC-20261006-104525199 ${SEC} T9: 5.242.880 byte được nhận, 5.242.881 byte bị cắt luồng, luồng 200 MB không đọc hết`, async () => {
    const base = await png(64, 64);
    const exact = padPng(base, MAX), over = padPng(base, MAX + 1);
    expect([exact.length, over.length]).toEqual([MAX, MAX + 1]);
    const ok = await uploadImage(t, w.a.cookie, exact);
    expect(ok.status).toBe(201);
    const bytesRead = () => t.logs.records.filter((l) => l.msg?.includes('ảnh đánh giá bị từ chối')).map((l) => l.bytes_read as number);
    const r = await uploadImage(t, w.a.cookie, over);
    expect([r.status, r.body.code, r.body.reason]).toEqual([400, 'image_invalid', 'size']);
    expect(bytesRead().at(-1)).toBeGreaterThanOrEqual(MAX + 1); // đã đọc tới ngưỡng rồi mới cắt
    expect(bytesRead().at(-1)).toBeLessThanOrEqual(MAX + 1 + 64 * 1024);
    t.logs.clear();
    await uploadImage(t, w.a.cookie, base); if (global.gc) global.gc();
    const rss = process.memoryUsage().rss;
    const huge = await uploadImage(t, w.a.cookie, padJpeg(await jpegWithExif(64, 64), 60_000_000), { contentType: 'image/jpeg' }); // thân lớn gấp mười hơn trần
    expect([huge.status, huge.body.reason]).toEqual([400, 'size']); // Content-Length khai báo đã quá trần: từ chối không đọc thân (bytes_read 0)
    expect(bytesRead().at(-1)).toBeLessThanOrEqual(MAX + 1 + 64 * 1024);
    expect(process.memoryUsage().rss - rss).toBeLessThan(150 * 1024 * 1024);
    expect(await imageRows(t)).toHaveLength(2);
  }, 120_000);

  it(`REV-TC-20261006-104525257 gắn đúng 5 ảnh hợp lệ nhưng 6 ảnh bị từ chối too_many_images; CSDL chặn ảnh thứ 6`, async () => {
    const p2 = await seedProduct(t, { category: w.cat });
    await eligible(t, w.a, w.p1); await seedOrderItem(t, w.a.id, p2);
    const ids: string[] = [];
    for (let i = 0; i < 6; i++) ids.push((await upload(await png(40 + i, 40))).image_id);
    const J = [] as string[]; for (let i = 0; i < 6; i++) J.push((await upload(await png(70 + i, 40))).image_id);
    const r1 = await createReview(t, w.a.cookie, w.p1, { rating: 5, image_ids: ids.slice(0, 5) });
    expect([r1.status, r1.body.images.length]).toEqual([201, 5]);
    expect((await imageRows(t, `review_id = '${r1.body.id}'`)).map((x) => x.position)).toEqual([1, 2, 3, 4, 5]);
    const r2 = await createReview(t, w.a.cookie, p2, { rating: 5, image_ids: J });
    expect([r2.status, r2.body.errors]).toEqual([400, [{ field: 'image_ids', code: 'too_many_images' }]]);
    expect(await revCount(t, `product_id = '${p2}'`)).toBe(0);
    expect((await imageRows(t, `id = ANY(ARRAY['${J.join("','")}']::uuid[]) AND review_id IS NOT NULL`))).toEqual([]);
    // lớp phòng thủ thứ hai: chèn trực tiếp ảnh thứ 6 hay vị trí trùng phải lỗi ở CSDL
    const code = async (p: Promise<unknown>) => { try { await p; return 'ok'; } catch (e) { return String((e as any).meta?.code ?? e); } };
    const extra = (await imageRows(t, `review_id IS NULL`))[0].id;
    expect(await code(t.prisma.$executeRaw`UPDATE review_images SET review_id = ${r1.body.id}::uuid, position = 6 WHERE id = ${extra}::uuid`)).toBe('23514');
    expect(await code(t.prisma.$executeRaw`UPDATE review_images SET review_id = ${r1.body.id}::uuid, position = 5 WHERE id = ${extra}::uuid`)).toBe('23505');
    expect(await code(t.prisma.$executeRaw`UPDATE review_images SET position = 2 WHERE id = ${extra}::uuid`)).toBe('23514'); // gắn position mà không có review_id
  });

  it(`REV-TC-20261006-104525319 ${SEC} T8: đúng 25 megapixel được nhận; vượt 25 megapixel và PNG bom giải nén bị từ chối`, async () => {
    const solid = (w: number, h: number) => sharp({ create: { width: w, height: h, channels: 3, background: '#808080' } }).png({ compressionLevel: 9 }).toBuffer();
    const ok = await solid(5000, 5000);
    const over = await solid(5001, 5000);
    expect([ok.length < 200_000, over.length < 200_000]).toEqual([true, true]);
    const a = await uploadImage(t, w.a.cookie, ok);
    expect([a.status, a.body.width, a.body.height]).toEqual([201, 1600, 1600]);
    const b = await uploadImage(t, w.a.cookie, over);
    expect([b.status, b.body.reason]).toEqual([400, 'dimensions']);
    const bomb = pngClaiming(30000, 30000);
    expect(bomb.length).toBeLessThan(200);
    if (global.gc) global.gc();
    const rss = process.memoryUsage().rss, started = Date.now();
    const c = await uploadImage(t, w.a.cookie, bomb);
    expect([c.status, c.body.reason]).toEqual([400, 'dimensions']);
    expect(Date.now() - started).toBeLessThan(2000);
    expect(process.memoryUsage().rss - rss).toBeLessThan(100 * 1024 * 1024);
    expect(await imageRows(t)).toHaveLength(1);
    expect(t.fake.keys('reviews/')).toHaveLength(1);
  }, 120_000);

  it(`REV-TC-20261006-104525374 ${SEC} T9: job dọn xóa ảnh chưa gắn quá 24 giờ và ảnh của đánh giá đã xóa; idempotent`, async () => {
    const h = 3600_000;
    await eligible(t, w.a, w.p1);
    const x1 = await seedImageRow(t, w.a.id, null, null, 25 * h);
    const x2 = await seedImageRow(t, w.a.id, null, null, 23 * h);
    const x3 = await seedImageRow(t, w.a.id, null, null, 40 * h, { orphanedAgeMs: 25 * h }); // đánh giá bị xóa cách đây 25 giờ (orphaned_at)
    const x4 = await seedImageRow(t, w.a.id, null, null, 40 * h, { noObject: true }); // object đã mất trước khi job chạy
    const own = await seedReview(t, { user: w.b.id, product: w.p1, status: 'published' });
    const kept = await seedImageRow(t, w.b.id, own, 1, 40 * h); // ảnh ĐANG gắn vào đánh giá còn sống: quá 24 giờ tuổi nhưng không bao giờ bị dọn
    const keys0 = t.fake.keys('reviews/');
    expect(keys0).toHaveLength(4);
    const r = await t.images.sweep();
    expect(r).toEqual({ removed: 3, failed: 0 });
    expect(t.fake.keys('reviews/').sort()).toEqual([x2.key, kept.key].sort());
    expect((await imageRows(t)).map((x) => x.id).sort()).toEqual([x2.id, kept.id].sort());
    const late = await createReview(t, w.a.cookie, w.p1, { rating: 4, image_ids: [x1.id] });
    expect([late.status, late.body.errors?.[0]?.code]).toEqual([400, 'invalid_image']);
    expect(await t.images.sweep()).toEqual({ removed: 0, failed: 0 });
    expect(x3.id && x4.id).toBeTruthy();
    // cửa đua: ảnh quá hạn mà job chưa chạy cũng không gắn được (job sắp xóa nó)
    const stale = await seedImageRow(t, w.a.id, null, null, 30 * h);
    const lateAttach = await createReview(t, w.a.cookie, w.p1, { rating: 4, image_ids: [stale.id] });
    expect(lateAttach.status).toBe(400);
    // kho lỗi: dòng được giữ cho lượt sau, job báo lỗi
    t.fake.failDelete = 500;
    await expect(t.images.sweep()).rejects.toThrow(/không xóa được/);
    expect(await imageRows(t, `id = '${stale.id}'`)).toHaveLength(1);
    t.fake.failDelete = null;
    expect((await t.images.sweep()).removed).toBe(1);
    // đăng ký với bộ lập lịch, chạy qua JobRunner
    const reg = (t.jobs as any).jobs as Map<string, { every: number }>;
    expect(reg.get('rev.sweep-orphan-images')?.every).toBe(3_600_000);
    expect(await t.jobs.runOnce('rev.sweep-orphan-images')).toBe('ran');
  });
});
