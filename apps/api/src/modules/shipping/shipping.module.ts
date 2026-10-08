import { Module, type OnModuleInit } from '@nestjs/common';
import { OrderModule } from '../order';
import './errors';
import { LifecycleService } from './lifecycle.service';
import { MethodService } from './method.service';
import { ReadService } from './read.service';
import { ShipmentService } from './shipment.service';
import { ShippingApi } from './shipping.api';
import { AdminShippingMethodController, ShippingController } from './shipping.controller';

/**
 * Module SHP (epic SHP, module `shipping`): cột Phụ thuộc chỉ ORD (qua `OrderApi`: đọc đơn, địa chỉ người nhận, `lockForHandoff` trong giao dịch bàn giao); phần dùng chung của platform không khai (ADR-012).
 * CRT, CHK gọi vào qua `ShippingApi`. PAY, NTF, DSH không gọi SHP (nhận event của ORD). SHP không có job.
 */
@Module({
  imports: [OrderModule],
  controllers: [AdminShippingMethodController, ShippingController],
  providers: [MethodService, ShipmentService, ReadService, LifecycleService, ShippingApi],
  exports: [ShippingApi],
})
export class ShippingModule implements OnModuleInit {
  constructor(private readonly lifecycle: LifecycleService) {}

  onModuleInit(): void {
    this.lifecycle.register(); // consumer `shipping` của OrderPaid, OrderConfirmed, OrderCancelled qua outbox (ADR-011)
  }
}
