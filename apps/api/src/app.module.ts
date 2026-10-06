import { Module } from '@nestjs/common';
import { PlatformModule } from './modules/platform';

@Module({ imports: [PlatformModule] })
export class AppModule {}
