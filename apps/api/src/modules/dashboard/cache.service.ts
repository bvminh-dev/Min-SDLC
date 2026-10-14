import { Injectable } from '@nestjs/common';
import { Clock, ConfigService } from '../platform';
import { CACHE_MAX_ENTRIES } from './config';
import { isoZ } from './range';

/**
 * Bộ nhớ đệm theo (khối, tham số đã chuẩn hóa) trong bộ nhớ tiến trình (ADR-020, DSH-DB): chỉ lưu phản hồi thành công; không bao giờ lưu lỗi (503), không có dữ liệu riêng theo người dùng
 * (mọi endpoint chỉ admin và quyền đã kiểm TRƯỚC khi tới đây, T7). Hạn tính theo `Clock` (đồng hồ giả trong test). Một lúc chỉ MỘT lần đọc nguồn cho mỗi khóa (single-flight): nhiều yêu cầu
 * cùng khóa đến lúc đệm trống dùng chung một lần đọc thay vì dồn đàn vào nguồn; lần đọc lỗi thì tất cả nhận cùng lỗi và không để lại gì.
 */
@Injectable()
export class BlockCache {
  private readonly entries = new Map<string, { expires: number; value: Record<string, unknown> }>();
  private readonly flights = new Map<string, Promise<Record<string, unknown>>>();
  constructor(private readonly clock: Clock, private readonly config: ConfigService) {}

  size(): number { return this.entries.size; }
  clear(): void { this.entries.clear(); }

  /** `load` trả phần thân của khối; `as_of` là thời điểm BẮT ĐẦU đọc nguồn và giữ nguyên khi trả từ đệm. */
  get(key: string, load: () => Promise<Record<string, unknown>>): Promise<Record<string, unknown>> {
    const now = this.clock.now().getTime();
    const hit = this.entries.get(key);
    if (hit && hit.expires > now) return Promise.resolve(hit.value);
    if (hit) this.entries.delete(key);
    const running = this.flights.get(key);
    if (running) return running;
    const flight = (async () => {
      const asOf = isoZ(this.clock.now());
      const body = await load();
      const value = { ...body, as_of: asOf };
      this.store(key, value);
      return value;
    })().finally(() => { this.flights.delete(key); });
    this.flights.set(key, flight);
    return flight;
  }

  private store(key: string, value: Record<string, unknown>): void {
    const now = this.clock.now().getTime();
    const ttl = this.config.get<number>('DASHBOARD_CACHE_TTL_SECONDS') * 1000;
    if (this.entries.size >= CACHE_MAX_ENTRIES) {
      for (const [k, v] of this.entries) if (v.expires <= now) this.entries.delete(k);
      while (this.entries.size >= CACHE_MAX_ENTRIES) { const oldest = this.entries.keys().next().value; if (oldest === undefined) break; this.entries.delete(oldest); }
    }
    this.entries.set(key, { expires: now + ttl, value });
  }
}
