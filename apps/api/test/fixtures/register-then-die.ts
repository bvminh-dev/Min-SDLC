// Tiến trình con cho AUTH-TC-20261006-100640931: đăng ký email mới, commit xong thì tự SIGKILL NGAY trước khi phát event in-process
// và trước khi relay outbox chạy. Không có mã kiểm thử nào trong src: ta chặn hàm phát in-process của EventsService trong tiến trình con.
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../../src/app.module';
import { EventsService } from '../../src/modules/platform';
import { AuthService } from '../../src/modules/auth/auth.service';

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: false });
  (EventsService.prototype as unknown as { dispatchInProcess: () => void }).dispatchInProcess = () => process.kill(process.pid, 'SIGKILL');
  await app.get(AuthService).register({ email: 'crash@shop.vn', password: 'Correct-Horse-9', full_name: 'Crash' });
  process.stdout.write('SURVIVED\n'); // không bao giờ tới đây
}
void main();
