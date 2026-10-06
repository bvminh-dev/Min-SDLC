import { Injectable, type LoggerService } from '@nestjs/common';
import pino, { type DestinationStream, type Logger } from 'pino';
import { currentCorrelationId } from '../common/context';
import { redactDeep, redactString } from './redact';

export interface LoggerOptions {
  level: string;
  env: string;
  destination?: DestinationStream;
}

/** Log JSON một dòng ra stdout (ADR-008, PRJ-REQ-20261006-095422908 BR1, BR2). Mỗi dòng có time, level, msg, correlation_id, module, env. */
@Injectable()
export class AppLogger {
  private constructor(private readonly root: Logger, private readonly log: Logger) {}

  static create(o: LoggerOptions): AppLogger {
    const root = pino(
      {
        level: o.level,
        base: { env: o.env },
        serializers: { err: (e: unknown) => e }, // lỗi đã thành đối tượng thường và qua bộ che ở formatters.log; serializer mặc định của pino chạy sau và tạo lại từ lỗi gốc
        timestamp: pino.stdTimeFunctions.isoTime,
        formatters: {
          level: (label) => ({ level: label }),
          log: (obj) => redactDeep(obj) as Record<string, unknown>,
        },
        mixin: () => ({ correlation_id: currentCorrelationId() ?? 'none' }),
      },
      o.destination ?? pino.destination({ dest: 1, sync: true }),
    );
    return new AppLogger(root, root.child({ module: 'platform' }));
  }

  /** Logger mang tên module (trường `module`). */
  for(module: string): AppLogger {
    return new AppLogger(this.root, this.root.child({ module }));
  }
  // msg cũng là chuỗi tự do (có thể nối từ dữ liệu), nên đi qua bộ che theo mẫu.
  debug(msg: string, fields: object = {}): void { this.log.debug(fields, redactString(msg)); }
  info(msg: string, fields: object = {}): void { this.log.info(fields, redactString(msg)); }
  warn(msg: string, fields: object = {}): void { this.log.warn(fields, redactString(msg)); }
  error(msg: string, fields: object = {}): void { this.log.error(fields, redactString(msg)); }
}

/** Cầu nối để log của chính Nest cũng ra JSON. */
export class NestLoggerAdapter implements LoggerService {
  constructor(private readonly l: AppLogger) {}
  log(m: unknown) { this.l.info(String(m)); }
  error(m: unknown) { this.l.error(String(m)); }
  warn(m: unknown) { this.l.warn(String(m)); }
  debug(m: unknown) { this.l.debug(String(m)); }
  verbose(m: unknown) { this.l.debug(String(m)); }
}
