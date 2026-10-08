// Điểm vào công khai DUY NHẤT của module catalog: module khác chỉ import từ đây (SB-35, check:boundaries).
// `CatalogApi` (getForCart, getSummaries, searchProductIds, listActiveProductIds, countByStatus) cho CRT, INV, REV, DSH (architecture.md, bảng Giao diện module).
export { CatalogModule } from './catalog.module';
export { CatalogApi, type CartProduct, type ProductSummary } from './catalog.api';
