/** Định dạng hiển thị chung của PRD: giá `150.000 đ`, điểm `★ 4,5 (10)`, nhãn trạng thái sản phẩm, ngày giờ. */
export const formatPrice = (n: number): string => `${n.toLocaleString('vi-VN')} đ`;

/** `null` khi chưa có đánh giá (không bao giờ hiện 0 sao). `long`: "(10 đánh giá)" ở trang chi tiết. */
export const formatRating = (avg: number | null | undefined, count: number | null | undefined, long = false): string | null =>
  avg == null || !count ? null : `★ ${avg.toFixed(1).replace('.', ',')} (${count}${long ? ' đánh giá' : ''})`;

export type ProductStatus = 'draft' | 'active' | 'archived';
export const STATUS_LABEL: Record<ProductStatus, string> = { draft: 'Nháp', active: 'Đang bán', archived: 'Đã lưu trữ' };

export const formatDateTime = (iso: string): string =>
  new Date(iso).toLocaleString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });

/** Số nguyên không âm từ chuỗi nhập; `null` nếu rỗng hay sai dạng. */
export const parseMoney = (s: string): number | null => (/^\d{1,12}$/.test(s.trim()) ? Number(s.trim()) : null);
