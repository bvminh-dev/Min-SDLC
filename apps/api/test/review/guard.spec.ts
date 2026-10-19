import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { AppModule } from '../../src/app.module';
import * as reviewIndex from '../../src/modules/review';
import { ConfigError, auditPermissions, auditRoutes, errorRegistry, loadConfig, parseMatrix, routeIds } from '../../src/modules/platform';
import { REPO_ROOT, truncateAll } from '../support/db';
import { baseEnv } from '../support/app';
import { createAuthApp, type AuthApp } from '../support/auth';
import { seedSession, seedUser } from '../support/auth';
import { call } from '../support/usr';

// Kiểm quyền, ranh giới và mã lỗi của REV trên AppModule thật (REV-SEC-20261006-103618395: T3, T4, T15, T21; SB-05, SB-07, SB-13, SB-35).
const MATRIX = readFileSync(resolve(REPO_ROOT, 'spec/permissions-matrix.md'), 'utf8');
const REV_SCOPE = (id: string) => /\s\/api\/v1\/(products\/[^/]+\/review|review-images|reviews|me\/reviews|admin\/reviews)/.test(id);
// Ba hàng không có endpoint riêng: luật điểm và bình luận nằm trong schema của tạo và sửa; job dọn ảnh do bộ lập lịch (tác nhân system).
const INTERNAL = ['Chấm điểm sao khi tạo hoặc sửa đánh giá', 'Viết bình luận khi tạo hoặc sửa đánh giá', 'Dọn ảnh mồ côi và ảnh của đánh giá đã xóa (job nền `rev.sweep-orphan-images`, không có endpoint)'];
const opts = { scope: REV_SCOPE, epic: 'REV', exempt: INTERNAL };
const SEC = 'REV-SEC-20261006-103618395';

