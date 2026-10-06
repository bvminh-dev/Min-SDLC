import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import {
  AppLogger, ConfigError, ConfigService, JobRunner, PrismaService, configureApp, loadConfigFromProcess, nestLogger, newCorrelationId, runWithCorrelation,
} from './modules/platform';

async function bootstrap(): Promise<void> {
  // Cấu hình hỏng: thoát mã khác 0 TRƯỚC khi mở cổng, nêu tên biến và lý do, không in giá trị (SB-16).
  let config: ConfigService;
  try {
    config = loadConfigFromProcess();
  } catch (e) {
    if (!(e instanceof ConfigError)) throw e;
    process.stderr.write(`Cấu hình không hợp lệ, ứng dụng dừng:\n${e.format()}\n`);
    process.exit(1);
  }

  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bodyParser: false, logger: false });
  const logger = app.get(AppLogger);
  app.useLogger(nestLogger(logger));
  configureApp(app, { config, logger });
  app.enableShutdownHooks();

  await runWithCorrelation(newCorrelationId(), async () => {
    const log = logger.for('bootstrap');
    try {
      await app.get(PrismaService).waitUntilReady(config.get('DB_CONNECT_RETRY_SECONDS'), (n) => log.warn('chưa kết nối được CSDL, thử lại', { attempt: n }));
    } catch (e) {
      log.error((e as Error).message);
      process.exit(1);
    }
    await app.listen(config.get('PORT'));
    app.get(JobRunner).start();
    log.info('config ok', { app_env: config.get('APP_ENV'), vars: config.statuses });
    log.info('đã lắng nghe', { port: config.get('PORT') });
  });
}

void bootstrap();
