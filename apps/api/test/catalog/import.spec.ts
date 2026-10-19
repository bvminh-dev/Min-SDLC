import { truncateAll } from '../support/db';
import { csv, importFile, kiot, newKey, KIOT_HEADER } from '../support/import';
import { auditOf, call, count, createPrdApp, outbox, productRow, seedCategory, seedProduct, who, type PrdApp, type Who } from '../support/prd';
import { q } from '../support/auth';
import { ImportService } from '../../src/modules/catalog/import.service';

// Import sản phẩm .xlsx, .csv (ADR-025, PRD-REQ-20261015-092431191): hai bước trên cùng một tệp, upsert theo sku, một giao dịch, một audit.
describe('PRD import sản phẩm: nghiệp vụ từng dòng (PRD-REQ-20261015-092431191; SB-42, SB-43)', () => {
  let t: PrdApp;
  let admin: Who, admin2: Who, root: string, ao: string, a001: string, a002: string;
  beforeAll(async () => { t = await createPrdApp({ level: 'debug' }); });
  afterAll(() => t.close());
  beforeEach(async () => {
    await truncateAll(t.prisma); t.fake.reset(); t.logs.clear();
    [admin, admin2] = [await who(t, 'admin'), await who(t, 'admin', 'admin2@shop.vn')];
    root = await seedCategory(t, 'Thời trang');
    ao = await seedCategory(t, 'Áo', root);
    a001 = await seedProduct(t, { category: ao, sku: 'AT-001', name: 'Áo thun cotton', price: 150000, costPrice: null, version: 3 });
    a002 = await seedProduct(t, { category: ao, sku: 'AT-002', name: 'Áo sơ mi', price: 200000, costPrice: 120000 });
  });
  const P = 'Thời trang>>Áo';
  /** Tệp của PRD-TC-20261015-093100234: một sku mới, một sku đổi giá bán, một sku giống hệt. */
  const standard = () => kiot([['AT-100', 'Áo thun', P, 150000, 90000, 'Cái', 12], ['AT-001', 'Áo thun cotton', P, 160000, null, 'Cái', 5], ['AT-002', 'Áo sơ mi', P, 200000, 120000, 'Cái', 1]]);
  const snapshot = async () => ({ products: await count(t, 'products'), audit: await count(t, 'audit_logs'), outbox: await count(t, 'outbox_events'), keys: await count(t, 'idempotency_keys'), v: (await productRow(t, a001)).version });

  it('PRD-TC-20261015-093100234: xem trước import báo cáo từng dòng, hiện đổi giá và các cột bị bỏ qua', async () => {
    const r = await importFile(t, admin.cookie, standard());
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ dry_run: true, summary: { total_rows: 3, created: 1, updated: 1, unchanged: 1, errors: 0 } });
    expect(r.body.ignored_columns).toEqual(['ĐVT', 'Tồn kho']);
    expect(r.body.rows.map((x: any) => [x.row, x.sku, x.action])).toEqual([[2, 'AT-100', 'create'], [3, 'AT-001', 'update'], [4, 'AT-002', 'unchanged']]);
    expect(r.body.rows[1].changes).toEqual({ price: { old: 150000, new: 160000 } });
    expect(r.body.rows[0].errors).toEqual([]);
  });

  it('PRD-TC-20261015-093100247: xem trước không ghi gì (sản phẩm, audit, outbox, idempotency, version, tồn kho), không cần Idempotency-Key', async () => {
    await t.prisma.$executeRaw`INSERT INTO stock_items (product_id, on_hand) VALUES (${a001}::uuid, 5)`;
    const before = await snapshot();
    const r = await importFile(t, admin.cookie, standard());
    expect(r.status).toBe(200);
    expect(await snapshot()).toEqual(before);
    expect(await count(t, 'products', "sku = 'AT-100'")).toBe(0);
    expect(await count(t, 'stock_items')).toBe(1);
  });

  it('PRD-TC-20261015-093100260: xác nhận import tạo draft, cập nhật theo sku, không đụng tồn kho, đúng một audit có cặp giá cũ mới', async () => {
    await t.prisma.$executeRaw`INSERT INTO stock_items (product_id, on_hand) VALUES (${a001}::uuid, 5)`;
    const r = await importFile(t, admin.cookie, standard(), { dryRun: false, filename: 'hang-moi.xlsx' });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ dry_run: false, summary: { total_rows: 3, created: 1, updated: 1, unchanged: 1, errors: 0 } });
    const [n] = await q<any>(t, "SELECT status, version, price::int AS price, cost_price::int AS cost_price, category_id, description FROM products WHERE sku = 'AT-100'");
    expect(n).toMatchObject({ status: 'draft', version: 1, price: 150000, cost_price: 90000, category_id: ao, description: null });
    expect(await count(t, 'product_images', `product_id = (SELECT id FROM products WHERE sku = 'AT-100')`)).toBe(0);
    expect(await productRow(t, a001)).toMatchObject({ price: 160000, version: 4, status: 'active', cost_price: null });
    expect((await productRow(t, a002)).version).toBe(1);
    expect(await outbox(t)).toHaveLength(0); // không phát event (PRD-DB mục 17)
    expect(await count(t, 'stock_items')).toBe(1); // không StockItem mới cho AT-100
    expect((await q<{ on_hand: number }>(t, `SELECT on_hand FROM stock_items WHERE product_id = '${a001}'`))[0].on_hand).toBe(5);
    const audits = await auditOf(t, 'catalog.product.import');
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({ actor_id: admin.id, actor_role: 'admin', after: { file_name: 'hang-moi.xlsx', created: 1, updated: 1, unchanged: 1, errors: 0, price_changes: [{ sku: 'AT-001', price: { old: 150000, new: 160000 } }] } });
    expect((await q<{ search_text: string }>(t, "SELECT search_text FROM products WHERE sku = 'AT-100'"))[0].search_text).toBe('ao thun at-100');
  });

  it('PRD-TC-20261015-093100273: import CSV UTF-8 có BOM phân cách chấm phẩy cho báo cáo giống xlsx', async () => {
    const r = await importFile(t, admin.cookie, csv([KIOT_HEADER.join(';'), `AT-201;Áo A;${P};100000;60000;Cái;3`, `AT-202;"Áo; B";${P};120000;;Cái;4`], { bom: true }), { filename: 'a.csv' });
    expect(r.status).toBe(200);
    expect(r.body.summary).toMatchObject({ total_rows: 2, created: 2, errors: 0 });
    expect(r.body.rows.map((x: any) => [x.row, x.sku, x.action])).toEqual([[2, 'AT-201', 'create'], [3, 'AT-202', 'create']]);
    const c = await importFile(t, admin.cookie, csv([KIOT_HEADER.join(','), `AT-203,Áo C,${P},100000,,,`]), { filename: 'b.csv', dryRun: false });
    expect([c.status, c.body.summary.created]).toEqual([200, 1]); // phân cách phẩy cũng nhận
  });

  it('PRD-TC-20261015-093100286: dòng lỗi dữ liệu được báo từng dòng và các dòng hợp lệ vẫn ghi; không tạo danh mục mới', async () => {
    const f = kiot([['N-001', 'Áo mới', P, 100000, null, null, null], ['N-002', 'Xe', 'Đồ chơi>>Xe', 100000, null, null, null], ['N-003', 'Áo', P, 'abc', null, null, null], ['n-001', 'Áo trùng', P, 100000, null, null, null], ['N-005', null, P, 100000, null, null, null]]);
    const cats = await count(t, 'categories');
    const r = await importFile(t, admin.cookie, f, { dryRun: false });
    expect(r.status).toBe(200);
    const by = Object.fromEntries(r.body.rows.map((x: any) => [x.row, x]));
    expect(by[2]).toMatchObject({ action: 'create', errors: [] });
    expect([by[3].action, by[3].errors[0].code, by[3].errors[0].message]).toEqual(['error', 'category_not_found', 'Nhóm hàng: không tìm thấy "Đồ chơi"']);
    expect([by[4].action, by[4].errors.map((e: any) => e.code)]).toEqual(['error', ['price_invalid']]);
    expect([by[5].action, by[5].errors[0].code, by[5].errors[0].message]).toEqual(['error', 'duplicate_in_file', 'Mã hàng: trùng với dòng 2']);
    expect([by[6].action, by[6].errors.map((e: any) => e.code)]).toEqual(['error', ['name_required']]);
    expect(r.body.summary).toMatchObject({ total_rows: 5, created: 1, errors: 4 });
    expect((await q<{ sku: string }>(t, "SELECT sku FROM products WHERE sku LIKE 'N-%'")).map((x) => x.sku)).toEqual(['N-001']);
    expect(await count(t, 'categories')).toBe(cats);
    // nhiều lỗi một dòng liệt kê hết
    const multi = await importFile(t, admin.cookie, kiot([['M-001', null, 'Không>>Có', 'x', 'y', null, null]]));
    expect(multi.body.rows[0].errors.map((e: any) => e.code).sort()).toEqual(['category_not_found', 'cost_price_invalid', 'name_required', 'price_invalid']);
  });

  it('PRD-TC-20261015-093100299: ô công thức và ô bắt đầu bằng = + - @ tab, xuống dòng bị từ chối formula_rejected; chỉ dòng hợp lệ được tạo', async () => {
    const row = (n: string, name: any) => [n, name, P, 100000, null, null, null];
    const f = kiot([row('F-001', { f: 'HYPERLINK("http://evil","x")' }), row('F-002', '=1+1'), row('F-003', '+1'), row('F-004', '-2+3'), row('F-005', '@SUM(A1)'), row('F-006', '\tTab'), row('F-007', 'Áo hợp lệ'), row('F-008', '\nXuống dòng')]);
    const r = await importFile(t, admin.cookie, f, { dryRun: false });
    expect(r.status).toBe(200);
    expect(r.body.rows.map((x: any) => [x.row, x.action, x.errors[0]?.code])).toEqual([[2, 'error', 'formula_rejected'], [3, 'error', 'formula_rejected'], [4, 'error', 'formula_rejected'], [5, 'error', 'formula_rejected'], [6, 'error', 'formula_rejected'], [7, 'error', 'formula_rejected'], [8, 'create', undefined], [9, 'error', 'formula_rejected']]);
    expect((await q<{ name: string }>(t, "SELECT name FROM products WHERE sku LIKE 'F-%'")).map((x) => x.name)).toEqual(['Áo hợp lệ']);
    expect(await count(t, 'products', "name ~ '^[=+@\\t-]'")).toBe(0);
  });

  it('PRD-TC-20261015-093100299: khoảng trắng, NBSP, zero-width hay ký tự điều khiển đứng trước = + - @ vẫn bị formula_rejected (xlsx và CSV), không sản phẩm nào có tên bắt đầu bằng ký tự công thức', async () => {
    const leads = [' ', '\u00A0', '\u2003', '\u200B', '\u200D', '\u2060', '\uFEFF', '\u0001', '\u00AD', ' \u200B\u00A0\t '];
    const names = leads.flatMap((l, i) => ['=', '+', '-', '@'].map((c, j) => [`L-${i}${j}`, `${l}${c}HYPERLINK("x")`] as const));
    const ok = ['L-OK', 'Áo thường'] as const;
    const want = [...names.map(() => 'formula_rejected'), 'create'];
    const xl = await importFile(t, admin.cookie, kiot([...names, ok].map(([sku, name]) => [sku, name, P, 100000, null, null, null])), { dryRun: false });
    expect([xl.status, xl.body.rows.map((x: any) => x.errors[0]?.code ?? x.action)]).toEqual([200, want]);
    const cs = await importFile(t, admin.cookie, csv([KIOT_HEADER.join(','), ...[...names, ok].map(([sku, name]) => `${sku},"${name.replace(/"/g, '""')}",${P},100000,,,`)]), { filename: 'a.csv', dryRun: true });
    expect([cs.status, cs.body.rows.map((x: any) => x.errors[0]?.code ?? x.action)]).toEqual([200, [...want.slice(0, -1), 'unchanged']]); // dòng hợp lệ đã được lần xlsx tạo
    expect((await q<{ name: string }>(t, "SELECT name FROM products WHERE sku LIKE 'L-%'")).map((x) => x.name)).toEqual(['Áo thường']);
    // mã hàng và nhóm hàng cũng bị chặn, không bị cắt khoảng trắng rồi lọt
    const sku = await importFile(t, admin.cookie, kiot([[' \u00A0=cmd', 'Tên', P, 1000, null, null, null], ['L-S2', 'Tên', ` @${P}`, 1000, null, null, null]]));
    expect(sku.body.rows.map((x: any) => [x.action, x.errors[0]?.code])).toEqual([['error', 'formula_rejected'], ['error', 'formula_rejected']]);
  });

  it('PRD-TC-20261015-093100507: NUL hoặc nửa cặp thay thế ở mã hàng, tên hay nhóm hàng bị lỗi dòng, dry_run và xác nhận cùng 200 (không 500)', async () => {
    // fixture `kiot` không dựng được nửa cặp lẻ (UTF-8 thay bằng U+FFFD): viết thẳng thực thể XML vào trang tính
    const cell = (ref: string, v: string) => `<c r="${ref}" t="inlineStr"><is><t>${v}</t></is></c>`;
    const bad = ['&#0;', '&#xD800;', '_x0000_', '_xD800_', '&#xDC00;'];
    const rows = [...bad.flatMap((b, i) => [[`${b}AB`, 'Tên', P], [`B-N${i}`, `Tên ${b}`, P], [`B-C${i}`, 'Tên', `${P}>>${b}`]]), ['B-OK', 'Tên tốt', P]];
    const cols = ['A', 'B', 'C'];
    const body = rows.map((r, i) => `<row r="${i + 2}">${r.map((v, j) => cell(`${cols[j]}${i + 2}`, v)).join('')}<c r="D${i + 2}"><v>1000</v></c></row>`).join('');
    const head = `<row r="1">${KIOT_HEADER.slice(0, 4).map((h, j) => cell(`${'ABCD'[j]}1`, h)).join('')}</row>`;
    const sheetXml = `<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${head}${body}</sheetData></worksheet>`;
    const file = kiot([], { sheetXml });
    const want = [...bad.flatMap(() => [['error'], ['error'], ['error']]), ['create']];
    for (const dryRun of [true, false]) {
      const r = await importFile(t, admin.cookie, file, { dryRun });
      expect([dryRun, r.status]).toEqual([dryRun, 200]);
      expect(r.body.rows.map((x: any) => [x.action])).toEqual(want);
      expect(r.body.rows.slice(0, -1).every((x: any) => x.errors.length === 1 && /^(sku|name|category)_invalid$/.test(x.errors[0].code))).toBe(true);
      expect(JSON.stringify(r.body)).not.toMatch(/\\u0000|\\ud800|\\udc00/i);
    }
    expect((await q<{ sku: string }>(t, "SELECT sku FROM products WHERE sku LIKE 'B-%'")).map((x) => x.sku)).toEqual(['B-OK']);
  });

  it('PRD-TC-20261015-093100312: ô công thức trong tệp CSV bị từ chối (tên bắt đầu bằng =, mã hàng bắt đầu bằng @)', async () => {
    const r = await importFile(t, admin.cookie, csv([KIOT_HEADER.join(','), `F-1,=cmd|' /C calc'!A0,${P},1000,,,`, `@AT-9,Tên,${P},1000,,,`, `F-3,Áo thường,${P},1000,,,`]), { filename: 'a.csv' });
    expect(r.status).toBe(200);
    expect(r.body.rows.map((x: any) => [x.row, x.action, x.errors[0]?.code])).toEqual([[2, 'error', 'formula_rejected'], [3, 'error', 'formula_rejected'], [4, 'create', undefined]]);
  });

  it('PRD-TC-20261015-093100325: ô công thức ở cột số (giá bán, giá vốn) bị từ chối formula_rejected', async () => {
    const r = await importFile(t, admin.cookie, kiot([['F-001', 'Áo', P, { f: '100000*2' }, null, null, null], ['F-002', 'Áo', P, 100000, { f: 'A1' }, null, null]]));
    expect(r.body.rows.map((x: any) => [x.row, x.action, x.errors.map((e: any) => [e.field, e.code])])).toEqual([[2, 'error', [['price', 'formula_rejected']]], [3, 'error', [['cost_price', 'formula_rejected']]]]);
    expect(r.body.summary.created).toBe(0);
  });

  it('PRD-TC-20261015-093100481: dòng của sản phẩm đã lưu trữ bị lỗi product_archived, sản phẩm không đổi', async () => {
    const id = await seedProduct(t, { category: ao, sku: 'QJ-010', price: 320000, status: 'archived', version: 2 });
    const r = await importFile(t, admin.cookie, kiot([['QJ-010', 'Quần jean', P, 330000, null, null, null]]), { dryRun: false });
    expect(r.body.rows[0]).toMatchObject({ action: 'error', errors: [{ code: 'product_archived' }] });
    expect(await productRow(t, id)).toMatchObject({ price: 320000, version: 2 });
  });

  it('PRD-TC-20261015-093100494: sku dùng ký tự đổi hoa thường thành ASCII (ſ, ı, dấu Kelvin) hoặc nửa cặp thay thế bị từ chối sku_invalid', async () => {
    const r = await importFile(t, admin.cookie, kiot([['AT-ſ01', 'Áo', P, 1000, null, null, null], ['AT-ı01', 'Áo', P, 1000, null, null, null], ['AT-K01', 'Áo', P, 1000, null, null, null], ['at\ud800-1', 'Áo', P, 1000, null, null, null]]));
    expect(r.body.rows.map((x: any) => [x.action, x.errors[0]?.code])).toEqual([['error', 'sku_invalid'], ['error', 'sku_invalid'], ['error', 'sku_invalid'], ['error', 'sku_invalid']]);
    expect(r.body.summary.created).toBe(0);
  });

  it('PRD-TC-20261015-093100507: tên vượt 200 ký tự, có ký tự NUL hoặc tab giữa tên bị name_invalid', async () => {
    const r = await importFile(t, admin.cookie, kiot([['N-001', '😀'.repeat(201), P, 1000, null, null, null], ['N-002', 'Áo\u0000x', P, 1000, null, null, null], ['N-003', 'Áo\tthun', P, 1000, null, null, null]]));
    expect(r.body.rows.map((x: any) => [x.action, x.errors.map((e: any) => e.code)])).toEqual([['error', ['name_invalid']], ['error', ['name_invalid']], ['error', ['name_invalid']]]);
  });

  it('PRD-TC-20261015-093100520: tên đúng 200 emoji được nhận và lưu đủ 200 ký tự', async () => {
    const r = await importFile(t, admin.cookie, kiot([['N-001', '😀'.repeat(200), P, 1000, null, null, null]]), { dryRun: false });
    expect(r.body.rows[0].action).toBe('create');
    expect((await q<{ n: number }>(t, "SELECT length(name)::int AS n FROM products WHERE sku = 'N-001'"))[0].n).toBe(200);
  });

  it('PRD-TC-20261015-093100546: tệp chỉ có dòng tiêu đề cho báo cáo rỗng (200, 0 dòng)', async () => {
    const r = await importFile(t, admin.cookie, kiot([]));
    expect([r.status, r.body.summary, r.body.rows]).toEqual([200, { total_rows: 0, created: 0, updated: 0, unchanged: 0, errors: 0 }, []]);
  });

  it('PRD-TC-20261015-093100559: ô trống giữ nguyên giá vốn và danh mục của sản phẩm có sẵn (unchanged, version giữ nguyên)', async () => {
    const id = await seedProduct(t, { category: ao, sku: 'AT-900', name: 'Áo gốc', price: 100000, costPrice: 90000, version: 3 });
    const r = await importFile(t, admin.cookie, kiot([['AT-900', 'Áo gốc', null, 100000, null, null, null]]), { dryRun: false });
    expect(r.body.rows[0].action).toBe('unchanged');
    expect(await productRow(t, id)).toMatchObject({ cost_price: 90000, category_id: ao, version: 3 });
  });

  it('PRD-TC-20261015-093100572: tên có thẻ script được lưu nguyên và JSON trả nguyên chuỗi (hiển thị escape ở E2E PRD-E2E-20261015-094000000)', async () => {
    const name = 'Áo <script>alert(1)</script>';
    await importFile(t, admin.cookie, kiot([['X-001', name, P, 1000, null, null, null]]), { dryRun: false });
    const l = await call(t, 'get', '/admin/products?q=x-001', { cookie: admin.cookie });
    expect(l.body.items[0].name).toBe(name);
  });

  it('PRD-TC-20261015-093100585: hai admin import song song cùng sku mới chỉ tạo một sản phẩm; bên thua cuộc là sku_conflict hoặc update, không 500', async () => {
    const a = kiot([['AT-200', 'Áo A', P, 100000, null, null, null]]), b = kiot([['AT-200', 'Áo B', P, 120000, null, null, null]]);
    const [x, y] = await Promise.all([importFile(t, admin.cookie, a, { dryRun: false }), importFile(t, admin2.cookie, b, { dryRun: false })]);
    expect([x.status, y.status]).toEqual([200, 200]);
    expect(await count(t, 'products', "sku = 'AT-200'")).toBe(1);
    const acts = [x.body.rows[0], y.body.rows[0]].map((r: any) => r.action).sort();
    expect(['create', 'error'].join() === acts.join() || ['create', 'update'].join() === acts.join()).toBe(true);
    const err = [x.body.rows[0], y.body.rows[0]].find((r: any) => r.action === 'error');
    if (err) expect(err.errors[0].code).toBe('sku_conflict');
  });

  it('PRD-TC-20261015-093100598: lỗi kết nối CSDL giữa lúc ghi lô thì 503, không ghi dở, không audit, khóa Idempotency-Key không lưu phản hồi', async () => {
    const rows = Array.from({ length: 100 }, (_v, i) => [`B-${String(i).padStart(3, '0')}`, `Áo ${i}`, P, 1000 + i, null, null, null]);
    const proto = ImportService.prototype as unknown as { insertChunk: (...a: unknown[]) => Promise<unknown> };
    const real = proto.insertChunk;
    let calls = 0;
    const spy = jest.spyOn(proto, 'insertChunk').mockImplementation(function (this: unknown, ...a: unknown[]) {
      if (++calls === 2) throw Object.assign(new Error("Can't reach database server"), { code: 'P1001' }); // lô thứ hai = dòng thứ 51 trở đi
      return real.apply(this, a);
    });
    try {
      const before = await count(t, 'products');
      const r = await importFile(t, admin.cookie, kiot(rows), { dryRun: false });
      expect([r.status, r.body.type]).toEqual([503, 'urn:ecom:error:service-unavailable']);
      expect(calls).toBe(2);
      expect(await count(t, 'products')).toBe(before);
      expect(await count(t, 'audit_logs', "action = 'catalog.product.import'")).toBe(0);
      expect(await count(t, 'idempotency_keys', "scope = 'prd:product-import'")).toBe(0);
    } finally { spy.mockRestore(); }
  });

  it('PRD-TC-20261015-093100611: gửi lại cùng Idempotency-Key và tệp trả báo cáo cũ không ghi lần hai; cùng khóa khác tệp là 422', async () => {
    const key = newKey(), f = standard();
    const first = await importFile(t, admin.cookie, f, { dryRun: false, key });
    const again = await importFile(t, admin.cookie, f, { dryRun: false, key });
    expect([first.status, again.status]).toEqual([200, 200]);
    expect(again.body).toEqual(first.body);
    expect(again.headers['idempotent-replayed']).toBe('true');
    expect(await count(t, 'audit_logs', "action = 'catalog.product.import'")).toBe(1);
    expect(await count(t, 'products')).toBe(3);
    expect((await productRow(t, a001)).version).toBe(4); // không tăng lần hai
    const other = await importFile(t, admin.cookie, kiot([['AT-300', 'Áo', P, 1000, null, null, null]]), { dryRun: false, key });
    expect([other.status, other.body.type]).toEqual([422, 'urn:ecom:error:idempotency-key-reused']);
  });

  it('PRD-TC-20261015-093100637: nội dung ô của tệp (tên, giá trị sai, giá vốn) không vào log ứng dụng', async () => {
    t.logs.clear();
    const f = kiot([['L-001', 'CHUOI-DANH-DAU-9731', P, 1000, 87654321, null, null], ['L-002', 'Áo', P, 'giavon-danh-dau-5512', null, null, null]]);
    await importFile(t, admin.cookie, f, { dryRun: true });
    expect((await importFile(t, admin.cookie, f, { dryRun: false })).status).toBe(200);
    await importFile(t, admin.cookie, Buffer.from('rác'), { dryRun: true });
    const all = t.logs.lines.join('\n');
    expect(all.length).toBeGreaterThan(0);
    for (const secret of ['CHUOI-DANH-DAU-9731', 'giavon-danh-dau-5512', '87654321']) expect([secret, all.includes(secret)]).toEqual([secret, false]);
    expect(all).toContain('import sản phẩm'); // log có số dòng, không có nội dung
  });

  it('PRD-TC-20261015-093100650: tên tệp có ký tự điều khiển, đường dẫn và dài 300 ký tự được làm sạch và cắt còn 255 trong audit', async () => {
    const filename = `../../x\ty${'a'.repeat(300)}.xlsx`; // ký tự điều khiển khác tab trong tên bị busboy từ chối từ tầng form (bad_form), nên dùng tab
    const r = await importFile(t, admin.cookie, standard(), { dryRun: false, filename });
    expect(r.status).toBe(200);
    const [a] = await auditOf(t, 'catalog.product.import');
    expect(a.after.file_name).toBe(`xy${'a'.repeat(300)}.xlsx`.slice(0, 255)); // bỏ ký tự điều khiển, bỏ phần đường dẫn, cắt 255; mã không ghi tệp ra đĩa theo tên này
  });
});
