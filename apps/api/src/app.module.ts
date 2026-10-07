import { Module } from '@nestjs/common';
import { AuthModule } from './modules/auth';
import { PlatformModule } from './modules/platform';
import { UserModule } from './modules/user';

@Module({ imports: [PlatformModule, AuthModule, UserModule] })
export class AppModule {}
