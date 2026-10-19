import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { AppModule } from '../../src/app.module';
import { AppLogger, Clock, ConfigService, auditPermissions, auditRoutes, configureApp, parseMatrix, routeIds } from '../../src/modules/platform';
import { FakeClock, testConfig } from '../support/app';
import { REPO_ROOT } from '../support/db';

const MATRIX = readFileSync(resolve(REPO_ROOT, 'spec/permissions-matrix.md'), 'utf8');
// route của REV nằm dưới /products/:product_id/ (đánh giá, điều kiện đánh giá) không thuộc PRD (REV-TC-20261006-104523767: sửa test nền kèm theo REV)
const PRD_SCOPE = (id: string) => /\s\/api\/v1\/(categories|products|admin\/categories|admin\/products)(\/|$)/.test(id) && !/\/products\/:product_id\/review/.test(id);
// Hàng "Xem điểm đánh giá" không có endpoint riêng: điểm là trường của danh sách và chi tiết, đổi bằng event của REV (tác nhân system, không HTTP).
// Bốn hàng quyền con của đợt bán hàng hộ (SB-42) không có endpoint riêng: quyền thấy, ghi giá vốn là SERIALIZER theo role của phiên trên các endpoint đã có
// (test tập khóa ở cost-price.spec.ts), và chi tiết công khai trùng hàng "Xem chi tiết sản phẩm đang bán".
const EXEMPT = [
  'Xem điểm đánh giá của sản phẩm',
  'Xem sản phẩm ở trang quản trị không kèm giá vốn (staff, sale, admin; chỉ đọc)',
  'Xem giá vốn (`cost_price`) ở danh sách và chi tiết sản phẩm quản trị',
  'Ghi giá vốn (`cost_price`) khi tạo và sửa sản phẩm',
  'Xem chi tiết sản phẩm đang bán, không kèm giá vốn (mọi role kể cả sale)',
];
const opts = { scope: PRD_SCOPE, epic: 'PRD', exempt: EXEMPT };

describe('PRD kiểm quyền theo ma trận trên AppModule thật (PRD-SEC T1, SB-05, SB-07)', () => {
  let app: INestApplication;
  beforeAll(async () => {
    const m = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(ConfigService).useValue(testConfig()).overrideProvider(Clock).useValue(new FakeClock()).compile();
    app = m.createNestApplication({ bodyParser: false, logger: false });
    configureApp(app, { config: testConfig(), logger: AppLogger.create({ level: 'error', env: 'dev' }) });
    await app.init();
  });
  afterAll(() => app.close());

  it('PRD-TC-20261006-100355410: mọi route của PRD khai quyền, schema và @Action khớp ma trận; tuyến tĩnh search đăng ký trước :id; đủ 18 route (thêm import và tệp mẫu)', () => {
    expect(auditRoutes(app)).toEqual([]);
    expect(auditPermissions(app, MATRIX, opts)).toEqual([]);
    expect(parseMatrix(MATRIX).filter((r) => r.requirement.startsWith('PRD-REQ-'))).toHaveLength(19);
    const ids = routeIds(app).filter(PRD_SCOPE);
    expect(ids).toHaveLength(18);
    expect(ids.indexOf('GET /api/v1/products/search')).toBeLessThan(ids.indexOf('GET /api/v1/products/:id'));
  });

  it('PRD-TC-20261006-100355547: kiểm lệch ma trận báo khi ma trận hay code sai và đóng khi công cụ hỏng', () => {
    // staff được ghi sản phẩm (sửa hàng ma trận) -> báo lệch
    const widened = MATRIX.replace(/^(\| Tạo sản phẩm nháp \|[^|]*\|[^|]*\|[^|]*\|)[^|]*\|/m, '$1 Y |');
    expect(widened).not.toBe(MATRIX);
    expect(auditPermissions(app, widened, opts).join('\n')).toContain('POST /api/v1/admin/products: code cho [admin] nhưng ma trận (Tạo sản phẩm nháp) cho [admin, staff]');
    // guest không còn xem được cây danh mục -> code @Public lệch
    const closed = MATRIX.replace(/^(\| Xem cây danh mục \|[^|]*\|)[^|]*\|/m, '$1 - |');
    expect(auditPermissions(app, closed, opts).join('\n')).toContain('code khai @Public nhưng ma trận không cho guest (Xem cây danh mục)');
    // hàng đổi tên: @Action không còn trong ma trận
    expect(auditPermissions(app, MATRIX.replace('| Công bố sản phẩm |', '| Công bố |'), opts).join('\n')).toContain('không có trong permissions-matrix.md');
    // ma trận rỗng: lỗi, không im lặng cho qua
    expect(auditPermissions(app, '', opts)).toEqual(['ma trận quyền rỗng hoặc không đọc được (không tìm thấy hàng nào có mã requirement)']);
    // phạm vi rỗng mà epic có hàng: báo từng hàng thiếu endpoint (14 hàng có endpoint, năm hàng quyền con và điểm đánh giá được miễn)
    expect(auditPermissions(app, MATRIX, { scope: () => false, epic: 'PRD', exempt: EXEMPT }).filter((l) => l.includes('không có endpoint nào khai @Action'))).toHaveLength(14);
    // không miễn hàng điểm đánh giá thì báo hàng đó (hàng không có endpoint là lỗi trừ khi khai miễn có chủ đích)
    expect(auditPermissions(app, MATRIX, { ...opts, exempt: [] }).join('\n')).toContain('hàng ma trận "Xem điểm đánh giá của sản phẩm" của PRD không có endpoint nào khai @Action');
  });
});
