// Tiến trình con cho PRM-TC-20261006-113100404: xử lý một PaymentSucceeded (tiêu thụ lượt) hoặc chạy job hết hạn coupon bằng AppModule thật,
// commit xong thì tự SIGKILL NGAY trước khi relay outbox chạy (không có mã kiểm thử trong src). Dùng: <consume|expire> [order_id event_id].
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../../src/app.module';
import { EventsService, type EventEnvelope } from '../../src/modules/platform';
import { JobsService } from '../../src/modules/promotion/jobs.service';

async function main() {
  const [mode, order, eventId] = process.argv.slice(2);
  const app = await NestFactory.createApplicationContext(AppModule, { logger: false });
  if (mode === 'expire') await app.get(JobsService).expireOnce();
  else {
    const events = app.get(EventsService);
    const env: EventEnvelope = {
      event_id: eventId, type: 'PaymentSucceeded', aggregate_type: 'payment', aggregate_id: order, occurred_at: new Date().toISOString(), correlation_id: 'child-corr',
      payload: { payment_id: eventId, order_id: order, order_code: 'ORD-K', user_id: eventId, amount: 270000, method: 'vnpay', paid_at: new Date().toISOString() },
    };
    for (const sub of events.consumersFor('PaymentSucceeded').filter((c) => c.consumer === 'promotion')) await events.deliver(sub, env); // chỉ consumer của PRM (INV cũng nhận PaymentSucceeded)
  }
  process.kill(process.pid, 'SIGKILL');
  process.stdout.write('SURVIVED\n'); // không bao giờ tới đây
}
void main();
