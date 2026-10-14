import { Module, type OnModuleInit } from '@nestjs/common';
import { CartModule } from '../cart';
import { InventoryModule } from '../inventory';
import { OrderModule } from '../order';
import { JobRunner } from '../platform';
import { PromotionModule } from '../promotion';
import { ShippingModule } from '../shipping';
import { UserModule } from '../user';
import { CheckoutController } from './checkout.controller';
import { EXPIRE_BUDGET_MS, EXPIRE_JOB_MS, PURGE_BUDGET_MS, PURGE_JOB_MS } from './config';
import { DepsService } from './deps.service';
import './errors';
import { JobsService } from './jobs.service';
import { PlaceService } from './place.service';
import { PriceService } from './price.service';
import { SelectService } from './select.service';
import { SessionService } from './session.service';
import { ViewService } from './view.service';

/**
 * Module CHK (epic CHK, module `checkout`): cột Phụ thuộc CRT, USR, PRM, INV, SHP, ORD (qua `CartApi`, `AddressService`, `PromotionApi`, `InventoryApi`, `ShippingApi`, `OrderApi`); phần dùng chung của platform
 * (outbox, idempotency, audit, giới hạn tần suất, job) không khai (ADR-012). CHK không có consumer nào (consumes rỗng, T16) và không phơi giao diện nội bộ nào: module khác không gọi vào CHK.
 * Job (ADR-013): hết hạn phiên mỗi 5 phút, xóa bản chụp địa chỉ của phiên đã đóng hằng ngày.
 */
@Module({
  imports: [CartModule, UserModule, PromotionModule, InventoryModule, ShippingModule, OrderModule],
  controllers: [CheckoutController],
  providers: [DepsService, PriceService, SessionService, ViewService, SelectService, PlaceService, JobsService],
})
export class CheckoutModule implements OnModuleInit {
  constructor(private readonly jobs: JobRunner, private readonly svc: JobsService) {}

  onModuleInit(): void {
    // ADR-013: bộ lập lịch chung do PRJ; job idempotent, có hạn thời gian (SB-34). Hạn nhỏ hơn chu kỳ nên hai lượt không chạy chồng.
    this.jobs.register({ name: 'chk.expire-sessions', module: 'checkout', every: EXPIRE_JOB_MS, timeoutMs: EXPIRE_BUDGET_MS + 10_000, run: async ({ signal }) => { await this.svc.expireOnce({ signal }); } });
    this.jobs.register({ name: 'chk.purge-address-snapshots', module: 'checkout', every: PURGE_JOB_MS, timeoutMs: PURGE_BUDGET_MS + 10_000, run: async ({ signal }) => { await this.svc.purgeOnce({ signal }); } });
  }
}
