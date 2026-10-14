import { Module } from '@nestjs/common';
import { AuthModule } from './modules/auth';
import { CartModule } from './modules/cart';
import { CatalogModule } from './modules/catalog';
import { CheckoutModule } from './modules/checkout';
import { DashboardModule } from './modules/dashboard';
import { InventoryModule } from './modules/inventory';
import { NotificationModule } from './modules/notification';
import { OrderModule } from './modules/order';
import { PaymentModule } from './modules/payment';
import { PlatformModule } from './modules/platform';
import { PromotionModule } from './modules/promotion';
import { ReviewModule } from './modules/review';
import { ShippingModule } from './modules/shipping';
import { UserModule } from './modules/user';

@Module({ imports: [PlatformModule, AuthModule, UserModule, CatalogModule, InventoryModule, PromotionModule, OrderModule, ShippingModule, CartModule, PaymentModule, CheckoutModule, NotificationModule, ReviewModule, DashboardModule] })
export class AppModule {}
