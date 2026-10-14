// Điểm vào công khai DUY NHẤT của module dashboard: module khác chỉ import từ đây (SB-35, check:boundaries). DSH không phơi giao diện nào cho module khác (chỉ đọc, chỉ HTTP cho admin).
export { DashboardModule } from './dashboard.module';
