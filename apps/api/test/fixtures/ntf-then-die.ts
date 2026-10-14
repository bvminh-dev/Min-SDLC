// Tiến trình con cho NTF-TC-20261006-104222796 (SB-27, NTF-SEC T16): nhận OrderCreated bằng AppModule thật qua đúng đường giao event (`EventsService.deliver`: pha chuẩn bị hỏi AUTH ngoài giao dịch, rồi
// chèn ProcessedEvent và chạy handler của NTF trong CÙNG giao dịch), chạy xong các câu INSERT (processed_events, notifications, email_deliveries) thì tự SIGKILL NGAY, TRƯỚC khi giao dịch commit
// (không có mã kiểm thử trong src). Dùng: <event_id> <user_id> <order_id>.
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../../src/app.module';
import { EventsService, type EventEnvelope } from '../../src/modules/platform';

async function main() {
  const [eventId, userId, orderId] = process.argv.slice(2);
  const app = await NestFactory.createApplicationContext(AppModule, { logger: false });
  const events = app.get(EventsService);
  const real = events.consumersFor('OrderCreated').find((s) => s.consumer === 'NTF');
  if (!real?.prepared) throw new Error('consumer NTF chưa đăng ký');
  const env: EventEnvelope = { event_id: eventId, type: 'OrderCreated', aggregate_type: 'order', aggregate_id: orderId, payload: { order_id: orderId, order_code: '7K3M9Q2XH4TB', user_id: userId, grand_total: 350000, payment_method: 'cod', payment_expires_at: null }, occurred_at: new Date().toISOString(), correlation_id: 'die-before-commit' };
  const dying = { consumer: 'NTF', handler: real.handler, prepared: { prepare: real.prepared.prepare, handle: async (tx: any, e: EventEnvelope, p: unknown) => { await real.prepared!.handle(tx, e, p); process.kill(process.pid, 'SIGKILL'); } } };
  await events.deliver(dying, env);
  process.stdout.write('SURVIVED\n'); // không bao giờ tới đây
}
void main();
