// Tiến trình con cho CRT-TC-20261006-113000220: nhận CheckoutCompleted bằng AppModule thật qua đúng đường giao event (`EventsService.deliver`: chèn ProcessedEvent rồi chạy handler của CRT
// trong CÙNG giao dịch), chạy xong hai câu lệnh (INSERT processed_events, UPDATE carts) thì tự SIGKILL NGAY, TRƯỚC khi giao dịch commit (không có mã kiểm thử trong src).
// Dùng: <event_id> <cart_id> <order_id>.
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../../src/app.module';
import { EventsService, type EventEnvelope } from '../../src/modules/platform';

async function main() {
  const [eventId, cartId, orderId] = process.argv.slice(2);
  const app = await NestFactory.createApplicationContext(AppModule, { logger: false });
  const events = app.get(EventsService);
  const real = events.consumersFor('CheckoutCompleted').find((s) => s.consumer === 'cart');
  if (!real) throw new Error('consumer cart chưa đăng ký');
  const env: EventEnvelope = { event_id: eventId, type: 'CheckoutCompleted', aggregate_type: 'checkout', aggregate_id: cartId, payload: { checkout_id: crypto.randomUUID(), cart_id: cartId, order_id: orderId }, occurred_at: new Date().toISOString(), correlation_id: 'die-before-commit' };
  await events.deliver({ consumer: 'cart', handler: async (tx, e) => { await real.handler(tx, e); process.kill(process.pid, 'SIGKILL'); } }, env);
  process.stdout.write('SURVIVED\n'); // không bao giờ tới đây
}
void main();
