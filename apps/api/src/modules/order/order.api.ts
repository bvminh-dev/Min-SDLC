import { Injectable } from '@nestjs/common';
import type { Tx } from '../platform';
import type { OrderStatus } from './config';
import { CreateService, type CreateHoInput, type CreatePendingInput } from './create.service';
import { InternalService, type RangeUtc, type SeriesBucket, type TopSort } from './internal.service';
import { SourcesService } from './sources.service';

/**
 * Giao diện nội bộ ORD phơi ra cho module khác (ADR-012, bảng "Giao diện module" của architecture.md, ORD-API mục Giao diện module): phương thức trong tiến trình, không có endpoint HTTP.
 * Chữ ký là bản chốt của ORD; CHK (createPending, confirmCod, countOpenOrders, getSummary), PAY (findForPayment), SHP (findForShipment, findByCode, findOwned, getRecipient, lockForHandoff),
 * REV (getDeliveredItems, hasUndeliveredItems), DSH (countByStatus, getOrderSeries, listRecent, getTopProducts, getProductSalesTotals, getSourcesReport, getSalesReport),
 * SAL (createHo, listSources, listForSale, getForSale), SHP (getShipmentDisplay) dùng đúng chữ ký này.
 */
@Injectable()
export class OrderApi {
  constructor(private readonly create: CreateService, private readonly reads: InternalService, private readonly sources: SourcesService) {}

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
  /** REV: có dòng đơn chứa sản phẩm ở đơn chưa giao xong (`pending`, `confirmed`, `paid`, `shipped`) không; để REV trả `not_delivered` thay `not_purchased`. */
  hasUndeliveredItems(userId: string, productId: string) { return this.reads.hasUndeliveredItems(userId, productId); }

  countByStatus(range: RangeUtc) { return this.reads.countByStatus(range); }
  getOrderSeries(range: RangeUtc, bucket: SeriesBucket) { return this.reads.getOrderSeries(range, bucket); }
  listRecent(limit: number) { return this.reads.listRecent(limit); }
  getTopProducts(range: RangeUtc, sort: TopSort, limit: number) { return this.reads.getTopProducts(range, sort, limit); }
  /** DSH: tổng số lượng bán và số sản phẩm khác nhau của toàn khoảng (cùng điều kiện với `getTopProducts`). */
  getProductSalesTotals(range: RangeUtc) { return this.reads.getProductSalesTotals(range); }

  /** SAL: đơn hộ `confirmed` ngay trong giao dịch `tx` của SAL (ORD-REQ-20261015-092748715). Ném `OrderBusinessError`: `invalid_input`, `source_unavailable` (nguồn không có hoặc đã tắt), `order_code_exhausted`; không ghi gì khi lỗi. */
  createHo(input: CreateHoInput, tx: Tx) { return this.create.createHo(input, tx); }
  /** SAL: danh mục nguồn đơn theo `position` rồi `name`; mặc định chỉ nguồn đang bật. */
  listSources(options?: { include_inactive?: boolean }) { return this.sources.listSources(options); }
  /** SAL: đơn hộ của một sale (`created_by` uuid) hoặc mọi đơn hộ (null, admin); ngoài miền ném `RangeError`. */
  listForSale(o: { created_by: string | null; status?: OrderStatus; source?: string; code?: string; page: number; limit: number }) { return this.reads.listForSale(o); }
  /** SAL: chi tiết đơn hộ hoặc `null` (đơn người khác, đơn khách tự đặt, không tồn tại cùng `null`, SB-44). */
  getForSale(code: string, o: { created_by: string | null }) { return this.reads.getForSale(code, o); }
  /** SHP: khối khách của cả trang vận đơn (một SELECT, một lời gọi AUTH); SHP ẩn `phone`, `address` theo SB-08 (d). */
  getShipmentDisplay(orderIds: string[]) { return this.reads.getShipmentDisplay(orderIds); }
  /** DSH: số đơn và doanh thu theo nguồn, loại `cancelled`, `expired`, `returned`. */
  getSourcesReport(range: RangeUtc) { return this.reads.getSourcesReport(range); }
  /** DSH: số đơn và doanh thu theo người tạo (null là khách tự đặt). */
  getSalesReport(range: RangeUtc) { return this.reads.getSalesReport(range); }
}
