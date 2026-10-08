// Kiểm nhanh check-tech-design.mjs: node check-tech-design.test.mjs (dừng ở assert đầu tiên sai).
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const script = join(dirname(fileURLToPath(import.meta.url)), 'check-tech-design.mjs');
const REQ = 'ORD-REQ-20261006-100000001';
const put = (root, rel, text) => { mkdirSync(dirname(join(root, rel)), { recursive: true }); writeFileSync(join(root, rel), text); };

const DB = (states = ['pending', 'paid'], fk = 'FK users') => `---
id: ORD-DB-20261006-110000001
epic: ORD
links: [${REQ}]
entities: [Order]
---
## Bảng
| Bảng | Entity | Khóa | Ràng buộc |
|---|---|---|---|
| orders | Order | id | ${fk} |
## Trạng thái hợp lệ
| Entity | Trạng thái | Ràng buộc |
|---|---|---|
${states.map((s) => `| Order | ${s} | enum |`).join('\n')}
`;
const API = ({ path = '/api/v1/orders', errs = '401, 403', dep = '[AUTH]', emits = '[OrderPaid]', role = 'customer' } = {}) => `---
id: ORD-API-20261006-110000002
epic: ORD
links: [${REQ}]
depends_on: ${dep}
emits: ${emits}
consumes: []
---
## Endpoint
| Method | Path | Role | Requirement | Lỗi | Ghi chú |
|---|---|---|---|---|---|
| GET | ${path} | ${role} | ${REQ} | ${errs} | own |
`;
const SEC = (sb = 'SB-06', measure = 'kiểm sở hữu', check = 'test') => `---
id: ORD-SEC-20261006-110000003
epic: ORD
links: [${REQ}]
---
## Mối đe dọa
| Mã | STRIDE | Tài sản | Mối đe dọa | Biện pháp | SB | Kiểm bằng |
|---|---|---|---|---|---|---|
| T1 | E | đơn | IDOR | ${measure} | ${sb} | ${check} |
`;

// DB cho entity mới chưa có trong entities.md (L1/L11): proposed_entities khai hoặc không
const DBP = (proposed) => DB()
  .replace('entities: [Order]', `entities: [Order, OrderStatusHistory]${proposed ? '\nproposed_entities: [OrderStatusHistory]' : ''}`)
  .replace('| orders | Order |', '| order_status_history | OrderStatusHistory | id | append-only |\n| orders | Order |');

function run({ db = DB(), api = API(), sec = SEC(), reqStatus = 'approved', reqBody = '', arch = '', strict = true, common = null } = {}) {
  const r = mkdtempSync(join(tmpdir(), 'design-'));
  put(r, 'permissions-matrix.md', '| Hành động | Requirement | guest | customer | staff | admin | system |\n|---|---|---|---|---|---|\n');
  put(r, 'domain/entities.md', '| Entity          | Epic | Khóa |\n|---|---|---|\n| Order | ORD | id |\n| StockItem | INV | id |\n| User | AUTH | id |\n\n| Entity        | Từ | Sang | Điều kiện |\n|---|---|---|---|\n| Order | pending | paid | x |\n');
  put(r, 'domain/events.md', '| Event | Entity | Producer | Consumers | Payload | Phát khi |\n|---|---|---|---|---|---|\n| OrderPaid | Order | ORD | SHP | id | Order:paid |\n');
  put(r, 'architecture.md', '| Epic | Module | Phụ thuộc |\n|---|---|---|\n| AUTH | auth | - |\n| ORD | order | AUTH |\n| INV | inventory | - |\n' + arch);
  put(r, 'security-baseline.md', '| Mã | Yêu cầu | Kiểm bằng | Epic |\n|---|---|---|---|\n| SB-06 | IDOR | test | ORD |\n');
  put(r, `epics/ORD/requirements/${REQ}.md`, `---\nid: ${REQ}\nepic: ORD\nstatus: ${reqStatus}\nroles: [customer, system]\n---\n${reqBody}`);
  if (common) put(r, 'epics/PRJ/requirements/PRJ-REQ-20261006-100000009.md', `---\nid: PRJ-REQ-20261006-100000009\nepic: PRJ\nstatus: approved\nroles: [customer]\n---\n- BR2: type là URN. ${common}\n`);
  put(r, 'epics/ORD/design/ORD-DB-20261006-110000001.md', db);
  put(r, 'epics/ORD/design/ORD-API-20261006-110000002.md', api);
  put(r, 'epics/ORD/design/ORD-SEC-20261006-110000003.md', sec);
  return spawnSync('node', [script, r, ...(strict ? ['--strict'] : [])], { encoding: 'utf8' });
}

