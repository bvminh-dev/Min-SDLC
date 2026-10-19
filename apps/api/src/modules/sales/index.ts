// Điểm vào công khai DUY NHẤT của module sales: module khác chỉ import từ đây (SB-35, check:boundaries).
// SAL không phơi giao diện nội bộ nào (không module nào gọi vào SAL: architecture.md, bảng Giao diện module chỉ có chiều SAL gọi ra); chỉ có SalesModule để AppModule nạp.
export { SalesModule } from './sales.module';
