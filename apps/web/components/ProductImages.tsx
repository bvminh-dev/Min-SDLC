'use client';
import { useState, type ChangeEvent } from 'react';
import { api, type ApiResult } from '../lib/api';

export interface ProductImage { id: string; url: string }
const IMAGE_MSG: Record<string, string> = {
  too_large: 'Ảnh quá lớn, tối đa 5 MB',
  unsupported_type: 'Chỉ nhận ảnh JPEG, PNG hoặc WebP',
  corrupt: 'Tệp ảnh bị hỏng, hãy chọn tệp khác',
  dimensions_exceeded: 'Ảnh quá lớn, tối đa 25 megapixel',
  bad_form: 'Yêu cầu tải ảnh không hợp lệ',
};
const MAX_IMAGES = 8;

/**
 * Khối ảnh của màn sửa sản phẩm (PRD-REQ-20261006-095502592): tải lên, đổi thứ tự, xóa. `onChanged` tải lại chi tiết quản trị sau mỗi thao tác thành công
 * (lấy ảnh và `version` mới). `onOther` nhận 401, 403, 404 (sản phẩm), 429 để màn cha xử lý chung. Staff (`editable` false) chỉ xem, không có nút nào.
 */
export function ProductImages({ productId, images, editable, onChanged, onOther }: {
  productId: string; images: ProductImage[]; editable: boolean; onChanged: () => Promise<void>; onOther: (r: ApiResult) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const base = `/admin/products/${productId}/images`;

  const run = async (call: () => Promise<ApiResult>, conflictText: string) => {
    setBusy(true); setError('');
    const r = await call();
    if (r.ok) await onChanged();
    else if (r.status === 400 && r.code === 'image-invalid') setError(IMAGE_MSG[r.body?.reason] ?? 'Ảnh không hợp lệ');
    else if (r.status === 400) setError('Yêu cầu không hợp lệ. Tải lại trang rồi thử lại.');
    else if (r.status === 413) setError(IMAGE_MSG.too_large);
    else if (r.status === 409) { setError(r.code === 'product-archived' ? 'Sản phẩm đã lưu trữ, không sửa được ảnh' : conflictText); await onChanged(); }
    else if (r.status === 404) { setError('Ảnh không còn tồn tại'); await onChanged(); }
    else if ([401, 403, 429].includes(r.status)) onOther(r);
    else setError('Không thực hiện được. Thử lại.');
    setBusy(false);
  };

  const upload = (e: ChangeEvent<HTMLInputElement>) => {
    const input = e.target;
    const file = input.files?.[0];
    if (!file) return;
    const fd = new FormData();
    fd.append('file', file);
    void run(() => api(base, { method: 'POST', body: fd }), 'Mỗi sản phẩm có tối đa 8 ảnh').then(() => { input.value = ''; });
  };
  const move = (i: number, d: -1 | 1) => {
    const ids = images.map((x) => x.id);
    [ids[i], ids[i + d]] = [ids[i + d], ids[i]];
    void run(() => api(`${base}/order`, { method: 'PUT', body: { image_ids: ids } }), 'Không đổi được thứ tự, ảnh đã thay đổi');
  };
  const remove = (id: string) => void run(() => api(`${base}/${id}`, { method: 'DELETE' }), 'Không xóa được ảnh cuối của sản phẩm đang bán');

  return (
    <section aria-label="Ảnh">
      <h2>Ảnh ({images.length} trên {MAX_IMAGES})</h2>
      {editable && (
        <p>
          <input type="file" accept="image/jpeg,image/png,image/webp" aria-label="Tải ảnh lên" disabled={busy} onChange={upload} data-testid="prd-admin-product-edit-image-upload" />
        </p>
      )}
      {error && <p className="field-error" role="alert" data-testid="prd-admin-product-edit-image-error">{error}</p>}
      {images.length === 0 && <p className="hint">Chưa có ảnh.</p>}
      <ul className="img-list">
        {images.map((im, i) => (
          <li key={im.id} className="img-item" {...(editable ? { 'data-testid': 'prd-admin-product-edit-image-item' } : {})} data-id={im.id}>
            <img src={im.url} alt={`Ảnh ${i + 1}`} />
            {editable && (
              <div className="img-actions">
                <button type="button" className="btn" disabled={busy || i === 0} aria-label="Chuyển sang trái" data-dir="left" onClick={() => move(i, -1)} data-testid="prd-admin-product-edit-image-move">‹</button>
                <button type="button" className="btn" disabled={busy || i === images.length - 1} aria-label="Chuyển sang phải" data-dir="right" onClick={() => move(i, 1)} data-testid="prd-admin-product-edit-image-move">›</button>
                <button type="button" className="btn btn-quiet" disabled={busy} aria-label="Xóa ảnh" onClick={() => remove(im.id)} data-testid="prd-admin-product-edit-image-delete">Xóa</button>
              </div>
            )}
          </li>
        ))}
      </ul>
      {images.length > 0 && <p className="hint">Ảnh đầu là ảnh đại diện.</p>}
    </section>
  );
}
