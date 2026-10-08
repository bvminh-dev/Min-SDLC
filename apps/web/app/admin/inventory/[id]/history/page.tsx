'use client';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Pager } from '../../../../../components/Pager';
import { RequireRole } from '../../../../../components/RequireRole';
import { useCountdown } from '../../../../../components/useCountdown';
import { api } from '../../../../../lib/api';
import { formatDateTime } from '../../../../../lib/format';
import { useLoginRedirect } from '../../../../../lib/prd';
import { limitedText, num, REASON_LABEL, shortId, signed, TYPE_LABEL, type Movement } from '../../../../../lib/stock';

interface Result { items: Movement[]; page: number; limit: number; total: number }
interface Filter { type: string[]; from: string; to: string }
const LIMIT = 20;
const EMPTY: Filter = { type: [], from: '', to: '' };
const RANGE_ERR = 'Khoảng thời gian không hợp lệ: ngày bắt đầu phải trước ngày kết thúc và tối đa 366 ngày.';

function History() {
  const { id } = useParams<{ id: string }>();
  const expired = useLoginRedirect();
  const [draft, setDraft] = useState<Filter>(EMPTY);     // giá trị đang nhập
  const [applied, setApplied] = useState<Filter>(EMPTY); // giá trị đã áp (gọi API)
  const [page, setPage] = useState(1);
  const [data, setData] = useState<Result | null>(null);
  const [view, setView] = useState<'loading' | 'ready' | 'notfound' | 'error' | 'rate'>('loading');
  const [message, setMessage] = useState('');
  const limit = useCountdown();
  const seq = useRef(0), wasLimited = useRef(false);
  const filtering = applied.type.length > 0 || applied.from !== '' || applied.to !== '';

  const load = useCallback(async (f: Filter, p: number) => {
    const mine = ++seq.current;
    setView('loading');
    const qs = new URLSearchParams({ page: String(p), limit: String(LIMIT) });
    if (f.type.length) qs.set('type', f.type.join(','));
    if (f.from) qs.set('from', f.from); // ngày gửi lên theo giờ UTC (00:00), `to` không tính ngày này
    if (f.to) qs.set('to', f.to);
    const r = await api<Result>(`/admin/inventory/${encodeURIComponent(id)}/movements?${qs}`);
    if (mine !== seq.current) return;
    if (r.status === 200 && Array.isArray(r.body.items)) { setData(r.body); setView('ready'); }
    else if (expired(r)) return;
    else if (r.status === 404) setView('notfound');
    else if (r.status === 429) { limit.start(r.retryAfter); setView('rate'); }
    else if (r.status === 400) { setData(null); setMessage(r.fieldErrors.from || r.fieldErrors.to ? RANGE_ERR : 'Tham số lọc không hợp lệ.'); setView('error'); }
    else { setMessage('Không tải được lịch sử kho.'); setView('error'); }
  }, [id]); // expired, limit đổi mỗi lần render nên không đưa vào deps
  useEffect(() => { void load(applied, page); }, [load, applied, page]);
  // Hết giờ chờ (429) thì tự tải lại; nút Thử lại cũng dùng được ngay.
  useEffect(() => { if (limit.left > 0) wasLimited.current = true; else if (wasLimited.current) { wasLimited.current = false; void load(applied, page); } }, [limit.left, load, applied, page]);

  const apply = () => { if (draft === applied && page === 1) void load(draft, 1); else { setApplied(draft); setPage(1); } };
  const clear = () => { setDraft(EMPTY); setApplied(EMPTY); setPage(1); };
  const items = data?.items ?? [];
  const emptyAll = view === 'ready' && items.length === 0;
  const actorOf = (m: Movement) => (m.actor.id === null ? 'Hệ thống' : m.actor.name ?? shortId(m.actor.id));

  return (
    <main className="wide">
      <p><Link href={`/admin/inventory/${encodeURIComponent(id)}`} data-testid="inv-inventory-history-back">← Quay lại chi tiết tồn kho</Link></p>
      <h1>Lịch sử biến động kho</h1>
      <div className="toolbar">
        <select multiple aria-label="Loại biến động" value={draft.type} onChange={(e) => setDraft({ ...draft, type: [...e.target.selectedOptions].map((o) => o.value) })} data-testid="inv-inventory-history-type-filter">
          {Object.entries(TYPE_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
        <input type="date" aria-label="Từ ngày" value={draft.from} onChange={(e) => setDraft({ ...draft, from: e.target.value })} data-testid="inv-inventory-history-from" />
        <input type="date" aria-label="Đến ngày" value={draft.to} onChange={(e) => setDraft({ ...draft, to: e.target.value })} data-testid="inv-inventory-history-to" />
        <button type="button" className="btn btn-primary tight" onClick={apply} data-testid="inv-inventory-history-apply">Lọc</button>
        {(filtering || draft.type.length > 0 || draft.from || draft.to) && <button type="button" className="btn btn-quiet tight" onClick={clear} data-testid="inv-inventory-history-clear-filter">Xoá lọc</button>}
      </div>

      {view === 'rate' && limit.left > 0 && <div role="alert" className="banner banner-error" data-testid="inv-inventory-history-error">{limitedText(limit.left)} <button className="btn" onClick={apply} data-testid="inv-inventory-history-retry">Thử lại</button></div>}
      {view === 'error' && <div role="alert" className="banner banner-error" data-testid="inv-inventory-history-error">{message} <button className="btn" onClick={apply} data-testid="inv-inventory-history-retry">Thử lại</button></div>}
      {view === 'notfound' && (
        <div className="notfound" data-testid="inv-inventory-history-not-found"><p className="big">404</p><h2>Không tìm thấy bản ghi kho</h2><Link className="btn" href="/admin/inventory">Về danh sách tồn kho</Link></div>
      )}
      {view === 'loading' && !data && <div data-testid="inv-inventory-history-loading" aria-busy="true">{Array.from({ length: 5 }, (_, i) => <div key={i} className="skeleton" />)}</div>}
      {emptyAll && (filtering || page > 1
        ? <div data-testid="inv-inventory-history-empty-filtered"><p>Không có biến động nào khớp.</p><button type="button" className="btn" onClick={clear}>Xoá lọc</button></div>
        : <p className="hint" data-testid="inv-inventory-history-empty">Sản phẩm này chưa có biến động kho nào.</p>)}
      {data && items.length > 0 && (view === 'ready' || view === 'loading') && (
        <>
          <div className={`table-wrap${view === 'ready' ? '' : ' dim'}`} data-testid={view === 'loading' ? 'inv-inventory-history-loading' : undefined}>
            <table className="stack-table">
              <thead><tr><th>Thời gian</th><th>Loại</th><th className="num">Thay đổi</th><th className="num">Còn lại</th><th>Lý do / Ghi chú</th><th>Người</th><th>Đơn</th></tr></thead>
              <tbody>
                {items.map((m) => (
                  <tr key={m.id} data-testid="inv-inventory-history-row">
                    <td data-label="Thời gian" data-testid="inv-inventory-history-time">{formatDateTime(m.created_at)}</td>
                    <td data-label="Loại"><span className="badge" data-testid="inv-inventory-history-type">{TYPE_LABEL[m.type] ?? m.type}</span></td>
                    <td data-label="Thay đổi" className="num" data-testid="inv-inventory-history-quantity">{signed(m.quantity)}</td>
                    <td data-label="Còn lại" className="num" data-testid="inv-inventory-history-on-hand-after">{num(m.on_hand_after)}</td>
                    <td data-label="Lý do / Ghi chú" data-testid="inv-inventory-history-reason">{[m.reason ? REASON_LABEL[m.reason] ?? m.reason : null, m.note].filter(Boolean).join(' · ') || '—'}</td>
                    <td data-label="Người" data-testid="inv-inventory-history-actor">{actorOf(m)}</td>
                    <td data-label="Đơn" className="mono" data-testid="inv-inventory-history-ref">{m.ref ? shortId(m.ref.id) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pager testPrefix="inv-inventory-history" unit="dòng" page={data.page ?? page} limit={data.limit ?? LIMIT} total={data.total} shown={items.length} onPage={setPage} />
        </>
      )}
    </main>
  );
}

export default function InventoryHistoryPage() {
  return <RequireRole roles={['staff', 'admin']}><History /></RequireRole>;
}
