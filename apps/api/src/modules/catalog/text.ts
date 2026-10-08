// Chuẩn hóa chữ cho slug và tìm kiếm (ADR-019): hạ chữ thường, bỏ dấu tiếng Việt, `đ` thành `d`.
export const fold = (s: string): string => s.normalize('NFD').replace(/\p{M}+/gu, '').replace(/[đĐ]/g, 'd').toLowerCase();

export const slugify = (name: string): string => fold(name).replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'danh-muc';

/** Cột `products.search_text`: tên và sku đã chuẩn hóa, ghi cùng giao dịch với tên và sku. */
export const searchTextOf = (name: string, sku: string): string => fold(`${name} ${sku}`);

/** Các từ của `q` (đã chuẩn hóa): mọi từ phải khớp (AND). Ký tự NUL không lưu được trong PostgreSQL nên coi như khoảng trắng. */
// eslint-disable-next-line no-control-regex
export const searchTerms = (q: string): string[] => fold(q).replace(/\u0000/g, ' ').split(/\s+/).filter(Boolean);

/** Thoát ký tự đại diện của LIKE (`%`, `_`, `\`): `q` luôn là chữ thường (PRD-REQ-20261006-095502718 BR4, SB-11). */
export const likeEscape = (s: string): string => s.replace(/[\\%_]/g, '\\$&');

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
