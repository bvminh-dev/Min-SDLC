// Tiến trình con cho PAY-TC-20261006-113000250 (SB-27, T15): xử lý một gói IPN thành công bằng AppModule thật (cổng VNPay thật không được gọi trên đường này), commit xong thì tự SIGKILL NGAY trước khi relay outbox chạy
// (không có mã kiểm thử trong src). Dùng: <chuỗi JSON của các tham số IPN>.
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../../src/app.module';
import { WebhookService } from '../../src/modules/payment/webhook.service';

async function main() {
  const query = JSON.parse(process.argv[2]) as Record<string, string>;
  const app = await NestFactory.createApplicationContext(AppModule, { logger: false });
  const reply = await app.get(WebhookService).handle(query, '127.0.0.1');
  if (reply.RspCode !== '00') { process.stdout.write(`REPLY ${reply.RspCode}\n`); process.exit(3); }
  process.kill(process.pid, 'SIGKILL');
  process.stdout.write('SURVIVED\n'); // không bao giờ tới đây
}
void main();
