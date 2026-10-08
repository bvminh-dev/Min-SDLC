import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { OrderApi, OrderBusinessError } from '../order';
import { AuditService, Clock, DomainError, EventsService, TransactionService, type SessionContext, type Tx } from '../platform';
import { NON_RESTOCKABLE, TRANSITIONS, type FailReason, type TransitionName } from './config';
import { SHIPMENT_COLS, isUnique, type ShipmentRow } from './db';
import type { FailBody, ShipBody, TrackingBody } from './policy';

const actorOf = (s: SessionContext) => ({ actor_id: s.user_id, actor_role: s.role });
const iso = (d: Date | null): string | null => (d ? d.toISOString() : null);

interface Order { order_id: string; code: string }

/**
 * Thao tác của staff, admin trên vận đơn (SHP-REQ ...855, ...880, ...903; SHP-DB mục Giao dịch và khóa 1 đến 3): mã đơn đổi thành `order_id` qua `OrderApi.findByCode` NGOÀI giao dịch (chỉ để tra),
 * rồi MỘT giao dịch: khóa dòng vận đơn (`FOR UPDATE`), kiểm trạng thái hiện tại thuộc cột Từ của bảng chuyển (`TRANSITIONS`), `UPDATE ... WHERE status = :cũ`, một dòng lịch sử, audit và
 * OutboxEvent cùng giao dịch (ADR-011, SB-27, SB-19): audit hay outbox lỗi thì cả chuyển rollback. Bàn giao gọi `OrderApi.lockForHandoff(order_id, tx)` SAU khi khóa vận đơn và TRƯỚC khi ghi `shipped` (R-04).
 * Thứ tự khóa: `shipments` rồi dòng `orders` (qua ORD). Hai yêu cầu song song: khóa dòng xếp thứ tự, chỉ một thắng, yêu cầu còn lại 409.
 */
@Injectable()
export class ShipmentService {
  constructor(
    private readonly transactions: TransactionService, private readonly audit: AuditService, private readonly events: EventsService, private readonly clock: Clock, private readonly orders: OrderApi,
  ) {}

  /** Mã đơn thành `order_id`; sai định dạng, không có đơn là cùng 404 (SB-06). */
  private async order(code: string): Promise<Order> {
    const o = await this.orders.findByCode(code);
    if (!o) throw new DomainError('not-found');
    return o;
  }

