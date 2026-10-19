'use client';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { RequireRole } from '../../../../components/RequireRole';
import { useCountdown } from '../../../../components/useCountdown';
import { api, type ApiResult } from '../../../../lib/api';
import { useLoginRedirect } from '../../../../lib/prd';
import { limitedText, newKey, num, parseInt0, signed, type StockItem } from '../../../../lib/stock';
import { SkPanel } from '../../../../components/Skeleton';

type Kind = 'in' | 'out' | 'adjust' | 'threshold';
const IN_REASONS: [string, string][] = [['purchase', 'Nhập từ NCC'], ['transfer_in', 'Chuyển kho đến'], ['other', 'Khác']];
const OUT_REASONS: [string, string][] = [['damaged', 'Hỏng'], ['lost', 'Mất'], ['internal_use', 'Dùng nội bộ'], ['other', 'Khác']];
const CONFLICT = 'Số liệu đã thay đổi, tải lại để tiếp tục';
const THRESHOLD_ERR = 'Ngưỡng từ 0 đến 1.000.000';

/** Lỗi hiển thị của hộp thoại theo mã lỗi của INV-API (mã `code` là phần sau `urn:ecom:error:`). */
function messageOf(kind: Kind, r: ApiResult, item: StockItem): string {
  if (r.status === 0) return 'Không kết nối được máy chủ. Thử lại.';
  if (r.status === 429) return limitedText(r.retryAfter);
  if (r.status === 404) return 'Không tìm thấy bản ghi kho.';
  if (r.status === 400 && r.code === 'idempotency-key-required') return 'Yêu cầu không hợp lệ, hãy mở lại hộp thoại';
  if (r.status === 400 && r.code === 'no-change') return 'Số đếm thực trùng số đang có, không có gì để điều chỉnh';
  if (r.status === 400) {
    const f = r.fieldErrors;
    if (f.quantity) return 'Số lượng từ 1 đến 100.000';
    if (f.note) return kind === 'adjust' ? 'Ghi chú từ 5 đến 200 ký tự' : f.note === 'required' ? 'Cần ghi chú khi lý do là Khác' : 'Ghi chú tối đa 200 ký tự';
    if (f.new_on_hand) return 'Số đếm thực từ 0 đến 10.000.000';
    if (f.low_stock_threshold) return THRESHOLD_ERR;
    return 'Dữ liệu không hợp lệ.';
  }
  if (r.status === 422) return 'Yêu cầu không hợp lệ, hãy mở lại hộp thoại';
  if (r.status === 409) {
    if (r.code === 'product-archived') return 'Sản phẩm đã ngừng bán';
    if (r.code === 'stock-limit-exceeded') return 'Vượt giới hạn 10.000.000';
    if (r.code === 'insufficient-stock') return `Chỉ còn ${num(Number(r.body?.available ?? item.available))} có thể xuất`;
    if (r.code === 'below-reserved') return `Số đếm không thể thấp hơn số đang giữ (${num(Number(r.body?.reserved ?? item.reserved))})`;
    if (r.code === 'stock-version-conflict') return CONFLICT;
  }
  return 'Không thực hiện được, thử lại.';
}

