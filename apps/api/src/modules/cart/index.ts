// Điểm vào công khai DUY NHẤT của module cart: module khác chỉ import từ đây (SB-35, check:boundaries).
// `CartApi` (snapshotForCheckout, lockForCheckout) cho CHK (architecture.md, bảng Giao diện module).
export { CartModule } from './cart.module';
export { CartApi } from './cart.api';
export type { CheckoutIssue, CheckoutLine, CheckoutSnapshot } from './cart.api';
