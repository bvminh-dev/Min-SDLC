import type { Request } from 'express';
import { AppModule } from '../../src/app.module';
import { ConfigError, OBJECT_STORAGE, UnconfiguredStorage, S3Storage, allowMultipart, createStorage, errorRegistry, loadConfig } from '../../src/modules/platform';
import { buildProblem } from '../../src/modules/platform/errors/problem';
import { isAllowedMultipart } from '../../src/modules/platform/http/multipart';
import { Test } from '@nestjs/testing';
import { Clock, ConfigService } from '../../src/modules/platform';
import { FakeClock, baseEnv, testConfig } from '../support/app';
import { testDbUrl } from '../support/db';

// Phần nền sửa kèm khi làm PRD (kho object chuyển từ module user sang platform, ngoại lệ multipart theo mẫu đường dẫn, trường phụ dạng danh sách của problem+json, mã `image-invalid` chung):
// test dưới test/platform/ cho từng chỗ sửa (check-report L53). Gắn vào TC của PRD dùng các phần này.
const req = (method: string, path: string, multipart = true): Request => ({ method, path, is: (t: string) => (multipart && t === 'multipart/form-data' ? t : false) }) as unknown as Request;

describe('platform dùng chung cho ảnh sản phẩm (PRD)', () => {
  it('PRD-TC-20261006-100355666: ngoại lệ multipart theo mẫu đường dẫn chỉ khớp đúng method, đúng cấu trúc và kiểu multipart', () => {
    allowMultipart('POST', '/api/v1/prd-test/:id/images');
    const ok = (m: string, p: string, multipart = true) => isAllowedMultipart(req(m, p, multipart));
    expect(ok('POST', '/api/v1/prd-test/3f2a/images')).toBe(true);
    expect(ok('POST', '/api/v1/prd-test/3f2a/images/')).toBe(true); // dấu / cuối
    expect(ok('PUT', '/api/v1/prd-test/3f2a/images')).toBe(false); // sai method
    expect(ok('POST', '/api/v1/prd-test/3f2a/images', false)).toBe(false); // không phải multipart (vẫn 415 ở app-setup)
    expect(ok('POST', '/api/v1/prd-test//images')).toBe(false); // :id rỗng
    expect(ok('POST', '/api/v1/prd-test/a/b/images')).toBe(false); // :id chỉ một đoạn
    expect(ok('POST', '/api/v1/prd-test/3f2a/images/extra')).toBe(false);
    expect(ok('POST', '/x/api/v1/prd-test/3f2a/images')).toBe(false); // khớp cả chuỗi, không khớp một phần
    expect(ok('POST', '/api/v1/prd-testX/3f2a/images')).toBe(false);
    expect(ok('POST', '/api/v1/admin/products/abc/images')).toBe(true); // route thật của PRD (khai ở admin.controller.ts, nạp cùng AppModule)
    expect(ok('POST', '/api/v1/admin/products/abc/publish')).toBe(false); // route khác của PRD không được miễn
    expect(ok('PUT', '/api/v1/admin/products/abc/images/order')).toBe(false);
  });

  it('PRD-TC-20261006-100355479: trường phụ của problem+json nhận danh sách mã (reasons, missing) nhưng không đè khóa chuẩn', () => {
    const b = buildProblem('category-not-empty', 'trace-1', { extra: { reasons: ['has_children', 'has_products'], note: 'x' } }, errorRegistryWith());
    expect(b).toMatchObject({ type: 'urn:ecom:error:category-not-empty', status: 409, trace_id: 'trace-1', reasons: ['has_children', 'has_products'], note: 'x' });
    const hostile = buildProblem('category-not-empty', 'trace-2', { extra: { type: 'urn:evil', status: 200, trace_id: 'x', errors: ['x'], title: 'x', detail: 'x' } as never }, errorRegistryWith());
    expect([hostile.type, hostile.status, hostile.trace_id]).toEqual(['urn:ecom:error:category-not-empty', 409, 'trace-2']);
    expect(hostile).not.toHaveProperty('errors');
  });

  it('PRD-TC-20261006-100355691: `image-invalid` là mã chung đúng một lần (USR và PRD cùng dùng), sổ mã của AppModule thật sạch', async () => {
    const m = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(ConfigService).useValue(testConfig()).overrideProvider(Clock).useValue(new FakeClock()).compile();
    try {
      expect(errorRegistry.audit()).toEqual([]); // không mã trùng sau khi nạp USR và PRD
      expect(errorRegistry.get('image-invalid')).toMatchObject({ status: 400, title: 'Image rejected' });
      for (const code of ['category-not-empty', 'product-not-publishable', 'product-version-conflict', 'product-sku-taken']) expect(errorRegistry.get(code)).toBeDefined();
      expect(m.get(OBJECT_STORAGE)).toBeDefined(); // kho là provider chung của platform
    } finally { await m.close(); }
  });

  it('PRD-TC-20261006-100355691: kho object là cấu hình của platform: dev để trống là kho chưa cấu hình (503 khi ghi), đặt đủ thì S3; staging thiếu biến thì nêu tên biến, không in giá trị', async () => {
    expect(createStorage(loadConfig(baseEnv()))).toBeInstanceOf(UnconfiguredStorage);
    await expect(createStorage(loadConfig(baseEnv())).put('products/x.jpg', Buffer.from('x'), { contentType: 'image/jpeg' })).rejects.toMatchObject({ code: 'service-unavailable' });
    const keys = { STORAGE_ENDPOINT: 'http://127.0.0.1:9', STORAGE_ACCESS_KEY: 'k'.repeat(20), STORAGE_SECRET_KEY: 's'.repeat(40) };
    expect(createStorage(loadConfig(baseEnv(keys)))).toBeInstanceOf(S3Storage);
    expect(() => createStorage(loadConfig(baseEnv({ STORAGE_ENDPOINT: 'http://127.0.0.1:9' })))).toThrow(ConfigError); // thiếu khóa
    const tls = `${testDbUrl()}?sslmode=require`;
    const err = (() => { try { loadConfig({ ...baseEnv({ APP_ENV: 'staging', DATABASE_URL: tls }), RETENTION_DATABASE_URL: tls }); return null; } catch (e) { return e as ConfigError; } })();
    expect(err!.problems.map((p) => p.name).sort()).toEqual(['STORAGE_ACCESS_KEY', 'STORAGE_ENDPOINT', 'STORAGE_SECRET_KEY']);
    expect(err!.format()).not.toContain(tls);
  });
});

/** Sổ mã có sẵn các mã của PRD (đã đăng ký khi nạp module ở bộ test khác trong cùng tiến trình có thể chưa có: đăng ký tại chỗ). */
function errorRegistryWith() {
  const r = new (errorRegistry.constructor as new () => typeof errorRegistry)();
  r.register({ code: 'category-not-empty', status: 409, title: 'Category still has children or products' });
  r.register({ code: 'internal-error', status: 500, title: 'Internal server error' });
  return r;
}
