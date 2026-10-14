import { Module, type OnModuleInit } from '@nestjs/common';
import { ConfigService, JobRunner } from '../platform';
import { OrderModule } from '../order';
import { CodService } from './cod.service';
import './config';
import { PaymentCore } from './core.service';
import './errors';
import { HttpVnpayGateway, VNPAY_GATEWAY } from './gateway';
import { setIpHops } from './http';
import { LifecycleService } from './lifecycle.service';
import { OutcomeService } from './outcome.service';
import { AdminPaymentController, IpnController, PaymentController, RefundController } from './payment.controller';
import { PaymentApi } from './payment.api';
import { ReadService } from './read.service';
import { ReconcileService } from './reconcile.service';
import { RefundService } from './refund.service';
import { StartService } from './start.service';
import { WebhookService } from './webhook.service';

/**
 * Module PAY (epic PAY, module `payment`): cột Phụ thuộc chỉ ORD (qua `OrderApi.findForPayment`, đọc, không `tx`); phần dùng chung của platform không khai (ADR-012). DSH gọi vào qua `PaymentApi`
 * (`getRevenue`, `countFailedRefunds`); NTF, INV, PRM, ORD nhận event của PAY. Job (ADR-013): đối soát lượt thử, tự thử lại và đối soát hoàn tiền (mỗi phút), xóa nhật ký webhook quá 12 tháng (hằng ngày).
 */
@Module({
  imports: [OrderModule],
  controllers: [PaymentController, RefundController, AdminPaymentController, IpnController],
  providers: [PaymentCore, RefundService, OutcomeService, StartService, WebhookService, CodService, LifecycleService, ReadService, ReconcileService, PaymentApi, { provide: VNPAY_GATEWAY, useClass: HttpVnpayGateway }],
  exports: [PaymentApi],
})
export class PaymentModule implements OnModuleInit {
  constructor(
    private readonly lifecycle: LifecycleService, private readonly jobs: JobRunner, private readonly reconcile: ReconcileService, private readonly refunds: RefundService, private readonly config: ConfigService,
  ) {}

  onModuleInit(): void {
    setIpHops(this.config.get('TRUST_PROXY_HOPS'));
    this.lifecycle.register(); // consumer `payment` của sáu event qua outbox (ADR-011)
    this.jobs.register({ name: 'payment-reconcile', module: 'payment', every: 60_000, run: async ({ signal }) => void (await this.reconcile.run(undefined, signal)) });
    this.jobs.register({ name: 'payment-refund-sweep', module: 'payment', every: 60_000, run: async ({ signal }) => void (await this.refunds.sweep(undefined, signal)) });
    this.jobs.register({ name: 'payment-webhook-retention', module: 'payment', every: 24 * 3600_000, timeoutMs: 600_000, run: async () => void (await this.reconcile.purgeWebhookLogs()) });
  }
}
