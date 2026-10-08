import { Global, Module, type OnModuleInit } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR, DiscoveryModule } from '@nestjs/core';
import { AuditService } from './audit/audit.service';
import { Clock } from './common/clock';
import { ConfigService, loadConfigFromProcess } from './config/config';
import { PrismaService } from './db/prisma.service';
import { TransactionService } from './db/transaction.service';
import { ProblemFilter } from './errors/problem.filter';
import { EventsService } from './events/events.service';
import { OutboxRelay } from './events/outbox-relay';
import { CsrfGuard } from './http/csrf.guard';
import { HealthController } from './http/health.controller';
import { IdempotencyInterceptor, IdempotencyService } from './http/idempotency';
import { RateLimitGuard, RateLimitService } from './http/rate-limit';
import { AuthGuard, SESSION_RESOLVER, SessionService } from './http/session';
import { ValidationInterceptor } from './http/validation';
import { JobRunner } from './jobs/job-runner';
import { RetentionService } from './jobs/retention.service';
import { AppLogger } from './logging/logger';
import { createStorage } from './storage/factory';
import { OBJECT_STORAGE } from './storage/storage';

/** Nền tảng dùng chung (epic PRJ): mối quan tâm cắt ngang, module khác không cần khai ở cột Phụ thuộc (A-01, ADR-012). */
@Global()
@Module({
  imports: [DiscoveryModule],
  controllers: [HealthController],
  providers: [
    { provide: ConfigService, useFactory: () => loadConfigFromProcess() },
    { provide: AppLogger, useFactory: (c: ConfigService) => AppLogger.create({ level: c.get('LOG_LEVEL'), env: c.get('APP_ENV') }), inject: [ConfigService] },
    // AUTH thay bằng triển khai thật; mặc định không có phiên nào (mọi endpoint không công khai trả 401).
    { provide: SESSION_RESOLVER, useValue: { resolve: async () => null } },
    // Kho object dùng chung (ADR-012): USR ảnh đại diện, PRD ảnh sản phẩm.
    { provide: OBJECT_STORAGE, useFactory: createStorage, inject: [ConfigService] },
    Clock, PrismaService, TransactionService, AuditService, EventsService, OutboxRelay, IdempotencyService,
    RateLimitService, RetentionService, JobRunner, SessionService, IdempotencyInterceptor,
    // Thứ tự khớp flow PRJ: giới hạn tần suất, CSRF, xác thực và quyền (guard); schema (interceptor); lỗi (filter).
    { provide: APP_GUARD, useClass: RateLimitGuard },
    { provide: APP_GUARD, useClass: CsrfGuard },
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_INTERCEPTOR, useClass: ValidationInterceptor },
    { provide: APP_FILTER, useClass: ProblemFilter },
  ],
  exports: [
    ConfigService, AppLogger, OBJECT_STORAGE, SESSION_RESOLVER, Clock, PrismaService, TransactionService, AuditService, EventsService,
    OutboxRelay, IdempotencyService, RateLimitService, RetentionService, JobRunner, SessionService,
  ],
})
export class PlatformModule implements OnModuleInit {
  constructor(private readonly jobs: JobRunner, private readonly relay: OutboxRelay, private readonly retention: RetentionService, private readonly log: AppLogger) {}

  // Job của PRJ (ADR-013): relay outbox, dọn dữ liệu quá hạn, dọn bộ đếm giới hạn tần suất.
  onModuleInit(): void {
    this.jobs.register({
      name: 'outbox-relay', module: 'platform', every: 3_000,
      run: async ({ signal }) => {
        await this.relay.runOnce(undefined, signal);
        const stuck = await this.relay.stuckCount();
        if (stuck > 0) this.log.for('outbox').warn('có OutboxEvent kẹt hết lượt thử', { stuck });
      },
    });
    this.jobs.register({ name: 'retention', module: 'platform', every: 24 * 3600_000, timeoutMs: 600_000, run: async () => void (await this.retention.run()) });
    this.jobs.register({ name: 'rate-limit-gc', module: 'platform', every: 60_000, run: async () => void (await this.retention.rateLimitGc()) });
  }
}
