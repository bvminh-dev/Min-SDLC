// Điểm vào công khai DUY NHẤT của module checkout: module khác chỉ import từ đây (SB-35, check:boundaries).
// CHK không phơi giao diện nội bộ nào (không module nào gọi vào CHK: architecture.md, bảng Giao diện module chỉ có chiều CHK gọi ra); chỉ có CheckoutModule để AppModule nạp.
export { CheckoutModule } from './checkout.module';
