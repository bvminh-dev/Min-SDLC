import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { Request, Response } from 'express';
import {
  AppLogger, Clock, ConfigService, DomainError, OBJECT_STORAGE, PrismaService, UploadError, readSingleFile, type ObjectStorage, type Tx,
} from '../platform';
import { IMAGE_CACHE_CONTROL, IMAGE_KEY_RE, IMAGE_MAX_BYTES, IMAGE_ORPHAN_AGE_MS, IMAGE_PREFIX, OBJECT_SWEEP_MAX, SWEEP_BATCH, SWEEP_BUDGET_MS } from './config';
import { UUID_RE } from './db';
import { ImageError, processReviewImage, type Processed } from './image';

const withTimeout = <T>(p: Promise<T>, ms: number): Promise<T> => new Promise<T>((resolve, reject) => {
  const t = setTimeout(() => reject(new ImageError('corrupt')), ms); // quá hạn xử lý: coi như ảnh không xử lý nổi (REV-SEC T9)
  p.then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); });
});

export interface SweepOptions { signal?: AbortSignal; batch?: number; budgetMs?: number; now?: Date }
export interface ObjectSweepOptions { signal?: AbortSignal; now?: Date; max?: number }

/**
 * Ảnh đánh giá (REV-REQ-20261006-103135207, REV-DB mục 7 và 8, ADR-018): tải lên xử lý theo luồng (dừng đọc ở 5.242.881 byte), kiểm magic bytes, đọc kích thước từ tiêu đề rồi mới giải mã, re-encode WebP bỏ metadata,
 * ghi object `reviews/<uuid>.webp` RỒI mới INSERT `review_images` (chưa gắn). Gắn ảnh vào đánh giá là việc của ReviewService, trong giao dịch của nó (`attach`). Job dọn `rev.sweep-orphan-images` xóa ảnh chưa gắn
 * và ảnh của đánh giá đã xóa sau 24 giờ.
 */
@Injectable()
export class ImageService {
  private readonly log: AppLogger;
  /** Bộ xử lý ảnh (thay được trong test để dựng ca quá hạn). */
  process: (buf: Buffer) => Promise<Processed> = processReviewImage;

  constructor(
    private readonly prisma: PrismaService, @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage, private readonly config: ConfigService, private readonly clock: Clock, logger: AppLogger,
  ) {
    this.log = logger.for('review');
  }

  async upload(userId: string, req: Request, res: Response): Promise<{ image_id: string; url: string; width: number; height: number }> {
    let bytes = 0;
    try {
      const { file } = await readSingleFile(req, res, IMAGE_MAX_BYTES, (n) => { bytes = n; });
      const img = await withTimeout(this.process(file), this.config.get<number>('REV_IMAGE_PROCESS_TIMEOUT_MS'));
      return await this.store(userId, img);
    } catch (e) {
      const reason = e instanceof ImageError ? e.reason : e instanceof UploadError ? (e.reason === 'too_large' ? 'size' : 'corrupt') : null; // form sai (không phải một phần `file`) coi như tệp hỏng
      if (!reason) throw e;
      this.log.warn('ảnh đánh giá bị từ chối', { code: 'image-rejected', reason, bytes_read: bytes }); // không có tên tệp, không có nội dung, không có người dùng
      throw new DomainError('image-invalid', { extra: { code: 'image_invalid', reason } });
    }
  }

  private async store(userId: string, img: Processed): Promise<{ image_id: string; url: string; width: number; height: number }> {
    const key = `reviews/${randomUUID()}.webp`;
    try {
      // Content-Type, nosniff và cache ngắn (ADR-018). Kho S3 thật có thể không phát lại `x-content-type-options`: CDN hay bucket gắn khi phát (kiểm bằng config)
      await this.storage.put(key, img.webp, { contentType: 'image/webp', headers: { 'x-content-type-options': 'nosniff', 'cache-control': IMAGE_CACHE_CONTROL } });
    } catch (e) {
      if (e instanceof DomainError) throw e;
      this.log.error('ghi ảnh đánh giá lên kho thất bại', { code: 'storage-put-failed', err: e }); // chi tiết (đường dẫn, máy chủ kho) chỉ vào log nội bộ, kèm trace_id (T19)
      throw new DomainError('internal-error');
    }
    try {
      const now = this.clock.now();
      const [row] = await this.prisma.$queryRaw<{ id: string }[]>`
        INSERT INTO review_images (user_id, storage_key, width, height, bytes, created_at, updated_at)
        VALUES (${userId}::uuid, ${key}, ${img.width}, ${img.height}, ${img.webp.length}, ${now}::timestamptz, ${now}::timestamptz) RETURNING id`;
      return { image_id: row.id, url: this.storage.urlFor(key), width: img.width, height: img.height };
    } catch (e) {
      await this.storage.delete(key).catch(() => undefined); // đối tượng mồ côi: dọn ngay, job quét là lưới an toàn
      throw e;
    }
  }

