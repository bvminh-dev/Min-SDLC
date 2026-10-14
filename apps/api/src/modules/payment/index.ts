// Điểm vào công khai DUY NHẤT của module payment: module khác chỉ import từ đây (SB-35, check:boundaries).
// `PaymentApi` (`getRevenue`, `countFailedRefunds`) cho DSH (architecture.md, bảng Giao diện module).
export { PaymentModule } from './payment.module';
export { PaymentApi, type Revenue, type RevenueBucket, type RevenueRange, type RevenueTotals } from './payment.api';
