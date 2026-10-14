import { Module, type OnModuleInit } from '@nestjs/common';
import { AuthModule } from '../auth';
import { ConfigService, JobRunner } from '../platform';
import { CLEANUP_BUDGET_MS, CLEANUP_JOB_MS, SEND_BUDGET_MS, SEND_JOB_MS } from './config';
import { CleanupService } from './cleanup.service';
import { ConsumerService } from './consumer.service';
import { EmailService, NTF_CONFIG } from './email.service';
import { MAIL_TRANSPORT, createMailTransport, createNtfConfig } from './mail';
import { NotificationController } from './notification.controller';
import { ReadService } from './read.service';

/**
 * Module NTF (epic NTF, module `notification`): cột Phụ thuộc chỉ AUTH (qua `AuthApi`: `getUserContact`, `listActiveUserIdsByRole`); phần dùng chung của platform không khai (ADR-012). NTF không phát event và không có
 * giao diện nội bộ cho module khác (không có hàng NTF ở vế "được gọi" của bảng Giao diện module). Consumer `NTF` của 18 event qua outbox (ADR-011), hai job (ADR-013): gửi email mỗi phút và dọn dữ liệu quá hạn mỗi giờ.
 */
@Module({
  imports: [AuthModule],
  controllers: [NotificationController],
  providers: [
    { provide: NTF_CONFIG, useFactory: createNtfConfig, inject: [ConfigService] }, // dừng lúc khởi động khi APP_BASE_URL hay SES_ENDPOINT không phải https ngoài dev
    { provide: MAIL_TRANSPORT, useFactory: createMailTransport, inject: [NTF_CONFIG] },
    EmailService, ConsumerService, ReadService, CleanupService,
  ],
})
export class NotificationModule implements OnModuleInit {
  constructor(private readonly jobs: JobRunner, private readonly consumer: ConsumerService, private readonly email: EmailService, private readonly cleanup: CleanupService) {}

  onModuleInit(): void {
    this.consumer.register();
    // Job idempotent, có hạn thời gian (SB-34): khóa tư vấn (một bản chạy trên toàn cụm) và hạn là việc của JobRunner; hạn nhỏ hơn chu kỳ nên hai lượt không chạy chồng.
    this.jobs.register({
      name: 'notification.send-email', module: 'notification', every: SEND_JOB_MS, timeoutMs: SEND_BUDGET_MS + 10_000,
      run: async ({ signal }) => { await this.email.failLost(); await this.email.sendDue({ signal }); },
    });
    this.jobs.register({ name: 'notification.cleanup', module: 'notification', every: CLEANUP_JOB_MS, timeoutMs: CLEANUP_BUDGET_MS + 10_000, run: async ({ signal }) => { await this.cleanup.run({ signal }); } });
  }
}
