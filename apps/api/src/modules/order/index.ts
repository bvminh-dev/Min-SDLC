// Điểm vào công khai DUY NHẤT của module order: module khác chỉ import từ đây (SB-35, check:boundaries).
// `OrderApi` (createPending, confirmCod, countOpenOrders, getSummary, findForPayment, findForShipment, findByCode, findOwned, getRecipient, lockForHandoff, getDeliveredItems,
// countByStatus, getOrderSeries, listRecent, getTopProducts, createHo, listSources, listForSale, getForSale, getShipmentDisplay, getSourcesReport, getSalesReport) cho CHK, PAY, SHP, REV, DSH, SAL (architecture.md, bảng Giao diện module).
export { OrderModule } from './order.module';
export { OrderApi } from './order.api';
export { OrderBusinessError, type OrderErrorCode } from './errors';
export type { CreateHoInput, CreatePendingInput, HoItemInput, OrderItemInput, ShippingAddress } from './create.service';
export type { SourceView } from './sources.service';
export type { RangeUtc, SeriesBucket, TopSort } from './internal.service';
