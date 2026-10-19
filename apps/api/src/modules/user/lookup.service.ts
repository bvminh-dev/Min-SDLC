import { Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { AuthApi, type UserView } from '../auth';
import { AuditService, DomainError, TransactionService, type SessionContext } from '../platform';
import { AddressService, type AddressDto } from './address.service';
import { maskEmail, maskPhone, normalizePhone } from './policy';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const sha256 = (s: string): string => createHash('sha256').update(s).digest('hex');
const MAX_SALE_ITEMS = 5; // trần kết quả tra theo điện thoại (số không duy nhất)

interface CustomerBase { id: string; full_name: string; email: string; phone: string | null; email_verified: boolean; status: 'active' | 'locked'; created_at: Date }
export type CustomerMasked = CustomerBase;
export type CustomerFull = CustomerBase & { avatar_url: string | null; addresses: AddressDto[] };
/** Bản che cho sale (USR-REQ-20261006-101004117 BR9): không `email_verified`, không địa chỉ. */
export interface SaleCustomer { id: string; full_name: string; email: string; phone: string | null; status: 'active' | 'locked' }

/** Tra cứu khách của staff (bản che, chỉ theo email) và admin (đầy đủ, theo email hoặc id): USR-REQ-20261006-101004117. */
@Injectable()
export class LookupService {
  constructor(private readonly auth: AuthApi, private readonly addresses: AddressService, private readonly audit: AuditService, private readonly transactions: TransactionService) {}

  byEmail(actor: SessionContext, email: string): Promise<CustomerMasked | CustomerFull> {
    return this.lookup(actor, 'email', email, () => this.auth.findCustomerByEmail(email));
  }
  byId(actor: SessionContext, id: string): Promise<CustomerMasked | CustomerFull> {
    return this.lookup(actor, 'id', id, () => (UUID.test(id) ? this.auth.findCustomerById(id) : Promise.resolve(null)));
  }

  /**
   * Tra khách cho sale hoặc admin khi tạo đơn hộ (qua SAL, BR9): đúng một khóa `phone` hoặc `email`, khớp chính xác, tối đa 5 bản che. Không có kết quả
   * (không tồn tại, hay là staff, sale, admin) trả `items` rỗng. MỘT dòng audit mỗi lần, khóa tra băm sha256, ghi TRƯỚC khi trả; lỗi ghi audit thì ném lỗi, không trả dữ liệu.
   */
  async forSale(actor: { actor_id: string; actor_role: 'sale' | 'admin' }, key: { phone?: string; email?: string }): Promise<{ items: SaleCustomer[] }> {
    const hasPhone = typeof key.phone === 'string' && key.phone !== '';
    const hasEmail = typeof key.email === 'string' && key.email !== '';
    if (hasPhone === hasEmail) throw new DomainError('validation-failed', { errors: [{ field: hasPhone ? 'email' : 'phone', code: hasPhone ? 'unknown_field' : 'required' }] }); // đúng một khóa
    const raw = (hasPhone ? key.phone : key.email) as string;
    // NUL (PostgreSQL 22021) và, ở email, ký tự ngoài ASCII (citext gấp Kelvin U+212A thành `k`): 400 TRƯỚC khi tra, kiểm trên chuỗi thô (trước toLowerCase)
    if (raw.includes('\0') || /\p{Cs}/u.test(raw) || (!hasPhone && /[^\x20-\x7e]/.test(raw))) throw new DomainError('validation-failed', { errors: [{ field: hasPhone ? 'phone' : 'email', code: 'invalid_format' }] });
    const by = hasPhone ? 'phone' : 'email';
    const input = hasPhone ? normalizePhone(key.phone as string) : (key.email as string).trim().toLowerCase();
    const found = hasPhone ? await this.auth.findCustomersByPhone(input, MAX_SALE_ITEMS) : [await this.auth.findCustomerByEmail(input)].filter((u): u is UserView => !!u);
    await this.transactions.run((tx) => this.audit.record(tx, {
      actor_id: actor.actor_id, actor_role: actor.actor_role, action: 'usr.customer_lookup', target_type: 'customer',
      target_id: sha256(input), after: { by, found: found.length, mask: 'masked' },
    }));
    return { items: found.slice(0, MAX_SALE_ITEMS).map((u) => ({ id: u.id, full_name: u.full_name, email: maskEmail(u.email), phone: maskPhone(u.phone), status: u.status })) };
  }

  /** `true` chỉ khi `id` là uuid của người dùng role `customer` (mọi trạng thái); mọi trường hợp khác `false`, không ném lỗi. */
  async isCustomer(id: string): Promise<boolean> {
    return typeof id === 'string' && UUID.test(id) && (await this.auth.findCustomerById(id)) !== null;
  }

  /**
   * Audit MỖI lần (kể cả 404), ghi TRƯỚC khi trả dữ liệu, một dòng mỗi lần (không gộp); lỗi ghi audit thì 500 và không trả dữ liệu khách (T13, ADR-021, M-10).
   * Không tìm thấy: target_id là băm sha256 của đầu vào (không ghi email gốc, T14).
   */
  private async lookup(actor: SessionContext, by: 'email' | 'id', input: string, find: () => Promise<UserView | null>): Promise<CustomerMasked | CustomerFull> {
    const found = await find();
    const full = actor.role === 'admin';
    await this.transactions.run((tx) => this.audit.record(tx, {
      actor_id: actor.user_id, actor_role: actor.role, action: 'usr.customer_lookup', target_type: 'customer',
      target_id: found ? found.id : sha256(input), after: { by, found: !!found, mask: full ? 'full' : 'masked' },
    }));
    if (!found) throw new DomainError('not-found');
    const base = { id: found.id, full_name: found.full_name, email_verified: found.email_verified, status: found.status, created_at: found.created_at };
    if (!full) return { ...base, email: maskEmail(found.email), phone: maskPhone(found.phone) };
    return { ...base, email: found.email, phone: found.phone || null, avatar_url: found.avatar_url || null, addresses: await this.addresses.list(found.id) };
  }
}
