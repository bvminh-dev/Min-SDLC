// Sinh app/icons.css: icon nét (24x24, kiểu Lucide) gắn bằng CSS mask vào link, nút, tiêu đề, banner... theo href, route và data-testid,
// nên không phải sửa từng màn. Thêm icon: bổ sung vào ICONS rồi vào RULES, chạy `node scripts/gen-icons.mjs`.
import { writeFileSync } from 'node:fs';

const c = (x, y, r) => `<circle cx="${x}" cy="${y}" r="${r}"/>`;
const ICONS = {
  tag: 'M20.6 13.4l-7.2 7.2a2 2 0 0 1-2.8 0L2 12V2h10l8.6 8.6a2 2 0 0 1 0 2.8zM7 7h.01',
  cart: `${c(9, 20, 1)}${c(18, 20, 1)}<path d="M2 3h3l2.7 12.4a2 2 0 0 0 2 1.6h7.7a2 2 0 0 0 2-1.5L21 7H6"/>`,
  receipt: 'M9 3h6a1 1 0 0 1 1 1v1H8V4a1 1 0 0 1 1-1zM8 5H6a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2M9 12h6M9 16h4',
  layers: 'M12 3l9 5-9 5-9-5 9-5zM3 13l9 5 9-5M3 17l9 5 9-5',
  truck: `<path d="M2 5h11v11H2zM13 9h5l4 4v3h-9"/>${c(7, 19, 2)}${c(18, 19, 2)}`,
  card: '<rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20"/>',
  star: 'M12 2l3.1 6.3 6.9 1-5 4.9 1.2 6.8L12 17.8 5.8 21l1.2-6.8-5-4.9 6.9-1z',
  undo: 'M3 12a9 9 0 1 0 3-6.7M3 4v5h5',
  dash: '<rect x="3" y="3" width="7" height="9"/><rect x="14" y="3" width="7" height="5"/><rect x="14" y="12" width="7" height="9"/><rect x="3" y="16" width="7" height="5"/>',
  nav: 'M3 11l19-9-9 19-2-8-8-2z',
  ticket: 'M2 9a3 3 0 0 1 0 6v2a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-2a3 3 0 0 1 0-6V7a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2zM13 5v2M13 17v2M13 11v2',
  message: 'M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z',
  login: 'M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4M10 17l5-5-5-5M15 12H3',
  logout: 'M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9',
  userplus: `${c(9, 8, 4)}<path d="M2 21a7 7 0 0 1 14 0M19 8v6M16 11h6"/>`,
  user: `${c(12, 8, 4)}<path d="M4 21a8 8 0 0 1 16 0"/>`,
  users: `${c(9, 8, 4)}<path d="M2 21a7 7 0 0 1 14 0M17 4a4 4 0 0 1 0 8M22 21a7 7 0 0 0-4-6.3"/>`,
  pin: `<path d="M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 0 1 16 0z"/>${c(12, 10, 3)}`,
  folder: 'M3 6a2 2 0 0 1 2-2h4l2 3h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z',
  bell: 'M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10.3 21a1.9 1.9 0 0 0 3.4 0',
  mail: '<rect x="2" y="4" width="20" height="16" rx="2"/><path d="M2 7l10 6 10-6"/>',
  shield: 'M12 3L4 6v6c0 5 3.4 8.4 8 9 4.6-.6 8-4 8-9V6zM9 12l2 2 4-4',
  search: `${c(11, 11, 7)}<path d="M21 21l-4.3-4.3"/>`,
  plus: 'M12 5v14M5 12h14',
  minus: 'M5 12h14',
  x: 'M18 6L6 18M6 6l12 12',
  check: 'M20 6L9 17l-5-5',
  trash: 'M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6M10 11v6M14 11v6',
  pencil: 'M17 3l4 4L8 20H4v-4z',
  left: 'M19 12H5M12 19l-7-7 7-7',
  right: 'M5 12h14M12 5l7 7-7 7',
  refresh: 'M21 12a9 9 0 1 1-3-6.7M21 3v5h-5',
  filter: 'M3 4h18l-7 9v6l-4 2v-8z',
  upload: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12',
  alert: 'M10.3 3.9L1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0zM12 9v4M12 17h.01',
  okc: `${c(12, 12, 10)}<path d="M8 12l3 3 5-6"/>`,
  xc: `${c(12, 12, 10)}<path d="M15 9l-6 6M9 9l6 6"/>`,
  info: `${c(12, 12, 10)}<path d="M12 16v-4M12 8h.01"/>`,
  inbox: 'M22 12h-6l-2 3h-4l-2-3H2M5.5 5.1L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.5-6.9A2 2 0 0 0 16.7 4H7.3a2 2 0 0 0-1.8 1.1z',
  chart: 'M3 3v18h18M8 17V9M13 17V5M18 17v-6',
  trend: 'M22 7l-8.5 8.5-5-5L2 17M16 7h6v6',
  clock: `${c(12, 12, 10)}<path d="M12 6v6l4 2"/>`,
  key: `${c(8, 15, 4)}<path d="M10.8 12.2L21 2M16 7l3 3"/>`,
  box: 'M21 8l-9-5-9 5v8l9 5 9-5V8zM3 8l9 5 9-5M12 13v8',
  calendar: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
  percent: 'M19 5L5 19M7 7h.01M17 17h.01',
  phone: 'M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 1.9.7 2.8a2 2 0 0 1-.5 2.1L8.1 9.9a16 16 0 0 0 6 6l1.3-1.2a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.8.7a2 2 0 0 1 1.7 2z',
  image: '<rect x="3" y="3" width="18" height="18" rx="2"/>' + c(9, 9, 2) + '<path d="M21 15l-5-5L5 21"/>',
  ban: c(12, 12, 10) + '<path d="M4.9 4.9l14.2 14.2"/>',
  archive: '<rect x="2" y="3" width="20" height="5" rx="1"/><path d="M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8M10 12h4"/>',
  eye: '<path d="M2 12s4-8 10-8 10 8 10 8-4 8-10 8S2 12 2 12z"/>' + c(12, 12, 3),
  eyeoff: 'M17.9 17.9A10 10 0 0 1 12 20C6 20 2 12 2 12a18 18 0 0 1 5.1-5.9M9.9 4.2A9 9 0 0 1 12 4c6 0 10 8 10 8a18 18 0 0 1-2.2 3.2M1 1l22 22',
  download: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3',
  list: 'M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01',
  sliders: 'M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6',
  dots: c(5, 12, 1) + c(12, 12, 1) + c(19, 12, 1),
  help: c(12, 12, 10) + '<path d="M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3M12 17h.01"/>',
  heart: 'M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 0 0-7.8 7.8l1 1.1L12 21l7.8-7.5 1-1.1a5.5 5.5 0 0 0 0-7.8z',
  send: 'M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z',
  copy: '<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
  link: 'M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7',
  gift: '<rect x="3" y="8" width="18" height="4" rx="1"/><path d="M12 8v13M19 12v7a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-7M7.5 8a2.5 2.5 0 0 1 0-5C11 3 12 8 12 8s1-5 4.5-5a2.5 2.5 0 0 1 0 5"/>',
  down: 'M6 9l6 6 6-6',
  menu: 'M4 6h16M4 12h16M4 18h16',
  pie: '<path d="M21 12c.552 0 1.005-.449.95-.998a10 10 0 0 0-8.953-8.951c-.55-.055-.998.398-.998.95v8a1 1 0 0 0 1 1z"/><path d="M21.21 15.89A10 10 0 1 1 8 2.83"/>',
  fileplus: '<path d="M4 22h14a2 2 0 0 0 2-2V7l-5-5H6a2 2 0 0 0-2 2v4"/><path d="M14 2v4a2 2 0 0 0 2 2h4M3 15h6M6 12v6"/>',
  megaphone: '<path d="M3 11l18-5v12L3 14v-3z"/><path d="M11.6 16.8a3 3 0 1 1-5.8-1.6"/>',
  cash: '<rect x="2" y="6" width="20" height="12" rx="2"/>' + c(12, 12, 2) + '<path d="M6 12h.01M18 12h.01"/>',
  bank: 'M3 21h18M5 21V10M9 21V10M15 21V10M19 21V10M12 3l9 5H3z',
  bag: 'M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4zM3 6h18M16 10a4 4 0 0 1-8 0',
};
const svg = (b) => `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='black' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'>${b.startsWith('<') ? b : `<path d='${b}'/>`}</svg>`.replace(/"/g, "'");
const url = (b) => `url("data:image/svg+xml,${svg(b).replace(/[<>#%]/g, (ch) => encodeURIComponent(ch))}")`;

const BTN = ':is(.btn,.btn-link,button):not(.rev-thumb-x):not(.chip-x):not(.avatar):not(.ntf-trigger)';
const tid = (suffix) => `${BTN}[data-testid$='-${suffix}']`;
const h1 = (route, prefix) => `html[data-page${prefix ? '^' : ''}='${route}'] :is(main,.editbar) h1`;
const RULES = [
  // Thanh đầu trang: liên kết quản trị dùng .i trong HeaderLinks.tsx; chỉ còn giỏ và chuông.
  ['.topbar .cart-badge', 'cart'], ['.ntf-trigger', 'bell'],
  // Menu tài khoản
  ['.popover a[href="/account/profile"]', 'user'], ['.popover a[href="/account/addresses"]', 'pin'], ['.popover a[href="/admin/customers"]', 'users'], ['.popover a[href="/admin/products"]', 'tag'],
  ['.popover a[href="/admin/categories"]', 'folder'], ['.popover a.chip', 'shield'], ["[data-testid='auth-account-menu-logout']", 'logout'],
  // Tiêu đề trang theo route (html[data-page] do PageMark đặt)
  [h1('/products'), 'tag'], [h1('/cart'), 'cart'], [h1('/checkout', 1), 'bag'], [h1('/orders'), 'receipt'], [h1('/admin/orders'), 'receipt'], [h1('/sales/orders/new'), 'fileplus'], [h1('/sales/orders'), 'receipt'], [h1('/payments'), 'card'], [h1('/admin/payments', 1), 'card'],
  [h1('/me/reviews', 1), 'star'], [h1('/admin/reviews'), 'message'], [h1('/notifications'), 'bell'], [h1('/account/profile'), 'user'], [h1('/account/addresses'), 'pin'], [h1('/account/password'), 'key'],
  [h1('/login'), 'login'], [h1('/register'), 'userplus'], [h1('/forgot-password'), 'mail'], [h1('/reset-password'), 'key'], [h1('/verify-email'), 'shield'],
  [h1('/admin/dashboard'), 'dash'], [h1('/admin/products'), 'tag'], [h1('/admin/categories'), 'folder'], [h1('/admin/inventory', 1), 'layers'], [h1('/admin/shipments', 1), 'truck'],
  [h1('/admin/shipping-methods'), 'nav'], [h1('/admin/refunds'), 'undo'], [h1('/admin/coupons', 1), 'ticket'], [h1('/admin/users'), 'users'], [h1('/admin/customers', 1), 'users'], [h1('/admin/reports', 1), 'chart'],
  // Nút theo hậu tố data-testid
  [tid('retry'), 'refresh'], [tid('reload'), 'refresh'], [tid('restart'), 'refresh'], [tid('cancel'), 'x'], [tid('delete'), 'trash'], [tid('remove'), 'trash'], [tid('search'), 'search'],
  [tid('apply'), 'check'], [tid('save'), 'check'], [tid('confirm'), 'check'], [tid('edit'), 'pencil'], [tid('back'), 'left'], [tid('continue'), 'right'], [tid('upload'), 'upload'],
  [tid('add'), 'plus'], [tid('create'), 'plus'], [tid('new'), 'plus'], [tid('increase'), 'plus'], [tid('decrease'), 'minus'], [tid('pay-button'), 'card'], [tid('pay-link'), 'card'],
  [tid('refund'), 'undo'], [tid('add-to-cart'), 'cart'], ["[data-testid='auth-login-submit']", 'login'], ["[data-testid='auth-register-submit']", 'userplus'],
  // Banner, toast, trạng thái, số liệu
  ['.banner-error', 'alert'], ['.banner-ok', 'okc'], ['.banner-info', 'info'], ['.toast', 'okc'], ['.toast-error', 'alert'], ['.stock-in', 'okc'], ['.stock-out', 'xc'], ["p[data-testid$='-empty']", 'inbox'],
  ['.dsh-kpi:nth-child(1) h2', 'trend'], ['.dsh-kpi:nth-child(2) h2', 'receipt'], ['.dsh-kpi:nth-child(3) h2', 'users'], ['.dsh-kpi:nth-child(4) h2', 'tag'],
  ['.dsh-widget:nth-child(1) h2', 'clock'], ['.dsh-widget:nth-child(2) h2', 'alert'], ['.notfound .big', 'info'],
];
const used = Object.keys(ICONS); // mọi icon đều dùng được qua class `.i .i-<tên>` trong TSX
const ruled = [...new Set(RULES.map((r) => r[1]))];
const missing = ruled.filter((n) => !ICONS[n]);
if (missing.length) throw new Error(`thiếu icon: ${missing}`);
const css = [
  '/* Sinh bởi scripts/gen-icons.mjs, đừng sửa tay. */',
  `:root { ${used.map((n) => `--i-${n}: ${url(ICONS[n])};`).join(' ')} }`,
  `:is(${RULES.map((r) => r[0]).join(',\n  ')})::before { content: ''; display: inline-block; flex: none; width: 1.1em; height: 1.1em; margin-right: .4em; vertical-align: -.2em; background: currentColor; -webkit-mask: var(--ic) center / contain no-repeat; mask: var(--ic) center / contain no-repeat; }`,
  ...RULES.map(([s, n]) => `${s}::before { --ic: var(--i-${n}); }`),
  // Dùng trong TSX: <span className="i i-tag" aria-hidden="true" />; đặt trong .tile để có ô icon màu.
  '.i { display: inline-block; flex: none; width: 1.1em; height: 1.1em; vertical-align: -.2em; background: currentColor; -webkit-mask: var(--ic) center / contain no-repeat; mask: var(--ic) center / contain no-repeat; }',
  ...used.map((n) => `.i-${n} { --ic: var(--i-${n}); }`),
  // Icon tiêu đề dùng màu nhấn; icon số liệu theo màu từng ô; "404" lớn thì icon to, đứng riêng một dòng.
  ':is(main,.editbar) h1::before { color: var(--brand); width: 1.15em; height: 1.15em; margin-right: .5rem; }',
  '.dsh-kpi:nth-child(1) h2::before { color: var(--brand); } .dsh-kpi:nth-child(2) h2::before { color: var(--ok); } .dsh-kpi:nth-child(3) h2::before { color: #f79009; } .dsh-kpi:nth-child(4) h2::before { color: var(--violet); }',
  '.notfound .big::before { display: block; width: 3rem; height: 3rem; margin: 0 auto .5rem; }',
  '.navlinks .cart-badge::before, .ntf-trigger::before { margin-right: .35rem; }',
  '',
].join('\n');
writeFileSync(new URL('../app/icons.css', import.meta.url), css);
console.log(`icons.css: ${used.length} icon, ${RULES.length} luật`);
