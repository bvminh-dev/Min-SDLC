import { Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { AuthApi, type UserView } from '../auth';
import { AuditService, DomainError, TransactionService, type SessionContext } from '../platform';
import { AddressService, type AddressDto } from './address.service';
import { maskEmail, maskPhone } from './policy';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const sha256 = (s: string): string => createHash('sha256').update(s).digest('hex');

interface CustomerBase { id: string; full_name: string; email: string; phone: string | null; email_verified: boolean; status: 'active' | 'locked'; created_at: Date }
export type CustomerMasked = CustomerBase;
export type CustomerFull = CustomerBase & { avatar_url: string | null; addresses: AddressDto[] };

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
