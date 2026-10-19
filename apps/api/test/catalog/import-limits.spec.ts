import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { unzipSync, strFromU8 } from 'fflate';
import { truncateAll } from '../support/db';
import { csv, importFile, kiot, xlsx, KIOT_HEADER } from '../support/import';
import { ORIGIN } from '../support/app';
import { call, count, createPrdApp, http as httpOf, seedCategory, who, type PrdApp, type Who } from '../support/prd';
import { ImportService } from '../../src/modules/catalog/import.service';

// Tệp import bị từ chối trước khi đọc dòng nào, quyền, tần suất, giới hạn cấu hình (SB-43, SB-14; PRD-REQ-20261015-092431191 BR1, BR3, BR12, BR13) và tệp mẫu (PRD-REQ-20261015-092431230).
describe('PRD import sản phẩm: kiểm tệp, quyền, tần suất, tệp mẫu', () => {
  let t: PrdApp;
  let admin: Who, staff: Who, sale: Who, customer: Who;
  beforeAll(async () => { t = await createPrdApp(); });
  afterAll(() => t.close());
  beforeEach(async () => {
    await truncateAll(t.prisma); t.fake.reset();
    [admin, staff, sale, customer] = [await who(t, 'admin'), await who(t, 'staff'), await who(t, 'sale'), await who(t, 'customer')];
    const root = await seedCategory(t, 'Thời trang');
    await seedCategory(t, 'Áo', root);
  });
  const P = 'Thời trang>>Áo';
  const row = (i: number) => [`S-${String(i).padStart(4, '0')}`, `Áo ${i}`, P, 1000 + i, null, null, null];
  const invalid = (r: { status: number; body: any }, reason: string) => expect([r.status, r.body.type, r.body.reason]).toEqual([400, 'urn:ecom:error:import-file-invalid', reason]);
  const productsBefore = () => count(t, 'products');

  it('PRD-TC-20261015-093100338: tệp sai loại (.xls thật, .xlsm, PDF đổi tên .xlsx khai Content-Type xlsx, chữ có NUL đổi tên .csv) bị unsupported_type, không đọc dòng nào', async () => {
    const before = await productsBefore();
    const ole = Buffer.concat([Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]), Buffer.alloc(512)]);
    const xlsm = kiot([], {});
    const cases: [string, Buffer, string, string?][] = [
      ['a.xls', ole, 'xls'], ['a.xlsm', xlsm, 'xlsm'], ['a.xlsx', Buffer.from('%PDF-1.7\n1 0 obj\n<<>>\nendobj\n'), 'pdf đổi tên', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
      ['a.csv', Buffer.from('ma;ten\nA-1;b\u0000c\n'), 'csv có NUL'], ['a.txt', Buffer.from('x'), 'đuôi lạ'], ['a', Buffer.from('x'), 'không đuôi'], ['a.csv', Buffer.from([0xff, 0xfe, 0xfd, 0x41]), 'csv không phải UTF-8'],
    ];
    for (const [filename, file, , contentType] of cases) invalid(await importFile(t, admin.cookie, file, { filename, contentType }), 'unsupported_type');
    expect(await productsBefore()).toBe(before);
  });

  it('PRD-TC-20261015-093100351: tệp 0 byte .csv hoặc .xlsx đúng chữ ký zip nhưng cấu trúc hỏng bị corrupt', async () => {
    invalid(await importFile(t, admin.cookie, Buffer.alloc(0), { filename: 'a.csv' }), 'corrupt');
    invalid(await importFile(t, admin.cookie, Buffer.concat([Buffer.from([0x50, 0x4b, 3, 4]), Buffer.from('không phải xlsx hợp lệ, rác rác rác')]), { filename: 'b.xlsx' }), 'corrupt');
    // zip hợp lệ nhưng không có workbook: cũng không phải xlsx
    invalid(await importFile(t, admin.cookie, xlsx([KIOT_HEADER], { extra: { 'xl/workbook.xml': '<workbook/>' } }), { filename: 'c.xlsx' }), 'corrupt');
  });

  it('PRD-TC-20261015-093100364: tệp .csv đúng 5242881 byte bị too_large, không đọc dòng nào, không ghi gì', async () => {
    const lines = [KIOT_HEADER.join(',')];
    let file = csv(lines);
    file = Buffer.concat([file, Buffer.alloc(5_242_881 - file.length, 'x')]);
    expect(file.length).toBe(5_242_881);
    const before = await productsBefore();
    invalid(await importFile(t, admin.cookie, file, { filename: 'a.csv' }), 'too_large');
    expect(await productsBefore()).toBe(before);
  });

  it('PRD-TC-20261015-093100377: tệp 2001 dòng bị too_many_rows; không tạo sản phẩm, không audit', async () => {
    const f = kiot(Array.from({ length: 2001 }, (_v, i) => row(i)));
    invalid(await importFile(t, admin.cookie, f, { dryRun: false }), 'too_many_rows');
    expect([await productsBefore(), await count(t, 'audit_logs', "action = 'catalog.product.import'")]).toEqual([0, 0]);
  });

  it('PRD-TC-20261015-093100390: tệp xlsx có xl/vbaProject.bin bị macro, không đọc dòng nào', async () => {
    invalid(await importFile(t, admin.cookie, kiot([row(1)], { extra: { 'xl/vbaProject.bin': 'MZ-giả' } })), 'macro');
  });

  it('PRD-TC-20261015-093100403: xlsx nén bất thường (sheet giải nén ra hơn 50 MB) bị uncompressed_too_large, dừng giải nén ngay khi vượt trần (bộ nhớ không tăng theo kích thước thật)', async () => {
    const bomb = xlsx([KIOT_HEADER], { extra: { 'xl/worksheets/sheet1.xml': new Uint8Array(200 * 1024 * 1024).fill(65) }, level: 6 });
    expect(bomb.length).toBeLessThan(400 * 1024); // vài trăm KB nén, 200 MB giải nén
    t.logs.clear();
    invalid(await importFile(t, admin.cookie, bomb), 'uncompressed_too_large');
    // Dừng giải nén ngay khi vượt trần: số byte đã giải nén lúc dừng chỉ hơn 50 MB một đệm nhỏ (đo bằng số byte, không bằng RSS vì RSS phụ thuộc lúc GC chạy); giải nén hết sẽ là 200 MB.
    const rej = t.logs.records.find((l) => String(l.msg ?? l.message).includes('tệp import sản phẩm bị từ chối'));
    expect(rej?.reason).toBe('uncompressed_too_large');
    expect(rej?.inflated_bytes).toBeGreaterThan(50 * 1024 * 1024);
    expect(rej?.inflated_bytes).toBeLessThan(60 * 1024 * 1024);
  }, 60_000);

  it('PRD-TC-20261015-093100416: tệp thiếu cột Mã hàng bị header_invalid kèm danh sách cột thiếu', async () => {
    const r = await importFile(t, admin.cookie, xlsx([['Tên hàng', 'Giá bán'], ['Áo', 1000]]));
    invalid(r, 'header_invalid');
    expect(r.body.missing).toEqual(['Mã hàng']);
    const both = await importFile(t, admin.cookie, csv(['a,b', '1,2']), { filename: 'a.csv' });
    expect(both.body.missing).toEqual(['Mã hàng', 'Tên hàng']);
  });

  it('PRD-TC-20261015-093100429: Content-Length gấp một triệu lần trần với thân vô hạn, và xlsx khai một triệu lần số dòng tối đa, bị từ chối nhanh trước khi đọc hết', async () => {
    const server = t.app.getHttpServer();
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const port = (server.address() as AddressInfo).port;
    try {
      const rss0 = process.memoryUsage().rss;
      t.logs.clear();
      // Khai Content-Length gấp một triệu lần trần rồi chỉ gửi phần mở đầu, giữ kết nối mở như thân vô hạn: máy chủ phải trả lời ngay mà không chờ hay đọc thân.
      const out = await new Promise<{ status: number; body: any; ms: number }>((resolve, reject) => {
        const t0 = Date.now();
        const req = http.request({ host: '127.0.0.1', port, method: 'POST', path: '/api/v1/admin/products/import?dry_run=true', headers: { cookie: admin.cookie, origin: ORIGIN, 'content-type': 'multipart/form-data; boundary=XXX', 'content-length': String(5_242_880 * 1_000_000) } });
        const giveUp = setTimeout(() => { req.destroy(); reject(new Error('không nhận được phản hồi sau 5 giây')); }, 5000);
        req.on('response', (res) => { let b = ''; res.on('data', (c) => { b += c; }); res.on('end', () => { clearTimeout(giveUp); resolve({ status: res.statusCode!, body: JSON.parse(b), ms: Date.now() - t0 }); req.destroy(); }); });
        req.on('error', () => undefined); // máy chủ ngắt kết nối sau khi trả lời
        req.write('--XXX\r\ncontent-disposition: form-data; name="file"; filename="a.csv"\r\n\r\n' + 'x'.repeat(1000));
      });
      const rej = t.logs.records.find((l) => String(l.msg ?? l.message).includes('tệp import sản phẩm bị từ chối'));
      expect([rej?.reason, rej?.bytes_read < 65_536]).toEqual(['too_large', true]); // không đọc thân khai báo
      invalid(out, 'too_large');
      expect(out.ms).toBeLessThan(2000);
      expect(process.memoryUsage().rss - rss0).toBeLessThan(200 * 1024 * 1024);
    } finally { await new Promise<void>((r) => server.close(() => r())); }
    const t0 = Date.now();
    const dim = await importFile(t, admin.cookie, kiot([row(1)], { dimension: 'A1:G2000000000' }));
    invalid(dim, 'too_many_rows');
    expect(Date.now() - t0).toBeLessThan(2000);
  }, 30_000);

  // Tệp xlsx rất nhỏ (< 4 KB) không được làm API chết hay đứng (SB-43): tham chiếu cột khổng lồ, thẻ mở không đóng, quá nhiều dòng hoặc ô; mỗi tệp trả 400 nhanh, bộ nhớ không tăng.
  it('PRD-TC-20261015-093100429: xlsx nhỏ có ô cột khổng lồ, thẻ mở không đóng, quá nhiều dòng hay ô bị từ chối nhanh, bộ nhớ không tăng', async () => {
    const sheet = (body: string) => `<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${body}</sheetData></worksheet>`;
    const cell = (ref: string) => `<c r="${ref}" t="inlineStr"><is><t>x</t></is></c>`;
    const cases: [string, string, string][] = [
      ['cột ZZZZZZ2', sheet(`<row r="1">${cell('A1')}</row><row r="2">${cell('ZZZZZZ2')}</row>`), 'corrupt'],
      ['cột 65 có dữ liệu', sheet(`<row r="1">${cell('BM1')}</row>`), 'corrupt'],
      ['100000 thẻ <row> mở không đóng', sheet('<row r="1">'.repeat(100_000)), 'corrupt'],
      ['100000 thẻ <c> mở không đóng trong một dòng', sheet(`<row r="1">${'<c r="A1">'.repeat(100_000)}</row>`), 'corrupt'],
      ['thẻ <row> không có dấu >', sheet('<row r="1"'.repeat(100_000)), 'corrupt'],
      ['30000 dòng đóng ngay (vượt trần số dòng)', sheet('<row/>'.repeat(30_000)), 'too_many_rows'],
      ['600000 ô trong một dòng (vượt trần số ô)', sheet(`<row r="1">${'<c/>'.repeat(600_000)}</row>`), 'too_many_rows'],
    ];
    const rss0 = process.memoryUsage().rss;
    for (const [name, sheetXml, reason] of cases) {
      const file = kiot([], { sheetXml });
      expect([name, file.length < 4096]).toEqual([name, true]); // tệp thật sự nhỏ
      const t0 = Date.now();
      const r = await importFile(t, admin.cookie, file, { dryRun: true });
      expect([name, r.status, r.body.reason]).toEqual([name, 400, reason]);
      expect([name, Date.now() - t0 < 3000]).toEqual([name, true]);
    }
    expect(process.memoryUsage().rss - rss0).toBeLessThan(300 * 1024 * 1024);
    expect(await productsBefore()).toBe(0);
  }, 60_000);

  it('PRD-TC-20261015-093100442: chỉ admin được import: staff, sale, customer 403, chưa đăng nhập 401; bộ xử lý tệp không được gọi, không ghi gì', async () => {
    const spy = jest.spyOn(ImportService.prototype, 'run');
    try {
      for (const [cookie, want] of [[staff.cookie, 403], [sale.cookie, 403], [customer.cookie, 403], [undefined, 401]] as const) {
        const r = await importFile(t, cookie, kiot([row(1)]), { dryRun: false });
        expect([want, r.status]).toEqual([want, want]);
        expect((await importFile(t, cookie, kiot([row(1)]), { dryRun: true })).status).toBe(want);
      }
      expect(spy).not.toHaveBeenCalled();
    } finally { spy.mockRestore(); }
    expect(await productsBefore()).toBe(0);
  });

  it('PRD-TC-20261015-093100455: thiếu Idempotency-Key ở dry_run=false là 400 idempotency-key-required; thiếu hoặc sai tham số dry_run là 400 validation-failed; không ghi gì', async () => {
    const a = await importFile(t, admin.cookie, kiot([row(1)]), { dryRun: false, key: null });
    expect([a.status, a.body.type]).toEqual([400, 'urn:ecom:error:idempotency-key-required']);
    const bad = await importFile(t, admin.cookie, kiot([row(1)]), { dryRun: false, key: 'short' });
    expect([bad.status, bad.body.type]).toEqual([400, 'urn:ecom:error:idempotency-key-required']);
    const b = await importFile(t, admin.cookie, kiot([row(1)]), { dryRun: null });
    expect([b.status, b.body.type, b.body.errors[0].field]).toEqual([400, 'urn:ecom:error:validation-failed', 'dry_run']);
    const c = await httpOf(t).post('/api/v1/admin/products/import?dry_run=maybe').set('Cookie', admin.cookie).set('Origin', ORIGIN).attach('file', kiot([row(1)]), { filename: 'a.xlsx' });
    expect(c.status).toBe(400);
    expect(await productsBefore()).toBe(0);
  });

  it('PRD-TC-20261015-093100468: yêu cầu thứ 21 trong một giờ bị 429 kèm Retry-After, tệp không được đọc; bộ đếm bậc E tính chung dry_run và xác nhận', async () => {
    const f = kiot([]);
    const read = jest.spyOn(ImportService.prototype as unknown as { read: () => unknown }, 'read');
    try {
      for (let i = 0; i < 20; i++) expect([i, (await importFile(t, admin.cookie, f, { dryRun: i % 2 === 0 })).status]).toEqual([i, 200]);
      read.mockClear();
      const r = await importFile(t, admin.cookie, f, { dryRun: true });
      expect([r.status, r.body.type]).toEqual([429, 'urn:ecom:error:rate-limited']);
      expect(Number(r.headers['retry-after'])).toBeGreaterThan(0);
      expect(read).not.toHaveBeenCalled();
      expect((await importFile(t, admin.cookie, f, { dryRun: false })).status).toBe(429); // xác nhận cùng bộ đếm
    } finally { read.mockRestore(); }
    const other = await who(t, 'admin', 'other-admin@shop.vn');
    expect((await importFile(t, other.cookie, f)).status).toBe(200); // bộ đếm theo từng admin
  });

  it('PRD-TC-20261015-093100533: import đúng 2000 dòng và đúng 5242880 byte được nhận (không bị coi là quá trần)', async () => {
    const head = KIOT_HEADER.join(',');
    const mk = (filler: number[]) => csv([head, ...filler.map((n, i) => `E-${String(i).padStart(4, '0')},Ao ${i},${P},${1000 + i},,${'x'.repeat(n)},`)]);
    const base = mk(new Array(2000).fill(0)).length;
    const each = Math.floor((5_242_880 - base) / 2000);
    const fill = new Array(2000).fill(each);
    fill[1999] += 5_242_880 - base - each * 2000;
    const file = mk(fill);
    expect(file.length).toBe(5_242_880);
    const r = await importFile(t, admin.cookie, file, { filename: 'a.csv' });
    expect([r.status, r.body.summary]).toEqual([200, { total_rows: 2000, created: 2000, updated: 0, unchanged: 0, errors: 0 }]);
    expect(r.body.ignored_columns).toEqual(['ĐVT', 'Tồn kho']);
  }, 30_000);

  it('PRD-TC-20261015-093100624: trần byte và số dòng đọc từ cấu hình (10 dòng, 2048 byte); khởi động không đặt hai biến thì mặc định 2000 dòng và 5242880 byte', async () => {
    const small = await createPrdApp({ env: { PRD_IMPORT_MAX_ROWS: '10', PRD_IMPORT_MAX_BYTES: '2048' } });
    try {
      const a = await who(small, 'admin', 'small-admin@shop.vn'); // cùng CSDL với ứng dụng chính: không truncate
      expect(small.config.get<number>('PRD_IMPORT_MAX_ROWS')).toBe(10);
      invalid(await importFile(small, a.cookie, kiot(Array.from({ length: 11 }, (_v, i) => row(i)))), 'too_many_rows');
      const ten = await importFile(small, a.cookie, csv([KIOT_HEADER.join(','), ...Array.from({ length: 10 }, (_v, i) => `T-${i}0,A,${P},1000,,,`)]), { filename: 'a.csv' });
      expect([ten.status, ten.body.summary.total_rows]).toEqual([200, 10]);
      invalid(await importFile(small, a.cookie, Buffer.concat([csv([KIOT_HEADER.join(',')]), Buffer.alloc(2049 - csv([KIOT_HEADER.join(',')]).length, 'x')]), { filename: 'a.csv' }), 'too_large');
    } finally { await small.close(); }
    // mặc định kiểm riêng (không đặt biến): đúng hằng của spec; 2000 dòng nhận, 2001 bị từ chối
    expect([t.config.get<number>('PRD_IMPORT_MAX_ROWS'), t.config.get<number>('PRD_IMPORT_MAX_BYTES')]).toEqual([2000, 5_242_880]);
    expect((await importFile(t, admin.cookie, kiot(Array.from({ length: 2000 }, (_v, i) => row(i))))).body.summary.total_rows).toBe(2000);
    invalid(await importFile(t, admin.cookie, kiot(Array.from({ length: 2001 }, (_v, i) => row(i)))), 'too_many_rows');
  }, 30_000);

  // ---- tệp mẫu (PRD-REQ-20261015-092431230)
  const template = (cookie?: string) => {
    const r = httpOf(t).get('/api/v1/admin/products/import/template');
    return (cookie ? r.set('Cookie', cookie) : r).buffer(true).parse((res, cb) => { const c: Buffer[] = []; res.on('data', (d: Buffer) => c.push(d)); res.on('end', () => cb(null, Buffer.concat(c))); });
  };

  it('PRD-TC-20261015-093100663: admin tải tệp mẫu .xlsx đúng 7 cột, không dòng dữ liệu, có trang Hướng dẫn, không công thức hay macro', async () => {
    const r = await template(admin.cookie);
    expect(r.status).toBe(200);
    expect(r.headers['content-type']).toContain('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    expect(r.headers['content-disposition']).toBe('attachment; filename="mau-import-san-pham.xlsx"');
    const files = unzipSync(new Uint8Array(r.body as Buffer));
    expect(Object.keys(files).some((k) => /vbaProject/i.test(k))).toBe(false);
    const sheet1 = strFromU8(files['xl/worksheets/sheet1.xml']), wb = strFromU8(files['xl/workbook.xml']);
    expect([...sheet1.matchAll(/<row /g)]).toHaveLength(1);
    expect([...sheet1.matchAll(/<t>([^<]*)<\/t>/g)].map((m) => m[1])).toEqual(KIOT_HEADER);
    expect(wb).toContain('name="Hướng dẫn"');
    for (const f of ['xl/worksheets/sheet1.xml', 'xl/worksheets/sheet2.xml']) expect(strFromU8(files[f])).not.toMatch(/<f[\s>/]/);
    expect(await count(t, 'audit_logs')).toBe(0); // tải mẫu không audit (BR4)
  });

  it('PRD-TC-20261015-093100676: staff, sale, customer 403 và chưa đăng nhập 401 khi tải tệp mẫu; không trả tệp', async () => {
    for (const [cookie, want] of [[staff.cookie, 403], [sale.cookie, 403], [customer.cookie, 403], [undefined, 401]] as const) {
      const r = await template(cookie);
      expect([want, r.status, String(r.headers['content-type']).includes('spreadsheetml')]).toEqual([want, want, false]);
    }
  });

  it('PRD-TC-20261015-093100689: import chính tệp mẫu chưa điền (dry_run=true) cho báo cáo 0 dòng, không lỗi', async () => {
    const r = await importFile(t, admin.cookie, (await template(admin.cookie)).body as Buffer, { filename: 'mau-import-san-pham.xlsx' });
    expect([r.status, r.body.summary, r.body.rows]).toEqual([200, { total_rows: 0, created: 0, updated: 0, unchanged: 0, errors: 0 }, []]);
    expect(r.body.ignored_columns).toEqual(['ĐVT', 'Tồn kho']);
  });

  it('PRD-TC-20261015-093100702: tải tệp mẫu lần thứ 31 trong một phút bị 429 kèm Retry-After (bậc D); 30 lần trước vẫn 200', async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 30; i++) statuses.push((await template(admin.cookie)).status);
    expect(statuses.every((s) => s === 200)).toBe(true);
    const over = await call(t, 'get', '/admin/products/import/template', { cookie: admin.cookie });
    expect([over.status, over.body.type]).toEqual([429, 'urn:ecom:error:rate-limited']);
    expect(Number(over.headers['retry-after'])).toBeGreaterThan(0);
  });
});
