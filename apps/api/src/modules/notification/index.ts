// Điểm vào công khai DUY NHẤT của module notification: module khác chỉ import từ đây (SB-35, check:boundaries).
// NTF không có giao diện gọi cho module khác (architecture.md, bảng Giao diện module: NTF chỉ là bên gọi AUTH) và không phát event.
export { NotificationModule } from './notification.module';
