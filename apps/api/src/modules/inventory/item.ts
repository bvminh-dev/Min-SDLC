export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface ItemRow {
  id: string; product_id: string; on_hand: number; reserved: number; low_stock_threshold: number; archived_at: Date | null; version: number; updated_at: Date;
}
export interface Product { name: string; sku: string }

/** Bản ghi kho dùng chung (INV-API): `available` = on_hand - reserved, không bao giờ âm (CHECK reserved <= on_hand giữ ở CSDL). */
export function toItem(r: Pick<ItemRow, 'product_id' | 'on_hand' | 'reserved' | 'low_stock_threshold' | 'archived_at' | 'version'>) {
  const available = Math.max(r.on_hand - r.reserved, 0);
  return {
    product_id: r.product_id, on_hand: r.on_hand, reserved: r.reserved, available, low_stock_threshold: r.low_stock_threshold,
    is_low_stock: available <= r.low_stock_threshold, archived: r.archived_at !== null, version: r.version,
  };
}
