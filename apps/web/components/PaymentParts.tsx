'use client';
import { useEffect, useRef, useState } from 'react';
import { api, type ApiResult } from '../lib/api';
import { newIdemKey, payStatusText, refundStatusText } from '../lib/payment';
import { useLoginRedirect } from '../lib/prd';
import { limitedText } from '../lib/stock';
import { useCountdown } from './useCountdown';

export function PayBadge({ status, method, testid }: { status: string; method?: string; testid?: string }) {
  return <span className="badge" data-status={`pay-${status}`} data-testid={testid}>{payStatusText(status, method)}</span>;
}

export function RefundBadge({ status, customer, testid }: { status: string; customer?: boolean; testid?: string }) {
  return <span className="badge" data-status={`pay-refund-${status}`} data-testid={testid}>{refundStatusText(status, customer)}</span>;
}

export const Spinner = () => <span className="spinner" aria-hidden="true" />;

/** Tổng số (chỉ con số, để kiểm đúng giá trị) và phân trang Trước, Sau; ẩn điều khiển khi chỉ một trang. */
export function PayPager({ testPrefix, page, limit, total, unit, onPage, disabled }: { testPrefix: string; page: number; limit: number; total: number; unit: string; onPage: (p: number) => void; disabled?: boolean }) {
  const pages = Math.max(1, Math.ceil(total / limit));
  return (
    <div className="pager">
      <p className="hint">Tổng <strong data-testid={`${testPrefix}-total`}>{total}</strong> {unit}</p>
      {pages > 1 && (
        <nav aria-label="Phân trang" className="pages" data-testid={`${testPrefix}-pagination`}>
          <button type="button" className="btn" disabled={disabled || page <= 1} onClick={() => onPage(page - 1)}>Trước</button>
          <span className="hint">Trang {page}/{pages}</span>
          <button type="button" className="btn" disabled={disabled || page >= pages} onClick={() => onPage(page + 1)}>Sau</button>
        </nav>
      )}
    </div>
  );
}

/**
 * Số giây còn lại tới `iso` (null khi không có hạn). Chỉ là gợi ý cho người dùng: về 0 thì gọi `onZero` đúng một lần cho mỗi hạn để màn đọc lại server,
 * không tự kết luận hết hạn. Timer dừng ở 0 và khi rời trang.
 */
export function useRemaining(iso: string | null | undefined, onZero: () => void): number | null {
  const [left, setLeft] = useState<number | null>(null);
  const zero = useRef(onZero);
  zero.current = onZero;
  useEffect(() => {
    const end = iso ? new Date(iso).getTime() : NaN;
    if (!Number.isFinite(end)) { setLeft(null); return; }
    let fired = false;
    const tick = () => {
      const s = Math.max(0, Math.ceil((end - Date.now()) / 1000));
      setLeft(s);
      if (s === 0) { clearInterval(t); if (!fired) { fired = true; zero.current(); } }
    };
    const t = setInterval(tick, 1000);
    tick();
    return () => clearInterval(t);
  }, [iso]);
  return left;
}

/**
 * Một thao tác ghi liên quan tiền trong hộp thoại: khóa ngay khi bấm (cờ đồng bộ, bấm lặp không gửi lần hai), 401 chuyển đăng nhập, 429 có đếm ngược và tự mất,
 * lỗi khác do `map` đổi thành câu. `idem` (nếu có) là chữ ký nội dung: cùng chữ ký thì giữ khóa `Idempotency-Key` của lần bấm trước khi lần đó chưa có phản hồi
 * (lỗi mạng, 5xx), nội dung khác hoặc đã có phản hồi thì sinh khóa mới.
 */
export function useMoney() {
  const expired = useLoginRedirect();
  const limit = useCountdown();
  const lock = useRef(false);
  const key = useRef<{ sig: string; key: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [rate, setRate] = useState(false);
  const send = async (path: string, body: unknown, o: { idem?: string; map: (r: ApiResult) => string }): Promise<ApiResult | null> => {
    if (lock.current) return null;
    lock.current = true; setBusy(true); setErr(null); setRate(false);
    let headers: Record<string, string> | undefined;
    if (o.idem !== undefined) {
      if (!key.current || key.current.sig !== o.idem) key.current = { sig: o.idem, key: newIdemKey() };
      headers = { 'Idempotency-Key': key.current.key };
    }
    const r = await api(path, { method: 'POST', body, headers });
    lock.current = false; setBusy(false);
    if (r.status > 0 && r.status < 500) key.current = null;
    if (r.ok) return r;
    if (expired(r)) return r;
    if (r.status === 429) { limit.start(r.retryAfter); setRate(true); return r; }
    setErr(o.map(r));
    return r;
  };
  return { busy, err, rateText: rate && limit.left > 0 ? limitedText(limit.left) : null, send, clear: () => { setErr(null); setRate(false); } };
}

/** Câu lỗi chung của hoàn tiền (tạo mới và thử lại). */
export function refundError(r: ApiResult): string {
  switch (r.code) {
    case 'payment-not-refundable': return 'Thanh toán này không hoàn tiền được ở trạng thái hiện tại';
    case 'refund-in-progress': return 'Đã có hoàn tiền đang xử lý';
    case 'refund-use-retry': return 'Giao dịch đã có hoàn tiền thất bại, hãy dùng Thử lại';
    case 'refund-not-retryable': return 'Không thử lại được ở trạng thái này';
    case 'cod-refund-unsupported': return 'Thanh toán COD chưa hỗ trợ hoàn tiền';
    default:
      if (r.status === 400) return 'Lý do từ 5 đến 300 ký tự';
      if (r.status === 403) return 'Bạn không có quyền hoàn tiền';
      if (r.status === 404) return 'Không tìm thấy thanh toán';
      return 'Không thực hiện được. Thử lại.';
  }
}