  /**
   * Gắn ảnh vào đánh giá TRONG giao dịch của bên gọi (REV-DB mục 1(d), 2): chỉ ảnh của chính `userId`, chưa gắn (hoặc vừa gỡ khỏi chính đánh giá này, `keep`), chưa quá 24 giờ chưa gắn (quá hạn thì job dọn sắp xóa
   * nên không còn gắn được: đóng cửa đua giữa gắn và dọn). Số dòng bị đổi phải bằng số `ids` nếu không thì ném 400 `invalid_image` (id của người khác, không tồn tại, đã gắn không phân biệt được, T20).
   */
  async attach(tx: Tx, reviewId: string, userId: string, ids: string[], keep: string[] = []): Promise<void> {
    const now = this.clock.now();
    const cutoff = new Date(now.getTime() - IMAGE_ORPHAN_AGE_MS);
    for (const [i, id] of ids.entries()) {
      const n = await tx.$executeRaw`
        UPDATE review_images SET review_id = ${reviewId}::uuid, position = ${i + 1}, orphaned_at = NULL, updated_at = ${now}::timestamptz
        WHERE id = ${id}::uuid AND user_id = ${userId}::uuid AND review_id IS NULL AND (id = ANY(${keep}::uuid[]) OR COALESCE(orphaned_at, created_at) >= ${cutoff}::timestamptz)`;
      if (n !== 1) throw new DomainError('validation-failed', { errors: [{ field: 'image_ids', code: 'invalid_image' }] });
    }
  }

