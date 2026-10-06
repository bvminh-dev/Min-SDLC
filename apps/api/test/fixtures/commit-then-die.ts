// Tiến trình con cho PRJ-TC-20261006-110200104: commit một OutboxEvent rồi báo "COMMITTED" và chờ bị SIGKILL (relay chưa từng chạy).
import 'reflect-metadata';
import { AppLogger, EventsService, PrismaService, TransactionService, loadConfig, runWithCorrelation } from '../../src/modules/platform';

async function main() {
  const config = loadConfig({ APP_ENV: 'dev', DATABASE_URL: process.env.DATABASE_URL!, CORS_ALLOWED_ORIGINS: 'http://localhost:3000' });
  const logger = AppLogger.create({ level: 'error', env: 'dev' });
  const prisma = new PrismaService(config);
  const events = new EventsService(new TransactionService(prisma, config, logger), logger);
  const tx = new TransactionService(prisma, config, logger);
  await runWithCorrelation('child-corr-1', () =>
    tx.run((t) => events.publish(t, { type: 'OrderPaid', aggregate_type: 'order', aggregate_id: 'order-killed', payload: { order_id: 'order-killed' } })),
  );
  process.stdout.write('COMMITTED\n');
  setInterval(() => undefined, 1000);
}
void main();
