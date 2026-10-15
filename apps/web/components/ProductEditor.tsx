'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { api, type ApiResult } from '../lib/api';
import { useAuth } from '../lib/auth';
import { formatPrice, parseMoney, STATUS_LABEL, type ProductStatus } from '../lib/format';
import { flattenTree, rateLimitedText, useCategories, useLoginRedirect } from '../lib/prd';
import { Field } from './Form';
import { ProductImages, type ProductImage } from './ProductImages';
import { useCountdown } from './useCountdown';

interface Product { id: string; name: string; sku: string; price: number; description: string | null; status: ProductStatus; version: number; category_id?: string; category?: { id: string; name: string } | null; images?: any[] }
interface FormState { name: string; sku: string; categoryId: string; price: string; description: string }
const EMPTY: FormState = { name: '', sku: '', categoryId: '', price: '', description: '' };
const FIELD_KEY: Record<keyof FormState, string> = { name: 'name', sku: 'sku', categoryId: 'category_id', price: 'price', description: 'description' };
const FIELD_MSG: Record<string, string> = {
  name: 'Tên không được rỗng và tối đa 200 ký tự', sku: 'Mã sku chỉ gồm chữ, số, dấu - và _', category_id: 'Chọn danh mục',
  price: 'Giá phải là số nguyên từ 1 đến 1.000.000.000', description: 'Mô tả tối đa 5000 ký tự',
};
const MISSING_MSG: Record<string, string> = { images: 'Cần ít nhất 1 ảnh', name: 'Cần tên', sku: 'Cần mã sku', price: 'Cần giá', category_id: 'Cần danh mục', category: 'Cần danh mục' };

const toForm = (p: Product): FormState => ({ name: p.name, sku: p.sku, categoryId: p.category_id ?? p.category?.id ?? '', price: String(p.price), description: p.description ?? '' });
const toImages = (p: Product): ProductImage[] => {
  const raw = (Array.isArray(p.images) ? p.images : []).map((i) => ({ id: String(i.id ?? i.image_id), url: String(i.url), position: typeof i.position === 'number' ? i.position : null }));
  return raw.every((i) => i.position !== null) ? raw.sort((a, b) => a.position! - b.position!) : raw;
};

