// Điểm vào công khai DUY NHẤT của module review: module khác chỉ import từ đây (SB-35, check:boundaries).
// REV không có giao diện gọi đồng bộ cho module khác (bảng Giao diện module chỉ có hàng REV gọi ORD, PRD, AUTH); chỉ phát event qua outbox.
export { ReviewModule } from './review.module';
