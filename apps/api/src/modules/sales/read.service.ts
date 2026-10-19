import { Injectable } from '@nestjs/common';
import { DomainError, type SessionContext } from '../platform';
import { DepsService } from './deps.service';
import type { ListQuery, LookupQuery, ShippingQuery } from './policy';

type Role = 'sale' | 'admin';
const roleOf = (s: SessionContext): Role => s.role as Role;

/**
 * Phần chỉ đọc của SAL: tra khách bản che, báo phí, "Đơn của tôi" (danh sách, chi tiết). SAL không đọc bảng nào (SB-35): dữ liệu qua `UserApi`, `ShippingApi`, `OrderApi`. Serializer liệt kê TỪNG trường được phép
 * (không loại trừ theo tên): giá vốn, `user_id` khách, địa chỉ ở danh sách và `created_by` của sale không bao giờ ra khỏi đây (SB-42, SB-06, SAL-SEC T5).
 */
@Injectable()
export class ReadService {
  constructor(private readonly deps: DepsService) {}

  /** SAL-REQ-20261015-092710942: bản che, tối đa 5; USR ghi audit trước khi trả và lỗi audit thì 500 (không bọc 503). */
  async lookup(s: SessionContext, q: LookupQuery) {
    const r = await this.deps.lookup({ actor_id: s.user_id, actor_role: roleOf(s) }, q);
    return { items: r.items.map((c) => ({ id: c.id, full_name: c.full_name, email: c.email, phone: c.phone, status: c.status })) };
  }

  /** SAL-REQ-20261015-092711037: phí từng phương thức đang bật theo cùng công thức của SHP, rẻ nhất trước; chỉ để hiển thị (khi tạo đơn server tính lại). */
  async shippingOptions(q: ShippingQuery) {
    const methods = await this.deps.methods();
    if (!methods.length) throw new DomainError('no-shipping-methods');
    const quoted = await Promise.all(methods.map(async (m) => {
      try { const r = await this.deps.quote({ method_id: m.id, city: q.city, subtotal: q.items_subtotal }); return { method_id: m.id, name: m.name, fee: r.fee, free_shipping: r.free_shipping }; } catch (e) {
        if (e instanceof DomainError && e.code === 'method-unavailable') return null; // vừa bị tắt giữa hai lời gọi
        throw e;
      }
    }));
    const options = quoted.filter((x): x is NonNullable<typeof x> => x !== null).sort((a, b) => a.fee - b.fee || a.name.localeCompare(b.name, 'vi'));
    if (!options.length) throw new DomainError('no-shipping-methods');
    return { city: q.city, items_subtotal: q.items_subtotal, options };
  }

  /** SAL-REQ-20261015-092711222: sale chỉ đơn có `created_by` là mình (điều kiện đặt từ PHIÊN, không từ tham số); admin mọi đơn hộ; sale gửi `created_by` là 400 (không bỏ qua lặng lẽ). */
  async list(s: SessionContext, q: ListQuery) {
    const admin = s.role === 'admin';
    if (q.created_by !== undefined && !admin) throw new DomainError('validation-failed', { errors: [{ field: 'created_by', code: 'unknown_field' }] });
    const r = await this.deps.listOrders({ created_by: admin ? (q.created_by ?? null) : s.user_id, status: q.status, source: q.source, code: q.code, page: q.page, limit: q.limit });
    return {
      items: r.items.map((o) => ({
        code: o.code, status: o.status, payment_method: o.payment_method, payment_status: o.payment_status, grand_total: o.grand_total, items_count: o.items_count,
        source: { code: o.source.code, name: o.source.name }, customer: { name: o.customer.name, phone: o.customer.phone }, created_at: o.created_at,
        ...(admin ? { created_by: { id: o.created_by.id, name: o.created_by.name } } : {}),
      })),
      page: q.page, limit: q.limit, total: r.total,
    };
  }

  /** SAL-REQ-20261015-092711321: đơn của người khác, đơn khách tự đặt, không có, sai mã, mã cũ 12 ký tự cùng một 404 (SB-44); không giá vốn, không `user_id`. */
  async detail(s: SessionContext, code: string) {
    const admin = s.role === 'admin';
    const o = await this.deps.getOrder(code, { created_by: admin ? null : s.user_id });
    if (!o) throw new DomainError('not-found');
    const a = o.shipping_address as Record<string, string | null>;
    return {
      code: o.code, status: o.status, payment_method: o.payment_method, payment_status: o.payment_status, created_at: o.created_at, confirmed_at: o.confirmed_at, paid_at: o.paid_at, delivered_at: o.delivered_at,
      ...(o.cancel_reason ? { cancel_reason: o.cancel_reason } : {}),
      source: { code: o.source.code, name: o.source.name }, note: o.note, customer: { name: o.customer.name, phone: o.customer.phone, has_account: o.customer.has_account },
      shipping_address: { receiver: a.receiver, phone: a.phone, line1: a.line1, ward: a.ward, district: a.district ?? null, city: a.city },
      items: o.items.map((i) => ({ product_id: i.product_id, name: i.name, quantity: i.quantity, unit_price: i.unit_price, line_total: i.line_total, note: i.note })),
      items_total: o.items_total, discount: o.discount, shipping_fee: o.shipping_fee, grand_total: o.grand_total,
      ...(admin && o.created_by ? { created_by: { id: o.created_by.id, name: o.created_by.name } } : {}),
    };
  }
}
