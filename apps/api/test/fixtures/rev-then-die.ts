// Tiến trình con cho REV-TC-20261006-140000005: thao tác kiểm duyệt của admin bằng AppModule thật, commit xong thì tự SIGKILL NGAY trước khi relay outbox chạy
// (không có mã kiểm thử trong src). Dùng: <approve|reject|hide|unhide> <review_id> <admin_id> [lý do].
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../../src/app.module';
import { ModerationService } from '../../src/modules/review/moderation.service';

async function main() {
  const [action, id, admin, reason] = process.argv.slice(2);
  const app = await NestFactory.createApplicationContext(AppModule, { logger: false });
  const s = { user_id: admin, role: 'admin' as const, email_verified: true };
  if (!['approve', 'reject', 'hide', 'unhide'].includes(action)) throw new Error(`hành động lạ: ${action}`);
  await app.get(ModerationService).act(s, action as 'approve', id, reason);
  process.kill(process.pid, 'SIGKILL');
  process.stdout.write('SURVIVED\n'); // không bao giờ tới đây
}
void main();
