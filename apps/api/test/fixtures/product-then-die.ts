// Tiến trình con cho PRD-TC-20261006-120604307: công bố sản phẩm P1 (draft) và ngừng bán P2 (active) bằng ProductService thật, commit xong thì tự SIGKILL NGAY
// trước khi relay outbox chạy (không có mã kiểm thử trong src). Biến môi trường: PRD_PUBLISH_ID, PRD_ARCHIVE_ID.
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../../src/app.module';
import { ProductService } from '../../src/modules/catalog/product.service';

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: false });
  const admin = { user_id: '00000000-0000-4000-8000-000000000001', role: 'admin' as const, email_verified: true };
  const products = app.get(ProductService);
  await products.publish(admin, process.env.PRD_PUBLISH_ID!);
  await products.archive(admin, process.env.PRD_ARCHIVE_ID!);
  process.kill(process.pid, 'SIGKILL');
  process.stdout.write('SURVIVED\n'); // không bao giờ tới đây
}
void main();
