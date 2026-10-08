import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { Request, Response } from 'express';
import { AppLogger, AuditService, Clock, DomainError, OBJECT_STORAGE, PrismaService, TransactionService, UploadError, readSingleFile, type ObjectStorage, type SessionContext, type Tx } from '../platform';
import { IMAGE_CACHE_CONTROL, IMAGE_MAX_BYTES, IMAGE_ORPHAN_AGE_MS, IMAGE_PREFIX, IMAGE_SWEEP_BATCH, MAX_IMAGES } from './config';
import { isForeignKey } from './db';
import { EXT, ImageError, MIME, processProductImage, type ProcessedImage } from './image';
import { QueryService, type ProductStatus } from './query.service';
import { UUID_RE } from './text';

const KEY_RE = /^products\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png|webp)$/;
const actorOf = (s: SessionContext) => ({ actor_id: s.user_id, actor_role: s.role });

/**
 * Ảnh sản phẩm (PRD-REQ-20261006-095502592, PRD-DB mục Giao dịch và khóa 4, 13): kiểm và xử lý lại ảnh, tải lên kho TRƯỚC, rồi ghi dòng `product_images`
 * trong giao dịch có khóa dòng sản phẩm; giao dịch lỗi thì xóa tệp mới ngay (job dọn là lưới an toàn). Xóa dòng trong giao dịch, xóa tệp SAU commit.
 */
@Injectable()
export class ImageService {
  private readonly log: AppLogger;
  constructor(
    private readonly transactions: TransactionService, private readonly prisma: PrismaService, private readonly audit: AuditService, private readonly clock: Clock,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage, private readonly queries: QueryService, logger: AppLogger,
  ) {
    this.log = logger.for('catalog');
  }

  private async product(tx: Tx, id: string): Promise<{ status: ProductStatus }> {
    if (!UUID_RE.test(id)) throw new DomainError('not-found');
    const [p] = await tx.$queryRaw<{ status: ProductStatus }[]>`SELECT status FROM products WHERE id = ${id}::uuid FOR UPDATE`;
    if (!p) throw new DomainError('not-found');
    if (p.status === 'archived') throw new DomainError('product-archived');
    return p;
  }

  async upload(actor: SessionContext, id: string, req: Request, res: Response): Promise<{ image_id: string; url: string; position: number }> {
    let bytes = 0;
    let img: ProcessedImage;
    try {
      const { file } = await readSingleFile(req, res, IMAGE_MAX_BYTES, (n) => { bytes = n; });
      img = await processProductImage(file);
    } catch (e) {
      const reason = e instanceof UploadError || e instanceof ImageError ? e.reason : null;
      if (!reason) throw e;
      this.log.warn('ảnh sản phẩm bị từ chối', { product_id: id, reason, bytes_read: bytes }); // không có tên tệp, không có nội dung
      throw new DomainError('image-invalid', { extra: { reason } });
    }
    // Kiểm sớm (không khóa) để ảnh bị từ chối không chạm kho: sản phẩm có thật, chưa archived, còn chỗ (BR1, BR2).
    if (!UUID_RE.test(id)) throw new DomainError('not-found');
    const [early] = await this.prisma.$queryRaw<{ status: ProductStatus; n: bigint }[]>`
      SELECT p.status, (SELECT count(*) FROM product_images i WHERE i.product_id = p.id) AS n FROM products p WHERE p.id = ${id}::uuid`;
    if (!early) throw new DomainError('not-found');
    if (early.status === 'archived') throw new DomainError('product-archived');
    if (Number(early.n) >= MAX_IMAGES) throw new DomainError('product-image-limit');

    const key = `${IMAGE_PREFIX}${randomUUID()}.${EXT[img.kind]}`; // khóa ngẫu nhiên do server sinh, không dùng tên tệp của client (BR4)
    try {
      // `nosniff` do CDN hoặc bucket gắn khi phát (S3 không lưu lại header này, ADR-018); gửi kèm để kho nào giữ được thì giữ.
      await this.storage.put(key, img.body, { contentType: MIME[img.kind], headers: { 'x-content-type-options': 'nosniff', 'cache-control': IMAGE_CACHE_CONTROL } });
    } catch (e) {
      if (e instanceof DomainError) throw e;
      this.log.error('ghi ảnh sản phẩm lên storage thất bại', { product_id: id, err: e });
      throw new DomainError('service-unavailable');
    }
    try {
      const now = this.clock.now();
      return await this.transactions.run(async (tx) => {
        await this.product(tx, id);
        const [{ n }] = await tx.$queryRaw<{ n: bigint }[]>`SELECT count(*) AS n FROM product_images WHERE product_id = ${id}::uuid`;
        if (Number(n) >= MAX_IMAGES) throw new DomainError('product-image-limit');
        const position = Number(n) + 1;
        const [row] = await tx.$queryRaw<{ id: string }[]>`
          INSERT INTO product_images (product_id, storage_key, content_type, width, height, bytes, position, created_at)
          VALUES (${id}::uuid, ${key}, ${img.kind}::image_type, ${img.width}, ${img.height}, ${img.body.length}, ${position}, ${now}::timestamptz) RETURNING id`;
        await tx.$executeRaw`UPDATE products SET updated_at = ${now}::timestamptz WHERE id = ${id}::uuid`;
        await this.audit.record(tx, { ...actorOf(actor), action: 'catalog.product.image.add', target_type: 'product', target_id: id, after: { image_id: row.id, position, content_type: img.kind, width: img.width, height: img.height, bytes: img.body.length } });
        return { image_id: row.id, url: this.storage.urlFor(key), position };
      });
    } catch (e) {
      await this.storage.delete(key).catch((err) => this.log.warn('xóa ảnh mồ côi thất bại, job dọn sẽ xóa', { err }));
      throw isForeignKey(e) ? new DomainError('not-found') : e;
    }
  }

