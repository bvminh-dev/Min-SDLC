// Điểm vào công khai DUY NHẤT của module shipping: module khác chỉ import từ đây (SB-35, check:boundaries).
// `ShippingApi` (`listActiveMethods`, `quote`) cho CRT, CHK (architecture.md, bảng Giao diện module).
export { ShippingModule } from './shipping.module';
export { ShippingApi } from './shipping.api';
export type { ActiveMethod, QuoteInput, QuoteResult } from './method.service';
