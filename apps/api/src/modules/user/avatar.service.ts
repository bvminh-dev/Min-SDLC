import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { Request, Response } from 'express';
import { AuthApi } from '../auth';
import { AppLogger, Clock, ConfigService, DomainError, OBJECT_STORAGE, type ObjectStorage } from '../platform';
import { AVATAR_CACHE_CONTROL, AVATAR_MAX_BYTES, AVATAR_ORPHAN_AGE_MS } from './config';
import { ImageError, processAvatar } from './image';
import { readSingleFile } from './multipart';

const KEY_RE = /^avatars\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.webp$/;
const withTimeout = <T>(p: Promise<T>, ms: number): Promise<T> => new Promise<T>((resolve, reject) => {
  const t = setTimeout(() => reject(new ImageError('corrupt')), ms); // quá hạn xử lý: coi như ảnh không xử lý nổi (USR-SEC T9)
  p.then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); });
});

/** Ảnh đại diện (USR-REQ-20261006-101003679, USR-DB mục 8): kiểm, xử lại, ghi storage, rồi mới đổi `avatar_url` qua AUTH, rồi xóa ảnh cũ (best-effort). */
@Injectable()
export class AvatarService {
  private readonly log: AppLogger;
  /** Bộ xử lý ảnh (thay được trong test để dựng ca quá hạn). */
  process: (buf: Buffer) => Promise<Buffer> = processAvatar;

  constructor(
    private readonly auth: AuthApi,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
    private readonly config: ConfigService,
    private readonly clock: Clock,
    logger: AppLogger,
  ) {
    this.log = logger.for('user');
  }

  async upload(userId: string, req: Request, res: Response): Promise<{ avatar_url: string }> {
    let bytes = 0;
    try {
      const { file } = await readSingleFile(req, res, AVATAR_MAX_BYTES, (n) => { bytes = n; });
      const webp = await withTimeout(this.process(file), this.config.get<number>('USR_AVATAR_PROCESS_TIMEOUT_MS'));
      return await this.store(userId, webp);
    } catch (e) {
      if (!(e instanceof ImageError)) throw e;
      this.log.warn('ảnh đại diện bị từ chối', { user_id: userId, reason: e.reason, bytes_read: bytes }); // không có tên tệp, không có nội dung
      throw new DomainError('image-invalid', { extra: { reason: e.reason } });
    }
  }

  private async store(userId: string, webp: Buffer): Promise<{ avatar_url: string }> {
    const before = await this.auth.getUser(userId);
    if (!before) throw new DomainError('unauthenticated');
    const key = `avatars/${randomUUID()}.webp`;
    try {
      // Content-Type, nosniff và cache ngắn theo USR-REQ BR5 (ADR-018). Kho S3 thật có thể không phát lại `x-content-type-options`: CDN hay bucket gắn khi phát (USR-SEC T8, kiểm bằng config)
      await this.storage.put(key, webp, { contentType: 'image/webp', headers: { 'x-content-type-options': 'nosniff', 'cache-control': AVATAR_CACHE_CONTROL } });
    } catch (e) {
      if (e instanceof DomainError) throw e;
      this.log.error('ghi ảnh lên storage thất bại', { user_id: userId, err: e });
      throw new DomainError('service-unavailable'); // avatar_url giữ nguyên (BR6)
    }
    const url = this.storage.urlFor(key);
    try {
      await this.auth.updateProfile(userId, { avatar_url: url });
    } catch (e) {
      await this.storage.delete(key).catch(() => undefined); // đối tượng mới mồ côi: dọn ngay, job quét là lưới an toàn
      throw e;
    }
    await this.removeKeyOf(before.avatar_url);
    return { avatar_url: url };
  }

  /** Xóa ảnh: đặt `avatar_url` rỗng trước, xóa đối tượng sau; idempotent (USR-DB mục 8). */
  async remove(userId: string): Promise<void> {
    const before = await this.auth.getUser(userId);
    if (!before) throw new DomainError('unauthenticated');
    if (!before.avatar_url) return;
    await this.auth.updateProfile(userId, { avatar_url: null });
    await this.removeKeyOf(before.avatar_url);
  }

  private async removeKeyOf(url: string | null): Promise<void> {
    const key = url ? this.storage.keyOf(url) : null;
    if (!key || !KEY_RE.test(key)) return; // chỉ xóa khóa do chính USR sinh
    await this.storage.delete(key).catch((err) => this.log.warn('xóa ảnh cũ thất bại, job quét sẽ dọn', { err }));
  }

  /** Job `usr.sweep-orphan-avatars` (ADR-013, ADR-018): xóa khóa `avatars/` quá 24 giờ mà không User nào còn tham chiếu. Trả số đối tượng đã xóa. */
  async sweepOrphans(signal?: AbortSignal): Promise<number> {
    const keys = (await this.auth.listAvatarUrlsInUse()).map((u) => this.storage.keyOf(u));
    // Có avatar_url không ánh xạ được về khóa của kho hiện tại (đổi STORAGE_PUBLIC_BASE_URL, đổi endpoint): không biết khóa nào còn dùng thì KHÔNG xóa gì (đóng khi không chắc), job báo lỗi để người xử lý.
    if (keys.some((k) => !k)) throw new Error(`usr.sweep-orphan-avatars dừng: ${keys.filter((k) => !k).length} avatar_url không thuộc kho ảnh hiện tại (đổi STORAGE_PUBLIC_BASE_URL hay endpoint cần chuyển avatar_url trước)`);
    const inUse = new Set(keys as string[]);
    const cutoff = this.clock.now().getTime() - AVATAR_ORPHAN_AGE_MS;
    let removed = 0;
    for (const o of await this.storage.list('avatars/')) {
      if (signal?.aborted) break;
      if (!KEY_RE.test(o.key) || inUse.has(o.key) || o.lastModified.getTime() > cutoff) continue;
      await this.storage.delete(o.key);
      removed++;
    }
    return removed;
  }
}
