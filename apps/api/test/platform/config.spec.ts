import { ConfigError, cfg, loadConfig, type ConfigFragment } from '../../src/modules/platform';
import { bootApp, freePort, portOpen, waitFor } from '../support/boot';
import { testDbUrl } from '../support/db';

const TLS_URL = 'postgresql://u:pw-not-printed@db.example:5432/app?sslmode=require'; // scan-secrets:allow giá trị giả của test
const rand = (n: number) => Array.from({ length: n }, (_, i) => 'q3Z8k2Mx9R7wE5tY4uI1oP6aS0dFgHjK'[(i * 7 + 3) % 32]).join('') + 'mN'.repeat(n).slice(0, 0);
const problems = (fn: () => unknown) => { try { fn(); } catch (e) { if (e instanceof ConfigError) return e; throw e; } throw new Error('không ném ConfigError'); };
const base = { APP_ENV: 'dev', DATABASE_URL: 'postgresql://u:pw@localhost:5433/x', CORS_ALLOWED_ORIGINS: 'http://localhost:3000' };

describe('Cấu hình kiểm schema lúc khởi động (PRJ-REQ-20261006-095422735)', () => {
  it('PRJ-TC-20261006-100124861: cấu hình hợp lệ ở dev mở cổng PORT và log một dòng "config ok" liệt kê tên biến, không giá trị', async () => {
    const port = await freePort();
    const b = bootApp({ ...base, DATABASE_URL: testDbUrl(), PORT: String(port), SOME_UNKNOWN_VAR: 'abc-unknown-value' });
    try {
      expect(await waitFor(() => portOpen(port))).toBe(true);
      const lines = b.stdout().split('\n').filter(Boolean).map((l) => JSON.parse(l));
      const ok = lines.filter((l) => l.msg === 'config ok');
      expect(ok).toHaveLength(1);
      const names = ok[0].vars.map((v: { name: string }) => v.name);
      expect(names).toEqual(expect.arrayContaining(['APP_ENV', 'DATABASE_URL', 'PORT', 'CORS_ALLOWED_ORIGINS']));
      expect(b.stdout()).not.toContain('pw@'); // PRJ-TC-20261006-100125022: biến lạ và giá trị nhạy cảm không vào log
      expect(b.stdout()).not.toContain('abc-unknown-value');
      expect(names).not.toContain('SOME_UNKNOWN_VAR');
      expect(lines.every((l) => l.time && l.level && l.msg && l.module && l.env && l.correlation_id)).toBe(true);
    } finally { b.kill(); await b.exited; }
  }, 60_000);

  it.each(['dev', 'staging', 'prod'])('PRJ-TC-20261006-100124883: thiếu DATABASE_URL và CORS_ALLOWED_ORIGINS ở %s, thoát mã khác 0, liệt kê cả hai tên, không mở cổng', async (appEnv) => {
    const port = await freePort();
    const b = bootApp({ APP_ENV: appEnv, PORT: String(port) });
    const code = await b.exited;
    expect(code).not.toBe(0);
    expect(b.stderr()).toContain('DATABASE_URL');
    expect(b.stderr()).toContain('CORS_ALLOWED_ORIGINS');
    expect(await portOpen(port)).toBe(false);
  }, 60_000);

  it('PRJ-TC-20261006-100124883 (đơn vị): lỗi gom một lượt, không in giá trị', () => {
    const e = problems(() => loadConfig({ APP_ENV: 'dev', PORT: 'abc-secret-looking' }));
    expect(e.problems.map((p) => p.name).sort()).toEqual(['CORS_ALLOWED_ORIGINS', 'DATABASE_URL', 'PORT']);
    expect(e.format()).not.toContain('abc-secret-looking');
  });

  it('PRJ-TC-20261006-100124905: prod từ chối bí mật giữ chỗ changeme, example, test và rỗng, nêu tên biến và lý do, không in giá trị', () => {
    const secret: ConfigFragment = { PAYMENT_HASH_SECRET: cfg.secret() };
    for (const v of ['changeme', 'example-key-long-long-long-long-xxxxxxx', 'test', 'Test-1234567890123456789012345678901', '']) {
      const e = problems(() => loadConfig({ ...base, APP_ENV: 'prod', DATABASE_URL: TLS_URL, RETENTION_DATABASE_URL: TLS_URL, PAYMENT_HASH_SECRET: v }, [secret]));
      expect(e.problems.map((p) => p.name)).toEqual(['PAYMENT_HASH_SECRET']);
      expect(e.problems[0].reason).toMatch(/giữ chỗ|thiếu hoặc rỗng/);
      if (v.length > 8) expect(e.format()).not.toContain(v); // giá trị ngắn trùng đúng từ khóa chính sách thì lý do nêu từ khóa đó, không phải lộ giá trị
    }
  });

  it('PRJ-TC-20261006-100124927: prod từ chối CORS *, CSDL không TLS và log debug; cùng cấu hình ở dev khởi động được', () => {
    const prodBase = { ...base, APP_ENV: 'prod', DATABASE_URL: TLS_URL, RETENTION_DATABASE_URL: TLS_URL };
    expect(problems(() => loadConfig({ ...prodBase, CORS_ALLOWED_ORIGINS: '*' })).problems.map((p) => p.name)).toEqual(['CORS_ALLOWED_ORIGINS']);
    expect(problems(() => loadConfig({ ...prodBase, DATABASE_URL: 'postgresql://u:p@db:5432/a' })).problems.map((p) => p.name)).toEqual(['DATABASE_URL']); // scan-secrets:allow giá trị giả của test
    expect(problems(() => loadConfig({ ...prodBase, LOG_LEVEL: 'debug' })).problems.map((p) => p.name)).toEqual(['LOG_LEVEL']);
    expect(() => loadConfig({ ...base, CORS_ALLOWED_ORIGINS: '*', LOG_LEVEL: 'debug' })).not.toThrow();
    expect(() => loadConfig(prodBase)).not.toThrow();
    // kết nối riêng của job dọn audit: bắt buộc ở staging và prod (ADR-007), và phải TLS
    const { RETENTION_DATABASE_URL: _omit, ...noRetention } = prodBase;
    expect(problems(() => loadConfig(noRetention)).problems.map((p) => p.name)).toEqual(['RETENTION_DATABASE_URL']);
    expect(() => loadConfig({ ...prodBase, RETENTION_DATABASE_URL: TLS_URL })).not.toThrow();
    expect(problems(() => loadConfig({ ...prodBase, RETENTION_DATABASE_URL: 'postgresql://r:r@db:5432/a' })).problems.map((p) => p.name)).toEqual(['RETENTION_DATABASE_URL']); // scan-secrets:allow giá trị giả của test
  });

  it('PRJ-TC-20261006-100124950: APP_ENV ngoài tập cho phép nêu APP_ENV phải thuộc dev, staging, prod', async () => {
    const e = problems(() => loadConfig({ ...base, APP_ENV: 'production' }));
    expect(e.format()).toContain('APP_ENV: phải thuộc dev, staging, prod');
    const b = bootApp({ ...base, APP_ENV: 'production' });
    expect(await b.exited).not.toBe(0);
    expect(b.stderr()).toContain('APP_ENV');
    expect(b.stderr()).not.toContain('production');
  }, 60_000);

  it('PRJ-TC-20261006-100124974: staging không đặt LOG_LEVEL và PORT dùng mặc định info và 3001, log trạng thái "dùng mặc định"', () => {
    const c = loadConfig({ ...base, APP_ENV: 'staging', DATABASE_URL: TLS_URL, RETENTION_DATABASE_URL: TLS_URL });
    expect(c.get('LOG_LEVEL')).toBe('info');
    expect(c.get('PORT')).toBe(3001);
    const st = Object.fromEntries(c.statuses.map((s) => [s.name, s.status]));
    expect(st.LOG_LEVEL).toBe('default');
    expect(st.PORT).toBe('default');
    expect(st.APP_ENV).toBe('set');
  });

  it('PRJ-TC-20261006-100124999: chuỗi rỗng hoặc toàn khoảng trắng coi như thiếu', () => {
    for (const v of ['', '   ']) {
      const e = problems(() => loadConfig({ ...base, DATABASE_URL: v }));
      expect(e.problems).toEqual([{ name: 'DATABASE_URL', reason: expect.stringContaining('thiếu') }]);
    }
  });

  it('PRJ-TC-20261006-100125022: biến lạ không thuộc schema nào bị bỏ qua, không làm lỗi, không vào trạng thái', () => {
    const c = loadConfig({ ...base, SOME_UNKNOWN_VAR: 'abc' });
    expect(c.statuses.map((s) => s.name)).not.toContain('SOME_UNKNOWN_VAR');
    expect(() => c.get('SOME_UNKNOWN_VAR')).toThrow();
  });

  it('PRJ-TC-20261006-120200102: prod từ chối bí mật quá ngắn hoặc giữ chỗ theo chính sách, liệt kê cả ba, không in giá trị', async () => {
    const secrets: ConfigFragment = { PAYMENT_HASH_SECRET: cfg.secret(), SESSION_SIGNING_KEY: cfg.secret(), WEBHOOK_SECRET: cfg.secret() };
    const short31 = rand(31), repeat40 = 'a'.repeat(40), ph = 'Placeholder-9f3k2m1x8q7w6e5r4t3y2u1i0o9p8a7s';
    const env = { ...base, APP_ENV: 'prod', DATABASE_URL: TLS_URL, RETENTION_DATABASE_URL: TLS_URL, PAYMENT_HASH_SECRET: short31, SESSION_SIGNING_KEY: repeat40, WEBHOOK_SECRET: ph };
    const e = problems(() => loadConfig(env, [secrets]));
    const by = Object.fromEntries(e.problems.map((p) => [p.name, p.reason]));
    expect(by.PAYMENT_HASH_SECRET).toMatch(/quá ngắn/);
    expect(by.SESSION_SIGNING_KEY).toMatch(/một ký tự lặp/);
    expect(by.WEBHOOK_SECRET).toMatch(/tiền tố placeholder/);
    for (const v of [short31, repeat40, ph]) expect(e.format()).not.toContain(v);
    // lần sau: hợp lệ, log "config ok" chỉ có tên và trạng thái
    const ok = loadConfig({ ...env, PAYMENT_HASH_SECRET: rand(32), SESSION_SIGNING_KEY: rand(48), WEBHOOK_SECRET: rand(48).split('').reverse().join('') }, [secrets]);
    expect(JSON.stringify(ok.statuses)).not.toMatch(/q3Z8/);
    expect(ok.statuses.map((s) => s.name)).toEqual(expect.arrayContaining(['PAYMENT_HASH_SECRET', 'SESSION_SIGNING_KEY', 'WEBHOOK_SECRET']));
    // chạy thật: stderr không có giá trị bí mật, không mở cổng
    const port = await freePort();
    const b = bootApp({ ...env, PORT: String(port) });
    expect(await b.exited).not.toBe(0);
    expect(await portOpen(port)).toBe(false);
    for (const v of [short31, repeat40, ph]) expect(b.stderr()).not.toContain(v);
  }, 60_000);

  it('PRJ-TC-20261006-120200103: biến cấu hình của epic khác đi qua registerConfigSchema, thiếu một biến không mặc định thì nêu đúng tên đó', () => {
    const dsh: ConfigFragment = { DASHBOARD_CACHE_TTL_SECONDS: cfg.int({ default: 60 }), DASHBOARD_RATE_LIMIT_PER_MINUTE: cfg.int({ default: 30 }) };
    const pay: ConfigFragment = { PAY_MAX_ATTEMPTS: cfg.int({ default: 3 }) };
    const ntf: ConfigFragment = { SES_REGION: cfg.string(), MAIL_FROM: cfg.string(), APP_BASE_URL: cfg.string() };
    const stg = { ...base, APP_ENV: 'staging', DATABASE_URL: TLS_URL, RETENTION_DATABASE_URL: TLS_URL };
    const e = problems(() => loadConfig({ ...stg, SES_REGION: 'ap-southeast-1', MAIL_FROM: 'no-reply@shop.example' }, [dsh, pay, ntf]));
    expect(e.problems.map((p) => p.name)).toEqual(['APP_BASE_URL']);
    const c = loadConfig({ ...stg, SES_REGION: 'ap-southeast-1', MAIL_FROM: 'no-reply@shop.example', APP_BASE_URL: 'https://shop.example' }, [dsh, pay, ntf]);
    expect(c.get('DASHBOARD_CACHE_TTL_SECONDS')).toBe(60);
    expect(c.get('DASHBOARD_RATE_LIMIT_PER_MINUTE')).toBe(30);
    expect(c.get('PAY_MAX_ATTEMPTS')).toBe(3);
    expect(c.get('OUTBOX_MAX_ATTEMPTS')).toBe(10);
    const defaults = c.statuses.filter((s) => s.status === 'default').map((s) => s.name);
    expect(defaults).toEqual(expect.arrayContaining(['DASHBOARD_CACHE_TTL_SECONDS', 'PAY_MAX_ATTEMPTS', 'OUTBOX_MAX_ATTEMPTS']));
  });
});
