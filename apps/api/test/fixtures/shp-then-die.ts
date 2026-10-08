// Tiến trình con cho SHP-TC-20261006-110000001: thao tác của staff trên vận đơn bằng AppModule thật, commit xong thì tự SIGKILL NGAY trước khi relay outbox chạy
// (không có mã kiểm thử trong src). Dùng: <ship|tracking|deliver|fail|return> <mã đơn> <staff_id> [mã vận đơn hoặc lý do].
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../../src/app.module';
import { ShipmentService } from '../../src/modules/shipping/shipment.service';

async function main() {
  const [action, code, staff, arg] = process.argv.slice(2);
  const app = await NestFactory.createApplicationContext(AppModule, { logger: false });
  const s = { user_id: staff, role: 'staff' as const, email_verified: true };
  const ships = app.get(ShipmentService);
  if (action === 'ship') await ships.ship(s, code, { tracking_number: arg });
  else if (action === 'deliver') await ships.deliver(s, code);
  else if (action === 'fail') await ships.fail(s, code, { reason_code: 'refused' });
  else if (action === 'return') await ships.returned(s, code);
  else throw new Error(`hành động lạ: ${action}`);
  process.kill(process.pid, 'SIGKILL');
  process.stdout.write('SURVIVED\n'); // không bao giờ tới đây
}
void main();
