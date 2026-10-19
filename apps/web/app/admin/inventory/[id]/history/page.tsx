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
import { SkRows } from '../../../../../components/Skeleton';

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

  const EV: Record<string, [string, string]> = { in: ['green', 'plus'], out: ['amber', 'minus'], adjust: ['violet', 'sliders'], sale: ['', 'cart'], return: ['gray', 'undo'], restock: ['gray', 'refresh'] };

  return (
    <main className="page page-mid">
      <Link href={`/admin/inventory/${encodeURIComponent(id)}`} className="back" data-testid="inv-inventory-history-back"><span className="i i-left" aria-hidden="true" /> Chi tiết</Link>
      <div className="page-head"><h1>Lịch sử kho</h1></div>
      <div className="panel ip-filter" style={{ marginBottom: '1rem' }}>
        <select multiple size={6} aria-label="Loại biến động" value={draft.type} onChange={(e) => setDraft({ ...draft, type: [...e.target.selectedOptions].map((o) => o.value) })} data-testid="inv-inventory-history-type-filter">
          {Object.entries(TYPE_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
        <div className="ip-filter-side">
          <input type="date" aria-label="Từ ngày" value={draft.from} onChange={(e) => setDraft({ ...draft, from: e.target.value })} data-testid="inv-inventory-history-from" />
          <input type="date" aria-label="Đến ngày" value={draft.to} onChange={(e) => setDraft({ ...draft, to: e.target.value })} data-testid="inv-inventory-history-to" />
          <div className="ip-btns">
            <button type="button" className="btn btn-primary tight" onClick={apply} data-testid="inv-inventory-history-apply">Lọc</button>
            {(filtering || draft.type.length > 0 || draft.from || draft.to) && <button type="button" className="btn btn-ghost tight" onClick={clear} data-testid="inv-inventory-history-clear-filter"><span className="i i-x" aria-hidden="true" /> Xoá lọc</button>}
          </div>
        </div>
      </div>

      {view === 'rate' && limit.left > 0 && <div role="alert" className="banner banner-error" data-testid="inv-inventory-history-error">{limitedText(limit.left)} <button className="btn" onClick={apply} data-testid="inv-inventory-history-retry">Thử lại</button></div>}
      {view === 'error' && <div role="alert" className="banner banner-error" data-testid="inv-inventory-history-error">{message} <button className="btn" onClick={apply} data-testid="inv-inventory-history-retry">Thử lại</button></div>}
      {view === 'notfound' && (
        <div className="empty panel" data-testid="inv-inventory-history-not-found"><span className="tile tile-lg gray"><span className="i i-search" aria-hidden="true" /></span><strong>Không tìm thấy bản ghi kho</strong><Link className="btn" href="/admin/inventory">Về tồn kho</Link></div>
      )}
      {view === 'loading' && !data && <SkRows n={5} lead={false} trail testid="inv-inventory-history-loading" />}
      {emptyAll && (filtering || page > 1
        ? <div className="empty panel" data-testid="inv-inventory-history-empty-filtered"><span className="tile tile-lg gray"><span className="i i-search" aria-hidden="true" /></span><strong>Không có kết quả</strong><button type="button" className="btn" onClick={clear}>Xoá lọc</button></div>
        : <div className="empty panel" data-testid="inv-inventory-history-empty"><span className="tile tile-lg gray"><span className="i i-inbox" aria-hidden="true" /></span><strong>Chưa có biến động</strong></div>)}
      {data && items.length > 0 && (view === 'ready' || view === 'loading') && (
        <>
          <div className={`panel panel-flush${view === 'ready' ? '' : ' dim'}`} data-testid={view === 'loading' ? 'inv-inventory-history-loading' : undefined}>
            <ul className="ip-tl">
              {items.map((m) => {
                const [tone, ic] = EV[m.type] ?? ['gray', 'list'];
                const reasonText = [m.reason ? REASON_LABEL[m.reason] ?? m.reason : null, m.note].filter(Boolean).join(' · ');
                return (
                  <li key={m.id} className="ip-ev" data-testid="inv-inventory-history-row">
                    <span className={`tile ${tone}`}><span className={`i i-${ic}`} aria-hidden="true" /></span>
                    <div className="ip-ev-main">
                      <div className="ip-ev-top">
                        <span className="badge" data-testid="inv-inventory-history-type">{TYPE_LABEL[m.type] ?? m.type}</span>
                        <span className="small muted" hidden={!reasonText} data-testid="inv-inventory-history-reason">{reasonText || '—'}</span>
                      </div>
                      <div className="ip-ev-meta">
                        <span><span className="i i-clock" aria-hidden="true" /><span data-testid="inv-inventory-history-time">{formatDateTime(m.created_at)}</span></span>
                        <span><span className="i i-user" aria-hidden="true" /><span data-testid="inv-inventory-history-actor">{actorOf(m)}</span></span>
                        <span hidden={!m.ref}><span className="i i-receipt" aria-hidden="true" /><span className="mono" data-testid="inv-inventory-history-ref">{m.ref ? shortId(m.ref.id) : '—'}</span></span>
                      </div>
                    </div>
                    <div className="ip-ev-qty">
                      <b data-sign={m.quantity > 0 ? '+' : m.quantity < 0 ? '-' : ''} data-testid="inv-inventory-history-quantity">{signed(m.quantity)}</b>
                      <small><span className="i i-right" aria-hidden="true" /><span data-testid="inv-inventory-history-on-hand-after">{num(m.on_hand_after)}</span></small>
                    </div>
                  </li>
                );
              })}
            </ul>
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
