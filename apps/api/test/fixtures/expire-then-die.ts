// Tiến trình con cho INV-TC-20261006-121044093: chạy job hết hạn giữ hàng bằng JobsService thật trên AppModule thật, commit xong thì tự SIGKILL NGAY
// trước khi relay outbox chạy (không có mã kiểm thử trong src).
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../../src/app.module';
import { JobsService } from '../../src/modules/inventory/jobs.service';

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: false });
  await app.get(JobsService).expireOnce();
  process.kill(process.pid, 'SIGKILL');
  process.stdout.write('SURVIVED\n'); // không bao giờ tới đây
}
void main();
