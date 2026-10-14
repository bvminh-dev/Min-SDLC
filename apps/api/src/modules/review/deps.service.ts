import { Injectable } from '@nestjs/common';
import { AuthApi, type DisplayName } from '../auth';
import { CatalogApi, type ProductSummary } from '../catalog';
import { OrderApi } from '../order';
import { AppLogger, DomainError } from '../platform';
import { ANONYMOUS_NAME, DEP_TIMEOUT_MS, NAME_BATCH } from './config';
import { UUID_RE } from './db';

export interface DeliveredItem { order_item_id: string; order_id: string; delivered_at: Date }
/** Dữ kiện của module khác cho một lần tạo hay hỏi điều kiện (đọc NGOÀI giao dịch, SB-31, ADR-012): sản phẩm, dòng đơn đã giao, có đơn chưa giao hay không. */
export interface Facts { product: ProductSummary | null; delivered: DeliveredItem[]; undelivered: boolean }

/** Tên đã che (REV-REQ-20261006-103135566 BR4): "<từ cuối> <chữ cái đầu của từ đầu>."; một từ thì giữ nguyên; thiếu họ tên thì "Khách hàng". Đếm theo code point, bỏ ký tự điều khiển. */
export function maskName(full: string | null | undefined): string {
  // eslint-disable-next-line no-control-regex
  const words = String(full ?? '').replace(/[\u0000-\u001F\u007F]/g, ' ').trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return ANONYMOUS_NAME;
  if (words.length === 1) return words[0];
  return `${words[words.length - 1]} ${[...words[0]][0].toLocaleUpperCase()}.`;
}

const withTimeout = <T>(p: Promise<T>, ms: number): Promise<T> => new Promise<T>((resolve, reject) => {
  const t = setTimeout(() => reject(new Error('dependency timeout')), ms);
  p.then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); });
});

/**
 * Lời gọi sang PRD (`CatalogApi.getSummaries`), ORD (`OrderApi.getDeliveredItems`, `hasUndeliveredItems`) và AUTH (`AuthApi.getDisplayNames`) của REV (ADR-012, bảng Giao diện module): chỉ đọc, theo lô, KHÔNG nhận `tx`
 * và không bao giờ gọi trong lúc giữ giao dịch (không giữ kết nối thứ nhất rồi xin kết nối thứ hai, SB-31). Quá hạn 2 giây hay lỗi: 503 `service-unavailable` (chi tiết chỉ vào log).
 */
@Injectable()
export class DepsService {
  private readonly log: AppLogger;
  constructor(private readonly catalog: CatalogApi, private readonly orders: OrderApi, private readonly auth: AuthApi, logger: AppLogger) {
    this.log = logger.for('review');
  }

  private async dep<T>(what: string, p: () => Promise<T>): Promise<T> {
    try { return await withTimeout(p(), DEP_TIMEOUT_MS); } catch (err) {
      this.log.error('lời gọi sang module khác thất bại', { code: 'dependency-failed', dependency: what, err });
      throw new DomainError('service-unavailable');
    }
  }

  /** Sản phẩm theo lô (tối đa 100 id, mọi trạng thái), khóa theo id. */
  async products(ids: string[]): Promise<Map<string, ProductSummary>> {
    const list = [...new Set(ids.filter((x) => UUID_RE.test(x)))];
    const out = new Map<string, ProductSummary>();
    for (let i = 0; i < list.length; i += NAME_BATCH) for (const p of await this.dep('PRD.getSummaries', () => this.catalog.getSummaries(list.slice(i, i + NAME_BATCH)))) out.set(p.product_id, p);
    return out;
  }

  /** Tên hiển thị và ảnh đại diện theo lô, khóa theo `user_id`; tên đã che theo BR4 ở đây, không bao giờ trả họ tên đầy đủ. */
  async names(ids: string[]): Promise<Map<string, { display_name: string; avatar_url: string | null }>> {
    const list = [...new Set(ids)];
    const out = new Map<string, { display_name: string; avatar_url: string | null }>();
    for (let i = 0; i < list.length; i += NAME_BATCH) {
      for (const n of await this.dep<DisplayName[]>('AUTH.getDisplayNames', () => this.auth.getDisplayNames(list.slice(i, i + NAME_BATCH)))) out.set(n.user_id, { display_name: maskName(n.display_name), avatar_url: n.avatar_url });
    }
    return out;
  }

  async facts(userId: string, productId: string | null): Promise<Facts> {
    if (!productId) return { product: null, delivered: [], undelivered: false };
    const [products, delivered, undelivered] = await Promise.all([
      this.products([productId]),
      this.dep('ORD.getDeliveredItems', () => this.orders.getDeliveredItems(userId, productId)),
      this.dep('ORD.hasUndeliveredItems', () => this.orders.hasUndeliveredItems(userId, productId)),
    ]);
    return { product: products.get(productId) ?? null, delivered, undelivered };
  }
}
