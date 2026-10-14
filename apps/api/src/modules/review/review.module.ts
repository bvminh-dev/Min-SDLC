import { Module, type OnModuleInit } from '@nestjs/common';
import { AuthModule } from '../auth';
import { CatalogModule } from '../catalog';
import { OrderModule } from '../order';
import { JobRunner } from '../platform';
import './config';
import { DepsService } from './deps.service';
import './errors';
import { ImageService } from './image.service';
import { ModerationService } from './moderation.service';
import { ReadService } from './read.service';
import { AdminReviewController, ReviewController } from './review.controller';
import { ReviewService } from './review.service';
import { OBJECT_SWEEP_JOB_NAME, SWEEP_JOB_MS, SWEEP_JOB_NAME } from './config';
import { ViewService } from './view.service';

/**
 * Module REV (epic REV, module `review`): cột Phụ thuộc PRD (`CatalogApi.getSummaries`), ORD (`OrderApi.getDeliveredItems`, `hasUndeliveredItems`), AUTH (`AuthApi.getDisplayNames`); phần dùng chung của platform
 * (guard phiên, audit, giới hạn tần suất, Idempotency-Key, outbox, job nền, kho object, `problem+json`, CSRF) không khai (ADR-012). REV phát ReviewPublished, ReviewHidden, ReviewUnpublished, ReviewDeleted, ReviewRatingChanged
 * (consumer: PRD) và không nhận event nào (REV-API mục Giao tiếp giữa module).
 */
@Module({
  imports: [AuthModule, CatalogModule, OrderModule],
  controllers: [ReviewController, AdminReviewController],
  providers: [DepsService, ViewService, ImageService, ReviewService, ModerationService, ReadService],
})
export class ReviewModule implements OnModuleInit {
  constructor(private readonly jobs: JobRunner, private readonly images: ImageService) {}

  onModuleInit(): void {
    // ADR-013, ADR-022: job dọn ảnh do REV sở hữu logic, bộ lập lịch chung do PRJ; mỗi giờ, idempotent, có hạn thời gian (JobRunner), tác nhân `system`.
    this.jobs.register({ name: SWEEP_JOB_NAME, module: 'review', every: SWEEP_JOB_MS, timeoutMs: 120_000, run: async ({ signal }) => { await this.images.sweep({ signal }); } });
    // REV-DB mục 8b: object ở kho không có dòng (tiến trình chết giữa ghi kho và INSERT); trần 500 mỗi lượt, đóng khi không chắc.
    this.jobs.register({ name: OBJECT_SWEEP_JOB_NAME, module: 'review', every: SWEEP_JOB_MS, timeoutMs: 120_000, run: async ({ signal }) => { await this.images.sweepObjects({ signal }); } });
  }
}
