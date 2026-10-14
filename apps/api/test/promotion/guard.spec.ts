import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { AppModule } from '../../src/app.module';
import { AppLogger, Clock, ConfigService, auditPermissions, auditRoutes, configureApp, errorRegistry, parseMatrix, routeIds } from '../../src/modules/platform';
import { PromotionApi } from '../../src/modules/promotion';
import { FakeClock, testConfig } from '../support/app';
import { API_DIR, REPO_ROOT } from '../support/db';

const MATRIX = readFileSync(resolve(REPO_ROOT, 'spec/permissions-matrix.md'), 'utf8');
const ARCH = readFileSync(resolve(REPO_ROOT, 'spec/architecture.md'), 'utf8');
const PRM_SCOPE = (id: string) => /\s\/api\/v1\/admin\/coupons(\/|$)/.test(id);
// Bảy hàng của PRM không có endpoint: kiểm mã, hai cách tính tiền giảm, điều kiện giá trị đơn, hạn dùng, giới hạn lượt dùng (qua giỏ và checkout, gọi nội bộ) và vòng đời lượt theo event.
const EXEMPT = [
  'Kiểm tra mã và xem tiền giảm (qua giỏ và checkout, PRM không có endpoint công khai)', 'Giảm theo phần trăm có mức giảm tối đa (qua giỏ và checkout)', 'Giảm theo số tiền cố định (qua giỏ và checkout)',
  'Điều kiện giá trị đơn tối thiểu của coupon (qua giỏ và checkout)', 'Hạn dùng của coupon (qua giỏ và checkout)', 'Giới hạn lượt dùng của coupon (qua giỏ và checkout)', 'Giữ, tiêu thụ, nhả lượt coupon theo vòng đời đơn (do event, không có endpoint)',
];
const opts = { scope: PRM_SCOPE, epic: 'PRM', exempt: EXEMPT };

