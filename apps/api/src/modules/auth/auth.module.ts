import { Module, type OnModuleInit } from '@nestjs/common';
import { JobRunner, SessionService } from '../platform';
import { AuthApi } from './auth.api';
import { AdminUsersService } from './admin.service';
import { AdminUsersController, AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { AuthCleanupService } from './cleanup.service';
import './config';
import './errors';
import { AuthSessionResolver } from './session.resolver';

/** Module AUTH (epic AUTH). Không phụ thuộc module nào khác (`-` ở architecture.md); phần dùng chung lấy từ platform. */
@Module({
  controllers: [AuthController, AdminUsersController],
  providers: [AuthService, AuthApi, AdminUsersService, AuthSessionResolver, AuthCleanupService],
  exports: [AuthApi],
})
export class AuthModule implements OnModuleInit {
  constructor(
    private readonly sessions: SessionService,
    private readonly resolver: AuthSessionResolver,
    private readonly jobs: JobRunner,
    private readonly cleanup: AuthCleanupService,
  ) {}

  onModuleInit(): void {
    this.sessions.use(this.resolver); // AUTH cung cấp SessionContext cho guard của platform (ADR-012)
    // Dọn phiên và token hết hạn mỗi giờ (ADR-013, ADR-022): hạ tầng, không phải đồng hồ nghiệp vụ.
    this.jobs.register({ name: 'auth.cleanup', module: 'auth', every: 3600_000, run: async () => void (await this.cleanup.run()) });
  }
}
