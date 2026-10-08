import { Injectable } from '@nestjs/common';
import type { Tx } from '../platform';
import { EvaluateService, type EvaluateInput, type EvaluateResult, type ReserveInput, type ReserveResult } from './evaluate.service';

/**
 * Giao diện nội bộ PRM phơi ra cho module khác (ADR-012, bảng "Giao diện module" của architecture.md, PRM-API mục Giao diện nội bộ): phương thức trong tiến trình, không có endpoint HTTP.
 * Chữ ký là hợp đồng của bảng Giao diện module (đổi phải chạy sdlc-impact): CRT gọi `evaluate(..., count_attempt)` (đọc theo lô, không `tx`), CHK gọi `evaluate` và `reserve(..., tx)`.
 * Tên lớp theo quy ước `<Tên>Api` của các module khác (`CatalogApi`, `InventoryApi`); PRM-API viết `PromotionService`.
 */
@Injectable()
export class PromotionApi {
  constructor(private readonly evaluator: EvaluateService) {}

  /**
   * CRT, CHK: kiểm mã và tính tiền giảm xem trước (chỉ đọc). `items_subtotal` do máy chủ bên gọi tính (SB-23). `count_attempt` mặc định true: false chỉ để kiểm lại mã ĐÃ LƯU ở giỏ hay phiên checkout
   * (không cộng bộ đếm thử sai, không bị `too_many_attempts`). Lỗi trả `{ ok: false, reason }`, bên gọi tự đổi sang mã HTTP của mình (kể cả `per_user_limit_reached`).
   */
  evaluate(input: EvaluateInput): Promise<EvaluateResult> {
    return this.evaluator.evaluate(input);
  }

  /**
   * CHK: giữ lượt của một đơn trong giao dịch `tx` của CHK (cùng giao dịch tạo Order). Kiểm lại như `evaluate` rồi giữ lượt nguyên tử; gọi lại cùng `order_id` và cùng mã trả lượt cũ,
   * mã khác là `order_already_has_coupon`. Có lỗi thì KHÔNG ghi gì (SAVEPOINT quay lui) nhưng bên gọi nên hủy giao dịch đặt hàng. Tham số có trường lạ (kể cả `amount`) là `invalid_argument`.
   */
  reserve(input: ReserveInput, tx: Tx): Promise<ReserveResult> {
    return this.evaluator.reserve(input, tx);
  }
}
