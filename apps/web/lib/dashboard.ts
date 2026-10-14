'use client';
// Dashboard và báo cáo của admin (epic DSH): kiểu dữ liệu, định dạng và hook tải từng khối. Mỗi khối tải ĐỘC LẬP (DSH-REQ-20261006-105126549 BR2): lỗi của khối này không làm hỏng khối kia,
// khối lỗi không bao giờ hiện 0 hay "không có dữ liệu" thay cho lỗi (SB-39). Ngày theo giờ Việt Nam (UTC+7 cố định), tính tay để không phụ thuộc múi giờ của máy.
import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from './api';
import { STATUS_ORDER, type OrderStatus, type PaymentStatus } from './order';
import type { BlockStatus, Granularity } from './dashboard-format';

export * from './dashboard-format';

export { STATUS_ORDER };
export type { OrderStatus, PaymentStatus };
export type StatusCounts = Record<OrderStatus, number>;
export interface Money { gross: number; refunded: number; net: number; payment_count: number }
export interface RevenueBlock extends Money { from: string; to: string; as_of: string; failed_refund_count: number }
export interface OrdersBlock { from: string; to: string; as_of: string; total: number; effective: number; by_status: StatusCounts }
export interface CustomersBlock { from: string; to: string; as_of: string; total: number; locked: number; new_in_range: number }
export interface ProductsBlock { as_of: string; total: number; by_status: { active: number; draft: number; archived: number } }
export interface LowStockBlock { as_of: string; count: number; items: { product_id: string; name: string; sku: string; available: number; low_stock_threshold: number }[] }
export interface RecentBlock { as_of: string; items: { code: string; created_at: string; status: OrderStatus; grand_total: number; payment_method: 'vnpay' | 'cod'; payment_status: PaymentStatus; item_count: number }[] }
export interface RevenueReport { from: string; to: string; as_of: string; granularity: Granularity; buckets: ({ bucket_start: string } & Money)[]; totals: Money; by_method: { vnpay: Money; cod: Money } }
export interface OrdersReport {
  from: string; to: string; as_of: string; granularity: Granularity; buckets: { bucket_start: string; total: number; by_status: StatusCounts }[];
  totals: { total: number; by_status: StatusCounts; cancel_rate: number | null; expired_rate: number | null; average_order_value: number | null };
}
export interface ProductsReport { from: string; to: string; as_of: string; sort: 'units' | 'amount'; limit: number; units_total: number; distinct_products: number; items: { product_id: string; name: string; units_sold: number; items_amount: number }[] }

export interface Block<T> { data: T | null; status: BlockStatus; retryAfter?: number; fields: Record<string, string>; reload: () => void }

/**
 * Tải một khối từ `path` (null là chưa tải). 200: số liệu; 400 (khoảng sai): giữ số cũ, báo `invalid`; 429: giữ số cũ, báo `limited` kèm số giây; 403: `forbidden`; còn lại (503, mạng): `error`
 * và BỎ số cũ (khối lỗi không hiện số). Lời gọi cũ đến muộn không ghi đè lời gọi mới (số thứ tự). `reload` gọi lại ngay (nút Thử lại, Làm mới).
 */
export function useBlock<T>(path: string | null): Block<T> {
  const [state, setState] = useState<{ data: T | null; status: BlockStatus; retryAfter?: number; fields: Record<string, string> }>({ data: null, status: 'loading', fields: {} });
  const seq = useRef(0);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (path === null) return;
    const n = ++seq.current;
    setState((s) => ({ ...s, status: s.data ? s.status : 'loading', fields: {} }));
    void api<T>(path).then((r) => {
      if (n !== seq.current) return;
      if (r.status === 200) setState({ data: r.body as T, status: 'ready', fields: {} });
      else if (r.status === 400) setState((s) => ({ data: s.data, status: 'invalid', fields: r.fieldErrors }));
      else if (r.status === 429) setState((s) => ({ data: s.data, status: 'limited', retryAfter: r.retryAfter, fields: {} }));
      else if (r.status === 403) setState({ data: null, status: 'forbidden', fields: {} });
      else if (r.status === 401) setState((s) => ({ ...s, status: s.data ? 'ready' : 'loading' })); // phiên hết hạn: hộp thoại của AUTH, không đổi số đang hiển thị
      else setState({ data: null, status: 'error', fields: {} });
    });
    return () => { seq.current += 1; };
  }, [path, tick]);
  const reload = useCallback(() => { setState((s) => ({ ...s, status: 'loading' })); setTick((x) => x + 1); }, []);
  return { ...state, reload };
}
