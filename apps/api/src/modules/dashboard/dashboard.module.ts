import { Module } from '@nestjs/common';
import { CatalogModule } from '../catalog';
import { InventoryModule } from '../inventory';
import { OrderModule } from '../order';
import { PaymentModule } from '../payment';
import { UserModule } from '../user';
import { BlocksService } from './blocks.service';
import { BlockCache } from './cache.service';
import './config';
import { DashboardController } from './dashboard.controller';
import { DashboardService } from './dashboard.service';
import './errors';
import { DashboardRateGuard } from './guard';
import { SourceGate } from './sources.service';

/**
 * Module DSH (epic DSH, module `dashboard`): CHỈ ĐỌC, không bảng, không migration, không event (ADR-020). Cột Phụ thuộc: ORD, PRD, INV, USR, PAY, chỉ qua giao diện đọc ở điểm vào công khai của từng module
 * (`OrderApi`, `CatalogApi`, `InventoryApi`, `UserApi`, `PaymentApi`); phần dùng chung của platform (phiên, role, audit, giới hạn tần suất) không khai.
 */
@Module({
  imports: [OrderModule, CatalogModule, InventoryModule, UserModule, PaymentModule],
  controllers: [DashboardController],
  providers: [SourceGate, BlockCache, BlocksService, DashboardService, DashboardRateGuard],
})
export class DashboardModule {}
