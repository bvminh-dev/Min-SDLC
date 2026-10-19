'use client';
import { useState, type FormEvent } from 'react';
import { Field } from '../../../components/Form';
import { RequireRole } from '../../../components/RequireRole';
import { useCountdown } from '../../../components/useCountdown';
import { api, type ApiResult } from '../../../lib/api';
import { flattenTree, rateLimitedText, useCategories, useLoginRedirect, type FlatCategory } from '../../../lib/prd';
import { SkRows } from '../../../components/Skeleton';

interface FormDlg { id?: string; name: string; parentId: string; busy: boolean; nameError?: string; parentError?: string; formError?: string }
interface DelDlg { row: FlatCategory; busy: boolean; error?: string; blocked?: boolean }
const MAX_DEPTH_INDEX = 2; // cấp 3 (depth 2) hết, không có nút Thêm con

/** Ô danh mục cha (ui/admin-category.md): loại chính nó và con cháu (tránh chu trình) và cha khiến nhánh vượt 3 cấp; server vẫn kiểm lại. `rows` theo thứ tự cha trước con. */
function parentChoices(rows: FlatCategory[], editing?: string): FlatCategory[] {
  const i = editing ? rows.findIndex((c) => c.id === editing) : -1;
  const banned = new Set<string>();
  let height = 0; // số cấp của nhánh đang chuyển, ngoài chính nó
  if (i >= 0) {
    banned.add(rows[i].id);
    for (let j = i + 1; j < rows.length && rows[j].depth > rows[i].depth; j++) { banned.add(rows[j].id); height = Math.max(height, rows[j].depth - rows[i].depth); }
  }
  return rows.filter((c) => !banned.has(c.id) && c.depth + 1 + height <= MAX_DEPTH_INDEX);
}

