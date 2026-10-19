import { Injectable } from '@nestjs/common';
import { AuthApi } from '../auth';
import { LookupService, type SaleCustomer } from './lookup.service';

export type { SaleCustomer };
export interface CustomerStats { total: number; locked: number; new_in_range: number }

/** Giao diện tổng hợp chỉ đọc cho DSH (architecture.md, hàng DSH -> USR; USR gọi AUTH, USR-API mục Cho module khác). */
@Injectable()
export class UserApi {
  constructor(private readonly auth: AuthApi, private readonly lookup: LookupService) {}
  /**
   * Số khách (role `customer`, kể cả bị khóa): `total` và `locked` là số tại lúc đọc, `new_in_range` là số tạo trong khoảng UTC nửa mở `[from, to)`. Chỉ số đếm (SB-08).
   * Khoảng sai ném `RangeError`; lỗi CSDL ném nguyên (DSH trả 503, không bao giờ thay bằng 0).
   */
  countCustomers(range: { from: Date; to: Date }): Promise<CustomerStats> { return this.auth.countCustomerStats(range); }

  /** SAL (đơn hộ, USR-REQ-20261006-101004117 BR9): đúng một khóa `phone` hoặc `email`, trả tối đa 5 bản che; USR ghi audit trước khi trả, lỗi audit thì ném lỗi. */
  lookupForSale(actor: { actor_id: string; actor_role: 'sale' | 'admin' }, key: { phone?: string; email?: string }): Promise<{ items: SaleCustomer[] }> { return this.lookup.forSale(actor, key); }
  /** SAL gợi ý khách khi gõ dở (khớp một phần, ≥3 ký tự, tối đa 5 bản che); USR ghi audit trước khi trả. */
  suggestForSale(actor: { actor_id: string; actor_role: 'sale' | 'admin' }, q: string): Promise<{ items: SaleCustomer[] }> { return this.lookup.suggestForSale(actor, q); }
  /** SAL kiểm `customer.user_id` khi tạo đơn hộ: `true` chỉ với uuid của người dùng role `customer` (mọi trạng thái). */
  isCustomer(userId: string): Promise<boolean> { return this.lookup.isCustomer(userId); }
  /** SAL đổi SĐT bản che (từ tra khách) về số thật của khách `userId` khi tạo đơn hộ; không khớp thì `null`. */
  unmaskPhone(userId: string, masked: string): Promise<string | null> { return this.lookup.unmaskPhone(userId, masked); }
}
