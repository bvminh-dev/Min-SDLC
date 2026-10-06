import { Controller, Get } from '@nestjs/common';
import { PrismaService } from '../db/prisma.service';
import { DomainError } from '../errors/registry';
import { SkipRateLimit } from './rate-limit';
import { Public } from './session';
import { Validate } from './validation';

const READY_TIMEOUT_MS = 2000;

/** Health công khai, không giới hạn tần suất, thân tối thiểu không lộ phiên bản hay lỗi (SB-20). */
@Controller('health')
@Public()
@SkipRateLimit()
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  @Validate({})
  live() {
    return { status: 'ok' };
  }

  @Get('ready')
  @Validate({})
  async ready() {
    let timer: NodeJS.Timeout | undefined;
    try {
      const query = this.prisma.$queryRaw`SELECT 1`;
      query.catch(() => undefined); // tránh unhandled rejection khi hết hạn trước
      await Promise.race([query, new Promise((_, rej) => { timer = setTimeout(() => rej(new Error('timeout')), READY_TIMEOUT_MS); })]);
    } catch {
      throw new DomainError('service-unavailable');
    } finally {
      if (timer) clearTimeout(timer);
    }
    return { status: 'ready' };
  }
}