  /** Gỡ mọi ảnh khỏi đánh giá (trước khi gắn lại theo thứ tự mới, hay khi xóa đánh giá): `position` về NULL cùng `review_id` (CHECK), nên đặt lại toàn bộ rồi gắn. Trả id ảnh đang gắn (theo `position`). */
  async detachAll(tx: Tx, reviewId: string, orphan: boolean): Promise<string[]> {
    const now = this.clock.now();
    const rows = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM review_images WHERE review_id = ${reviewId}::uuid ORDER BY position FOR UPDATE`;
    if (!rows.length) return [];
    await tx.$executeRaw`
      UPDATE review_images SET review_id = NULL, position = NULL, orphaned_at = ${orphan ? now : null}::timestamptz, updated_at = ${now}::timestamptz WHERE review_id = ${reviewId}::uuid`;
    return rows.map((r) => r.id);
  }

  /** Đánh dấu ảnh vừa gỡ nhưng không gắn lại là mồ côi (job dọn sau 24 giờ). */
  async orphan(tx: Tx, ids: string[]): Promise<void> {
    if (!ids.length) return;
    const now = this.clock.now();
    await tx.$executeRaw`UPDATE review_images SET orphaned_at = ${now}::timestamptz, updated_at = ${now}::timestamptz WHERE id = ANY(${ids}::uuid[]) AND review_id IS NULL`;
  }

  /**
   * Job `rev.sweep-orphan-images` (ADR-013, ADR-022, REV-DB mục 8): ảnh chưa gắn hoặc đã gỡ quá 24 giờ. Lô nhỏ, theo con trỏ id; xóa object TRƯỚC (idempotent: object đã mất là thành công, không giữ giao dịch khi gọi kho,
   * SB-31) rồi xóa dòng (còn kiểm lại điều kiện quá hạn và chưa gắn). Object xóa lỗi thì dòng được giữ cho lượt sau; hết hạn thời gian thì thôi nhận lô mới. Một bản chạy duy nhất trên cụm do JobRunner (khóa tư vấn).
   * Trả số dòng đã xóa; nếu có object không xóa được thì ném lỗi SAU khi đã làm hết lô (job báo lỗi, lượt sau thử lại).
   */
  async sweep(o: SweepOptions = {}): Promise<{ removed: number; failed: number }> {
    const start = Date.now(), budget = o.budgetMs ?? SWEEP_BUDGET_MS, batch = o.batch ?? SWEEP_BATCH;
    const cutoff = new Date((o.now ?? this.clock.now()).getTime() - IMAGE_ORPHAN_AGE_MS);
    let removed = 0, failed = 0, after = '00000000-0000-0000-0000-000000000000';
    while (!o.signal?.aborted && Date.now() - start < budget) {
      const rows = await this.prisma.$queryRaw<{ id: string; storage_key: string }[]>`
        SELECT id, storage_key FROM review_images
        WHERE review_id IS NULL AND COALESCE(orphaned_at, created_at) < ${cutoff}::timestamptz AND id > ${after}::uuid ORDER BY id LIMIT ${batch}`;
      if (!rows.length) break;
      after = rows[rows.length - 1].id;
      const gone: string[] = [];
      for (const r of rows) {
        if (o.signal?.aborted) break;
        try { await this.storage.delete(r.storage_key); gone.push(r.id); } catch (err) { failed++; this.log.warn('xóa ảnh đánh giá khỏi kho thất bại, lượt sau thử lại', { code: 'sweep-delete-failed', err }); }
      }
      if (gone.length) {
        removed += await this.prisma.$executeRaw`
          DELETE FROM review_images WHERE id = ANY(${gone}::uuid[]) AND review_id IS NULL AND COALESCE(orphaned_at, created_at) < ${cutoff}::timestamptz`;
      }
    }
    this.log.info('rev.sweep-orphan-images xong', { code: 'review-image-sweep', removed, failed });
    if (failed > 0) throw new Error(`rev.sweep-orphan-images: ${failed} đối tượng không xóa được khỏi kho`);
    return { removed, failed };
  }

  /**
   * Job `rev.sweep-orphan-objects` (ADR-013, ADR-018, REV-DB mục 8b, REV-REV-16): object `reviews/<uuid>.webp` ở kho QUÁ 24 giờ mà không dòng `review_images` nào có `storage_key` đó (tiến trình chết giữa `put` và
   * `INSERT`, hay `INSERT` lỗi cộng `delete` lỗi): job `sweep` chỉ đi từ dòng sang object nên không thấy. Trần 500 object mỗi lượt, phần còn lại để lượt sau. ĐÓNG KHI KHÔNG CHẮC (như PRD, USR): có object cần xóa
   * mà bảng tham chiếu rỗng, hoặc không khóa nào của bảng có mặt trong kho (nghi sai CSDL, bucket hay endpoint) thì không xóa gì và báo lỗi. Tham chiếu là `storage_key` chứ không phải URL nên đổi
   * `STORAGE_PUBLIC_BASE_URL` không làm ảnh đang dùng thành mồ côi. Xóa lỗi một object: ghi log, đi tiếp, báo lỗi sau lượt. Idempotent.
   */
  async sweepObjects(o: ObjectSweepOptions = {}): Promise<{ removed: number; failed: number }> {
    const keys = new Set((await this.prisma.$queryRaw<{ storage_key: string }[]>`SELECT storage_key FROM review_images`).map((r) => r.storage_key));
    const cutoff = (o.now ?? this.clock.now()).getTime() - IMAGE_ORPHAN_AGE_MS;
    const listed = (await this.storage.list(IMAGE_PREFIX)).filter((x) => IMAGE_KEY_RE.test(x.key));
    const orphans = listed.filter((x) => !keys.has(x.key) && x.lastModified.getTime() <= cutoff);
    if (orphans.length && (keys.size === 0 || !listed.some((x) => keys.has(x.key)))) {
      this.log.error('rev.sweep-orphan-objects dừng: nguồn tham chiếu không khớp kho', { code: 'object-sweep-closed', referenced: keys.size, listed: listed.length, candidates: orphans.length });
      throw new Error(`rev.sweep-orphan-objects dừng: kho có ${orphans.length} object cần xóa nhưng ${keys.size === 0 ? 'bảng review_images rỗng' : 'không khóa nào của review_images có trong kho'} (sai CSDL, bucket hay endpoint thì xóa sẽ mất ảnh đang dùng); xác nhận bằng tay`);
    }
    let removed = 0, failed = 0;
    for (const x of orphans.slice(0, o.max ?? OBJECT_SWEEP_MAX)) { // phần còn lại để lượt sau (mỗi giờ)
      if (o.signal?.aborted) break;
      try { await this.storage.delete(x.key); removed++; } catch (err) { failed++; this.log.warn('xóa object mồ côi khỏi kho thất bại, lượt sau thử lại', { code: 'object-sweep-delete-failed', err }); }
    }
    this.log.info('rev.sweep-orphan-objects xong', { code: 'review-object-sweep', removed, failed });
    if (failed) throw new Error(`rev.sweep-orphan-objects: ${failed} object không xóa được khỏi kho`);
    return { removed, failed };
  }
}

export const isImageId = (v: unknown): v is string => typeof v === 'string' && UUID_RE.test(v);
