import { Module, type OnModuleInit } from '@nestjs/common';
import { AppLogger, JobRunner } from '../platform';
import { EXPIRE_BUDGET_MS, EXPIRE_JOB_MS, RECONCILE_JOB_MS } from './config';
import { CouponService } from './coupon.service';
import './errors';
import { EvaluateService } from './evaluate.service';
import { JobsService } from './jobs.service';
import { LifecycleService } from './lifecycle.service';
import { PromotionApi } from './promotion.api';
import { AdminCouponController } from './promotion.controller';

/** Module PRM (epic PRM, module `promotion`): cột Phụ thuộc là `-` (không gọi module nào, không đọc bảng module khác); phần dùng chung của platform không khai (ADR-012). CRT, CHK gọi vào qua `PromotionApi`. */
@Module({
  controllers: [AdminCouponController],
  providers: [CouponService, EvaluateService, LifecycleService, JobsService, PromotionApi],
  exports: [PromotionApi],
})
export class PromotionModule implements OnModuleInit {
  constructor(private readonly jobs: JobRunner, private readonly svc: JobsService, private readonly lifecycle: LifecycleService, private readonly logger: AppLogger) {}

  onModuleInit(): void {
    this.lifecycle.register(); // consumer `promotion` của bốn event qua outbox (ADR-011)
    // ADR-013: bộ lập lịch chung do PRJ; mỗi job idempotent, có hạn thời gian (SB-34). Hạn của job hết hạn nhỏ hơn chu kỳ nên hai lượt không chạy chồng.
    this.jobs.register({ name: 'promotion.expire-coupons', module: 'promotion', every: EXPIRE_JOB_MS, timeoutMs: EXPIRE_BUDGET_MS + 10_000, run: async ({ signal }) => { await this.svc.expireOnce({ signal }); } });
    const log = this.logger.for('promotion');
    this.jobs.register({ name: 'promotion.reconcile', module: 'promotion', every: RECONCILE_JOB_MS, timeoutMs: 600_000, run: async () => { log.info('đối soát coupon', await this.svc.reconcileOnce()); } });
  }
}