/** Tạo (không có `id`) và sửa (staff chỉ xem) sản phẩm: màn admin-product-edit. */
export function ProductEditor({ id }: { id?: string }) {
  const router = useRouter();
  const { user } = useAuth();
  const expired = useLoginRedirect();
  const cats = useCategories();
  const limit = useCountdown();
  const isAdmin = user?.role === 'admin';
  const [view, setView] = useState<'loading' | 'ready' | 'notfound' | 'error' | 'forbidden'>(id ? 'loading' : 'ready');
  const [p, setP] = useState<Product | null>(null);
  const [base, setBase] = useState<FormState>(EMPTY); // lần tải đầy đủ gần nhất: PATCH chỉ gửi trường khác `base`
  const [form, setForm] = useState<FormState>(EMPTY);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [conflict, setConflict] = useState(false);
  const [missing, setMissing] = useState<string[] | null>(null);
  const [error, setError] = useState<{ text: string; retry?: () => void; rate?: boolean } | null>(null);
  const [saved, setSaved] = useState('');
  const [busy, setBusy] = useState(false);
  const [archive, setArchive] = useState<{ busy: boolean; error?: string } | null>(null);
  const seq = useRef(0);
  const wasLimited = useRef(false);

  const load = useCallback(async (o: { reset?: boolean; silent?: boolean } = {}) => {
    if (!id) return;
    const reset = o.reset ?? true;
    const n = ++seq.current;
    if (!o.silent) setView('loading');
    const r = await api<Product>(`/admin/products/${encodeURIComponent(id)}`);
    if (n !== seq.current) return;
    if (r.status === 200) {
      setP(r.body); setMissing(null); setError(null);
      if (reset) { const f = toForm(r.body); setBase(f); setForm(f); setFieldErrors({}); setConflict(false); }
      setView('ready');
    } else if (expired(r)) return;
    else if (r.status === 403) setView('forbidden');
    else if (r.status === 404) setView('notfound');
    else if (r.status === 429) { limit.start(r.retryAfter); setError({ text: '', rate: true }); setView('error'); }
    else { setError({ text: 'Không tải hoặc không lưu được.', retry: () => void load() }); setView('error'); }
  }, [id]); // expired, limit đổi mỗi lần render nên không đưa vào deps
  useEffect(() => { void load(); }, [load]);
  // Hết giờ chờ 429: banner mất, nút mở lại (tải lại nếu lỗi nằm ở lần tải).
  useEffect(() => {
    if (limit.left > 0) { wasLimited.current = true; return; }
    if (!wasLimited.current) return;
    wasLimited.current = false;
    if (error?.rate) { setError(null); if (view === 'error') void load(); }
  }, [limit.left]);

  const locked = limit.left > 0;
  const status: ProductStatus | null = p?.status ?? null;
  const canWrite = isAdmin && status !== 'archived';
  const set = (k: keyof FormState, v: string) => { setForm((f) => ({ ...f, [k]: v })); setFieldErrors((e) => { const { [FIELD_KEY[k]]: _drop, ...rest } = e; return rest; }); setSaved(''); };
  const dirty = (Object.keys(form) as (keyof FormState)[]).some((k) => form[k] !== base[k]);

  /** Lỗi dùng chung của mọi lời gọi ghi/đọc (sau các nhánh riêng). */
  const fail = (r: ApiResult, retry: () => void) => {
    if (expired(r)) return;
    if (r.status === 403) return setView('forbidden');
    if (r.status === 404) return setView('notfound');
    if (r.status === 429) { limit.start(r.retryAfter); return setError({ text: '', rate: true }); }
    if (r.status === 409 && r.code === 'product-version-conflict') return setConflict(true);
    if (r.status === 409 && r.code === 'product-archived') return void load({ silent: true }); // hiện ghi chú đã lưu trữ
    setError({ text: 'Không tải hoặc không lưu được.', retry });
  };

  /** Tạo mới hoặc sửa. Trả true khi thành công hoặc không có gì để lưu (để Công bố đi tiếp). */
  const save = async (): Promise<boolean> => {
    setError(null); setSaved(''); setFieldErrors({});
    const errs: Record<string, string> = {};
    const price = parseMoney(form.price);
    const changed = (k: keyof FormState) => !id || form[k] !== base[k];
    if (changed('name') && (!form.name.trim() || form.name.trim().length > 200)) errs.name = FIELD_MSG.name;
    if (changed('sku') && (!id || status === 'draft') && !/^[A-Za-z0-9_-]+$/.test(form.sku.trim())) errs.sku = FIELD_MSG.sku;
    if (changed('categoryId') && !form.categoryId) errs.category_id = FIELD_MSG.category_id;
    if (changed('price') && (price === null || price < 1 || price > 1_000_000_000)) errs.price = FIELD_MSG.price; // cùng khoảng với server (PRD-REQ BR4)
    if (changed('description') && form.description.length > 5000) errs.description = FIELD_MSG.description;
    if (Object.keys(errs).length) { setFieldErrors(errs); return false; }

    if (!id) {
      const body: Record<string, unknown> = { name: form.name.trim(), sku: form.sku.trim(), category_id: form.categoryId, price };
      if (form.description.trim()) body.description = form.description;
      const r = await api<Product>('/admin/products', { method: 'POST', body });
      if (r.status === 201 || r.ok) { router.replace(`/admin/products/${r.body.id}`); return true; }
      if (!fieldFail(r)) fail(r, () => void onSave());
      return false;
    }
    if (!p) return false;
    const body: Record<string, unknown> = { version: p.version };
    if (changed('name')) body.name = form.name.trim();
    if (changed('sku') && status === 'draft') body.sku = form.sku.trim();
    if (changed('categoryId')) body.category_id = form.categoryId;
    if (changed('price')) body.price = price;
    if (changed('description')) body.description = form.description;
    if (Object.keys(body).length === 1) { setSaved('Không có thay đổi để lưu.'); return true; }
    const r = await api(`/admin/products/${id}`, { method: 'PATCH', body });
    if (r.ok) { await load({ silent: true }); setSaved('Đã lưu.'); return true; }
    if (!fieldFail(r)) fail(r, () => void onSave());
    return false;
  };
  /** 400 theo trường và 409 sku: chữ đỏ dưới ô. Trả true khi đã xử lý. */
  const fieldFail = (r: ApiResult): boolean => {
    const errs: Record<string, string> = {};
    if (r.status === 400) for (const k of Object.keys(r.fieldErrors)) if (FIELD_MSG[k]) errs[k] = FIELD_MSG[k];
    if (r.status === 409 && r.code === 'product-sku-taken') errs.sku = 'Mã sku đã được dùng';
    if (r.status === 409 && r.code === 'product-sku-locked') errs.sku = 'Mã sku bị khóa khi sản phẩm đang bán';
    if (r.status === 400 && Object.keys(errs).length === 0) { setError({ text: 'Dữ liệu không hợp lệ, kiểm tra lại các ô.' }); return true; }
    if (Object.keys(errs).length === 0) return false;
    setFieldErrors(errs);
    return true;
  };
  const onSave = async (e?: FormEvent) => {
    e?.preventDefault();
    if (busy || locked || !canWrite) return;
    setBusy(true); await save(); setBusy(false);
  };

  const publish = async () => {
    if (busy || locked || !id) return;
    setBusy(true); setMissing(null);
    if (dirty && !(await save())) { setBusy(false); return; } // lưu chữ đang gõ trước khi công bố
    const r = await api(`/admin/products/${id}/publish`, { method: 'POST' });
    if (r.ok) { await load({ silent: true }); setSaved('Đã công bố.'); }
    else if (r.status === 422) setMissing(Array.isArray(r.body?.missing) ? r.body.missing : []);
    else fail(r, () => void publish());
    setBusy(false);
  };
  const doArchive = async () => {
    if (!archive || archive.busy || locked) return;
    setArchive({ busy: true });
    const r = await api(`/admin/products/${id}/archive`, { method: 'POST' });
    if (r.ok || (r.status === 409 && r.code === 'product-archived')) { setArchive(null); await load({ silent: true }); return; }
    if ([401, 403, 404, 429].includes(r.status) || (r.status === 409 && r.code === 'product-version-conflict')) { setArchive(null); fail(r, () => void doArchive()); return; }
    setArchive({ busy: false, error: 'Không thực hiện được. Thử lại.' });
  };

  const ic = (n: string) => <span className={`i i-${n}`} aria-hidden="true" />;
  const back = <Link className="back" href="/admin/products">{ic('left')} Sản phẩm</Link>;
  if (view === 'loading') {
    return <main className="page" data-testid="prd-admin-product-edit-loading" aria-busy="true"><div className="skeleton" /><div className="ct-edit-grid"><div><div className="skeleton" /><div className="skeleton" /><div className="skeleton" /></div><div className="skeleton skeleton-card" /></div></main>;
  }
  if (view === 'notfound') return <main className="page"><div className="empty" data-testid="prd-admin-product-edit-not-found"><span className="tile tile-lg gray">{ic('search')}</span><strong>Không tìm thấy sản phẩm</strong><Link className="btn" href="/admin/products">{ic('left')} Sản phẩm</Link></div></main>;
  if (view === 'forbidden') return <main className="page"><div role="alert" className="banner banner-error" data-testid="prd-admin-product-edit-error">Bạn không có quyền xem sản phẩm này.</div></main>;
  if (view === 'error' && !p) {
    return (
      <main className="page">
        <div role="alert" className="banner banner-error" data-testid="prd-admin-product-edit-error">
          {locked ? rateLimitedText(limit.left) : error?.text || 'Không tải hoặc không lưu được.'}{' '}
          <button className="btn" disabled={locked} onClick={() => void load()} data-testid="prd-admin-product-edit-retry">Thử lại</button>
        </div>
      </main>
    );
  }

  const images = p ? toImages(p) : [];
  const categoryName = cats.items.find((c) => c.id === form.categoryId)?.name ?? p?.category?.name ?? '';
  const priceNum = parseMoney(form.price);
  const checklist: [string, boolean][] = [['Tên', !!base.name.trim()], ['Mã', !!base.sku.trim()], ['Giá', parseMoney(base.price) !== null], ['Danh mục', !!base.categoryId], ['Có ảnh', images.length > 0]];
  const ro = !canWrite;
  const fieldsDisabled = ro || busy;
  const showStatus = !!id && canWrite;

  return (
    <main className="page">
      {back}
      <div className="page-head ct-editbar">
        <h1>{id ? (p?.name ?? '') : 'Tạo sản phẩm'}</h1>
        <div className="actions">
          {status && <span className="badge" data-status={status} data-testid="prd-admin-product-edit-status-badge">{STATUS_LABEL[status]}</span>}
          {canWrite && <button type="submit" form="product-form" className="btn btn-primary tight" disabled={busy || locked} data-testid="prd-admin-product-edit-save">{busy ? 'Đang xử lý...' : 'Lưu'}</button>}
        </div>
      </div>

      {(error && (locked || !error.rate)) && (
        <div role="alert" className="banner banner-error" data-testid="prd-admin-product-edit-error">
          {error.rate ? rateLimitedText(limit.left) : error.text}{' '}
          {error.retry && <button className="btn" disabled={locked} onClick={error.retry} data-testid="prd-admin-product-edit-retry">Thử lại</button>}
        </div>
      )}
      {conflict && (
        <div role="alert" className="banner banner-error" data-testid="prd-admin-product-edit-conflict">
          Sản phẩm đã được người khác sửa, hãy tải lại. <button className="btn" onClick={() => void load()}>Tải lại</button>
        </div>
      )}
      {saved && <p role="status" className="ct-ok">{ic('okc')}{saved}</p>}
      {id && status === 'archived' && <p className="banner banner-info" data-testid="prd-admin-product-edit-archived-note">Sản phẩm đã lưu trữ, không sửa được</p>}
      {id && !isAdmin && <p className="banner banner-info" data-testid="prd-admin-product-edit-readonly-note">Bạn chỉ có quyền xem</p>}

      <div className="ct-edit-grid">
        <section className="panel" aria-label="Thông tin">
          <div className="panel-head"><h2>{ic('list')} Thông tin</h2></div>
          {!isAdmin && p ? (
            <dl className="kv" data-testid="prd-admin-product-edit-view-fields">
              <dt>Tên</dt><dd>{p.name}</dd>
              <dt>Mã</dt><dd>{p.sku}</dd>
              <dt>Danh mục</dt><dd>{p.category?.name ?? categoryName}</dd>
              <dt>Giá</dt><dd className="money">{formatPrice(p.price)}</dd>
              <dt>Mô tả</dt><dd className="pre">{p.description ?? ''}</dd>
            </dl>
          ) : (
            <form id="product-form" className="ct-form" noValidate onSubmit={onSave}>
              <Field label="Tên *" error={fieldErrors.name} errorTestId="prd-admin-product-edit-field-error" field="name">
                {(i, d) => <input id={i} aria-describedby={d} value={form.name} maxLength={200} disabled={fieldsDisabled} onChange={(e) => set('name', e.target.value)} data-testid="prd-admin-product-edit-name" />}
              </Field>
              <div className="ct-form-2">
                <Field label="Mã sku *" error={fieldErrors.sku} errorTestId="prd-admin-product-edit-field-error" field="sku" hint={id && status !== 'draft' ? 'Đã khóa' : 'Chữ, số, - và _'}>
                  {(i, d) => <input id={i} aria-describedby={d} value={form.sku} maxLength={64} disabled={fieldsDisabled || (!!id && status !== 'draft')} autoComplete="off" onChange={(e) => set('sku', e.target.value)} data-testid="prd-admin-product-edit-sku" />}
                </Field>
                <Field label="Giá (đ) *" error={fieldErrors.price} errorTestId="prd-admin-product-edit-field-error" field="price" hint={priceNum !== null ? formatPrice(priceNum) : undefined}>
                  {(i, d) => <input id={i} aria-describedby={d} inputMode="numeric" value={form.price} disabled={fieldsDisabled} onChange={(e) => set('price', e.target.value)} data-testid="prd-admin-product-edit-price" />}
                </Field>
              </div>
              <Field label="Danh mục *" error={fieldErrors.category_id} errorTestId="prd-admin-product-edit-field-error" field="category_id">
                {(i, d) => (
                  <select id={i} aria-describedby={d} value={form.categoryId} disabled={fieldsDisabled} onChange={(e) => set('categoryId', e.target.value)} data-testid="prd-admin-product-edit-category">
                    <option value="">Chọn danh mục</option>
                    {flattenTree(cats.items).map((c) => <option key={c.id} value={c.id} style={{ paddingLeft: c.depth * 14 }}>{c.name}</option>)}
                    {form.categoryId && !cats.items.some((c) => c.id === form.categoryId) && <option value={form.categoryId}>{p?.category?.name ?? form.categoryId}</option>}
                  </select>
                )}
              </Field>
              <Field label="Mô tả" error={fieldErrors.description} errorTestId="prd-admin-product-edit-field-error" field="description">
                {(i, d) => <textarea id={i} aria-describedby={d} rows={6} maxLength={5000} value={form.description} disabled={fieldsDisabled} onChange={(e) => set('description', e.target.value)} data-testid="prd-admin-product-edit-description" />}
              </Field>
            </form>
          )}
        </section>

        <div className="stack">
          {id && p ? <ProductImages productId={id} images={images} editable={canWrite} onChanged={() => load({ reset: false, silent: true })} onOther={(r) => fail(r, () => undefined)} /> : null}
          {!id && <div className="panel"><div className="panel-head"><h2>{ic('image')} Ảnh</h2></div><p className="hint">Lưu nháp để thêm ảnh.</p></div>}
          {showStatus && (
            <section className="panel" aria-label="Trạng thái">
              <div className="panel-head"><h2>{ic('okc')} Trạng thái</h2></div>
              {canWrite && status === 'draft' && (
                <>
                  <ul className="ct-checks" aria-label="Điều kiện công bố">{checklist.map(([l, ok]) => <li key={l} className={ok ? 'ok' : 'no'}>{ic(ok ? 'check' : 'x')} {l}</li>)}</ul>
                  {missing && (
                    <div role="alert" className="field-error" data-testid="prd-admin-product-edit-publish-missing">
                      <p>Chưa đủ điều kiện công bố:</p>
                      <ul>{(missing.length ? missing : ['']).map((m) => <li key={m}>{m ? MISSING_MSG[m] ?? `Thiếu: ${m}` : 'Còn thiếu dữ liệu bắt buộc'}</li>)}</ul>
                    </div>
                  )}
                </>
              )}
              {canWrite && (
                <div className="row ct-status-actions">
                  {status === 'draft' && <button type="button" className="btn btn-primary tight" disabled={busy || locked} onClick={() => void publish()} data-testid="prd-admin-product-edit-publish">{ic('upload')} Công bố</button>}
                  <button type="button" className="btn btn-danger-soft tight" disabled={busy || locked} onClick={() => setArchive({ busy: false })} data-testid="prd-admin-product-edit-archive">{ic('archive')} {status === 'draft' ? 'Hủy nháp' : 'Ngừng bán'}</button>
                </div>
              )}
            </section>
          )}
        </div>
      </div>

      {archive && (
        <div className="backdrop">
          <div className="dialog" role="alertdialog" aria-modal="true" aria-labelledby="arc-title" onKeyDown={(e) => e.key === 'Escape' && !archive.busy && setArchive(null)}>
            <div className="dlg-head"><span className="tile red">{ic('archive')}</span><h2 id="arc-title">{status === 'draft' ? 'Hủy nháp' : 'Ngừng bán'} {p?.name}?</h2></div>
            <p>Không thể khôi phục.</p>
            {archive.error && <p className="field-error" role="alert">{archive.error}</p>}
            {locked && <p className="field-error" role="alert">{rateLimitedText(limit.left)}</p>}
            <div className="actions">
              <button className="btn" disabled={archive.busy} onClick={() => setArchive(null)} data-testid="prd-admin-product-edit-archive-cancel" autoFocus>Hủy</button>
              <button className="btn btn-danger" disabled={archive.busy || locked} onClick={() => void doArchive()} data-testid="prd-admin-product-edit-archive-confirm">{archive.busy ? 'Đang xử lý...' : status === 'draft' ? 'Hủy nháp' : 'Ngừng bán'}</button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
