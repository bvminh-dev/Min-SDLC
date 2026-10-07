import { ArgumentsHost, Catch, ExceptionFilter, HttpException, Injectable } from '@nestjs/common';
import type { Request, Response } from 'express';
import { ZodError } from 'zod';
import { isDbUnavailable } from '../db/db-errors';
import { AppLogger } from '../logging/logger';
import { DEFAULT_INTERNAL, DEFAULT_REJECT, SystemSignatureError, type SystemEndpointOptions } from '../http/session';
import { buildProblem, traceIdOf } from './problem';
import { DomainError, errorRegistry } from './registry';
import { zodItems } from '../http/validation';

const HTTP_TO_CODE: Record<number, string> = {
  400: 'validation-failed', 401: 'unauthenticated', 403: 'forbidden', 404: 'not-found', 409: 'conflict',
  413: 'payload-too-large', 415: 'unsupported-media-type', 429: 'rate-limited', 503: 'service-unavailable',
};

/** Mọi lỗi đi qua một bộ lọc toàn cục: problem+json, không bao giờ HTML hay văn bản mặc định (PRJ-REQ-20261006-095422820 BR8). */
@Catch()
@Injectable()
export class ProblemFilter implements ExceptionFilter {
  private readonly log: AppLogger;
  constructor(logger: AppLogger) {
    this.log = logger.for('http');
  }

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const req = http.getRequest<Request & { systemEndpoint?: SystemEndpointOptions }>();
    const res = http.getResponse<Response>();
    const traceId = traceIdOf(req);

    // Endpoint hệ thống (IPN): định dạng của cổng, không problem+json, không lộ chi tiết (ADR-006).
    if (req.systemEndpoint) {
      const reply = exception instanceof SystemSignatureError ? (req.systemEndpoint.reject ?? DEFAULT_REJECT) : (req.systemEndpoint.internalError ?? DEFAULT_INTERNAL);
      if (!(exception instanceof SystemSignatureError)) this.log.error('lỗi ở endpoint hệ thống', { err: exception });
      res.status(reply.status).json(reply.body);
      return;
    }

    let code = 'internal-error';
    let opts: { detail?: string; errors?: { field: string; code: string }[]; headers?: Record<string, string>; extra?: Record<string, string | number | boolean> } = {};

    if (exception instanceof DomainError) {
      if (errorRegistry.get(exception.code)) { code = exception.code; opts = exception.options; }
      else this.log.error(`mã lỗi miền chưa đăng ký: ${exception.code}`);
    } else if (exception instanceof ZodError) {
      code = 'validation-failed'; opts = { errors: zodItems(exception) };
    } else if (exception instanceof HttpException) {
      code = HTTP_TO_CODE[exception.getStatus()] ?? (exception.getStatus() >= 500 ? 'internal-error' : 'validation-failed');
    } else if (isDbUnavailable(exception)) {
      code = 'service-unavailable';
    }

    const body = buildProblem(code, traceId, opts);
    // Chi tiết (stack) chỉ ở log, kèm correlation_id (BR6, BR10).
    if (body.status >= 500) this.log.error('request thất bại', { err: exception });
    for (const [k, v] of Object.entries(opts.headers ?? {})) res.setHeader(k, v);
    res.status(body.status).setHeader('Content-Type', 'application/problem+json; charset=utf-8').send(JSON.stringify(body));
  }
}
