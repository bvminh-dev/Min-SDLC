import { Module, type OnModuleInit } from '@nestjs/common';
import { AuthModule } from '../auth';
import { AppLogger, JobRunner } from '../platform';
import { AddressController } from './address.controller';
import { AddressService } from './address.service';
import { AvatarService } from './avatar.service';
import './config';
import { CustomerController } from './customer.controller';
import './errors';
import { LookupService } from './lookup.service';
import { MeController } from './me.controller';
import { UserApi } from './user.api';
import { UserService } from './user.service';

/** Module USR (epic USR). Gọi AUTH qua AuthApi (cột Phụ thuộc `AUTH`); phần dùng chung lấy từ platform. */
@Module({
  imports: [AuthModule],
  controllers: [MeController, AddressController, CustomerController],
  providers: [UserService, AvatarService, AddressService, LookupService, UserApi],
  exports: [AddressService, UserApi],
})
export class UserModule implements OnModuleInit {
  constructor(private readonly jobs: JobRunner, private readonly addresses: AddressService, private readonly avatars: AvatarService, private readonly logger: AppLogger) {}

  onModuleInit(): void {
    const log = this.logger.for('user');
    // ADR-013: hai job hằng ngày do USR sở hữu logic, bộ lập lịch chung do PRJ; idempotent, có hạn thời gian (JobRunner).
    this.jobs.register({ name: 'usr.purge-deleted-addresses', module: 'user', every: 24 * 3600_000, run: async () => { log.info('xóa cứng địa chỉ quá hạn', { removed: await this.addresses.purgeDeleted() }); } });
    this.jobs.register({ name: 'usr.sweep-orphan-avatars', module: 'user', every: 24 * 3600_000, timeoutMs: 300_000, run: async ({ signal }) => { log.info('quét ảnh mồ côi', { removed: await this.avatars.sweepOrphans(signal) }); } });
  }
}
