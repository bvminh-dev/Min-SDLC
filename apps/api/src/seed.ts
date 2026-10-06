// Lệnh seed dữ liệu mồi cho dev (PRJ-REQ-20261006-095422563 BR9, PRJ-SEC T24). Từ chối chạy ở staging và prod, thoát mã khác 0.
// Module đăng ký seeder của mình bằng registerSeeder; PRJ không có seed nghiệp vụ. Admin đầu tiên do AUTH seed riêng (SB-29).
import 'reflect-metadata';
import type { Env } from './modules/platform/config/config';

export type Seeder = (ctx: { databaseUrl: string }) => Promise<void>;
const seeders: Seeder[] = [];
export const registerSeeder = (s: Seeder): void => void seeders.push(s);

/** `env` truyền vào để test; mặc định đọc từ tiến trình ở điểm vào bên dưới. Trả mã thoát. */
export async function runSeed(env: Env, list: Seeder[] = seeders): Promise<number> {
  // ponytail: spec nói "APP_ENV là dev hoặc test" nhưng APP_ENV chỉ có dev, staging, prod (BR1): chỉ dev được seed.
  if (env.APP_ENV !== 'dev') {
    process.stderr.write('seed bị từ chối: chỉ chạy khi APP_ENV=dev (staging, prod không có seed)\n');
    return 1;
  }
  for (const s of list) await s({ databaseUrl: env.DATABASE_URL ?? '' });
  process.stdout.write(`seed xong (${list.length} seeder)\n`);
  return 0;
}

if (require.main === module) {
  // eslint-disable-next-line no-restricted-syntax -- điểm vào CLI của seed, không phải mã ứng dụng
  void runSeed(process.env).then((code) => process.exit(code));
}
