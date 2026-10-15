'use client';
import { Avatar } from './Avatar';

export interface CustomerAddress { id: string; receiver: string; phone: string; line1: string; ward: string; district: string | null; city: string; is_default: boolean }
export interface Customer {
  id: string; full_name: string; email: string; phone: string | null; email_verified: boolean; status: 'active' | 'locked'; created_at: string;
  avatar_url?: string | null; addresses?: CustomerAddress[];
}
export const addressLine = (a: { line1: string; ward: string; district?: string | null; city: string }): string => [a.line1, a.ward, a.district, a.city].filter(Boolean).join(', ');

/** Thẻ kết quả tra cứu khách (USR-REQ-20261006-101004117): staff nhận bản che từ server (không có ảnh, địa chỉ), admin nhận đầy đủ. Giao diện chỉ hiển thị giá trị nhận được. */
export function CustomerCard({ c, role }: { c: Customer; role: 'staff' | 'admin' }) {
  return (
    <section className="panel ip-cust" data-testid="usr-customer-lookup-result" data-id={c.id}>
      <div className="ip-cust-head">
        {role === 'admin' ? <Avatar name={c.full_name} url={c.avatar_url} size={56} testId="usr-customer-lookup-avatar" /> : <span className="tile tile-lg"><span className="i i-user" aria-hidden="true" /></span>}
        <div className="grow"><h2 data-testid="usr-customer-lookup-name">{c.full_name}</h2></div>
        <span className={`badge${c.status === 'locked' ? ' badge-locked' : ''}`} data-status={c.status === 'locked' ? undefined : 'active'} data-testid="usr-customer-lookup-status">{c.status === 'locked' ? 'Đã khóa' : 'Hoạt động'}</span>
      </div>
      <dl className="kv ip-kv">
        <dt><span className="i i-mail" aria-hidden="true" /><span className="ip-lbl">Email</span></dt>
        <dd>
          <span data-testid="usr-customer-lookup-result-email">{c.email}</span>{' '}
          <span className={`small ${c.email_verified ? 'ip-ok' : 'ip-no'}`} data-testid="usr-customer-lookup-verified"><span className={`i ${c.email_verified ? 'i-okc' : 'i-alert'}`} aria-hidden="true" /> {c.email_verified ? 'Đã xác minh' : 'Chưa xác minh'}</span>
        </dd>
        <dt><span className="i i-phone" aria-hidden="true" /><span className="ip-lbl">Điện thoại</span></dt><dd data-testid="usr-customer-lookup-phone">{c.phone ?? ''}</dd>
        <dt><span className="i i-calendar" aria-hidden="true" /><span className="ip-lbl">Ngày tạo</span></dt><dd data-testid="usr-customer-lookup-created">{new Date(c.created_at).toLocaleDateString('vi-VN')}</dd>
      </dl>
      {role === 'staff' && <p className="small muted" data-testid="usr-customer-lookup-masked-notice" style={{ margin: 0 }}><span className="i i-shield" aria-hidden="true" /> Thông tin đã được che</p>}
      {role === 'admin' && c.addresses && (
        <div data-testid="usr-customer-lookup-addresses">
          <h3 style={{ margin: '0 0 .5rem', fontSize: '1rem' }}><span className="i i-pin" aria-hidden="true" /> Địa chỉ</h3>
          {c.addresses.length === 0 ? <p className="small muted" style={{ margin: 0 }}>Chưa có địa chỉ</p> : (
            <ul className="ip-addr">
              {c.addresses.map((a) => (
                <li key={a.id}>
                  <span className={`tile ${a.is_default ? 'green' : 'gray'}`}><span className="i i-pin" aria-hidden="true" /></span>
                  <div className="grow"><b>{a.receiver}</b> <span className="muted">· {a.phone}</span>{a.is_default && <> <span className="badge" data-status="active">Mặc định</span></>}<div className="small muted">{addressLine(a)}</div></div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}
