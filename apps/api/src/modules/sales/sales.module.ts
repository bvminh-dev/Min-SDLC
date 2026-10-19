import { Module } from '@nestjs/common';
import { CatalogModule } from '../catalog';
import { InventoryModule } from '../inventory';
import { OrderModule } from '../order';
import { ShippingModule } from '../shipping';
import { UserModule } from '../user';
import { CreateService } from './create.service';
import { DepsService } from './deps.service';
import './errors';
import { ReadService } from './read.service';
import { SalesController } from './sales.controller';

/**
 * Module SAL (epic SAL, module `sales`): cột Phụ thuộc PRD, INV, SHP, ORD, USR (qua `CatalogApi`, `InventoryApi`, `ShippingApi`, `OrderApi`, `UserApi`; ADR-026); phần dùng chung của platform (idempotency, giới hạn tần suất)
 * không khai (ADR-012). SAL không có bảng riêng (SAL-DB), không có consumer, job hay giao diện nội bộ nào: module khác không gọi vào SAL.
 */
@Module({
  imports: [CatalogModule, InventoryModule, ShippingModule, OrderModule, UserModule],
  controllers: [SalesController],
  providers: [DepsService, CreateService, ReadService],
})
export class SalesModule {}
