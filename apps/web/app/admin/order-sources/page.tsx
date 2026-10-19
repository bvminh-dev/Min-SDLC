'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { RequireRole } from '../../../components/RequireRole';
import { api } from '../../../lib/api';
import { limitedText } from '../../../lib/stock';
import { SkRows } from '../../../components/Skeleton';

interface Source { id: string; code: string; name: string; is_active: boolean; is_system: boolean; position: number }
const P = 'ord-order-source-admin';
const CODE_RE = /^[a-z0-9_]{2,32}$/;
const len = (s: string): number => [...s].length; // ký tự Unicode, khớp phía server (emoji tính một ký tự)
const FIELD_ERR: Record<string, string> = { required: 'Bắt buộc', too_long: 'Tối đa 60 ký tự', invalid_format: 'Không hợp lệ', out_of_range: 'Từ 0 đến 999', unknown_field: 'Không hợp lệ' };

/** Nháp của hộp thoại: `edit` có khi sửa (mã khóa, nguồn hệ thống chỉ sửa tên và thứ tự). */
interface Draft { edit?: Source; code: string; name: string; position: string }
const draftError = (d: Draft): { code?: string; name?: string; position?: string } => ({
  code: d.edit ? undefined : d.code && !CODE_RE.test(d.code) ? 'Chữ thường, số, _; 2 đến 32 ký tự' : undefined,
  name: len(d.name.trim()) > 60 ? 'Tên tối đa 60 ký tự' : undefined,
  position: d.position !== '' && !(/^\d{1,3}$/.test(d.position) && Number(d.position) <= 999) ? 'Từ 0 đến 999' : undefined,
});

/**
 * Quản lý nguồn đơn (ui/order-source-admin, ORD-REQ-20261015-092748678): chỉ admin. Bảng mọi nguồn kể cả đã tắt (tối đa 50, không phân trang), hộp thoại thêm và sửa (không đóng khi bấm ra ngoài vì có ô nhập),
 * xác nhận trước khi tắt, không có nút Xóa (v1 chỉ tắt) và nguồn hệ thống không có nút Tắt. Tên nguồn là văn bản thuần, React escape (SB-12, SB-45).
 */