let r = run();
assert.equal(r.status, 0, r.stderr);
const bad = (opts, re) => { const x = run(opts); assert.equal(x.status, 1, `phải lỗi: ${re}`); assert.match(x.stderr, re); };
bad({ db: DB(['pending']) }, /lệch vòng đời/);
bad({ api: API({ path: '/orders' }) }, /\/api\/v1\//);
bad({ db: DB(['pending', 'paid'], 'FK stock_items') }, /FK stock_items thuộc epic INV/);
bad({ db: DB(['pending', 'paid'], 'item_id -> stock_items.id (RESTRICT)') }, /stock_items thuộc epic INV/);
bad({ db: DB(['pending', 'paid'], 'item_id REFERENCES stock_items(id)') }, /stock_items thuộc epic INV/);
bad({ api: API({ errs: '401' }) }, /401 và 403/);
assert.equal(run({ api: API({ role: 'system', errs: '-' }) }).status, 0, 'endpoint role system không bắt buộc 401/403');
bad({ api: API({ dep: '[PAY]' }) }, /depends_on PAY/);
bad({ api: API({ emits: '[StockReleased]' }) }, /emits StockReleased/);
bad({ sec: SEC('SB-99') }, /SB-99/);
// L1/L11: entity đề xuất chưa có trong entities.md: lỗi nếu không khai proposed_entities, chỉ cảnh báo nếu có khai
bad({ db: DBP(false) }, /OrderStatusHistory chưa có trong entities\.md/);
r = run({ db: DBP(true) });
assert.equal(r.status, 0, r.stderr);
assert.match(r.stdout, /OrderStatusHistory.*entities\.md.*sdlc-foundation/, 'proposed_entities phải cảnh báo cần thêm vào entities.md');
// L7/L20: requirement trong links còn draft thì cảnh báo (không chặn); approved thì không cảnh báo
r = run({ reqStatus: 'draft' });
assert.equal(r.status, 0, r.stderr);
assert.match(r.stdout, new RegExp(`Lưu ý.*draft.*${REQ}`), 'requirement draft phải có cảnh báo');
assert.doesNotMatch(run().stdout, /draft/, 'requirement approved không cảnh báo draft');
// L30: cùng tên chữ ký decorator/interface mà khác tập khóa giữa requirement, API và architecture.md: cảnh báo (lỗi ở --strict)
const REQSIG = '- BR7: dùng `@RateLimit({ tier, perWindow, window })`.\n';
const APISIG = (keys = 'tier, limit, windowSeconds, key') => API().replace('## Endpoint', `Decorator \`@RateLimit({ ${keys} })\`.\n\n## Endpoint`);
bad({ reqBody: REQSIG, api: APISIG() }, /RateLimit.*PRJ|RateLimit.*requirement.*API|RateLimit.*khác/);
assert.equal(run({ reqBody: REQSIG.replace('perWindow, window', 'limit, windowSeconds, key').replace('tier,', 'tier,'), api: APISIG('key, tier, limit, windowSeconds') }).status, 0, 'cùng tập khóa (khác thứ tự) thì qua');
bad({ api: APISIG(), arch: '\nSessionContext: `interface SessionContext { user_id, role }`.\n', reqBody: 'x `interface SessionContext { user_id, role, display_name? }`\n' }, /SessionContext/);
const warnOnly = run({ reqBody: REQSIG, api: APISIG(), strict: false });
assert.equal(warnOnly.status, 0, warnOnly.stderr);
assert.match(warnOnly.stdout, /Lưu ý: .*RateLimit/);

// L44: mã lỗi chung lấy từ dòng "Mã chung" của requirement; API epic khác dùng mã gần trùng (khác tên hoặc kiểu đặt tên) thì cảnh báo (lỗi ở --strict)
const COMMON = 'Mã chung: `validation-failed` (400), `csrf_failed` (403), `not-found` (404), `rate-limited` (429).';
const apiErr = (txt) => API().replace('## Endpoint', `Lỗi 400: ${txt}.\n\n## Endpoint`);
bad({ common: COMMON, api: apiErr('`type` `urn:ecom:error:validation`') }, /validation.*gần trùng.*validation-failed/);
bad({ common: COMMON, api: apiErr('`type` `urn:ecom:error:csrf-failed`') }, /csrf-failed.*gần trùng.*csrf_failed/);
bad({ common: COMMON, api: apiErr('`type` `urn:ecom:error:not_found`') }, /not_found.*gần trùng.*not-found/);
assert.equal(run({ common: COMMON, api: apiErr('`type` `urn:ecom:error:validation-failed`, `urn:ecom:error:order-not-found`') }).status, 0, 'đúng mã chung hoặc mã riêng khác hẳn thì qua');
const lax44 = run({ common: COMMON, api: apiErr('`type` `urn:ecom:error:validation`'), strict: false });
assert.equal(lax44.status, 0, lax44.stderr);
assert.match(lax44.stdout, /Lưu ý: .*validation.*gần trùng/);
// L58: mối đe dọa Kiểm bằng test mà Biện pháp nằm ở hạ tầng ngoài ứng dụng (CDN, bucket, proxy, header phản hồi của kho): cảnh báo (lỗi ở --strict)
bad({ sec: SEC('SB-06', 'gửi `X-Content-Type-Options: nosniff` lưu cùng đối tượng, CDN giữ nguyên header', 'test') }, /T1.*hạ tầng/);
bad({ sec: SEC('SB-06', 'bucket chặn truy cập công khai', 'test') }, /T1.*hạ tầng/);
assert.equal(run({ sec: SEC('SB-06', 'bucket chặn truy cập công khai', 'config') }).status, 0, 'Kiểm bằng config thì qua');
assert.equal(run({ sec: SEC('SB-06', 'bucket chặn truy cập công khai', 'test, review') }).status, 0, 'có review thì qua');
const lax58 = run({ sec: SEC('SB-06', 'CDN giữ nguyên header', 'test'), strict: false });
assert.equal(lax58.status, 0, lax58.stderr);
assert.match(lax58.stdout, /Lưu ý: .*T1.*hạ tầng/);
console.log('OK: check-tech-design.mjs');