function InventoryDetail() {
  const { id } = useParams<{ id: string }>();
  const expired = useLoginRedirect();
  const [item, setItem] = useState<StockItem | null>(null);
  const [view, setView] = useState<'loading' | 'ready' | 'notfound' | 'error' | 'rate'>('loading');
  const [toast, setToast] = useState<string | null>(null);
  const [dlg, setDlg] = useState<{ kind: Kind; key: string; busy: boolean; error: string | null; conflict: boolean } | null>(null);
  const [qty, setQty] = useState(''), [reason, setReason] = useState(''), [note, setNote] = useState(''), [onHand, setOnHand] = useState(''), [threshold, setThreshold] = useState('');
  const limit = useCountdown();
  const seq = useRef(0), wasLimited = useRef(false);

  const load = useCallback(async (): Promise<StockItem | null> => {
    const mine = ++seq.current;
    setView('loading');
    const r = await api<StockItem>(`/admin/inventory/${encodeURIComponent(id)}`);
    if (mine !== seq.current) return null;
    if (r.status === 200 && typeof r.body.product_id === 'string') { setItem(r.body); setView('ready'); return r.body; }
    if (expired(r)) return null;
    if (r.status === 404) setView('notfound');
    else if (r.status === 429) { limit.start(r.retryAfter); setView('rate'); }
    else setView('error');
    return null;
  }, [id]); // expired, limit đổi mỗi lần render nên không đưa vào deps
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { if (limit.left > 0) wasLimited.current = true; else if (wasLimited.current) { wasLimited.current = false; void load(); } }, [limit.left, load]);
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(null), 6000); return () => clearTimeout(t); }, [toast]);

  const open = (kind: Kind) => {
    setQty(''); setNote(''); setOnHand(''); setThreshold(kind === 'threshold' && item ? String(item.low_stock_threshold) : '');
    setReason(kind === 'in' ? 'purchase' : kind === 'out' ? 'damaged' : '');
    setDlg({ kind, key: newKey(), busy: false, error: null, conflict: false }); // mỗi lần mở một Idempotency-Key mới, giữ nguyên khi gửi lại sau lỗi mạng
  };
  const close = () => { if (dlg && !dlg.busy) setDlg(null); };
  const reload = async () => {
    const fresh = await load();
    if (fresh) { setOnHand(''); setDlg((d) => d && { ...d, error: null, conflict: false }); }
  };

  const submit = async () => {
    if (!dlg || !item || dlg.busy) return;
    const fail = (error: string) => setDlg((d) => d && { ...d, error, busy: false });
    let path = '', body: Record<string, unknown> = {}, method: 'POST' | 'PATCH' = 'POST', done = '';
    if (dlg.kind === 'in' || dlg.kind === 'out') {
      const n = parseInt0(qty);
      if (n === null || n < 1 || n > 100000) return fail('Số lượng từ 1 đến 100.000');
      if (reason === 'other' && !note.trim()) return fail('Cần ghi chú khi lý do là Khác');
      path = `/stock-${dlg.kind}`; body = { quantity: n, reason, ...(note.trim() ? { note: note.trim() } : {}) };
      done = dlg.kind === 'in' ? `Đã nhập ${num(n)} đơn vị` : `Đã xuất ${num(n)} đơn vị`;
    } else if (dlg.kind === 'adjust') {
      const n = parseInt0(onHand);
      if (n === null || n > 10_000_000) return fail('Số đếm thực từ 0 đến 10.000.000');
      if (note.trim().length < 5) return fail('Ghi chú từ 5 đến 200 ký tự');
      path = '/adjustments'; body = { new_on_hand: n, version: item.version, note: note.trim() }; done = `Đã điều chỉnh tồn kho về ${num(n)}`;
    } else {
      const n = parseInt0(threshold);
      if (n === null || n > 1_000_000) return fail(THRESHOLD_ERR);
      path = '/threshold'; method = 'PATCH'; body = { low_stock_threshold: n, version: item.version }; done = `Đã lưu ngưỡng tồn thấp ${num(n)}`;
    }
    setDlg({ ...dlg, busy: true, error: null, conflict: false });
    const r = await api<{ item?: StockItem } & Partial<StockItem>>(`/admin/inventory/${encodeURIComponent(id)}${path}`, { method, body, headers: dlg.kind === 'threshold' ? undefined : { 'Idempotency-Key': dlg.key } });
    if (r.status === 200) {
      const next = dlg.kind === 'threshold' ? (r.body as StockItem) : r.body.item!;
      setItem((cur) => cur && { ...cur, ...next, product: next.product ?? cur.product });
      setToast(done); setDlg(null);
      return;
    }
    if (expired(r)) return;
    // 409 version thì không giữ số cũ lặng lẽ: hiện nút tải lại; 429 thì cho thử lại khi hết giờ chờ (không khóa vĩnh viễn)
    setDlg((d) => d && { ...d, busy: false, error: messageOf(dlg.kind, r, item), conflict: r.status === 409 && r.code === 'stock-version-conflict' });
  };

  const k = dlg?.kind;
  const pre = k ? `inv-inventory-detail-${k === 'in' ? 'stock-in' : k === 'out' ? 'stock-out' : k === 'adjust' ? 'adjust' : 'threshold'}` : '';
  const title = item?.product?.name ?? 'Sản phẩm';
  const thresholdLive = k === 'threshold' && threshold !== '' && (parseInt0(threshold) === null || Number(threshold) > 1_000_000) ? THRESHOLD_ERR : null;

  const lvl = item ? (item.archived ? 'off' : item.available <= 0 ? 'out' : item.is_low_stock ? 'low' : 'ok') : 'ok';
  const pct = item ? (item.low_stock_threshold > 0 ? Math.min(100, Math.round((item.available / (item.low_stock_threshold * 3)) * 100)) : item.available > 0 ? 100 : 0) : 0;

  return (
    <main className="page page-mid">
      <Link href="/admin/inventory" className="back" data-testid="inv-inventory-detail-back"><span className="i i-left" aria-hidden="true" /> Tồn kho</Link>

      {view === 'loading' && !item && <SkPanel n={4} testid="inv-inventory-detail-loading" />}
      {view === 'rate' && limit.left > 0 && <div role="alert" className="banner banner-error" data-testid="inv-inventory-detail-error">{limitedText(limit.left)} <button className="btn" onClick={() => void load()} data-testid="inv-inventory-detail-retry">Thử lại</button></div>}
      {view === 'error' && <div role="alert" className="banner banner-error" data-testid="inv-inventory-detail-error">Không tải được tồn kho. <button className="btn" onClick={() => void load()} data-testid="inv-inventory-detail-retry">Thử lại</button></div>}
      {view === 'notfound' && (
        <div className="empty panel" data-testid="inv-inventory-detail-not-found">
          <span className="tile tile-lg gray"><span className="i i-search" aria-hidden="true" /></span>
          <h1>Không tìm thấy bản ghi kho</h1>
          <Link className="btn" href="/admin/inventory">Về tồn kho</Link>
        </div>
      )}

      {item && view !== 'notfound' && (
        <div className="stack">
          <div className="page-head" style={{ marginBottom: 0 }}>
            <h1><span data-testid="inv-inventory-detail-name">{title}</span><span className="mono muted" data-testid="inv-inventory-detail-sku" style={{ marginLeft: '.6rem' }}>{item.product?.sku ?? ''}</span></h1>
            <span className="ip-badges">
              {item.is_low_stock && !item.archived && <span className="badge ip-low" data-testid="inv-inventory-detail-low-badge">Sắp hết</span>}
              {item.archived && <span className="badge" data-status="archived">Ngừng bán</span>}
            </span>
          </div>
          {item.archived && <div className="banner banner-info" style={{ margin: 0 }} data-testid="inv-inventory-detail-archived-notice">Đã ngừng bán: không nhập thêm được.</div>}

          <div className="stat-grid stat-grid-3 ip-stats3">
            <div className="stat"><span className="tile"><span className="i i-box" aria-hidden="true" /></span><div><b data-testid="inv-inventory-detail-on-hand">{num(item.on_hand)}</b><span className="lbl">Có</span></div></div>
            <div className="stat"><span className="tile amber"><span className="i i-clock" aria-hidden="true" /></span><div><b data-testid="inv-inventory-detail-reserved">{num(item.reserved)}</b><span className="lbl">Giữ</span></div></div>
            <div className="stat"><span className="tile green"><span className="i i-okc" aria-hidden="true" /></span><div><b data-testid="inv-inventory-detail-available">{num(item.available)}</b><span className="lbl">Còn bán</span></div></div>
          </div>

          <div className="panel ip-sum">
            <div className="ip-cap">
              <span className="row"><span className="i i-alert" aria-hidden="true" /> Ngưỡng <b data-testid="inv-inventory-detail-threshold">{num(item.low_stock_threshold)}</b></span>
              <button className="btn btn-sm btn-ghost" disabled={view === 'loading'} onClick={() => open('threshold')} data-testid="inv-inventory-detail-edit-threshold" aria-label="Đổi ngưỡng"><span className="i i-pencil" aria-hidden="true" /> Đổi</button>
            </div>
            <span className="ip-bar" data-lv={lvl} aria-hidden="true"><i style={{ width: `${pct}%` }} /></span>
          </div>

          <div className="row">
            <button className="btn btn-primary tight" disabled={view === 'loading' || item.archived} title={item.archived ? 'Đã ngừng bán' : undefined} onClick={() => open('in')} data-testid="inv-inventory-detail-stock-in"><span className="i i-plus" aria-hidden="true" /> Nhập kho</button>
            <button className="btn tight" disabled={view === 'loading'} onClick={() => open('out')} data-testid="inv-inventory-detail-stock-out"><span className="i i-minus" aria-hidden="true" /> Xuất kho</button>
            <button className="btn tight" disabled={view === 'loading'} onClick={() => open('adjust')} data-testid="inv-inventory-detail-adjust"><span className="i i-sliders" aria-hidden="true" /> Kiểm kê</button>
            <Link href={`/admin/inventory/${encodeURIComponent(id)}/history`} className="btn btn-ghost tight" style={{ marginLeft: 'auto' }} data-testid="inv-inventory-detail-history-link"><span className="i i-clock" aria-hidden="true" /> Lịch sử</Link>
          </div>
        </div>
      )}

      {toast && <div className="toast" role="status" data-testid="inv-inventory-detail-toast">{toast}</div>}

      {dlg && item && (
        <div className="backdrop">
          <div className="dialog ip-dlg" role="dialog" aria-modal="true" aria-labelledby="inv-dlg-title" onKeyDown={(e) => e.key === 'Escape' && close()}>
            <div className="dlg-head">
              <span className={`tile ${k === 'in' ? 'green' : k === 'out' ? 'amber' : k === 'adjust' ? 'violet' : ''}`}><span className={`i i-${k === 'in' ? 'plus' : k === 'out' ? 'minus' : k === 'adjust' ? 'sliders' : 'alert'}`} aria-hidden="true" /></span>
              <h2 id="inv-dlg-title">{k === 'in' ? 'Nhập kho' : k === 'out' ? 'Xuất kho' : k === 'adjust' ? 'Điều chỉnh' : 'Đổi ngưỡng'}</h2>
            </div>
            <p className="small truncate">{title}</p>
            {(k === 'in' || k === 'out') && (
              <>
                {k === 'out' && <p className="small">Tối đa <strong data-testid="inv-inventory-detail-stock-out-max">{num(item.available)}</strong></p>}
                <div className="ip-grid2">
                  <div className="field"><label htmlFor="inv-qty">Số lượng</label>
                    <input id="inv-qty" inputMode="numeric" value={qty} disabled={dlg.busy} autoFocus onChange={(e) => setQty(e.target.value)} data-testid={`${pre}-quantity`} /></div>
                  <div className="field"><label htmlFor="inv-reason">Lý do</label>
                    <select id="inv-reason" value={reason} disabled={dlg.busy} onChange={(e) => setReason(e.target.value)} data-testid={`${pre}-reason`}>{(k === 'in' ? IN_REASONS : OUT_REASONS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></div>
                </div>
                <div className="field"><label htmlFor="inv-note">Ghi chú{reason === 'other' ? ' *' : ''}</label>
                  <input id="inv-note" value={note} maxLength={200} disabled={dlg.busy} onChange={(e) => setNote(e.target.value)} data-testid={`${pre}-note`} /></div>
              </>
            )}
            {k === 'adjust' && (
              <>
                <div className="row"><span className="ip-chip">Có <b>{num(item.on_hand)}</b></span><span className="ip-chip">Giữ <b>{num(item.reserved)}</b></span><span className="ip-chip">Chênh <b data-testid="inv-inventory-detail-adjust-delta">{parseInt0(onHand) === null ? '—' : signed(parseInt0(onHand)! - item.on_hand)}</b></span></div>
                <div className="field"><label htmlFor="inv-new">Số đếm thực</label>
                  <input id="inv-new" inputMode="numeric" value={onHand} disabled={dlg.busy} autoFocus onChange={(e) => setOnHand(e.target.value)} data-testid="inv-inventory-detail-adjust-new-on-hand" /></div>
                <div className="field"><label htmlFor="inv-note">Ghi chú *</label>
                  <input id="inv-note" value={note} maxLength={200} disabled={dlg.busy} onChange={(e) => setNote(e.target.value)} data-testid="inv-inventory-detail-adjust-note" /></div>
              </>
            )}
            {k === 'threshold' && (
              <div className="field"><label htmlFor="inv-th">Ngưỡng mới</label>
                <input id="inv-th" inputMode="numeric" value={threshold} disabled={dlg.busy} autoFocus onChange={(e) => setThreshold(e.target.value)} data-testid="inv-inventory-detail-threshold-input" /></div>
            )}
            {(dlg.error || thresholdLive) && <p className="field-error" role="alert" data-testid={`${pre}-error`}>{dlg.error ?? thresholdLive}</p>}
            {dlg.conflict && (k === 'adjust' || k === 'threshold') && <button className="btn" onClick={() => void reload()} data-testid={`inv-inventory-detail-${k}-reload`}>Tải lại số liệu</button>}
            <div className="actions">
              <button className="btn" disabled={dlg.busy} onClick={close} data-testid={k === 'threshold' ? undefined : `${pre}-cancel`}>Hủy</button>
              <button className="btn btn-primary tight" disabled={dlg.busy} onClick={() => void submit()} data-testid={`${pre}-submit`}>{dlg.busy ? 'Đang gửi...' : k === 'in' ? 'Nhập kho' : k === 'out' ? 'Xuất kho' : k === 'adjust' ? 'Xác nhận' : 'Lưu'}</button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

export default function InventoryDetailPage() {
  return <RequireRole roles={['staff', 'admin']}><InventoryDetail /></RequireRole>;
}
