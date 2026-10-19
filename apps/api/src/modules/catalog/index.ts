// Điểm vào công khai DUY NHẤT của module catalog: module khác chỉ import từ đây (SB-35, check:boundaries).
// `CatalogApi` (getForCart, getForSale, getSummaries, searchProductIds, listActiveProductIds, countByStatus) cho CRT, SAL, INV, REV, DSH (architecture.md, bảng Giao diện module).
export { CatalogModule } from './catalog.module';
export { CatalogApi, type CartProduct, type SaleProduct, type ProductSummary } from './catalog.api';
