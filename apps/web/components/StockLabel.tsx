/** Nhãn còn hàng / hết hàng: chỉ chữ, không số lượng. `undefined` (INV lỗi, quá giờ, chưa biết) thì không hiện gì. */
export function StockLabel({ inStock, testId }: { inStock: boolean | undefined; testId: string }) {
  if (inStock === undefined) return null;
  return <span className={`stock ${inStock ? 'stock-in' : 'stock-out'}`} data-testid={testId}>{inStock ? 'Còn hàng' : 'Hết hàng'}</span>;
}