describe('PRM kiểm quyền theo ma trận trên AppModule thật (PRM-SEC T1, SB-05, SB-07)', () => {
  let app: INestApplication;
  beforeAll(async () => {
    const m = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(ConfigService).useValue(testConfig()).overrideProvider(Clock).useValue(new FakeClock()).compile();
    app = m.createNestApplication({ bodyParser: false, logger: false });
    configureApp(app, { config: testConfig(), logger: AppLogger.create({ level: 'error', env: 'dev' }) });
    await app.init();
  });
  afterAll(() => app.close());

  it('PRM-TC-20261006-101036662: mọi route của PRM khai quyền (chỉ admin), schema và @Action khớp ma trận; tuyến có đúng 7 route; mọi route của AppModule vẫn sạch', () => {
    expect(auditRoutes(app)).toEqual([]);
    expect(auditPermissions(app, MATRIX, opts)).toEqual([]);
    expect(parseMatrix(MATRIX).filter((r) => r.requirement.startsWith('PRM-REQ-'))).toHaveLength(12);
    for (const r of parseMatrix(MATRIX).filter((r) => r.requirement.startsWith('PRM-REQ-') && !EXEMPT.includes(r.action))) expect([r.action, r.guest, r.customer, r.staff, r.admin]).toEqual([r.action, '-', '-', '-', 'Y']); // staff không có quyền coupon
    expect(routeIds(app).filter(PRM_SCOPE).sort()).toEqual([
      'DELETE /api/v1/admin/coupons/:id', 'GET /api/v1/admin/coupons', 'GET /api/v1/admin/coupons/:id', 'PATCH /api/v1/admin/coupons/:id', 'POST /api/v1/admin/coupons',
      'POST /api/v1/admin/coupons/:id/disable', 'POST /api/v1/admin/coupons/:id/enable',
    ]);
    expect(routeIds(app).filter((id) => /coupon|promotion/i.test(id) && !PRM_SCOPE(id) && !/^(PUT|DELETE) \/api\/v1\/(cart\/coupon|checkout\/sessions\/:id\/coupon)$/.test(id))).toEqual([]); // PRM không có endpoint nào cho khách; áp, gỡ mã trên giỏ là route của CRT (CRT-REQ-20261006-103226511) và trên checkout là route của CHK (CHK-REQ-20261006-105051536), không phải của PRM
  });

  it('PRM-TC-20261006-101037169 và PRM-SEC-20261006-101036568 T1 (kiểm lệch ma trận, SB-05): báo khi ma trận hay code sai (staff được quyền coupon, hàng đổi tên) và đóng khi công cụ hỏng', () => {
    const widened = MATRIX.replace(/^(\| Tạo coupon \|[^|]*\|[^|]*\|[^|]*\|)[^|]*\|/m, '$1 Y |');
    expect(widened).not.toBe(MATRIX);
    expect(auditPermissions(app, widened, opts).join('\n')).toContain('POST /api/v1/admin/coupons: code cho [admin] nhưng ma trận (Tạo coupon) cho [admin, staff]');
    expect(auditPermissions(app, MATRIX.replace('| Tạo coupon |', '| Làm coupon |'), opts).join('\n')).toContain('không có trong permissions-matrix.md');
    expect(auditPermissions(app, '', opts)).toEqual(['ma trận quyền rỗng hoặc không đọc được (không tìm thấy hàng nào có mã requirement)']);
    expect(auditPermissions(app, MATRIX, { scope: () => false, epic: 'PRM', exempt: EXEMPT }).filter((l) => l.includes('không có endpoint nào khai @Action'))).toHaveLength(5);
    expect(auditPermissions(app, MATRIX, { ...opts, exempt: [] }).join('\n')).toContain('không có endpoint nào khai @Action');
  });

  it('PRM-API-20261006-101036543 mục Giao tiếp giữa module: PromotionApi đúng chữ ký bảng Giao diện module (evaluate với count_attempt, reserve với tx), không phụ thuộc module nào ngoài platform; sổ mã lỗi sạch và có đủ mã của spec', () => {
    // bảng Giao diện module của architecture.md: hàng CHK -> PRM và CRT -> PRM
    expect(ARCH).toMatch(/\| CHK \| PRM \| `PromotionApi\.evaluate\(\.\.\., count_attempt = true\)`[^|]*, `PromotionApi\.reserve\(\.\.\., tx\)` \| có \|/);
    expect(ARCH).toMatch(/\| CRT \| PRD, INV, PRM, SHP \| [^|]*`PromotionApi\.evaluate\(\.\.\., count_attempt\)`/);
    expect(ARCH).toMatch(/\|\s*PRM\s*\|\s*promotion\s*\|\s*-\s*\|/); // cột Phụ thuộc là `-`
    const proto = Object.getOwnPropertyNames(PromotionApi.prototype).filter((n) => n !== 'constructor').sort();
    expect(proto).toEqual(['evaluate', 'reserve']);
    expect([PromotionApi.prototype.evaluate.length, PromotionApi.prototype.reserve.length]).toEqual([1, 2]); // evaluate(input), reserve(input, tx)
    // ranh giới: mã của module chỉ import platform (điểm vào) và chính nó
    const dir = resolve(API_DIR, 'src/modules/promotion');
    const bad: string[] = [];
    for (const f of readdirSync(dir)) for (const m of readFileSync(resolve(dir, f), 'utf8').matchAll(/from '(\.\.\/[^']+)'/g)) if (!/^\.\.\/platform$/.test(m[1])) bad.push(`${f}: ${m[1]}`);
    expect(bad).toEqual([]);
    expect(errorRegistry.audit()).toEqual([]);
    for (const code of ['code_taken', 'field_immutable', 'coupon_not_editable', 'usage_limit_below_used', 'version_mismatch', 'invalid_transition', 'coupon_expired', 'coupon_exhausted']) expect([code, errorRegistry.get(code)?.status]).toEqual([code, code === 'field_immutable' ? 400 : 409]);
  });
});
