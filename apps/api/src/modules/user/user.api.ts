import { Injectable } from '@nestjs/common';
import { AuthApi } from '../auth';

/** Giao diện tổng hợp chỉ đọc cho DSH (architecture.md, hàng DSH -> USR; USR gọi AUTH, USR-API mục Cho module khác). */
@Injectable()
export class UserApi {
  constructor(private readonly auth: AuthApi) {}
  /** Số khách (role `customer`, kể cả bị khóa). */
  countCustomers(): Promise<number> { return this.auth.countCustomers(); }
}
