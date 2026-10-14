import { Inject, Injectable } from '@nestjs/common';
import { OBJECT_STORAGE, PrismaService, type ObjectStorage, type Tx } from '../platform';
import type { ReviewRow } from './db';

/** `id` chỉ trả cho chủ (để gửi lại trong `image_ids` khi sửa, giữ ảnh hiện có); công khai và admin dùng `bare()`. */
export interface ImageView { id: string; url: string; width: number; height: number }
export const bare = (list: ImageView[]): { url: string; width: number; height: number }[] => list.map(({ url, width, height }) => ({ url, width, height }));
export interface OwnerView {
  id: string; product_id: string; status: string; rating: number; comment: string | null; images: ImageView[]; created_at: string; edited_at: string | null;
}
const iso = (d: Date | null): string | null => (d ? d.toISOString() : null);

/** Ảnh của một tập đánh giá theo thứ tự `position`, một câu truy vấn cho cả trang. `db` là `tx` khi cần đọc trong giao dịch. */
@Injectable()
export class ViewService {
  constructor(private readonly prisma: PrismaService, @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage) {}

  async imagesOf(reviewIds: string[], db: PrismaService | Tx = this.prisma): Promise<Map<string, ImageView[]>> {
    const out = new Map<string, ImageView[]>();
    if (!reviewIds.length) return out;
    const rows = await db.$queryRaw<{ id: string; review_id: string; storage_key: string; width: number; height: number }[]>`
      SELECT id, review_id, storage_key, width, height FROM review_images WHERE review_id = ANY(${reviewIds}::uuid[]) ORDER BY review_id, position`;
    for (const r of rows) {
      const list = out.get(r.review_id) ?? [];
      list.push({ id: r.id, url: this.storage.urlFor(r.storage_key), width: r.width, height: r.height });
      out.set(r.review_id, list);
    }
    return out;
  }

  /** Dạng trả về cho chủ sau khi tạo hoặc sửa: không có `user_id`, `order_item_id`, `moderation_reason`. */
  owner(r: ReviewRow, images: ImageView[]): OwnerView {
    return { id: r.id, product_id: r.product_id, status: r.status, rating: r.rating, comment: r.comment, images, created_at: r.created_at.toISOString(), edited_at: iso(r.edited_at) };
  }
}
