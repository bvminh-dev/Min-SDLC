import { Module } from '@nestjs/common';
import { AuthModule } from './modules/auth';
import { CatalogModule } from './modules/catalog';
import { InventoryModule } from './modules/inventory';
import { OrderModule } from './modules/order';
import { PlatformModule } from './modules/platform';
import { PromotionModule } from './modules/promotion';
import { ShippingModule } from './modules/shipping';
import { UserModule } from './modules/user';

@Module({ imports: [PlatformModule, AuthModule, UserModule, CatalogModule, InventoryModule, PromotionModule, OrderModule, ShippingModule] })
export class AppModule {}
