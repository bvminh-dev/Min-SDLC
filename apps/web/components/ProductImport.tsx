'use client';
import Link from 'next/link';
import { useRef, useState } from 'react';
import { api } from '../lib/api';
import { API_BASE_URL } from '../lib/config';
import { formatPrice } from '../lib/format';
import { rateLimitedText, useLoginRedirect } from '../lib/prd';
import { useCountdown } from './useCountdown';

// Import sản phẩm từ Excel hoặc CSV (admin-product-import, ADR-025): một trang, ba vùng; Xem trước (dry_run=true, không ghi) rồi Xác nhận (dry_run=false) trên đúng tệp đã xem.
interface RowError { field: string; code: string; message: string }
interface Change { old: string | number | null; new: string | number | null }
interface Row { row: number; sku: string; action: 'create' | 'update' | 'unchanged' | 'error'; errors: RowError[]; changes?: Record<string, Change> }
interface Report { dry_run: boolean; summary: { total_rows: number; created: number; updated: number; unchanged: number; errors: number }; ignored_columns: string[]; rows: Row[] }
type Phase = 'idle' | 'checking' | 'preview' | 'writing' | 'done';
type Failure = { text: string; retry?: boolean; rate?: boolean } | null;

const MAX_BYTES = 5_242_880;
const REASON_MSG: Record<string, string> = {
  unsupported_type: 'Sai loại tệp: chỉ nhận .xlsx hoặc .csv hợp lệ.',
  too_large: 'Tệp quá lớn: tối đa 5 MB.',
  too_many_rows: 'Tệp quá nhiều dòng: tối đa 2000 dòng dữ liệu.',
  macro: 'Tệp có macro, không được nhận.',
  uncompressed_too_large: 'Tệp nén bất thường (giải nén quá lớn), không được nhận.',
  header_invalid: 'Thiếu cột bắt buộc',
  corrupt: 'Tệp hỏng hoặc rỗng.',
  bad_form: 'Yêu cầu tải tệp không hợp lệ: chọn đúng một tệp.',
};
const ACTION_LABEL: Record<Row['action'], string> = { create: 'Tạo mới', update: 'Cập nhật', unchanged: 'Không đổi', error: 'Lỗi' };
const FIELD_LABEL: Record<string, string> = { name: 'Tên hàng', category: 'Nhóm hàng', price: 'Giá bán', cost_price: 'Giá vốn' };
const fmt = (v: string | number | null): string => (typeof v === 'number' ? formatPrice(v) : v === null ? '(trống)' : v);
const sizeText = (n: number): string => (n >= 1_048_576 ? `${(n / 1_048_576).toFixed(1).replace('.', ',')} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

/** Mã thô nằm ở thuộc tính data-code cho nhà phát triển; chữ hiển thị là câu tiếng Việt do server trả (đã là chữ thuần, React escape khi vẽ, SB-12 và SB-43). */
function RowDetail({ r }: { r: Row }) {
  if (r.errors.length) return <span className="field-error" data-testid="prd-admin-product-import-row-error">{r.errors.map((e, i) => <span key={i} data-code={e.code} style={{ display: 'block' }}>{e.message}</span>)}</span>;
  if (r.changes) return <span className="muted small">{Object.entries(r.changes).map(([k, c]) => `${FIELD_LABEL[k] ?? k} ${fmt(c.old)} → ${fmt(c.new)}`).join('; ')}</span>;
  return null;
}

export function ProductImport() {
  const expired = useLoginRedirect();
  const limit = useCountdown();
  const [file, setFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState('');
  const [phase, setPhase] = useState<Phase>('idle');
  const [report, setReport] = useState<Report | null>(null);
  const [errorsOnly, setErrorsOnly] = useState(false);
  const [failure, setFailure] = useState<Failure>(null);
  const [forbidden, setForbidden] = useState(false);
  const [tplError, setTplError] = useState(false);
  const key = useRef<string>(''); // một Idempotency-Key cho lần xác nhận: bấm lại hay thử lại sau lỗi mạng dùng đúng khóa này
  const input = useRef<HTMLInputElement>(null);
  const busy = phase === 'checking' || phase === 'writing';

  const reset = () => { setFile(null); setFileError(''); setReport(null); setFailure(null); setPhase('idle'); setErrorsOnly(false); key.current = ''; if (input.current) input.current.value = ''; };
  const choose = (f: File | null) => {
    setReport(null); setFailure(null); setPhase('idle'); setErrorsOnly(false); key.current = ''; // đổi tệp: xóa kết quả xem trước, vô hiệu nút Xác nhận
    if (!f) { setFile(null); setFileError(''); return; }
    setFile(f);
    setFileError(!/\.(xlsx|csv)$/i.test(f.name) ? REASON_MSG.unsupported_type : f.size > MAX_BYTES ? REASON_MSG.too_large : ''); // báo sớm, server vẫn kiểm lại
  };

  /** Gửi tệp: `dryRun` true là Xem trước, false là Xác nhận (kèm Idempotency-Key). */
  const send = async (dryRun: boolean) => {
    if (!file || busy || limit.left > 0) return;
    setFailure(null); setFileError('');
    setPhase(dryRun ? 'checking' : 'writing');
    const form = new FormData();
    form.append('file', file);
    if (!dryRun && !key.current) key.current = crypto.randomUUID();
    const r = await api<any>(`/admin/products/import?dry_run=${dryRun}`, { method: 'POST', body: form, headers: dryRun ? undefined : { 'Idempotency-Key': key.current } });
    if (r.status === 200 && r.body?.summary) { setReport(r.body); setPhase(dryRun ? 'preview' : 'done'); return; }
    if (dryRun) setReport(null); // xem trước lỗi: không để lại kết quả của tệp cũ
    setPhase(dryRun ? 'idle' : 'preview'); // lỗi ở bước xác nhận: giữ kết quả xem trước để thử lại
    if (expired(r)) return;
    if (r.status === 403) { setForbidden(true); return; }
    if (r.status === 400 && r.code === 'import-file-invalid') {
      const reason = String(r.body?.reason ?? '');
      const missing = Array.isArray(r.body?.missing) ? `: ${r.body.missing.join(', ')}` : '';
      setFileError((REASON_MSG[reason] ?? 'Tệp bị từ chối.') + (reason === 'header_invalid' ? missing : ''));
      setReport(null); setPhase('idle');
      return;
    }
    if (r.status === 429) { limit.start(r.retryAfter); setFailure({ text: '', rate: true }); return; }
    if (r.status === 422 && r.code === 'idempotency-key-reused') { setFailure({ text: 'Khóa xác nhận đã dùng cho một tệp khác. Chọn lại tệp rồi xem trước lại.' }); key.current = ''; return; }
    if (r.status === 503) { setFailure({ text: 'Không import được: mất kết nối cơ sở dữ liệu, chưa dòng nào được ghi.', retry: true }); return; }
    setFailure({ text: 'Không import được.', retry: true });
  };

  const template = async () => {
    setTplError(false);
    try {
      const res = await fetch(`${API_BASE_URL}/admin/products/import/template`, { credentials: 'include' });
      if (!res.ok) { setTplError(true); return; }
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement('a');
      a.href = url; a.download = 'mau-import-san-pham.xlsx';
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    } catch { setTplError(true); }
  };

  const ic = (n: string) => <span className={`i i-${n}`} aria-hidden="true" />;
  if (forbidden) return <main className="page"><div role="alert" className="banner banner-error" data-testid="prd-admin-product-import-error">Bạn không có quyền import sản phẩm.</div></main>;

  const s = report?.summary;
  const writable = s ? s.created + s.updated : 0;
  const priceChanges = report ? report.rows.filter((r) => r.action === 'update' && (r.changes?.price || r.changes?.cost_price)).length : 0;
  const shown = report ? (errorsOnly ? report.rows.filter((r) => r.action === 'error') : report.rows) : [];
  const done = phase === 'done';

  return (
    <main className="page">
      <Link className="back" href="/admin/products">{ic('left')} Sản phẩm</Link>
      <div className="page-head">
        <h1>Import sản phẩm</h1>
        <div className="actions">
          <button type="button" className="btn tight" onClick={() => void template()} data-testid="prd-admin-product-import-template">{ic('download')} Tải tệp mẫu</button>
        </div>
      </div>
      {tplError && <p className="field-error" role="alert" data-testid="prd-admin-product-import-template-error">Không tải được tệp mẫu. Thử lại sau.</p>}

      {failure && (failure.rate ? limit.left > 0 : true) && (
        <div role="alert" className="banner banner-error" data-testid="prd-admin-product-import-error">
          {failure.rate ? rateLimitedText(limit.left) : failure.text}{' '}
          {failure.retry && <button className="btn" disabled={busy} onClick={() => void send(phase !== 'preview')} data-testid="prd-admin-product-import-retry">Thử lại</button>}
        </div>
      )}

      <section className="panel" aria-label="Chọn tệp">
        <div className="panel-head"><h2>{ic('upload')} 1. Chọn tệp</h2></div>
        <div className="row">
          <input ref={input} type="file" accept=".xlsx,.csv" disabled={busy || done} aria-label="Tệp .xlsx hoặc .csv" onChange={(e) => choose(e.target.files?.[0] ?? null)} data-testid="prd-admin-product-import-file" />
          <button type="button" className="btn btn-primary tight" disabled={!file || !!fileError || busy || done || limit.left > 0} onClick={() => void send(true)} data-testid="prd-admin-product-import-preview">{phase === 'checking' ? 'Đang kiểm tra...' : 'Xem trước'}</button>
        </div>
        {file && <p className="muted small" data-testid="prd-admin-product-import-file-name">{file.name} ({sizeText(file.size)})</p>}
        <p className="hint">Tối đa 5 MB và 2000 dòng. Cột: Mã hàng, Tên hàng, Nhóm hàng, Giá bán, Giá vốn. ĐVT và Tồn kho được bỏ qua.</p>
        {fileError && <div role="alert" className="banner banner-error" data-testid="prd-admin-product-import-file-error">{fileError}</div>}
      </section>

      {phase === 'checking' && <div data-testid="prd-admin-product-import-loading" aria-busy="true"><div className="skeleton" /><div className="skeleton" /></div>}

      {report && s && (
        <section className="panel" aria-label={done ? 'Kết quả import' : 'Xem trước'} data-testid={done ? 'prd-admin-product-import-result' : undefined}>
          <div className="panel-head"><h2>{ic('list')} {done ? 'Kết quả import' : '2. Xem trước (chưa ghi gì)'}</h2></div>
          <p data-testid={done ? undefined : 'prd-admin-product-import-summary'}>
            <strong>Tạo mới {s.created}</strong> · Cập nhật {s.updated}{priceChanges > 0 ? ` (${priceChanges} đổi giá)` : ''} · Không đổi {s.unchanged} · <strong className={s.errors ? 'field-error' : undefined}>Lỗi {s.errors}</strong>
          </p>
          {report.ignored_columns.length > 0 && <p className="muted small" data-testid="prd-admin-product-import-ignored-columns">Bỏ qua các cột: {report.ignored_columns.join(', ')}</p>}
          {s.errors > 0 && (
            <label className="row small">
              <input type="checkbox" checked={errorsOnly} onChange={(e) => setErrorsOnly(e.target.checked)} data-testid="prd-admin-product-import-errors-only" /> Chỉ hiện dòng lỗi
            </label>
          )}
          <div className="table-wrap" style={{ maxHeight: '28rem', overflowY: 'auto' }}>
            <table data-testid="prd-admin-product-import-report">
              <thead><tr><th>Dòng</th><th>Mã hàng</th><th>Kết quả</th><th>Chi tiết</th></tr></thead>
              <tbody>
                {shown.map((r) => (
                  <tr key={r.row} data-testid="prd-admin-product-import-row" data-action={r.action} className={r.action === 'error' ? 'row-error' : undefined}>
                    <td>{r.row}</td><td>{r.sku}</td><td>{ACTION_LABEL[r.action]}</td><td><RowDetail r={r} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {report && s && !done && (
        <section className="panel" aria-label="Xác nhận">
          <div className="panel-head"><h2>{ic('okc')} 3. Xác nhận</h2></div>
          <p className="hint">Dòng lỗi sẽ bị bỏ, các dòng còn lại được ghi. Sản phẩm mới ở trạng thái Nháp, cần thêm ảnh rồi mới công bố.</p>
          {writable === 0 && <p className="field-error" data-testid="prd-admin-product-import-no-valid">Không có dòng hợp lệ để ghi.</p>}
          {phase === 'writing' && <p className="muted" data-testid="prd-admin-product-import-writing" aria-busy="true"><span className="spinner" aria-hidden="true" />Đang ghi...</p>}
          <button type="button" className="btn btn-primary" disabled={writable === 0 || busy || limit.left > 0} onClick={() => void send(false)} data-testid="prd-admin-product-import-confirm">
            {phase === 'writing' ? 'Đang ghi...' : `Xác nhận import ${writable} dòng`}
          </button>
        </section>
      )}

      {done && (
        <div className="row">
          <button type="button" className="btn" onClick={reset} data-testid="prd-admin-product-import-again">Import tệp khác</button>
          <Link className="btn btn-ghost" href="/admin/products">Về danh sách sản phẩm</Link>
        </div>
      )}
    </main>
  );
}
