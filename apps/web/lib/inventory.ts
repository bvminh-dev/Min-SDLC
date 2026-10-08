// Nhãn còn hàng: web ghép từ endpoint công khai của INV (K-12, SB-37), PRD không đọc tồn kho. Lỗi, quá 3 giây hay thân lạ thì trả null (ẩn nhãn, không báo lỗi).
import { API_BASE_URL } from './config';

const TIMEOUT_MS = 3000;
const inflight = new Map<string, Promise<Map<string, boolean> | null>>();

/** Một lời gọi theo lô (tối đa 100 id). Các lời gọi cùng danh sách id đang chạy dùng chung một yêu cầu (React StrictMode chạy effect hai lần ở môi trường dev). */
export function fetchStock(ids: string[]): Promise<Map<string, boolean> | null> {
  const list = [...new Set(ids)].slice(0, 100);
  if (list.length === 0) return Promise.resolve(null);
  const key = list.join(',');
  const running = inflight.get(key);
  if (running) return running;
  const p = (async () => {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(`${API_BASE_URL}/inventory/availability?product_ids=${encodeURIComponent(key).replace(/%2C/g, ',')}`, { signal: ctl.signal });
      if (res.status !== 200) return null;
      const body = await res.json();
      if (!Array.isArray(body?.items)) return null;
      const map = new Map<string, boolean>();
      for (const it of body.items) if (typeof it?.product_id === 'string' && typeof it?.in_stock === 'boolean') map.set(it.product_id, it.in_stock);
      return map;
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
      inflight.delete(key);
    }
  })();
  inflight.set(key, p);
  return p;
}
