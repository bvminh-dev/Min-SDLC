import { Module, type OnModuleInit } from '@nestjs/common';
import { AuthModule } from '../auth';
import { AppLogger, ConfigError, ConfigService, JobRunner } from '../platform';
import { AddressController } from './address.controller';
import { AddressService } from './address.service';
import { AvatarService } from './avatar.service';
import './config';
import { CustomerController } from './customer.controller';
import './errors';
import { LookupService } from './lookup.service';
import { MeController } from './me.controller';
import { S3Storage } from './storage/s3';
import { OBJECT_STORAGE, UnconfiguredStorage, type ObjectStorage } from './storage/storage';
import { UserApi } from './user.api';
import { UserService } from './user.service';

/** Kho ảnh theo cấu hình: dev có thể để trống (tải ảnh trả 503); staging và prod bắt buộc đủ biến (ConfigVar.requiredOutsideDev kiểm lúc nạp cấu hình). */
export function createStorage(c: ConfigService): ObjectStorage {
  const endpoint = c.get<string>('STORAGE_ENDPOINT');
  if (!endpoint) return new UnconfiguredStorage();
  // SB-09: staging và prod chỉ https; client ký và dựng URL trên gốc (origin) nên endpoint có đường dẫn con sẽ ký sai (chữ ký tính trên đường dẫn khác URL thật): từ chối ngay lúc khởi động.
  let u: URL | null = null;
  try { u = new URL(endpoint); } catch { /* báo ở dưới */ }
  const why = !u ? 'phải là URL hợp lệ' : u.pathname !== '/' || u.search || u.hash ? 'phải là gốc (không có đường dẫn con, query)' : c.get('APP_ENV') !== 'dev' && u.protocol !== 'https:' ? 'phải là https ở staging và prod (SB-09)' : null;
  if (why) throw new ConfigError([{ name: 'STORAGE_ENDPOINT', reason: why }]);
  const accessKey = c.get<string>('STORAGE_ACCESS_KEY'), secretKey = c.get<string>('STORAGE_SECRET_KEY');
  if (!accessKey || !secretKey) throw new ConfigError([{ name: !accessKey ? 'STORAGE_ACCESS_KEY' : 'STORAGE_SECRET_KEY', reason: 'bắt buộc khi đặt STORAGE_ENDPOINT' }]);
  return new S3Storage({ endpoint, bucket: c.get('STORAGE_BUCKET'), region: c.get('STORAGE_REGION'), accessKey, secretKey, publicBase: c.get('STORAGE_PUBLIC_BASE_URL') });
}

/** Module USR (epic USR). Gọi AUTH qua AuthApi (cột Phụ thuộc `AUTH`); phần dùng chung lấy từ platform. */
@Module({
  imports: [AuthModule],
  controllers: [MeController, AddressController, CustomerController],
  providers: [UserService, AvatarService, AddressService, LookupService, UserApi, { provide: OBJECT_STORAGE, useFactory: createStorage, inject: [ConfigService] }],
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
