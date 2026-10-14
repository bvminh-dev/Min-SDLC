import { Injectable } from '@nestjs/common';
import { AuthApi } from '../auth';

export interface CustomerStats { total: number; locked: number; new_in_range: number }

/** Giao diện tổng hợp chỉ đọc cho DSH (architecture.md, hàng DSH -> USR; USR gọi AUTH, USR-API mục Cho module khác). */
@Injectable()
export class UserApi {
  constructor(private readonly auth: AuthApi) {}
  /**
   * Số khách (role `customer`, kể cả bị khóa): `total` và `locked` là số tại lúc đọc, `new_in_range` là số tạo trong khoảng UTC nửa mở `[from, to)`. Chỉ số đếm (SB-08).
   * Khoảng sai ném `RangeError`; lỗi CSDL ném nguyên (DSH trả 503, không bao giờ thay bằng 0).
   */
  countCustomers(range: { from: Date; to: Date }): Promise<CustomerStats> { return this.auth.countCustomerStats(range); }
}
