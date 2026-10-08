import { Module, type OnModuleInit } from '@nestjs/common';
import { CatalogModule } from '../catalog';
import { AppLogger, JobRunner } from '../platform';
import { EXPIRE_BUDGET_MS, EXPIRE_JOB_MS, RECONCILE_JOB_MS } from './config';
import './errors';
import { AdminInventoryController, PublicInventoryController } from './inventory.controller';
import { InventoryApi } from './inventory.api';
import { JobsService } from './jobs.service';
import { LifecycleService } from './lifecycle.service';
import { LowStockService } from './low-stock.service';
import { ReadService } from './read.service';
import { ReservationService } from './reservation.service';
import { StockService } from './stock.service';

/** Module INV (epic INV, module `inventory`): cột Phụ thuộc chỉ PRD (đọc tên, sku, tìm, liệt kê qua `CatalogApi`, P7); phần dùng chung của platform không khai (ADR-012). */
@Module({
  imports: [CatalogModule],
  controllers: [AdminInventoryController, PublicInventoryController],
  providers: [LowStockService, ReadService, StockService, ReservationService, LifecycleService, JobsService, InventoryApi],
  exports: [InventoryApi],
})
export class InventoryModule implements OnModuleInit {
  constructor(private readonly jobs: JobRunner, private readonly svc: JobsService, private readonly lifecycle: LifecycleService, private readonly logger: AppLogger) {}

  onModuleInit(): void {
    this.lifecycle.register(); // consumer `inventory` của sáu event qua outbox (ADR-011)
    // ADR-013: bộ lập lịch chung do PRJ; mỗi job idempotent, có hạn thời gian (SB-34). Hạn của job hết hạn nhỏ hơn chu kỳ nên hai lượt không chạy chồng.
    this.jobs.register({ name: 'inventory.expire-reservations', module: 'inventory', every: EXPIRE_JOB_MS, timeoutMs: EXPIRE_BUDGET_MS + 10_000, run: async ({ signal }) => { await this.svc.expireOnce({ signal }); } });
    const log = this.logger.for('inventory');
    this.jobs.register({ name: 'inventory.reconcile', module: 'inventory', every: RECONCILE_JOB_MS, timeoutMs: 600_000, run: async ({ signal }) => { log.info('đối soát kho', await this.svc.reconcileOnce({ signal })); } });
  }
}
