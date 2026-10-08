// Điểm vào công khai DUY NHẤT của module promotion: module khác chỉ import từ đây (SB-35, check:boundaries).
// `PromotionApi` (evaluate, reserve) cho CRT và CHK (architecture.md, bảng Giao diện module).
export { PromotionModule } from './promotion.module';
export { PromotionApi } from './promotion.api';
export type { EvaluateInput, EvaluateResult, ReserveInput, ReserveResult, Failure } from './evaluate.service';
