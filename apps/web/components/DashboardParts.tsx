'use client';
import Link from 'next/link';
import { useEffect, useState, type ReactNode } from 'react';
import { AccessDenied } from './AccessDenied';
import { useAuth } from '../lib/auth';
import { addDays, asOfText, bucketLabel, defaultRange, limitedText, money, type BlockStatus, type Granularity } from '../lib/dashboard';

/** Lỗi theo khoảng ngày của máy chủ (400) bằng lời ngắn: không lặp lại giá trị người dùng nhập. */
export const RANGE_ERROR_TEXT = 'Khoảng ngày không hợp lệ: tối đa 366 ngày, không sau hôm nay, Từ không sau Đến.';

/**
 * Thanh khoảng ngày dùng chung (dashboard và ba báo cáo), gọn một hàng: ô ngày Từ, ô ngày Đến, Áp dụng, phím tắt 7 và 30 ngày, "Cập nhật lúc". Giá trị ở ô là bản nháp cho tới khi bấm Áp dụng; khoảng đang áp dụng (`applied`)
 * đến từ URL hoặc mặc định. Không có `<form>` nên ràng buộc `max` của trình duyệt không chặn lần gửi: máy chủ là nơi quyết định khoảng hợp lệ (400 hiện ở dòng lỗi, giữ số của khoảng trước).
 */
export function RangeBar({ p, applied, onApply, onReset, invalid, asOf, children }: {
  p: string; applied: { from: string; to: string } | null; onApply: (from: string, to: string) => void; onReset: () => void; invalid: boolean; asOf?: string; children?: ReactNode;
}) {
  const base = applied ?? defaultRange();
  const [from, setFrom] = useState(base.from);
  const [to, setTo] = useState(base.to);
  useEffect(() => { setFrom(base.from); setTo(base.to); }, [base.from, base.to]);
  const today = defaultRange().to;
  const week = addDays(today, -6);
  const is7 = applied?.from === week && applied.to === today;
  return (
    <div className="rd-range" role="group" aria-label="Khoảng ngày">
      <div className="rd-dates">
        <label className="rd-date"><span className="sr-only">Từ</span>
          <input type="date" value={from} max={today} onChange={(e) => setFrom(e.target.value)} data-testid={`${p}-range-from`} />
        </label>
        <span className="i i-right muted" aria-hidden="true" />
        <label className="rd-date"><span className="sr-only">Đến</span>
          <input type="date" value={to} max={today} onChange={(e) => setTo(e.target.value)} data-testid={`${p}-range-to`} />
        </label>
        <button type="button" className="btn btn-primary tight" onClick={() => onApply(from, to)} data-testid={`${p}-range-apply`}>Áp dụng</button>
      </div>
      <div className="seg" role="group" aria-label="Phím tắt">
        <button type="button" aria-pressed={is7} onClick={() => onApply(week, today)} data-testid={`${p}-range-7`}>7 ngày</button>
        <button type="button" aria-pressed={!applied} onClick={onReset} data-testid={`${p}-range-reset`}>30 ngày</button>
      </div>
      {children && <div className="rd-range-extra">{children}</div>}
      {asOf && <span className="small muted rd-asof" role="status" data-testid={`${p}-as-of`}><span className="i i-clock" aria-hidden="true" /> {asOfText(asOf)}</span>}
      {invalid && <div role="alert" className="field-error rd-range-error" data-testid={`${p}-range-error`}>{RANGE_ERROR_TEXT}</div>}
    </div>
  );
}

/** Dải "Thao tác quá nhanh" của 429: giữ số cũ đang hiển thị. */
export function RateBanner({ testid, status, retryAfter }: { testid: string; status: BlockStatus | undefined; retryAfter?: number }) {
  if (status !== 'limited') return null;
  return <div role="alert" className="banner banner-info" data-testid={testid}>{limitedText(retryAfter)}.</div>;
}

/** Khung chờ đúng hình khối. */
export function Skeleton({ testid, rows = 2 }: { testid: string; rows?: number }) {
  return <div aria-busy="true" data-testid={testid}>{Array.from({ length: rows }, (_, i) => <div key={i} className="skeleton" />)}</div>;
}

/** Lỗi của MỘT khối (503, mạng) kèm Thử lại; không bao giờ thay bằng 0. */
export function BlockError({ what, testid, retryTestid, onRetry }: { what: string; testid: string; retryTestid: string; onRetry: () => void }) {
  return (
    <div role="alert" className="rd-block-error" data-testid={testid}>
      <span>Không tải được {what}.</span>
      <button type="button" className="btn btn-sm" onClick={onRetry} data-testid={retryTestid}>Thử lại</button>
    </div>
  );
}

