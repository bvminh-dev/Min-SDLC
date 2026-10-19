import { Module, type OnModuleInit } from '@nestjs/common';
import { AppLogger, JobRunner } from '../platform';
import { AdminCategoryController, AdminProductController } from './admin.controller';
import { CatalogApi } from './catalog.api';
import { CategoryService } from './category.service';
import './errors';
import { ImageService } from './image.service';
import { ImportService } from './import.service';
import { ProductService } from './product.service';
import { PublicCatalogController } from './public.controller';
import { QueryService } from './query.service';
import { RatingService } from './rating.service';

/** Module PRD (epic PRD, module `catalog`): cột Phụ thuộc chỉ PRJ (platform, ngầm) nên không import module nghiệp vụ nào (P7). */
@Module({
  controllers: [PublicCatalogController, AdminCategoryController, AdminProductController],
  providers: [CategoryService, QueryService, ProductService, ImageService, ImportService, RatingService, CatalogApi],
  exports: [CatalogApi],
})
export class CatalogModule implements OnModuleInit {
  constructor(private readonly jobs: JobRunner, private readonly images: ImageService, private readonly ratings: RatingService, private readonly logger: AppLogger) {}

  onModuleInit(): void {
    const log = this.logger.for('catalog');
    this.ratings.register(); // consumer `catalog` của event REV qua outbox (ADR-011)
    // ADR-013: job dọn ảnh mỗi giờ, idempotent, có hạn thời gian; bộ lập lịch chung do PRJ.
    this.jobs.register({ name: 'prd.sweep-orphan-images', module: 'catalog', every: 3600_000, timeoutMs: 300_000, run: async ({ signal }) => { log.info('quét ảnh sản phẩm mồ côi', { removed: await this.images.sweepOrphans(signal) }); } });
  }
}