  /** Khóa vận đơn còn hiệu lực của đơn; chỉ có vận đơn `cancelled` thì 409 (vận đơn tồn tại nhưng đã đóng), không có vận đơn nào thì 404. */
  private async lock(tx: Tx, orderId: string): Promise<ShipmentRow> {
    const [s] = await tx.$queryRaw<ShipmentRow[]>`SELECT ${SHIPMENT_COLS} FROM shipments WHERE order_id = ${orderId}::uuid AND status <> 'cancelled'::shipment_status FOR UPDATE`;
    if (s) return s;
    const [c] = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM shipments WHERE order_id = ${orderId}::uuid LIMIT 1`;
    throw new DomainError(c ? 'shipment-invalid-transition' : 'not-found');
  }

  private allowed(name: TransitionName, s: ShipmentRow): void {
    if (!(TRANSITIONS[name].from as readonly string[]).includes(s.status)) throw new DomainError('shipment-invalid-transition'); // không đổi, không lịch sử, không event
  }

  /** Phần chung của một chuyển trạng thái: UPDATE có điều kiện trạng thái cũ, lịch sử, audit, event (cùng giao dịch). */
  private async move(tx: Tx, s: ShipmentRow, name: TransitionName, s0: SessionContext, o: { now: Date; set?: Prisma.Sql; reason?: FailReason; note?: string; payload?: Record<string, unknown>; after?: Record<string, unknown> }): Promise<ShipmentRow> {
    const t = TRANSITIONS[name];
    const [r] = await tx.$queryRaw<ShipmentRow[]>(Prisma.sql`
      UPDATE shipments SET status = ${t.to}::shipment_status, version = version + 1, updated_at = ${o.now}::timestamptz${o.set ?? Prisma.empty}
      WHERE id = ${s.id}::uuid AND status = ${s.status}::shipment_status RETURNING ${SHIPMENT_COLS}`);
    if (!r) throw new DomainError('shipment-invalid-transition'); // lưới an toàn thứ hai sau khóa dòng
    await tx.$executeRaw`
      INSERT INTO shipment_status_history (shipment_id, event, status, tracking_number, reason_code, note, created_at)
      VALUES (${s.id}::uuid, 'status_changed'::shipment_history_event, ${t.to}::shipment_status, ${r.tracking_number}, ${o.reason ?? null}::shipment_fail_reason, ${o.note ?? null}, ${o.now}::timestamptz)`;
    await this.audit.record(tx, {
      ...actorOf(s0), action: `shipping.shipment.${name}`, target_type: 'shipment', target_id: s.id,
      before: { status: s.status, tracking_number: s.tracking_number }, after: { status: r.status, tracking_number: r.tracking_number, ...(o.after ?? {}) },
    });
    if (t.event) await this.events.publish(tx, { type: t.event, aggregate_type: 'shipment', aggregate_id: s.id, payload: { shipment_id: s.id, order_id: s.order_id, ...(o.payload ?? {}) } });
    return r;
  }

  /** Bàn giao: `pending` sang `shipped` kèm mã vận đơn; `lockForHandoff` trong cùng giao dịch (đơn đã hủy thì 409 `order-not-shippable`, vận đơn giữ `pending`). */
  async ship(s0: SessionContext, code: string, b: ShipBody) {
    const o = await this.order(code);
    try {
      return await this.transactions.run(async (tx) => {
        const s = await this.lock(tx, o.order_id);
        this.allowed('ship', s);
        try {
          await this.orders.lockForHandoff(o.order_id, tx);
        } catch (e) {
          if (e instanceof OrderBusinessError) throw new DomainError(e.code === 'order_not_found' ? 'not-found' : 'order-not-shippable');
          throw e;
        }
        const now = this.clock.now();
        const r = await this.move(tx, s, 'ship', s0, {
          now, set: Prisma.sql`, tracking_number = ${b.tracking_number}, shipped_at = ${now}::timestamptz`, payload: { tracking_number: b.tracking_number },
        });
        return { order_code: o.code, status: r.status, tracking_number: r.tracking_number, shipped_at: iso(r.shipped_at), version: r.version };
      });
    } catch (e) {
      if (isUnique(e, /shipments_tracking_number_key|\(tracking_number\)=/)) throw new DomainError('tracking-number-taken'); // unique index ở CSDL phân xử hai vận đơn cùng mã; giao dịch rollback cả cờ bàn giao
      throw e;
    }
  }

  /** Sửa mã: chỉ khi `shipped`; thứ tự kiểm: trạng thái, `version`, mã không đổi. Không đổi `status`; phát ShipmentTrackingChanged. */
  async changeTracking(s0: SessionContext, code: string, b: TrackingBody) {
    const o = await this.order(code);
    try {
      return await this.transactions.run(async (tx) => {
        const s = await this.lock(tx, o.order_id);
        if (s.status !== 'shipped') throw new DomainError('shipment-invalid-transition');
        if (s.version !== b.version) throw new DomainError('version-conflict');
        if (s.tracking_number === b.tracking_number) throw new DomainError('tracking-number-unchanged');
        const now = this.clock.now();
        const [r] = await tx.$queryRaw<ShipmentRow[]>`
          UPDATE shipments SET tracking_number = ${b.tracking_number}, version = version + 1, updated_at = ${now}::timestamptz
          WHERE id = ${s.id}::uuid AND status = 'shipped'::shipment_status AND version = ${b.version} RETURNING ${SHIPMENT_COLS}`;
        if (!r) throw new DomainError('version-conflict');
        await tx.$executeRaw`
          INSERT INTO shipment_status_history (shipment_id, event, status, tracking_number, created_at)
          VALUES (${s.id}::uuid, 'tracking_changed'::shipment_history_event, 'shipped'::shipment_status, ${r.tracking_number}, ${now}::timestamptz)`;
        await this.audit.record(tx, {
          ...actorOf(s0), action: 'shipping.shipment.tracking', target_type: 'shipment', target_id: s.id,
          before: { status: s.status, tracking_number: s.tracking_number }, after: { status: r.status, tracking_number: r.tracking_number },
        });
        await this.events.publish(tx, { type: 'ShipmentTrackingChanged', aggregate_type: 'shipment', aggregate_id: s.id, payload: { shipment_id: s.id, order_id: s.order_id, tracking_number: b.tracking_number } });
        return { order_code: o.code, status: r.status, tracking_number: r.tracking_number, shipped_at: iso(r.shipped_at), version: r.version };
      });
    } catch (e) {
      if (isUnique(e, /shipments_tracking_number_key|\(tracking_number\)=/)) throw new DomainError('tracking-number-taken');
      throw e;
    }
  }

  /** `shipped` sang `delivered`; `delivered_at` do server đặt. COD do PAY thu khi nhận OrderDelivered của ORD, SHP không ghi bảng nào của PAY. */
  async deliver(s0: SessionContext, code: string) {
    const o = await this.order(code);
    return this.transactions.run(async (tx) => {
      const s = await this.lock(tx, o.order_id);
      this.allowed('deliver', s);
      const now = this.clock.now();
      const r = await this.move(tx, s, 'deliver', s0, { now, set: Prisma.sql`, delivered_at = ${now}::timestamptz` });
      return { order_code: o.code, status: r.status, delivered_at: iso(r.delivered_at), version: r.version };
    });
  }

  /** `shipped` sang `failed` kèm `reason_code`; lý do và ghi chú chỉ lưu ở dòng lịch sử (một nơi, bất biến). ShipmentFailed chỉ mang `reason` = `reason_code`, không mang `note`. */
  async fail(s0: SessionContext, code: string, b: FailBody) {
    const o = await this.order(code);
    const owner = await this.orders.findForPayment(o.order_id); // `user_id` cho ShipmentFailed (xem report, Lệch spec: findByCode của ORD không trả user_id)
    if (!owner) throw new DomainError('not-found');
    return this.transactions.run(async (tx) => {
      const s = await this.lock(tx, o.order_id);
      this.allowed('fail', s);
      const r = await this.move(tx, s, 'fail', s0, {
        now: this.clock.now(), reason: b.reason_code, note: b.note, payload: { order_code: o.code, user_id: owner.user_id, reason: b.reason_code }, after: { reason_code: b.reason_code },
      });
      return { order_code: o.code, status: r.status, version: r.version };
    });
  }

  /** `failed` sang `returned`; `restockable` suy ra từ `reason_code` của dòng `failed` mới nhất (theo `seq`): `damaged` thì false (R-11). Hoàn hàng không tự hoàn tiền. */
  async returned(s0: SessionContext, code: string) {
    const o = await this.order(code);
    return this.transactions.run(async (tx) => {
      const s = await this.lock(tx, o.order_id);
      this.allowed('return', s);
      const [last] = await tx.$queryRaw<{ reason_code: FailReason | null }[]>`
        SELECT reason_code::text AS reason_code FROM shipment_status_history WHERE shipment_id = ${s.id}::uuid AND status = 'failed'::shipment_status ORDER BY seq DESC LIMIT 1`;
      const restockable = !(last?.reason_code && NON_RESTOCKABLE.includes(last.reason_code));
      const r = await this.move(tx, s, 'return', s0, { now: this.clock.now(), payload: { restockable } });
      return { order_code: o.code, status: r.status, version: r.version };
    });
  }
}
