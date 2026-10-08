'use client';
// Tồn kho (epic INV): kiểu dữ liệu và định dạng dùng chung ba màn quản trị `inventory-list`, `inventory-detail`, `inventory-history`.
export interface StockItem {
  product_id: string; product?: { name: string; sku: string } | null; on_hand: number; reserved: number; available: number; low_stock_threshold: number;
  is_low_stock: boolean; archived: boolean; version: number; updated_at?: string;
}
export interface Movement {
  id: string; type: 'in' | 'out' | 'adjust' | 'sale' | 'restock' | 'return'; quantity: number; on_hand_after: number; reason: string | null; note: string | null;
  actor: { id: string | null; name: string | null }; ref: { type: 'order' | 'shipment'; id: string } | null; created_at: string;
}
export const TYPE_LABEL: Record<Movement['type'], string> = { in: 'Nhập kho', out: 'Xuất kho', adjust: 'Điều chỉnh', sale: 'Bán', restock: 'Hoàn nhả', return: 'Hoàn về' };
export const REASON_LABEL: Record<string, string> = { purchase: 'Nhập từ NCC', transfer_in: 'Chuyển kho đến', damaged: 'Hỏng', lost: 'Mất', internal_use: 'Dùng nội bộ', other: 'Khác' };
/** Số nguyên có dấu phân cách hàng nghìn kiểu Việt Nam (1.000.000). */
export const num = (n: number): string => n.toLocaleString('vi-VN');
export const signed = (n: number): string => `${n > 0 ? '+' : n < 0 ? '−' : ''}${num(Math.abs(n))}`;
/** Mã rút gọn của uuid (8 ký tự đầu). */
export const shortId = (id: string): string => `${id.slice(0, 8)}…`;
export const limitedText = (s?: number): string => `Thao tác quá nhanh, thử lại sau ${s ?? 60} giây`;
/** Số nguyên không âm từ chuỗi nhập; `null` nếu rỗng hay sai dạng. */
export const parseInt0 = (s: string): number | null => (/^\d{1,9}$/.test(s.trim()) ? Number(s.trim()) : null);
/** Khóa idempotency mới: uuid đúng định dạng 8 đến 64 ký tự [A-Za-z0-9_-] của ADR-017. */
export const newKey = (): string => crypto.randomUUID();