  /** Đổi thứ tự: danh sách phải đúng bằng tập ảnh hiện có (BR6). `unique (product_id, position)` hoãn được nên đổi chỗ trong một câu UPDATE. */
  async reorder(actor: SessionContext, id: string, ids: string[]) {
    const now = this.clock.now();
    await this.transactions.run(async (tx) => {
      await this.product(tx, id);
      const have = (await tx.$queryRaw<{ id: string }[]>`SELECT id FROM product_images WHERE product_id = ${id}::uuid ORDER BY position`).map((r) => r.id);
      const lower = ids.map((x) => x.toLowerCase());
      if (new Set(lower).size !== lower.length || lower.length !== have.length || !lower.every((x) => have.includes(x))) {
        throw new DomainError('validation-failed', { errors: [{ field: 'image_ids', code: 'mismatch' }] });
      }
      await tx.$executeRaw`UPDATE product_images i SET position = v.pos FROM unnest(${lower}::uuid[]) WITH ORDINALITY AS v(id, pos) WHERE i.id = v.id AND i.product_id = ${id}::uuid`;
      await tx.$executeRaw`UPDATE products SET updated_at = ${now}::timestamptz WHERE id = ${id}::uuid`;
      await this.audit.record(tx, { ...actorOf(actor), action: 'catalog.product.image.reorder', target_type: 'product', target_id: id, before: { image_ids: have }, after: { image_ids: lower } });
    });
    return { images: await this.queries.images(id) };
  }

  /** Xóa ảnh: `draft` xóa được cả ảnh cuối; `active` phải còn ít nhất 1 ảnh (BR5). Dồn lại vị trí, rồi xóa tệp sau commit. */
  async remove(actor: SessionContext, id: string, imageId: string): Promise<void> {
    const now = this.clock.now();
    const key = await this.transactions.run(async (tx) => {
      const p = await this.product(tx, id);
      const imgs = await tx.$queryRaw<{ id: string; storage_key: string; position: number }[]>`SELECT id, storage_key, position FROM product_images WHERE product_id = ${id}::uuid ORDER BY position`;
      const target = imgs.find((i) => i.id === imageId.toLowerCase());
      if (!target) throw new DomainError('not-found');
      if (p.status === 'active' && imgs.length <= 1) throw new DomainError('product-last-image');
      await tx.$executeRaw`DELETE FROM product_images WHERE id = ${target.id}::uuid`;
      await tx.$executeRaw`UPDATE product_images i SET position = r.rn FROM (SELECT id, row_number() OVER (ORDER BY position) AS rn FROM product_images WHERE product_id = ${id}::uuid) r WHERE i.id = r.id AND i.position <> r.rn`;
      await tx.$executeRaw`UPDATE products SET updated_at = ${now}::timestamptz WHERE id = ${id}::uuid`;
      await this.audit.record(tx, { ...actorOf(actor), action: 'catalog.product.image.delete', target_type: 'product', target_id: id, before: { image_id: target.id, position: target.position } });
      return target.storage_key;
    });
    await this.storage.delete(key).catch((err) => this.log.warn('xóa tệp ảnh thất bại, job dọn sẽ xóa', { err }));
  }

  /**
   * Job `prd.sweep-orphan-images` (ADR-013, ADR-018): xóa khóa `products/` quá 24 giờ mà không dòng `product_images` nào tham chiếu. Trả số đối tượng đã xóa.
   * Đóng khi không chắc (bài học L52): nguồn tham chiếu RỖNG mà kho có đối tượng cần xóa (sai CSDL, bảng bị làm rỗng) thì dừng và báo lỗi, không xóa gì.
   */
  async sweepOrphans(signal?: AbortSignal): Promise<number> {
    const inUse = new Set((await this.prisma.$queryRaw<{ storage_key: string }[]>`SELECT storage_key FROM product_images`).map((r) => r.storage_key));
    const cutoff = this.clock.now().getTime() - IMAGE_ORPHAN_AGE_MS;
    const orphans = (await this.storage.list(IMAGE_PREFIX)).filter((o) => KEY_RE.test(o.key) && !inUse.has(o.key) && o.lastModified.getTime() <= cutoff);
    if (orphans.length && inUse.size === 0) throw new Error(`prd.sweep-orphan-images dừng: bảng product_images rỗng nhưng kho có ${orphans.length} ảnh cần xóa (nguồn tham chiếu hỏng hay sai CSDL thì xóa sẽ mất ảnh đang dùng); xác nhận bằng tay`);
    let removed = 0;
    for (const o of orphans.slice(0, IMAGE_SWEEP_BATCH)) { // phần còn lại để lượt sau (mỗi giờ)
      if (signal?.aborted) break;
      await this.storage.delete(o.key);
      removed++;
    }
    return removed;
  }
}
