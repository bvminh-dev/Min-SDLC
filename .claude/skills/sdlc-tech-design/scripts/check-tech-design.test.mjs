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
const SEC = (sb = 'SB-06') => `---
id: ORD-SEC-20261006-110000003
epic: ORD
links: [${REQ}]
---
## Mối đe dọa
| Mã | STRIDE | Tài sản | Mối đe dọa | Biện pháp | SB | Kiểm bằng |
|---|---|---|---|---|---|---|
| T1 | E | đơn | IDOR | kiểm sở hữu | ${sb} | test |
`;

function run({ db = DB(), api = API(), sec = SEC() } = {}) {
  const r = mkdtempSync(join(tmpdir(), 'design-'));
  put(r, 'permissions-matrix.md', '| Hành động | Requirement | guest | customer | staff | admin | system |\n|---|---|---|---|---|---|\n');
  put(r, 'domain/entities.md', '| Entity          | Epic | Khóa |\n|---|---|---|\n| Order | ORD | id |\n| StockItem | INV | id |\n| User | AUTH | id |\n\n| Entity        | Từ | Sang | Điều kiện |\n|---|---|---|---|\n| Order | pending | paid | x |\n');
  put(r, 'domain/events.md', '| Event | Entity | Producer | Consumers | Payload | Phát khi |\n|---|---|---|---|---|---|\n| OrderPaid | Order | ORD | SHP | id | Order:paid |\n');
  put(r, 'architecture.md', '| Epic | Module | Phụ thuộc |\n|---|---|---|\n| AUTH | auth | - |\n| ORD | order | AUTH |\n| INV | inventory | - |\n');
  put(r, 'security-baseline.md', '| Mã | Yêu cầu | Kiểm bằng | Epic |\n|---|---|---|---|\n| SB-06 | IDOR | test | ORD |\n');
  put(r, `epics/ORD/requirements/${REQ}.md`, `---\nid: ${REQ}\nepic: ORD\nroles: [customer, system]\n---\n`);
  put(r, 'epics/ORD/design/ORD-DB-20261006-110000001.md', db);
  put(r, 'epics/ORD/design/ORD-API-20261006-110000002.md', api);
  put(r, 'epics/ORD/design/ORD-SEC-20261006-110000003.md', sec);
  return spawnSync('node', [script, r, '--strict'], { encoding: 'utf8' });
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
console.log('OK: check-tech-design.mjs');
