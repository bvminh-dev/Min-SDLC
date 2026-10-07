import { Injectable } from '@nestjs/common';
import { Clock, PrismaService } from '../platform';
import { RETENTION_DAYS } from './config';

/** Job dọn mỗi giờ (AUTH-DB mục 11): đánh dấu `expired`, rồi xóa bản ghi đã đóng quá 30 ngày (ADR-022). Tính hợp lệ của phiên luôn kiểm lúc đọc. */
@Injectable()
export class AuthCleanupService {
  constructor(private readonly prisma: PrismaService, private readonly clock: Clock) {}

  async run(): Promise<{ expired: number; deleted: number }> {
    const now = this.clock.now();
    const cutoff = new Date(now.getTime() - RETENTION_DAYS * 24 * 3600_000);
    let expired = 0, deleted = 0;
    expired += await this.prisma.$executeRaw`UPDATE sessions SET status = 'expired', updated_at = ${now}::timestamptz WHERE status = 'active' AND (expires_at <= ${now}::timestamptz OR absolute_expires_at <= ${now}::timestamptz)`;
    expired += await this.prisma.$executeRaw`UPDATE password_reset_tokens SET status = 'expired', updated_at = ${now}::timestamptz WHERE status = 'issued' AND expires_at <= ${now}::timestamptz`;
    expired += await this.prisma.$executeRaw`UPDATE email_verification_tokens SET status = 'expired', updated_at = ${now}::timestamptz WHERE status = 'issued' AND expires_at <= ${now}::timestamptz`;
    // đóng quá 30 ngày: phiên thu hồi tính từ revoked_at, còn lại từ hạn
    deleted += await this.prisma.$executeRaw`DELETE FROM sessions WHERE status <> 'active' AND COALESCE(revoked_at, expires_at) < ${cutoff}::timestamptz`;
    deleted += await this.prisma.$executeRaw`DELETE FROM password_reset_tokens WHERE status <> 'issued' AND COALESCE(used_at, expires_at) < ${cutoff}::timestamptz`;
    deleted += await this.prisma.$executeRaw`DELETE FROM email_verification_tokens WHERE status <> 'issued' AND COALESCE(used_at, expires_at) < ${cutoff}::timestamptz`;
    return { expired, deleted };
  }
}
