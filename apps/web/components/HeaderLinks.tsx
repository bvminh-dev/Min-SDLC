'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { useAuth } from '../lib/auth';
import { CartBadge } from './CartBadge';
import { CategoryStrip } from './CategoryStrip';
import { HeaderSearch } from './HeaderSearch';
import { NotificationBell } from './NotificationBell';

type Item = { href: string; label: string; icon: string };
type Group = { label: string; icon: string; items: Item[] };
type Entry = Item | Group;

const item = (href: string, label: string, icon: string): Item => ({ href, label, icon });
const OPS = [
  item('/admin/orders', 'Đơn hàng', 'receipt'), item('/admin/shipments', 'Vận đơn', 'truck'), item('/admin/payments', 'Thanh toán', 'card'),
  item('/admin/refunds', 'Hoàn tiền', 'undo'), item('/admin/inventory', 'Tồn kho', 'layers'),
];
const PRODUCTS = item('/products', 'Sản phẩm', 'tag');
// Admin: việc hằng ngày hiện sẵn, phần còn lại gom vào ba menu thả. Staff: nhóm "Bán hộ", cấu hình, phân tích không có (một mục thì là link thẳng).
const ADMIN: Entry[] = [
  ...OPS,
  { label: 'Bán hộ', icon: 'users', items: [item('/sales/orders/new', 'Tạo đơn hộ', 'fileplus'), item('/sales/orders', 'Đơn hộ', 'list')] },
  { label: 'Cấu hình', icon: 'sliders', items: [PRODUCTS, item('/admin/coupons', 'Coupon', 'ticket'), item('/admin/shipping-methods', 'Vận chuyển', 'nav'), item('/admin/order-sources', 'Nguồn đơn', 'megaphone')] },
  { label: 'Phân tích', icon: 'chart', items: [item('/admin/dashboard', 'Dashboard', 'dash'), item('/admin/reports/sources', 'Báo cáo nguồn', 'pie'), item('/admin/reports/sales', 'Báo cáo sale', 'trend'), item('/admin/reviews', 'Đánh giá', 'star')] },
];
const STAFF: Entry[] = [...OPS, PRODUCTS];
// Sale: tạo đơn hộ và "Đơn của tôi" (SAL, ui/sale-create-order, ui/sale-order-list); các màn quản trị khác theo quyền của role sale ở epic tương ứng.
const SALE: Entry[] = [PRODUCTS, item('/sales/orders/new', 'Tạo đơn', 'fileplus'), item('/sales/orders', 'Đơn của tôi', 'list'), item('/admin/shipments', 'Vận đơn', 'truck')];

const isGroup = (e: Entry): e is Group => 'items' in e;
const Icon = ({ name, className = '' }: { name: string; className?: string }) => <span className={`i i-${name} ${className}`} aria-hidden="true" />;

function NavLink({ it, current, onGo }: { it: Item; current: string | null; onGo?: () => void }) {
  return (
    <Link className="nav-item" href={it.href} aria-current={it.href === current ? 'page' : undefined} onClick={onGo}>
      <Icon name={it.icon} />{it.label}
    </Link>
  );
}

function NavDropdown({ group, current }: { group: Group; current: string | null }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', esc); };
  }, [open]);
  const active = group.items.some((i) => i.href === current);
  return (
    <div className="nav-dd" ref={box}>
      <button type="button" className="nav-item" aria-haspopup="true" aria-expanded={open} data-active={active || undefined} onClick={() => setOpen((o) => !o)}>
        <Icon name={group.icon} />{group.label}<Icon name="down" className="nav-chev" />
      </button>
      {open && <div className="nav-pop">{group.items.map((i) => <NavLink key={i.href} it={i} current={current} onGo={() => setOpen(false)} />)}</div>}
    </div>
  );
}

/** Menu quản trị: từ 1100px là hàng ngang; hẹp hơn thì nút ☰ mở panel trượt từ trái. */
function AdminNav({ entries }: { entries: Entry[] }) {
  const path = usePathname();
  const [menu, setMenu] = useState(false);
  const all = entries.flatMap((e) => (isGroup(e) ? e.items : [e]));
  // Khớp dài nhất thắng: /sales/orders/new không làm sáng cả "Đơn hộ" (/sales/orders).
  const current = all.filter((i) => path === i.href || path.startsWith(`${i.href}/`)).sort((a, b) => b.href.length - a.href.length)[0]?.href ?? null;
  useEffect(() => setMenu(false), [path]);
  useEffect(() => {
    if (!menu) return;
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setMenu(false); };
    document.addEventListener('keydown', esc);
    return () => document.removeEventListener('keydown', esc);
  }, [menu]);
  return (
    <>
      <button type="button" className="nav-burger" aria-label="Mở menu" aria-expanded={menu} onClick={() => setMenu(true)}><Icon name="menu" /></button>
      <div className="navlinks">
        {entries.map((e) => (isGroup(e) ? <NavDropdown key={e.label} group={e} current={current} /> : <NavLink key={e.href} it={e} current={current} />))}
      </div>
      <div className={menu ? 'nav-open' : undefined} style={{ display: 'contents' }}>
        <div className="nav-overlay" onClick={() => setMenu(false)} />
        <aside className="nav-drawer" aria-label="Menu" aria-hidden={!menu}>
          <div className="nav-drawer-head"><Link href="/" className="brand">Ecom</Link></div>
          <div className="nav-drawer-nav">
            {entries.map((e) => (isGroup(e)
              ? [<div key={e.label} className="nav-lbl">{e.label}</div>, ...e.items.map((i) => <NavLink key={i.href} it={i} current={current} />)]
              : <NavLink key={e.href} it={e} current={current} />))}
          </div>
        </aside>
      </div>
    </>
  );
}

/**
 * Đầu trang. Khách và customer: kiểu sàn TMĐT (ô tìm kiếm, giỏ, chuông, dải danh mục; guest có Đăng nhập, Đăng ký; đơn hàng, thanh toán, đánh giá nằm trong menu tài khoản).
 * Staff và admin: menu quản trị gom nhóm (staff: "Đơn hàng", "Tồn kho", "Vận đơn", "Thanh toán", "Hoàn tiền", "Sản phẩm"; admin thêm "Bán hộ", "Cấu hình", "Phân tích").
 */
export function HeaderLinks() {
  const { status, user } = useAuth();
  const staff = status === 'ready' && (user?.role === 'staff' || user?.role === 'admin');
  const admin = status === 'ready' && user?.role === 'admin';
  const sale = status === 'ready' && user?.role === 'sale';
  if (sale || staff) {
    return (
      <>
        <AdminNav entries={sale ? SALE : admin ? ADMIN : STAFF} />
        <NotificationBell />
      </>
    );
  }
  return (
    <>
      <HeaderSearch />
      {status === 'ready' && user?.role === 'customer' && <><CartBadge /><NotificationBell /></>}
      {status === 'ready' && !user && (
        <div className="authlinks"><Link className="btn" href="/login">Đăng nhập</Link><Link className="btn btn-primary tight" href="/register">Đăng ký</Link></div>
      )}
      <CategoryStrip />
    </>
  );
}
