'use client';
// Dashboard và báo cáo của admin (epic DSH): kiểu dữ liệu, định dạng và hook tải từng khối. Mỗi khối tải ĐỘC LẬP (DSH-REQ-20261006-105126549 BR2): lỗi của khối này không làm hỏng khối kia,
// khối lỗi không bao giờ hiện 0 hay "không có dữ liệu" thay cho lỗi (SB-39). Ngày theo giờ Việt Nam (UTC+7 cố định), tính tay để không phụ thuộc múi giờ của máy.
import { useCallback, useEffect, useRef, useState } from 'react';
import { api, SESSION_EXPIRED_EVENT } from './api';
import { API_BASE_URL } from './config';
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

/** Báo cáo theo nguồn (DSH-REQ-20261015-092608812): doanh thu là GIÁ TRỊ ĐƠN (không phải tiền PAY), đã loại đơn hủy, hết hạn, hoàn về; thứ tự dòng do máy chủ (khớp tệp CSV). */
export interface SourcesReport { from: string; to: string; as_of: string; items: { source_id: string; code: string; name: string; is_active: boolean; orders: number; revenue: number }[]; totals: { orders: number; revenue: number; excluded_orders: number } }
/** Báo cáo theo sale (DSH-REQ-20261015-092608849): `website` là dòng gom đơn khách tự đặt, luôn có, đứng riêng ngoài `items`. */
export interface SalesReport {
  from: string; to: string; as_of: string; items: { user_id: string; name: string; orders: number; revenue: number }[];
  website: { name: string; orders: number; revenue: number }; totals: { orders: number; revenue: number; excluded_orders: number };
}
/** Nhãn máy chủ điền khi không tra được tên người tạo (dòng và số liệu vẫn đủ). */
export const DELETED_ACCOUNT_LABEL = '(tài khoản đã xóa)';

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

/**
 * Tải tệp CSV của báo cáo (tệp do MÁY CHỦ dựng, chống công thức ở máy chủ: web không tự dựng tệp). `loading` khóa nút; mọi lỗi (400, 403, 429, 503, mạng, thân không phải CSV) là `error`
 * và KHÔNG tải tệp rỗng; 401 hết phiên mở hộp thoại của AUTH. Tên tệp lấy từ `Content-Disposition` nếu đọc được (cùng site), không thì `fallbackName`.
 */
export function useCsvExport() {
  const [state, setState] = useState<'idle' | 'loading' | 'error'>('idle');
  const run = useCallback(async (path: string, fallbackName: string): Promise<void> => {
    setState('loading');
    try {
      const res = await fetch(`${API_BASE_URL}${path}`, { credentials: 'include' });
      if (!res.ok || !/^text\/csv/i.test(res.headers.get('Content-Type') ?? '')) {
        if (res.status === 401) { const b = await res.json().catch(() => ({})); if (String(b?.type).endsWith('session_expired')) window.dispatchEvent(new Event(SESSION_EXPIRED_EVENT)); }
        setState('error');
        return;
      }
      const blob = await res.blob();
      const name = /filename="([^"]+)"/.exec(res.headers.get('Content-Disposition') ?? '')?.[1] ?? fallbackName;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = name;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 0);
      setState('idle');
    } catch { setState('error'); }
  }, []);
  return { state, run, clear: useCallback(() => setState('idle'), []) };
}
