import { Injectable, type OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { ConfigService } from '../config/config';
import { prismaUrl } from './pg-config';

/** Một PrismaService dùng chung cho mọi module (PRJ-REQ-20261006-095422563 BR1); module không tạo client riêng. */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleDestroy {
  constructor(config: ConfigService) {
    super({ datasourceUrl: prismaUrl(config.get('DATABASE_URL'), config.get('DB_POOL_MAX'), config.get('DB_STATEMENT_TIMEOUT_MS')), log: [] });
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }

  /**
   * Khi khởi động: thử lại tối đa `seconds` giây rồi ném lỗi KHÔNG chứa chuỗi kết nối (BR8).
   * Mã lỗi Prisma thôi, không chép message vì message có thể nêu host.
   */
  async waitUntilReady(seconds: number, onRetry?: (attempt: number) => void): Promise<void> {
    const deadline = Date.now() + seconds * 1000;
    for (let attempt = 1; ; attempt++) {
      try {
        await this.$queryRaw`SELECT 1`;
        return;
      } catch (e) {
        if (Date.now() >= deadline) {
          const code = (e as { code?: string }).code;
          throw new Error(`Không kết nối được CSDL sau ${seconds} giây${code ? ` (mã ${code})` : ''}`);
        }
        onRetry?.(attempt);
        await new Promise((r) => setTimeout(r, 1000));
      }
    }
  }
}
