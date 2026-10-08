import { Injectable } from '@nestjs/common';
import { DomainError } from '../platform';
import { CITY_QUERY_MAX, SUBTOTAL_MAX } from './config';
import { MethodService, type ActiveMethod, type QuoteInput, type QuoteResult } from './method.service';

/**
 * Giao diện nội bộ SHP phơi ra cho module khác (ADR-012, bảng "Giao diện module" của architecture.md, SHP-API mục Giao tiếp giữa module): phương thức trong tiến trình, không có endpoint HTTP,
 * không giới hạn tần suất (bậc C chỉ áp cho endpoint HTTP). CHK (`listActiveMethods`, `quote`) và CRT (`quote`, theo lô) dùng đúng chữ ký này. Chỉ đọc, không ghi, không `tx`.
 */
@Injectable()
export class ShippingApi {
  constructor(private readonly methods: MethodService) {}

  /** Phương thức đang bật: `[{ id, name, base_fee, free_over }]`, `base_fee` tăng dần. */
  listActiveMethods(): Promise<ActiveMethod[]> { return this.methods.listActive(); }

  /**
   * Phí vận chuyển của một phương thức: `{ fee, free_shipping }` (số nguyên đồng); `subtotal` là tạm tính hàng trước giảm giá, do bên gọi tính ở server (SB-23). Phương thức không có, đã tắt hay `method_id`
   * sai định dạng ném `DomainError('method-unavailable')`; `subtotal` hay `city` ngoài miền ném `RangeError` (lỗi lập trình của bên gọi).
   */
  async quote(input: QuoteInput): Promise<QuoteResult> {
    const { method_id: methodId, city, subtotal } = input ?? ({} as QuoteInput);
    if (!Number.isSafeInteger(subtotal) || subtotal < 0 || subtotal > SUBTOTAL_MAX) throw new RangeError(`subtotal phải là số nguyên từ 0 đến ${SUBTOTAL_MAX}`);
    if (typeof city !== 'string' || [...city].length < 1 || [...city].length > CITY_QUERY_MAX) throw new RangeError(`city phải từ 1 đến ${CITY_QUERY_MAX} ký tự`);
    const r = await this.methods.quoteCore({ method_id: methodId, city, subtotal });
    if (!r.ok) throw new DomainError('method-unavailable');
    return r.result;
  }
}