function Categories() {
  const cats = useCategories();
  const expired = useLoginRedirect();
  const limit = useCountdown();
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [form, setForm] = useState<FormDlg | null>(null);
  const [del, setDel] = useState<DelDlg | null>(null);
  const [forbidden, setForbidden] = useState(false);

  const rows = flattenTree(cats.items);
  const visible = rows.filter((c, i) => { // ẩn dòng có tổ tiên đang thu gọn
    let pid = c.parent_id;
    for (let j = i - 1; j >= 0 && pid; j--) if (rows[j].id === pid) { if (collapsed.has(pid)) return false; pid = rows[j].parent_id; }
    return true;
  });
  const hasKids = (id: string) => rows.some((c) => c.parent_id === id);
  const toggle = (id: string) => setCollapsed((s) => { const n = new Set(s); if (!n.delete(id)) n.add(id); return n; });
  const locked = limit.left > 0;

  /** Lỗi chung của ghi: 401 chuyển đăng nhập, 403 bỏ cây, 429 đếm ngược. Trả chữ lỗi hoặc null khi đã xử lý. */
  const common = (r: ApiResult): string | null => {
    if (expired(r)) return null;
    if (r.status === 403) { setForbidden(true); setForm(null); setDel(null); return null; }
    if (r.status === 429) { limit.start(r.retryAfter); return ''; } // chữ đếm ngược hiện sống ở hộp thoại, tự mất khi hết giờ
    return 'Không thực hiện được. Thử lại.';
  };

  const openForm = (d: Partial<FormDlg>) => setForm({ name: '', parentId: '', busy: false, ...d });
  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (!form || form.busy || locked) return;
    const name = form.name.trim();
    if (!name) { setForm({ ...form, nameError: 'Nhập tên danh mục (tối đa 100 ký tự)', parentError: undefined, formError: undefined }); return; }
    setForm({ ...form, busy: true, nameError: undefined, parentError: undefined, formError: undefined });
    const body = { name, parent_id: form.parentId || null };
    const r = await api(form.id ? `/admin/categories/${form.id}` : '/admin/categories', { method: form.id ? 'PATCH' : 'POST', body });
    if (r.ok) { setForm(null); void cats.reload(); return; }
    const f = { ...form, busy: false };
    if (r.status === 409 && r.code === 'category-name-taken') f.nameError = 'Đã có danh mục tên này trong cùng danh mục cha';
    else if (r.status === 409 && r.code === 'category-cycle') f.parentError = 'Không thể chuyển vào nhánh con của chính nó';
    else if (r.status === 409 && r.code === 'category-too-deep') f.parentError = 'Tối đa 3 cấp';
    else if (r.status === 400 && r.fieldErrors.parent_id) f.parentError = 'Danh mục cha không hợp lệ';
    else if (r.status === 400) f.nameError = 'Tên không hợp lệ: từ 1 tới 100 ký tự';
    else if (r.status === 404) { f.formError = 'Danh mục này không còn tồn tại.'; void cats.reload(); }
    else { const t = common(r); if (t === null) return; f.formError = t; }
    setForm(f);
  };

  const doDelete = async () => {
    if (!del || del.busy || locked) return;
    setDel({ ...del, busy: true, error: undefined });
    const r = await api(`/admin/categories/${del.row.id}`, { method: 'DELETE' });
    if (r.status === 204 || r.ok) { setDel(null); void cats.reload(); return; }
    if (r.status === 404) { setDel({ ...del, busy: false, blocked: true, error: 'Danh mục không còn tồn tại' }); void cats.reload(); return; }
    if (r.status === 409 && r.code === 'category-not-empty') {
      const reasons: string[] = Array.isArray(r.body?.reasons) ? r.body.reasons : [];
      const text = [reasons.includes('has_children') && 'Còn danh mục con', reasons.includes('has_products') && 'Còn sản phẩm'].filter(Boolean).join(', ');
      setDel({ ...del, busy: false, blocked: true, error: text || 'Còn danh mục con hoặc sản phẩm' });
      return;
    }
    const t = common(r);
    if (t !== null) setDel({ ...del, busy: false, error: t });
  };

  const ic = (n: string) => <span className={`i i-${n}`} aria-hidden="true" />;
  const createRoot = <button className="btn btn-primary tight" onClick={() => openForm({})} data-testid="prd-admin-category-create-root">{ic('plus')} Thêm</button>;
  const empty = cats.state === 'ready' && rows.length === 0;
  return (
    <main className="page page-mid">
      <div className="page-head">
        <h1>Danh mục</h1>
        <div className="actions">{cats.state === 'ready' && !forbidden && !empty && createRoot}</div>
      </div>
      {forbidden && <div role="alert" className="banner banner-error" data-testid="prd-admin-category-error">Bạn không có quyền thực hiện thao tác này.</div>}
      {cats.state === 'error' && !forbidden && (
        <div role="alert" className="banner banner-error" data-testid="prd-admin-category-error">Không tải được danh mục. <button className="btn" onClick={() => void cats.reload()} data-testid="prd-admin-category-retry">Thử lại</button></div>
      )}
      {cats.state === 'loading' && !forbidden && <SkRows n={6} lead={false} lines={1} trail testid="prd-admin-category-loading" />}
      {empty && !forbidden && <div className="empty" data-testid="prd-admin-category-empty"><span className="tile tile-lg gray">{ic('folder')}</span><strong>Chưa có danh mục</strong>{createRoot}</div>}
      {cats.state === 'ready' && !empty && !forbidden && (
        <div className="panel panel-flush">
          <ul className="tree admin-tree ct-admin-tree" data-testid="prd-admin-category-tree">
            {visible.map((c) => (
              <li key={c.id} className="tree-row admin-row ct-cat-row" data-testid="prd-admin-category-row" data-id={c.id}>
                <span className="ct-indent" style={{ width: c.depth * 20 }} aria-hidden="true" />
                {hasKids(c.id)
                  ? <button type="button" className={`ct-tg${collapsed.has(c.id) ? '' : ' open'}`} aria-expanded={!collapsed.has(c.id)} aria-label={`${collapsed.has(c.id) ? 'Mở' : 'Thu gọn'} ${c.name}`} onClick={() => toggle(c.id)}>{ic('right')}</button>
                  : <span className="ct-tg" aria-hidden="true" />}
                <span className={`tile ct-tile ${['', 'violet', 'gray'][c.depth] ?? 'gray'}`}>{ic('folder')}</span>
                <span className="grow ct-cat-name">{c.name}</span>
                <span className="ct-count" data-testid="prd-admin-category-product-count" title="Sản phẩm">{ic('tag')}{c.product_count}</span>
                <span className="ct-acts">
                  {c.depth < MAX_DEPTH_INDEX && <button className="btn btn-sm btn-ghost btn-icon" aria-label={`Thêm con của ${c.name}`} title="Thêm con" onClick={() => openForm({ parentId: c.id })} data-testid="prd-admin-category-create-child">{ic('plus')}</button>}
                  <button className="btn btn-sm btn-ghost btn-icon" aria-label={`Sửa ${c.name}`} title="Sửa" onClick={() => openForm({ id: c.id, name: c.name, parentId: c.parent_id ?? '' })} data-testid="prd-admin-category-edit"></button>
                  <button className="btn btn-sm btn-ghost btn-icon ct-del" aria-label={`Xóa ${c.name}`} title="Xóa" onClick={() => setDel({ row: c, busy: false })} data-testid="prd-admin-category-delete"></button>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {form && (
        <div className="backdrop">
          <form className="dialog" role="dialog" aria-modal="true" aria-labelledby="cat-title" noValidate onSubmit={save} onKeyDown={(e) => e.key === 'Escape' && !form.busy && setForm(null)}>
            <div className="dlg-head"><span className="tile">{ic('folder')}</span><h2 id="cat-title">{form.id ? 'Sửa danh mục' : 'Thêm danh mục'}</h2></div>
            <Field label="Tên *" error={form.nameError} errorTestId="prd-admin-category-name-error" field="name">
              {(id, d) => <input id={id} aria-describedby={d} value={form.name} maxLength={100} autoFocus disabled={form.busy} onChange={(e) => setForm({ ...form, name: e.target.value })} data-testid="prd-admin-category-name" />}
            </Field>
            <Field label="Danh mục cha" error={form.parentError} errorTestId="prd-admin-category-parent-error" field="parent_id">
              {(id, d) => (
                <select id={id} aria-describedby={d} value={form.parentId} disabled={form.busy} onChange={(e) => setForm({ ...form, parentId: e.target.value })} data-testid="prd-admin-category-parent">
                  <option value="">(gốc)</option>
                  {parentChoices(rows, form.id).map((c) => <option key={c.id} value={c.id} style={{ paddingLeft: c.depth * 14 }}>{c.name}</option>)}
                </select>
              )}
            </Field>
            {form.formError && <p className="field-error" role="alert">{form.formError}</p>}
            {locked && <p className="field-error" role="alert">{rateLimitedText(limit.left)}</p>}
            <div className="actions">
              <button type="button" className="btn" disabled={form.busy} onClick={() => setForm(null)} data-testid="prd-admin-category-cancel">Hủy</button>
              <button className="btn btn-primary tight" disabled={form.busy || locked} data-testid="prd-admin-category-save">{form.busy ? 'Đang lưu...' : 'Lưu'}</button>
            </div>
          </form>
        </div>
      )}

      {del && (
        <div className="backdrop">
          <div className="dialog" role="alertdialog" aria-modal="true" aria-labelledby="del-title" onKeyDown={(e) => e.key === 'Escape' && !del.busy && setDel(null)}>
            <div className="dlg-head"><span className="tile red">{ic('trash')}</span><h2 id="del-title">Xóa danh mục {del.row.name}?</h2></div>
            <p>Không thể khôi phục.</p>
            {del.error && <p className="field-error" role="alert" data-testid="prd-admin-category-delete-error">{del.error}</p>}
            {locked && <p className="field-error" role="alert">{rateLimitedText(limit.left)}</p>}
            <div className="actions">
              <button className="btn" disabled={del.busy} onClick={() => setDel(null)} data-testid="prd-admin-category-delete-cancel" autoFocus>Hủy</button>
              <button className="btn btn-danger" disabled={del.busy || del.blocked || locked} onClick={() => void doDelete()} data-testid="prd-admin-category-delete-confirm">{del.busy ? 'Đang xóa...' : 'Xóa'}</button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

export default function AdminCategoriesPage() {
  return <RequireRole roles={['admin']}><Categories /></RequireRole>;
}
