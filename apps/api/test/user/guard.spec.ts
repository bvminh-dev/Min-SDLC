import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { AppModule } from '../../src/app.module';
import { AppLogger, Clock, ConfigService, auditPermissions, auditRoutes, configureApp, parseMatrix } from '../../src/modules/platform';
import { FakeClock, testConfig } from '../support/app';
import { REPO_ROOT } from '../support/db';

const MATRIX = readFileSync(resolve(REPO_ROOT, 'spec/permissions-matrix.md'), 'utf8');
const USR_SCOPE = (id: string) => /\s\/api\/v1\/(me|admin\/customers)(\/|$)/.test(id);
const opts = { scope: USR_SCOPE, epic: 'USR' };

describe('USR kiểm quyền theo ma trận trên AppModule thật (USR-SEC T18, SB-05, SB-07)', () => {
  let app: INestApplication;
  beforeAll(async () => {
    const m = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(ConfigService).useValue(testConfig()).overrideProvider(Clock).useValue(new FakeClock()).compile();
    app = m.createNestApplication({ bodyParser: false, logger: false });
    configureApp(app, { config: testConfig(), logger: AppLogger.create({ level: 'error', env: 'dev' }) });
    await app.init();
  });
  afterAll(() => app.close());

  it('USR-TC-20261006-102054271: mọi route /me và /admin/customers khai quyền, schema và @Action khớp ma trận (tra theo email và theo id là hai hàng)', () => {
    expect(auditRoutes(app)).toEqual([]);
    expect(auditPermissions(app, MATRIX, opts)).toEqual([]);
    expect(parseMatrix(MATRIX).filter((r) => r.requirement.startsWith('USR-REQ-'))).toHaveLength(10);
  });

  it('USR-TC-20261006-102053767: kiểm lệch ma trận báo khi code hay ma trận sai và đóng khi công cụ hỏng', () => {
    // đổi một hàng: sổ địa chỉ cho staff -> báo lệch
    const tampered = MATRIX.replace(/^(\| Xem danh sách địa chỉ giao hàng của mình \|[^|]*\|[^|]*\|[^|]*\|)[^|]*\|/m, '$1 Y |');
    expect(tampered).not.toBe(MATRIX);
    expect(auditPermissions(app, tampered, opts).join('\n')).toContain('code cho [customer] nhưng ma trận (Xem danh sách địa chỉ giao hàng của mình) cho [customer, staff]');
    // sale tự phục vụ GIỐNG HỆT staff ở hồ sơ, mật khẩu, ảnh (không có sổ địa chỉ); bỏ sale khỏi hàng đổi mật khẩu thì bị báo
    for (const r of parseMatrix(MATRIX).filter((x) => /^USR-REQ-/.test(x.requirement) && x.staff === 'own')) expect(r.sale).toBe('own');
    const noSale = MATRIX.replace(/^(\| Đổi mật khẩu \|[^|]*\|[^|]*\|[^|]*\|[^|]*\|)[^|]*\|/m, '$1 - |');
    expect(noSale).not.toBe(MATRIX);
    expect(auditPermissions(app, noSale, opts).join('\n')).toContain('code cho [admin, customer, sale, staff] nhưng ma trận (Đổi mật khẩu) cho [admin, customer, staff]');
    // hàng đổi tên: @Action không còn trong ma trận
    expect(auditPermissions(app, MATRIX.replace('| Đổi mật khẩu |', '| Đổi mật khẩu của tôi |'), opts).join('\n')).toContain('không có trong permissions-matrix.md');
    // ma trận rỗng: lỗi, không im lặng cho qua
    expect(auditPermissions(app, '', opts)).toEqual(['ma trận quyền rỗng hoặc không đọc được (không tìm thấy hàng nào có mã requirement)']);
    // staff được vào route theo id (hàng ma trận theo id bị sửa cho staff Y): báo, không còn ngoại lệ nào để che
    const widened = MATRIX.replace(/^(\| Tra cứu hồ sơ khách theo id \(chỉ admin: đầy đủ kèm địa chỉ\) \|[^|]*\|[^|]*\|[^|]*\|)[^|]*\|/m, '$1 Y |');
    expect(widened).not.toBe(MATRIX);
    expect(auditPermissions(app, widened, opts).join('\n')).toContain('GET /api/v1/admin/customers/:id: code cho [admin] nhưng ma trận (Tra cứu hồ sơ khách theo id (chỉ admin: đầy đủ kèm địa chỉ)) cho [admin, staff]');
    // phạm vi rỗng (không route nào khớp) mà epic có hàng: báo từng hàng thiếu endpoint
    expect(auditPermissions(app, MATRIX, { scope: () => false, epic: 'USR' }).filter((l) => l.includes('không có endpoint nào khai @Action'))).toHaveLength(10);
  });
});