/** 403 của máy chủ (role đổi khi đang xem): màn không có quyền chung, không phải dashboard rỗng. */
export function ForbiddenView() {
  const { user } = useAuth();
  return <AccessDenied role={user?.role} />;
}

/** Liên kết "Xem báo cáo" cùng khoảng ngày đang áp dụng: nút icon, chữ chỉ cho trình đọc màn hình. */
export function ReportLink({ href, testid, children }: { href: string; testid: string; children: ReactNode }) {
  return <Link className="btn btn-ghost btn-icon btn-sm rd-rlink" href={href} data-testid={testid}><span className="i i-chart" aria-hidden="true" /><span className="sr-only">{children}</span></Link>;
}

/** Ô số liệu: tile màu, số lớn, nhãn, dòng phụ ngắn. `children` là phần thân đã có trạng thái (chờ, lỗi, số). */
export function Kpi({ icon, tone, label, aside, children }: { icon: string; tone?: string; label: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <div className="stat rd-kpi">
      <span className={`tile ${tone ?? ''}`}><span className={`i i-${icon}`} aria-hidden="true" /></span>
      <div className="rd-kpi-body"><span className="lbl">{label}</span>{children}</div>
      {aside}
    </div>
  );
}

// --- Biểu đồ SVG tự vẽ (không thêm phụ thuộc): mốc có thể ÂM nên trục có mức 0; hơn 12 mốc dùng đường, từ 12 mốc trở xuống dùng cột; Tab vào từng mốc để đọc số của mốc.
export interface ChartPoint { key: string; label: string; value: number; text: string }
const W = 640, H = 220, L = 72, R = 12, T = 16, B = 28;
const niceMax = (v: number): number => { if (v <= 0) return 1; const e = 10 ** Math.floor(Math.log10(v)); const f = v / e; return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * e; };
export function Chart({ testid, title, points, format = money, unit }: { testid: string; title: string; points: ChartPoint[]; format?: (n: number) => string; unit?: string }) {
  const [active, setActive] = useState<ChartPoint | null>(null);
  if (points.length < 2) return null; // một mốc: không vẽ biểu đồ một điểm (bảng vẫn có)
  const max = Math.max(0, ...points.map((x) => x.value)), min = Math.min(0, ...points.map((x) => x.value));
  const hi = max > 0 ? niceMax(max) : 0, lo = min < 0 ? -niceMax(-min) : 0;
  const span = hi - lo || 1;
  const y = (v: number): number => T + ((hi - v) / span) * (H - T - B);
  const step = (W - L - R) / points.length;
  const x = (i: number): number => L + step * (i + 0.5);
  const bars = points.length <= 12;
  const ticks = [...new Set([hi, 0, lo])];
  const path = points.map((pt, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(pt.value).toFixed(1)}`).join(' ');
  return (
    <figure className="dsh-chart rd-chart" data-testid={testid}>
      <svg viewBox={`0 0 ${W} ${H}`} role="group" aria-label={title} className="dsh-svg">
        {ticks.map((t) => <g key={t}><line x1={L} x2={W - R} y1={y(t)} y2={y(t)} className={t === 0 ? 'dsh-axis' : 'dsh-grid'} /><text x={L - 6} y={y(t) + 4} textAnchor="end" className="dsh-tick">{format(t)}</text></g>)}
        {!bars && <path d={path} className="dsh-line" fill="none" />}
        {points.map((pt, i) => {
          const focus = { onFocus: () => setActive(pt), onBlur: () => setActive(null), onMouseEnter: () => setActive(pt), onMouseLeave: () => setActive(null) };
          const label = `${pt.label}: ${pt.text}`;
          const showLabel = points.length <= 14 || i % Math.ceil(points.length / 6) === 0;
          return (
            <g key={pt.key} tabIndex={0} role="img" aria-label={label} className="dsh-point" {...focus}>
              {bars
                ? <rect x={x(i) - step * 0.3} y={Math.min(y(pt.value), y(0))} width={step * 0.6} height={Math.max(1, Math.abs(y(pt.value) - y(0)))} className="dsh-bar" />
                : <circle cx={x(i)} cy={y(pt.value)} r={4} className="dsh-dot" />}
              {showLabel && <text x={x(i)} y={H - 8} textAnchor="middle" className="dsh-tick">{pt.label}</text>}
              <title>{label}</title>
            </g>
          );
        })}
      </svg>
      <figcaption className="small muted" aria-live="polite">{active ? `${active.label}: ${active.text}` : `${title}${unit ? ` (${unit})` : ''}`}</figcaption>
    </figure>
  );
}
export { bucketLabel };
export type { Granularity };
