import { Injectable } from '@nestjs/common';
import type { Tx } from '../platform';
import { CreateService, type CreatePendingInput } from './create.service';
import { InternalService, type RangeUtc, type SeriesBucket, type TopSort } from './internal.service';

/**
 * Giao diện nội bộ ORD phơi ra cho module khác (ADR-012, bảng "Giao diện module" của architecture.md, ORD-API mục Giao diện module): phương thức trong tiến trình, không có endpoint HTTP.
 * Chữ ký là bản chốt của ORD; CHK (createPending, confirmCod, countOpenOrders, getSummary), PAY (findForPayment), SHP (findForShipment, findByCode, findOwned, getRecipient, lockForHandoff),
 * REV (getDeliveredItems), DSH (countByStatus, getOrderSeries, listRecent, getTopProducts) dùng đúng chữ ký này.
 */
@Injectable()
export class OrderApi {
  constructor(private readonly create: CreateService, private readonly reads: InternalService) {}

  /** CHK: tạo đơn `pending` trong giao dịch `tx` của CHK. Đầu vào sai hay số tiền không nhất quán ném `OrderBusinessError('invalid_input')`; không ghi gì khi lỗi (CHK rollback). */
  createPending(input: CreatePendingInput, tx: Tx) { return this.create.createPending(input, tx); }
  /** CHK: `pending -> confirmed` cho đơn COD trong cùng giao dịch; đơn không phải COD `pending` ném `OrderBusinessError('not_confirmable')`. */
  confirmCod(orderId: string, tx: Tx) { return this.create.confirmCod(orderId, tx); }
  countOpenOrders(userId: string) { return this.reads.countOpenOrders(userId); }
  getSummary(orderId: string) { return this.reads.getSummary(orderId); }

  findForPayment(orderId: string) { return this.reads.findForPayment(orderId); }

  findForShipment(orderId: string) { return this.reads.findForShipment(orderId); }
  findByCode(code: string) { return this.reads.findByCode(code); }
  findOwned(code: string, userId: string) { return this.reads.findOwned(code, userId); }
  getRecipient(orderId: string) { return this.reads.getRecipient(orderId); }
  /** SHP: khóa hủy đơn trong giao dịch bàn giao (R-04). Đơn không ở `paid` hay `confirmed` ném `OrderBusinessError('not_lockable')`, không có đơn ném `'order_not_found'`. */
  lockForHandoff(orderId: string, tx: Tx) { return this.reads.lockForHandoff(orderId, tx); }

  getDeliveredItems(userId: string, productId: string) { return this.reads.getDeliveredItems(userId, productId); }

  countByStatus(range: RangeUtc) { return this.reads.countByStatus(range); }
  getOrderSeries(range: RangeUtc, bucket: SeriesBucket) { return this.reads.getOrderSeries(range, bucket); }
  listRecent(limit: number) { return this.reads.listRecent(limit); }
  getTopProducts(range: RangeUtc, sort: TopSort, limit: number) { return this.reads.getTopProducts(range, sort, limit); }
}
