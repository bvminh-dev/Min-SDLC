import { Module, type OnModuleInit } from '@nestjs/common';
import { AuthModule } from '../auth';
import { JobRunner } from '../platform';
import { CancelService } from './cancel.service';
import { SWEEP_JOB_MS } from './config';
import { CreateService } from './create.service';
import './errors';
import { InternalService } from './internal.service';
import { OrderJobsService } from './jobs.service';
import { LifecycleService } from './lifecycle.service';
import { OrderApi } from './order.api';
import { AdminOrderController, AdminOrderSourcesController, OrderController, OrderSourcesController } from './order.controller';
import { ReadService } from './read.service';
import { SourcesService } from './sources.service';
import { TransitionService } from './transition.service';

/**
 * Module ORD (epic ORD, module `order`): cột Phụ thuộc AUTH (hai khóa ngoại tới `users` và một lời gọi đọc `AuthApi.getDisplayNames` lấy tên người tạo đơn); phần dùng chung của platform không khai (ADR-012).
 * CHK, PAY, SHP, REV, DSH, SAL gọi vào qua `OrderApi`. Job duy nhất `ord.sweep-code-counters` (dọn bộ đếm mã cũ, ADR-013); ORD không có job hết hạn (đồng hồ hết hạn là của INV, ADR-009).
 */
@Module({
  imports: [AuthModule],
  controllers: [OrderController, AdminOrderController, OrderSourcesController, AdminOrderSourcesController],
  providers: [TransitionService, CreateService, CancelService, ReadService, InternalService, LifecycleService, SourcesService, OrderJobsService, OrderApi],
  exports: [OrderApi],
})
export class OrderModule implements OnModuleInit {
  constructor(private readonly lifecycle: LifecycleService, private readonly jobs: JobRunner, private readonly sweep: OrderJobsService) {}

  onModuleInit(): void {
    this.lifecycle.register(); // consumer `order` của mười một event qua outbox (ADR-011)
    this.jobs.register({ name: 'ord.sweep-code-counters', module: 'order', every: SWEEP_JOB_MS, timeoutMs: 60_000, run: async () => { await this.sweep.sweepCodeCounters(); } });
  }
}
