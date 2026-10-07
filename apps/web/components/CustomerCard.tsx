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
    <section className="card" data-testid="usr-customer-lookup-result" data-id={c.id} style={{ marginTop: '1rem', border: '1px solid var(--line)', borderRadius: 8, padding: '1rem' }}>
      <div style={{ display: 'flex', gap: '.75rem', alignItems: 'center', flexWrap: 'wrap' }}>
        {role === 'admin' && <Avatar name={c.full_name} url={c.avatar_url} size={56} testId="usr-customer-lookup-avatar" />}
        <h2 data-testid="usr-customer-lookup-name" style={{ margin: 0 }}>{c.full_name}</h2>
        <span className={`badge${c.status === 'locked' ? ' badge-locked' : ''}`} data-testid="usr-customer-lookup-status">{c.status === 'locked' ? 'Đã khóa' : 'Hoạt động'}</span>
      </div>
      <dl style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '.25rem 1rem' }}>
        <dt>Email</dt><dd style={{ margin: 0 }}><span data-testid="usr-customer-lookup-result-email">{c.email}</span> <span className="hint" data-testid="usr-customer-lookup-verified">({c.email_verified ? 'Đã xác minh' : 'Chưa xác minh'})</span></dd>
        <dt>Điện thoại</dt><dd style={{ margin: 0 }} data-testid="usr-customer-lookup-phone">{c.phone ?? ''}</dd>
        <dt>Ngày tạo</dt><dd style={{ margin: 0 }} data-testid="usr-customer-lookup-created">{new Date(c.created_at).toLocaleDateString('vi-VN')}</dd>
      </dl>
      {role === 'staff' && <p className="hint" data-testid="usr-customer-lookup-masked-notice">Thông tin liên hệ đã được che theo chính sách.</p>}
      {role === 'admin' && c.addresses && (
        <div data-testid="usr-customer-lookup-addresses">
          <h3>Địa chỉ</h3>
          {c.addresses.length === 0 ? <p className="hint">Chưa có địa chỉ.</p> : (
            <ul style={{ paddingLeft: '1.25rem' }}>
              {c.addresses.map((a) => <li key={a.id}>{a.receiver} · {a.phone} · {addressLine(a)}{a.is_default ? ' (Mặc định)' : ''}</li>)}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}