function SourceAdmin() {
  const [rows, setRows] = useState<Source[] | null>(null);
  const [view, setView] = useState<'loading' | 'ready' | 'error'>('loading');
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [fieldErr, setFieldErr] = useState<{ code?: string; name?: string; position?: string }>({});
  const [dialogErr, setDialogErr] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<{ row: Source; error?: string } | null>(null);
  const [saved, setSaved] = useState(false);
  const seq = useRef(0);

  const load = useCallback(async () => {
    const id = ++seq.current;
    setView('loading');
    const r = await api<{ items: Source[] }>('/admin/order-sources');
    if (id !== seq.current) return;
    if (r.status === 200 && Array.isArray(r.body.items)) { setRows(r.body.items); setView('ready'); } else setView('error'); // 429 (bậc D) cũng vào đây; Thử lại bấm được ngay
  }, []);
  useEffect(() => { void load(); }, [load]);

  const open = (d: Draft) => { setDraft(d); setFieldErr({}); setDialogErr(null); setSaved(false); };
  const closeDialog = () => { if (!busy) setDraft(null); };
  const errs: { code?: string; name?: string; position?: string } = draft ? draftError(draft) : {};
  const valid = !!draft && !errs.code && !errs.name && !errs.position && len(draft.name.trim()) >= 1 && (!!draft.edit || CODE_RE.test(draft.code));

  /** Lỗi chung của thao tác ghi: trả chữ hiển thị trong banner (khi không có lỗi theo trường). */
  const failText = (r: { status: number; code?: string; retryAfter?: number }): string => (
    r.code === 'order-source-limit' ? 'Đã đủ 50 nguồn' : r.code === 'order-source-protected' ? 'Nguồn Website của hệ thống không tắt được'
      : r.status === 429 ? limitedText(r.retryAfter) : r.status === 403 ? 'Bạn không có quyền quản lý nguồn đơn' : r.status === 404 ? 'Không tìm thấy nguồn đơn' : 'Không lưu được. Thử lại.');

  const save = async () => {
    if (!draft || !valid) return;
    setBusy(true); setDialogErr(null); setFieldErr({});
    const name = draft.name.trim();
    const pos = draft.position === '' ? undefined : Number(draft.position);
    const r = draft.edit
      ? await api<Source>(`/admin/order-sources/${draft.edit.id}`, { method: 'PATCH', body: { ...(name !== draft.edit.name ? { name } : {}), ...(pos !== undefined && pos !== draft.edit.position ? { position: pos } : {}) } })
      : await api<Source>('/admin/order-sources', { method: 'POST', body: { code: draft.code, name, ...(pos !== undefined ? { position: pos } : {}) } });
    setBusy(false);
    if (r.ok) { setDraft(null); setSaved(true); void load(); return; }
    if (r.code === 'order-source-code-taken') setFieldErr({ code: 'Mã này đã có' });
    else if (r.status === 400 && Object.keys(r.fieldErrors).length) setFieldErr(Object.fromEntries(Object.entries(r.fieldErrors).map(([k, c]) => [k, FIELD_ERR[c] ?? 'Không hợp lệ'])));
    else if (r.status === 400 && !draft.edit) setFieldErr({ name: 'Không hợp lệ' });
    else setDialogErr(failText(r));
  };

  /** Bật lại ngay, tắt thì có hộp xác nhận; thành công làm mới bảng. */
  const toggle = async (row: Source, on: boolean) => {
    setBusy(true);
    const r = await api(`/admin/order-sources/${row.id}`, { method: 'PATCH', body: { is_active: on } });
    setBusy(false);
    if (r.ok) { setConfirm(null); setSaved(true); void load(); } else if (on) { setSaved(false); void load(); } else setConfirm({ row, error: failText(r) });
  };

  return (
    <main className="page page-mid">
      <div className="page-head"><h1>Nguồn đơn</h1><div className="actions"><button type="button" className="btn btn-primary tight" onClick={() => open({ code: '', name: '', position: '' })} disabled={view !== 'ready'} data-testid={`${P}-add`}>Thêm nguồn</button></div></div>
      <p className="muted os-sub">Nơi đơn hàng đến, dùng để chọn khi tạo đơn hộ và để tính lương marketing.{rows && <span className="os-count"> {rows.length}/50 nguồn</span>}</p>
      {saved && <div role="status" className="banner banner-ok" data-testid={`${P}-saved`}>Đã lưu nguồn đơn</div>}
      {view === 'error' && <div role="alert" className="banner banner-error" data-testid={`${P}-error`}>Không tải được danh sách nguồn đơn. <button type="button" className="btn" onClick={() => void load()} data-testid={`${P}-retry`}>Thử lại</button></div>}
      {view === 'loading' && !rows && <SkRows n={4} lead={false} trail testid={`${P}-loading`} />}
      {rows && view !== 'error' && (
        <div className="panel panel-flush table-wrap" data-testid={`${P}-table`}>
          <table className="stack-table os-table">
            <thead><tr><th>Tên</th><th>Mã</th><th className="num">Thứ tự</th><th>Trạng thái</th><th className="os-act">Hành động</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className={r.is_active ? undefined : 'os-off'} data-testid={`${P}-row`} data-code={r.code}>
                  <td data-label="Tên" className="strong"><span data-testid={`${P}-name`}>{r.name}</span>{r.is_system && <span className="badge os-sys" data-testid={`${P}-system-badge`}>Hệ thống</span>}</td>
                  <td data-label="Mã"><code className="os-code" data-testid={`${P}-code`}>{r.code}</code></td>
                  <td data-label="Thứ tự" className="num" data-testid={`${P}-position`}>{r.position}</td>
                  <td data-label="Trạng thái"><span className="badge" data-status={r.is_active ? 'confirmed' : 'cancelled'} data-testid={`${P}-status-badge`}>{r.is_active ? 'Đang bật' : 'Đã tắt'}</span></td>
                  <td data-label="Hành động" className="os-act">
                    <div className="actions">
                      <button type="button" className="btn btn-sm" disabled={busy} onClick={() => open({ edit: r, code: r.code, name: r.name, position: String(r.position) })} data-testid={`${P}-edit`}>Sửa</button>
                      {!r.is_system && (r.is_active
                        ? <button type="button" className="btn btn-sm" disabled={busy} onClick={() => setConfirm({ row: r })} data-testid={`${P}-toggle`}>Tắt</button>
                        : <button type="button" className="btn btn-sm" disabled={busy} onClick={() => void toggle(r, true)} data-testid={`${P}-toggle`}>Bật</button>)}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {draft && (
        <div className="backdrop">
          <div className="dialog os-dlg" role="dialog" aria-modal="true" aria-labelledby="ord-src-title" onKeyDown={(e) => e.key === 'Escape' && closeDialog()} data-testid={`${P}-dialog`}>
            <div className="dlg-head"><h2 id="ord-src-title">{draft.edit ? 'Sửa nguồn' : 'Thêm nguồn'}</h2></div>
            <div className="field">
              <label htmlFor="ord-src-code">Mã</label>
              <input id="ord-src-code" value={draft.code} disabled={busy || !!draft.edit} readOnly={!!draft.edit} autoComplete="off" onChange={(e) => setDraft({ ...draft, code: e.target.value })} data-testid={`${P}-field-code`} placeholder="vd: zalo_oa" />
              <p className="hint">Chữ thường, số, _; 2 đến 32 ký tự. Không đổi được sau khi tạo.</p>
              {(fieldErr.code ?? errs.code) && <p className="field-error" role="alert" data-testid={`${P}-field-error`} data-field="code">{fieldErr.code ?? errs.code}</p>}
            </div>
            <div className="field">
              <label htmlFor="ord-src-name">Tên hiển thị</label>
              <input id="ord-src-name" value={draft.name} disabled={busy} autoComplete="off" onChange={(e) => setDraft({ ...draft, name: e.target.value })} data-testid={`${P}-field-name`} placeholder="vd: Zalo OA" />
              <p className="hint">1 đến 60 ký tự.</p>
              {(fieldErr.name ?? errs.name) && <p className="field-error" role="alert" data-testid={`${P}-field-error`} data-field="name">{fieldErr.name ?? errs.name}</p>}
            </div>
            <div className="field">
              <label htmlFor="ord-src-pos">Thứ tự hiển thị</label>
              <input id="ord-src-pos" inputMode="numeric" value={draft.position} disabled={busy} autoComplete="off" placeholder="0" onChange={(e) => setDraft({ ...draft, position: e.target.value.trim() })} data-testid={`${P}-field-position`} />
              <p className="hint">Từ 0 đến 999; số nhỏ hiện trước.</p>
              {(fieldErr.position ?? errs.position) && <p className="field-error" role="alert" data-testid={`${P}-field-error`} data-field="position">{fieldErr.position ?? errs.position}</p>}
            </div>
            {dialogErr && <div role="alert" className="field-error" data-testid={`${P}-dialog-error`}>{dialogErr}</div>}
            <div className="actions">
              <button type="button" className="btn" disabled={busy} onClick={closeDialog} data-testid={`${P}-cancel`}>Hủy</button>
              <button type="button" className="btn btn-primary tight" disabled={busy || !valid} onClick={() => void save()} data-testid={`${P}-save`}>{busy ? <><span className="spinner" aria-hidden="true" />Đang lưu</> : 'Lưu'}</button>
            </div>
          </div>
        </div>
      )}

      {confirm && (
        <div className="backdrop">
          <div className="dialog" role="dialog" aria-modal="true" aria-labelledby="ord-src-off" onKeyDown={(e) => e.key === 'Escape' && !busy && setConfirm(null)} data-testid={`${P}-toggle-confirm`}>
            <div className="dlg-head"><h2 id="ord-src-off">Tắt nguồn {confirm.row.name}?</h2></div>
            <p>Đơn mới không chọn được nguồn này nữa; đơn cũ giữ nguyên.</p>
            {confirm.error && <div role="alert" className="field-error" data-testid={`${P}-dialog-error`}>{confirm.error}</div>}
            <div className="actions">
              <button type="button" className="btn" disabled={busy} onClick={() => setConfirm(null)}>Giữ nguồn</button>
              <button type="button" className="btn btn-danger tight" disabled={busy} onClick={() => void toggle(confirm.row, false)}>Tắt nguồn</button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

export default function OrderSourceAdminPage() {
  return <RequireRole roles={['admin']}><SourceAdmin /></RequireRole>;
}