describe('REV kiểm quyền và ranh giới trên AppModule thật', () => {
  let t: AuthApp;
  beforeAll(async () => { t = await createAuthApp({ imports: [AppModule], controllers: [], env: { TRUST_PROXY_HOPS: '1' } }); });
  afterAll(() => t.close());
  beforeEach(async () => { await truncateAll(t.prisma); t.clock.advance(61_000); });

  it(`REV-TC-20261006-104528170 ${SEC} T3, T21: danh sách route của REV đúng 13 route của REV-API; không có đường HTTP nào để nhận event, sửa nội dung bằng admin hay đổi trạng thái`, async () => {
    expect(routeIds(t.app).filter(REV_SCOPE).sort()).toEqual([
      'DELETE /api/v1/reviews/:id', 'GET /api/v1/admin/reviews', 'GET /api/v1/me/reviews', 'GET /api/v1/me/reviews/:id', 'GET /api/v1/products/:product_id/review-eligibility', 'GET /api/v1/products/:product_id/reviews',
      'PATCH /api/v1/reviews/:id', 'POST /api/v1/admin/reviews/:id/approve', 'POST /api/v1/admin/reviews/:id/hide', 'POST /api/v1/admin/reviews/:id/reject', 'POST /api/v1/admin/reviews/:id/unhide',
      'POST /api/v1/products/:product_id/reviews', 'POST /api/v1/review-images',
    ].sort());
    const admin = await seedUser(t, { email: 'ad@shop.vn', role: 'admin' }), staff = await seedUser(t, { email: 'st@shop.vn', role: 'staff' });
    const ac = (await seedSession(t, admin.id)).cookie, sc = (await seedSession(t, staff.id)).cookie;
    const id = '3f6c1f0e-9d1a-4a55-8d6b-1f2a3b4c5d6e';
    const attempts: [string, string, unknown][] = [
      ['post', '/reviews/events', { type: 'ReviewPublished' }], ['post', '/admin/reviews/events', {}], ['patch', `/admin/reviews/${id}`, { comment: 'sửa hộ', status: 'published' }], ['put', `/reviews/${id}`, {}],
      ['post', `/reviews/${id}/approve`, {}], ['post', `/admin/reviews/${id}/publish`, {}], ['post', `/admin/reviews/${id}/delete`, {}], ['delete', `/admin/reviews/${id}`, {}], ['post', '/admin/reviews', {}],
      ['post', `/me/reviews/${id}`, {}], ['patch', `/me/reviews/${id}`, {}],
    ];
    for (const who of [undefined, sc, ac]) for (const [m, p, body] of attempts) {
      const r = await call(t, m as 'post', p, { cookie: who, body });
      expect([m, p, [401, 404, 405].includes(r.status)]).toEqual([m, p, true]);
      if (who) expect([404, 405]).toContain(r.status);
    }
  });

  it(`REV-TC-20261006-104523936 REV-TC-20261006-104526113 REV-TC-20261006-104527768 ${SEC} T3, T4: mọi route của REV khai quyền, schema và @Action khớp ma trận (customer own, admin); AppModule vẫn sạch; báo khi ma trận hay code sai và đóng khi công cụ hỏng`, async () => {
    expect(auditRoutes(t.app)).toEqual([]);
    expect(auditPermissions(t.app, MATRIX, opts)).toEqual([]);
    expect(parseMatrix(MATRIX).filter((r) => r.requirement.startsWith('REV-REQ-')).map((r) => r.action).sort()).toEqual([
      'Ẩn đánh giá đã đăng', 'Bỏ ẩn đánh giá (hidden về published)', 'Duyệt đánh giá chờ duyệt', ...INTERNAL, 'Kiểm điều kiện được đánh giá sản phẩm (mua có xác minh)', 'Sửa đánh giá của mình', 'Tải ảnh đính kèm đánh giá',
      'Tạo đánh giá sản phẩm (người đã nhận hàng)', 'Từ chối đánh giá chờ duyệt', 'Xem hàng đợi và danh sách đánh giá để kiểm duyệt', 'Xem đánh giá của tôi (danh sách và chi tiết)', 'Xem đánh giá công khai của sản phẩm',
      'Xóa đánh giá (chủ hoặc admin)',
    ].sort());
    for (const r of parseMatrix(MATRIX).filter((x) => x.action.startsWith('Dọn ảnh mồ côi'))) expect([r.guest, r.customer, r.staff, r.admin, r.system]).toEqual(['-', '-', '-', '-', 'Y']);
    // staff không có quyền kiểm duyệt: mở ma trận cho staff thì code lệch
    const widened = MATRIX.replace(/^(\| Duyệt đánh giá chờ duyệt \|[^|]*\|[^|]*\|[^|]*\|)[^|]*\|/m, '$1 Y |');
    expect(widened).not.toBe(MATRIX);
    expect(auditPermissions(t.app, widened, opts).join('\n')).toContain('POST /api/v1/admin/reviews/:id/approve: code cho [admin] nhưng ma trận (Duyệt đánh giá chờ duyệt) cho [admin, staff]');
    // admin không sửa nội dung: cho admin sửa trong ma trận thì code lệch
    const adminEdit = MATRIX.replace(/^(\| Sửa đánh giá của mình \|[^|]*\|[^|]*\|[^|]*\|[^|]*\|[^|]*\|)[^|]*\|/m, '$1 Y |');
    expect(adminEdit).not.toBe(MATRIX);
    expect(auditPermissions(t.app, adminEdit, opts).join('\n')).toContain('PATCH /api/v1/reviews/:id: code cho [customer] nhưng ma trận (Sửa đánh giá của mình) cho [admin, customer]');
    const closed = MATRIX.replace(/^(\| Xem đánh giá công khai của sản phẩm \|[^|]*\|)[^|]*\|/m, '$1 - |');
    expect(auditPermissions(t.app, closed, opts).join('\n')).toContain('code khai @Public nhưng ma trận không cho guest');
    expect(auditPermissions(t.app, MATRIX.replace('| Ẩn đánh giá đã đăng |', '| Ẩn |'), opts).join('\n')).toContain('không có trong permissions-matrix.md');
    expect(auditPermissions(t.app, '', opts)).toEqual(['ma trận quyền rỗng hoặc không đọc được (không tìm thấy hàng nào có mã requirement)']);
    expect(auditPermissions(t.app, MATRIX, { scope: () => false, epic: 'REV', exempt: INTERNAL }).filter((l) => l.includes('không có endpoint nào khai @Action'))).toHaveLength(12);
    expect(auditPermissions(t.app, MATRIX, { ...opts, exempt: [] }).join('\n')).toContain('không có endpoint nào khai @Action');
  });

  it(`${SEC} T21 (SB-35): REV chỉ phơi ReviewModule ở điểm vào công khai; mã lỗi của REV có trong sổ mã và chỉ khai một lần`, () => {
    expect(Object.keys(reviewIndex).sort()).toEqual(['ReviewModule']);
    expect(errorRegistry.get('review-conflict')).toMatchObject({ status: 409 });
    expect(errorRegistry.audit()).toEqual([]);
    for (const code of ['idempotency-key-required', 'idempotency-key-reused', 'image-invalid', 'rate-limited', 'validation-failed', 'not-found']) expect(errorRegistry.get(code)).toBeTruthy();
  });

  it(`${SEC} T6 (ADR-007): REVIEW_PRE_MODERATION mặc định bật, nhận true hoặc false, giá trị khác khiến khởi động dừng và nêu tên biến`, () => {
    expect(loadConfig(baseEnv()).get('REVIEW_PRE_MODERATION')).toBe(true);
    expect(loadConfig(baseEnv({ REVIEW_PRE_MODERATION: 'false' })).get('REVIEW_PRE_MODERATION')).toBe(false);
    expect(loadConfig(baseEnv({ REVIEW_PRE_MODERATION: 'true' })).get('REVIEW_PRE_MODERATION')).toBe(true);
    for (const bad of ['yes', '1', 'TRUE', 'tru']) {
      let err: unknown;
      try { loadConfig(baseEnv({ REVIEW_PRE_MODERATION: bad })); } catch (e) { err = e; }
      expect([bad, err instanceof ConfigError, String((err as Error)?.message)]).toEqual([bad, true, expect.stringContaining('REVIEW_PRE_MODERATION')]);
    }
    expect(readFileSync(resolve(REPO_ROOT, '.env.example'), 'utf8')).toContain('REVIEW_PRE_MODERATION');
  });
});
