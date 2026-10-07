import { DomainError } from '../../platform';

/** Object storage cho ảnh đại diện (ADR-010): chỉ ba thao tác USR cần. Khóa đối tượng không bao giờ lấy từ dữ liệu client. */
export interface StoredObject { key: string; lastModified: Date }
export interface ObjectStorage {
  put(key: string, body: Buffer, o: { contentType: string; headers?: Record<string, string> }): Promise<void>;
  /** Idempotent: xóa khóa không tồn tại không lỗi. */
  delete(key: string): Promise<void>;
  list(prefix: string): Promise<StoredObject[]>;
  /** URL công khai theo khóa (ADR-018: khóa ngẫu nhiên, không ký URL). */
  urlFor(key: string): string;
  /** Khóa từ URL do `urlFor` sinh ra; null nếu URL không thuộc kho này. */
  keyOf(url: string): string | null;
}
export const OBJECT_STORAGE = Symbol('OBJECT_STORAGE');

/** Chưa cấu hình kho (chỉ cho phép ở dev): ghi báo 503, không có gì để xóa hay quét. */
export class UnconfiguredStorage implements ObjectStorage {
  async put(): Promise<void> { throw new DomainError('service-unavailable'); }
  async delete(): Promise<void> { /* không có đối tượng nào */ }
  async list(): Promise<StoredObject[]> { return []; }
  urlFor(key: string): string { return `/${key}`; }
  keyOf(): string | null { return null; }
}
