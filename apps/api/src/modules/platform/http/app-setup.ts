import type { INestApplication, LoggerService } from '@nestjs/common';
import express, { type NextFunction, type Request, type Response } from 'express';
import { randomUUID } from 'node:crypto';
import { runWithCorrelation } from '../common/context';
import { ConfigService } from '../config/config';
import { sendProblem } from '../errors/problem';
import { AppLogger, NestLoggerAdapter } from '../logging/logger';
import type { SessionContext } from './session';

const ID_RE = /^[A-Za-z0-9-]{8,64}$/;
export const MAX_BODY_BYTES = 1024 * 1024; // 1 MB (PRJ-REQ-20261006-095422650 BR2)

/** X-Request-Id hợp lệ thì giữ, ngược lại sinh UUID v4; giá trị lạ không bao giờ vào log (BR8, T6). */
export const resolveCorrelationId = (h: string | string[] | undefined): string => {
  const v = Array.isArray(h) ? h[0] : h;
  return typeof v === 'string' && ID_RE.test(v) ? v : randomUUID();
};
/** `/api/v1/orders/:code` -> `/api/v1/orders/{code}`; không bao giờ ghi URL thật hay query string (BR2, BR4 của PRJ-REQ ...908). */
export const routeTemplate = (req: Request): string => {
  const p = req.route?.path;
  return typeof p === 'string' ? p.replace(/:(\w+)/g, '{$1}') : 'unmatched';
};

type Req = Request & { correlationId?: string; session?: SessionContext };

/**
 * Dựng các middleware nền của API. Thứ tự: định danh request và header an toàn, CORS, kiểm loại thân và kích thước, ngữ cảnh log.
 * Các bước còn lại (giới hạn tần suất, CSRF, quyền, schema) là guard và interceptor toàn cục của PlatformModule.
 */
export function configureApp(app: INestApplication, deps: { config: ConfigService; logger: AppLogger }): void {
  const { config } = deps;
  const log = deps.logger.for('http');
  const server = app.getHttpAdapter().getInstance() as express.Express;
  server.disable('x-powered-by');
  app.setGlobalPrefix('api/v1');

  const hsts = config.get('APP_ENV') !== 'dev';
  app.use((req: Req, res: Response, next: NextFunction) => {
    const id = resolveCorrelationId(req.headers['x-request-id']);
    req.correlationId = id;
    res.setHeader('X-Request-Id', id);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    if (hsts) res.setHeader('Strict-Transport-Security', 'max-age=31536000');
    const start = process.hrtime.bigint();
    res.on('finish', () => {
      const status = res.statusCode;
      const level = status >= 500 ? 'error' : [401, 403, 429].includes(status) ? 'warn' : 'info';
      runWithCorrelation(id, () =>
        log[level]('request', {
          method: req.method, route: routeTemplate(req), status,
          duration_ms: Number(process.hrtime.bigint() - start) / 1e6,
          ...(req.session ? { user_id: req.session.user_id } : {}),
        }),
      );
    });
    next();
  });

  const allowed = new Set(config.get('CORS_ALLOWED_ORIGINS'));
  app.enableCors({
    origin: (origin: string | undefined, cb: (e: Error | null, ok?: boolean) => void) => cb(null, !!origin && allowed.has(origin)),
    credentials: true,
  });

  const json = express.json({ limit: MAX_BODY_BYTES });
  app.use((req: Request, res: Response, next: NextFunction) => {
    const hasBody = Number(req.headers['content-length'] ?? 0) > 0 || req.headers['transfer-encoding'] !== undefined;
    if (hasBody && !req.is('application/json')) return sendProblem(req, res, 'unsupported-media-type');
    json(req, res, (err?: { type?: string }) => {
      if (!err) return next();
      sendProblem(req, res, err.type === 'entity.too.large' ? 'payload-too-large' : 'validation-failed'); // JSON hỏng: 400 chuẩn
    });
  });

  // Từ đây trở đi mọi mã (guard, handler, handler event do request phát) thấy cùng correlation_id.
  app.use((req: Req, _res: Response, next: NextFunction) => runWithCorrelation(req.correlationId!, next));
}

export const nestLogger = (l: AppLogger): LoggerService => new NestLoggerAdapter(l);
