// Tiến trình con cho CHK-TC-20261006-120905422 (SB-27, T15) và CHK-TC-20261006-110703029 (T14): đặt hàng bằng AppModule thật qua đúng `PlaceService.place`, rồi tự SIGKILL NGAY (không có mã kiểm thử trong src):
//   `after-commit`: giao dịch đặt hàng đã cam kết, relay outbox chưa chạy (AppModule không tự khởi động lịch job khi chỉ nạp ngữ cảnh ứng dụng);
//   `before-commit`: chết giữa giao dịch, SAU khi INV, PRM đã giữ hàng và lượt coupon và TRƯỚC khi cam kết.
// Dùng: <after-commit|before-commit> <user_id> <session_id> <idempotency_key> <expected_grand_total> <cart_version>.
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../../src/app.module';
import { PlaceService } from '../../src/modules/checkout/place.service';
import { PromotionApi } from '../../src/modules/promotion';

async function main() {
  const [mode, userId, sessionId, key, expected, version] = process.argv.slice(2);
  const app = await NestFactory.createApplicationContext(AppModule, { logger: false });
  if (mode === 'before-commit') {
    const prm = app.get(PromotionApi), real = prm.reserve.bind(prm);
    prm.reserve = (async (...a: Parameters<PromotionApi['reserve']>) => { const r = await real(...a); process.kill(process.pid, 'SIGKILL'); return r; }) as PromotionApi['reserve'];
  }
  const r = await app.get(PlaceService).place({ user_id: userId, role: 'customer', email_verified: true }, sessionId, key, { expected_grand_total: Number(expected), cart_version: Number(version) });
  if (mode === 'after-commit') process.kill(process.pid, 'SIGKILL');
  process.stdout.write(`SURVIVED ${r.status}\n`); // không bao giờ tới đây
}
void main();
