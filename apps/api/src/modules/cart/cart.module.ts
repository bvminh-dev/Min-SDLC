import { Module, type OnModuleInit } from '@nestjs/common';
import { CatalogModule } from '../catalog';
import { InventoryModule } from '../inventory';
import { JobRunner } from '../platform';
import { PromotionModule } from '../promotion';
import { ShippingModule } from '../shipping';
import { CartApi } from './cart.api';
import { CartController } from './cart.controller';
import { ABANDON_BUDGET_MS, ABANDON_JOB_MS } from './config';
import { DepsService } from './deps.service';
import './errors';
import { JobsService } from './jobs.service';
import { LifecycleService } from './lifecycle.service';
import { ReadService } from './read.service';
import { WriteService } from './write.service';

/**
 * Module CRT (epic CRT, module `cart`): cột Phụ thuộc PRD, INV, PRM, SHP (qua `CatalogApi`, `InventoryApi`, `PromotionApi`, `ShippingApi`); phần dùng chung của platform không khai (ADR-012).
 * CHK gọi vào qua `CartApi` (`snapshotForCheckout`, `lockForCheckout`). Consumer `cart` của CheckoutCompleted, ProductArchived qua outbox (ADR-011); job `cart.abandon` mỗi giờ (ADR-013).
 */
@Module({
  imports: [CatalogModule, InventoryModule, PromotionModule, ShippingModule],
  controllers: [CartController],
  providers: [DepsService, ReadService, WriteService, LifecycleService, JobsService, CartApi],
  exports: [CartApi],
})
export class CartModule implements OnModuleInit {
  constructor(private readonly jobs: JobRunner, private readonly svc: JobsService, private readonly lifecycle: LifecycleService) {}

  onModuleInit(): void {
    this.lifecycle.register();
    // ADR-013: bộ lập lịch chung do PRJ; job idempotent, có hạn thời gian (SB-34). Hạn nhỏ hơn chu kỳ nên hai lượt không chạy chồng.
    this.jobs.register({ name: 'cart.abandon', module: 'cart', every: ABANDON_JOB_MS, timeoutMs: ABANDON_BUDGET_MS + 10_000, run: async ({ signal }) => { await this.svc.abandonOnce({ signal }); } });
  }
}
