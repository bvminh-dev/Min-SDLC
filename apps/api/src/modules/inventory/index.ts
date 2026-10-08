// Điểm vào công khai DUY NHẤT của module inventory: module khác chỉ import từ đây (SB-35, check:boundaries).
// `InventoryApi` (reserve, getAvailability, getLowStockSummary) cho CHK, CRT, DSH (architecture.md, bảng Giao diện module).
export { InventoryModule } from './inventory.module';
export { InventoryApi } from './inventory.api';
export { ReservationExistsError, type ReserveItem, type ReserveResult, type Reservation, type Shortage } from './reservation.service';
