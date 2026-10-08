import { Module, type OnModuleInit } from '@nestjs/common';
import { CancelService } from './cancel.service';
import { CreateService } from './create.service';
import './errors';
import { InternalService } from './internal.service';
import { LifecycleService } from './lifecycle.service';
import { OrderApi } from './order.api';
import { AdminOrderController, OrderController } from './order.controller';
import { ReadService } from './read.service';
import { TransitionService } from './transition.service';

/**
 * Module ORD (epic ORD, module `order`): cột Phụ thuộc chỉ AUTH (hai khóa ngoại tới `users`, không có lời gọi nào); phần dùng chung của platform không khai (ADR-012).
 * CHK, PAY, SHP, REV, DSH gọi vào qua `OrderApi`. ORD không có job (đồng hồ hết hạn là của INV, ADR-009).
 */
@Module({
  controllers: [OrderController, AdminOrderController],
  providers: [TransitionService, CreateService, CancelService, ReadService, InternalService, LifecycleService, OrderApi],
  exports: [OrderApi],
})
export class OrderModule implements OnModuleInit {
  constructor(private readonly lifecycle: LifecycleService) {}

  onModuleInit(): void {
    this.lifecycle.register(); // consumer `order` của mười một event qua outbox (ADR-011)
  }
}
