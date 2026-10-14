import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Writable } from 'node:stream';
import {
  AppLogger, Clock, ConfigService, PlatformModule, SESSION_RESOLVER, configureApp, loadConfig, type SessionContext, type ConfigFragment,
} from '../../src/modules/platform';
import { testDbUrl } from './db';

export const ORIGIN = 'https://shop.example';
// NTF (ADR-007): staging và prod bắt buộc SES_REGION, MAIL_FROM, APP_BASE_URL (https), SES_ACCESS_KEY, SES_SECRET_KEY. Dev KHÔNG đặt khóa SES để bộ chuyển thư là "chưa cấu hình" (không bao giờ gọi mạng thật trong test);
// môi trường ngoài dev tự có giá trị giả đủ (ghi đè được) để các test cấu hình staging, prod của nền không phải liệt kê biến của NTF.
const NTF_OUTSIDE_DEV: Record<string, string> = {
  SES_REGION: 'ap-southeast-1', MAIL_FROM: 'no-reply@shop.example', APP_BASE_URL: 'https://shop.example',
  SES_ACCESS_KEY: 'AKIAFAKEFAKEFAKEFAKE', SES_SECRET_KEY: 'fakeSecretKeyForTestsOnly0123456789abcdef', // scan-secrets:allow giá trị giả của test
};
export const baseEnv = (over: Record<string, string> = {}): Record<string, string> => ({
  APP_ENV: 'dev',
  DATABASE_URL: testDbUrl(),
  CORS_ALLOWED_ORIGINS: ORIGIN,
  DB_POOL_MAX: '5',
  // PAY (ADR-007): staging và prod bắt buộc khóa và cấu hình cổng VNPay (prod còn từ chối khóa giữ chỗ hoặc ngắn): giá trị giả đủ mạnh để các test cấu hình staging, prod của nền không phải liệt kê biến của PAY
  VNPAY_TMN_CODE: 'PAYTMN01', VNPAY_RETURN_URL: 'https://shop.example/orders/{order_code}/payment',
  VNPAY_HASH_SECRET: 'q3Z8k2Mx9R7wE5tY4uI1oP6aS0dFgHjKmNbVcXz', // scan-secrets:allow giá trị giả của test
  ...over,
  ...(over.APP_ENV && over.APP_ENV !== 'dev' ? { ...NTF_OUTSIDE_DEV, ...over } : {}),
});
export const testConfig = (over: Record<string, string> = {}, extra: ConfigFragment[] = []): ConfigService => loadConfig(baseEnv(over), extra);

/** Logger ghi vào bộ nhớ: mỗi dòng stdout là một JSON (để assert định dạng, che dữ liệu, correlation_id). */
export class LogCapture extends Writable {
  lines: string[] = [];
  _write(chunk: Buffer, _enc: string, cb: () => void) {
    this.lines.push(...chunk.toString().split('\n').filter(Boolean));
    cb();
  }
  get records(): Record<string, any>[] { return this.lines.map((l) => JSON.parse(l)); }
  clear() { this.lines = []; }
}

export class FakeClock extends Clock {
  constructor(private t = new Date('2026-10-06T10:00:00.000Z')) { super(); }
  now(): Date { return new Date(this.t); }
  set(d: Date) { this.t = d; }
  advance(ms: number) { this.t = new Date(this.t.getTime() + ms); }
}

/** Phiên giả: header `x-test-user: <uuid>:<role>[:unverified]`. Không có header là guest. */
export const headerSession = {
  resolve: async (req: { headers: Record<string, string | string[] | undefined> }): Promise<SessionContext | null> => {
    const h = req.headers['x-test-user'];
    if (typeof h !== 'string') return null;
    const [user_id, role, flag] = h.split(':');
    return { user_id, role: role as SessionContext['role'], email_verified: flag !== 'unverified' };
  },
};

export interface TestApp {
  app: NestExpressApplication;
  logs: LogCapture;
  logger: AppLogger;
  clock: FakeClock;
  config: ConfigService;
  close: () => Promise<void>;
}

export async function createTestApp(o: { imports?: any[]; controllers?: any[]; providers?: any[]; env?: Record<string, string>; extra?: ConfigFragment[]; level?: string } = {}): Promise<TestApp> {
  const config = testConfig(o.env, o.extra);
  const logs = new LogCapture();
  const logger = AppLogger.create({ level: o.level ?? config.get('LOG_LEVEL'), env: config.get('APP_ENV'), destination: logs });
  const clock = new FakeClock();
  const moduleRef = await Test.createTestingModule({ imports: o.imports ?? [PlatformModule], controllers: o.controllers ?? [], providers: o.providers ?? [] })
    .overrideProvider(ConfigService).useValue(config)
    .overrideProvider(AppLogger).useValue(logger)
    .overrideProvider(Clock).useValue(clock)
    .overrideProvider(SESSION_RESOLVER).useValue(headerSession)
    .compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>({ bodyParser: false, logger: false });
  configureApp(app, { config, logger });
  await app.init();
  return { app, logs, logger, clock, config, close: () => app.close() };
}
