import type { EventEnvelope } from '../platform';
import {
  FAIL_REASONS, GREETING_NAME_MAX, MAX_RECIPIENTS, ORDER_CODE_RE, PRODUCT_NAME_MAX, TOKEN_RE, TRACKING_RE,
  type EmailType, type NotificationType,
} from './config';
import { isUuid } from './db';

// Nội dung thông báo và email chỉ sinh từ MẪU CỐ ĐỊNH (SB-34, NTF-REQ-20261006-103208460 BR5, BR6): chỉ chèn các trường whitelist đã kiểm dạng (số tiền số nguyên, mã đơn 12 ký tự chữ hoa và số,
// mã vận đơn, số lần thử, 8 ký tự đầu của uuid, tên sản phẩm đã làm sạch); văn bản tự do (lý do hủy, lý do khóa của admin, ghi chú giao thất bại, thông điệp của cổng) không bao giờ vào nội dung.
// Đường dẫn `link` chỉ chọn từ danh sách cố định của mẫu, không bao giờ lấy từ event (T15).

export type FailReason = (typeof FAIL_REASONS)[number];
export type Json = Record<string, unknown>;

/** Các trường đã kiểm mà mẫu dùng. Vừa là đầu vào dựng thông báo, vừa là dạng đọc lại từ `email_deliveries.data` (whitelist) khi dựng thư. */
export interface Fields {
  order_code?: string; amount?: number; payment_expires_at?: string; tracking_number?: string; reason?: FailReason;
  attempt_no?: number; final?: boolean; was_paid?: boolean; changed_at?: string;
  product_name?: string; available?: number; threshold?: number; ref8?: string; lock_reason?: 'too_many_attempts' | 'admin';
}
export interface Content { title: string; body: string; link: string | null }

const isMoney = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;
const isCount = isMoney;
const isIso = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(v) && !Number.isNaN(Date.parse(v));
// eslint-disable-next-line no-control-regex
const CONTROL_G = /[\u0000-\u001F\u007F-\u009F\u2028\u2029]+/g;
/** Nửa cặp thay thế lẻ (UTF-16 không hợp lệ): driver ghi thành U+FFFD hay lỗi tùy phiên bản, nên bỏ hẳn trước khi vào câu SQL hay thân thư. */
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;
const cut = (s: string, max: number): string => [...s].slice(0, max).join('');
/** Bỏ ký tự điều khiển và xuống dòng (đổi thành một khoảng trắng), gộp khoảng trắng, cắt theo ký tự Unicode. */
export const cleanText = (s: string, max: number): string => cut(s.replace(LONE_SURROGATE, '').replace(CONTROL_G, ' ').replace(/\s+/g, ' ').trim(), max);

/** `350000` thành `350.000 đ` (vi-VN, dấu chấm ngăn nghìn, không ký hiệu khoa học; số nguyên không âm an toàn). */
export const formatVnd = (n: number): string => `${String(n).replace(/\B(?=(\d{3})+(?!\d))/g, '.')} đ`;
const pad = (n: number): string => String(n).padStart(2, '0');
/** `dd/MM/yyyy HH:mm` theo giờ Việt Nam (UTC+7, không có giờ mùa hè). */
export const formatVn = (iso: string): string => {
  const d = new Date(Date.parse(iso) + 7 * 3600_000);
  return `${pad(d.getUTCDate())}/${pad(d.getUTCMonth() + 1)}/${d.getUTCFullYear()} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
};

const orderLink = (f: Fields): string => (f.order_code ? `/orders/${f.order_code}` : '/orders');
const FAIL_SENTENCE: Record<FailReason, string> = {
  customer_unreachable: 'Chưa liên lạc được với bạn.',
  refused: 'Đơn hàng đã bị từ chối nhận.',
  wrong_address: 'Địa chỉ giao hàng chưa chính xác.',
  damaged: 'Hàng bị hư hại trong lúc vận chuyển.',
  other: 'Vui lòng liên hệ cửa hàng để biết thêm.',
};
export const LOCK_SENTENCE = {
  too_many_attempts: 'Tài khoản của bạn bị tạm khóa do đăng nhập sai nhiều lần và sẽ tự mở lại sau một thời gian ngắn. Nếu không phải bạn, hãy đổi mật khẩu sau khi tài khoản mở lại.',
  admin: 'Tài khoản của bạn đã bị quản trị viên khóa. Vui lòng liên hệ cửa hàng để biết thêm.',
} as const;

/** Tiêu đề, nội dung, liên kết của một loại thông báo (NTF-REQ-20261006-103208641 đến -103209168). `amount` thiếu thì dùng 0 (chỉ xảy ra khi dữ liệu email hỏng, đã kiểm lại ở `fieldsFromData`). */
export function notificationContent(type: NotificationType | 'account_locked', f: Fields): Content {
  const code = f.order_code;
  switch (type) {
    case 'order_created': {
      const head = code ? `Đơn #${code} đã được tạo.` : 'Đơn hàng của bạn đã được tạo.';
      const pay = f.payment_expires_at ? ` Vui lòng thanh toán trước ${formatVn(f.payment_expires_at)} (giờ Việt Nam).` : '';
      return { title: 'Đã nhận đơn hàng', body: `${head} Tổng tiền ${formatVnd(f.amount ?? 0)}.${pay}`, link: orderLink(f) };
    }
    case 'order_confirmed':
      return { title: 'Đơn hàng đã được xác nhận', body: 'Đơn hàng của bạn đã được xác nhận và sẽ sớm được chuẩn bị giao.', link: orderLink(f) };
    case 'payment_succeeded':
      return { title: 'Thanh toán thành công', body: code ? `Chúng tôi đã nhận ${formatVnd(f.amount ?? 0)} cho đơn #${code}.` : `Chúng tôi đã nhận ${formatVnd(f.amount ?? 0)} cho đơn hàng của bạn.`, link: orderLink(f) };
    case 'payment_failed': {
      const lan = f.attempt_no !== undefined ? ` lần ${f.attempt_no}` : '';
      const tail = f.final ? ' và đã hết lượt thử. Đơn hàng sẽ bị hủy.' : '. Bạn có thể thử lại từ trang đơn hàng.';
      return { title: 'Thanh toán chưa thành công', body: `Thanh toán${lan} chưa thành công${tail}`, link: orderLink(f) };
    }
    case 'order_cancelled':
      return { title: 'Đơn hàng đã bị hủy', body: `Đơn hàng của bạn đã bị hủy.${f.was_paid === true ? ' Số tiền đã thanh toán sẽ được hoàn lại.' : ''}`, link: orderLink(f) };
    case 'refund_succeeded':
      return { title: 'Hoàn tiền thành công', body: `Chúng tôi đã hoàn ${formatVnd(f.amount ?? 0)} cho bạn.`, link: orderLink(f) };
    case 'order_shipped':
      return { title: 'Đơn hàng đang được giao', body: `Đơn hàng của bạn đã được bàn giao cho đơn vị vận chuyển.${f.tracking_number ? ` Mã vận đơn: ${f.tracking_number}.` : ''}`, link: orderLink(f) };
    case 'shipment_failed':
      return { title: 'Giao hàng chưa thành công', body: `Đơn vị vận chuyển chưa giao được đơn hàng của bạn. ${FAIL_SENTENCE[f.reason ?? 'other']}`, link: orderLink(f) };
    case 'order_delivered':
      return { title: 'Đơn hàng đã được giao', body: 'Đơn hàng của bạn đã được giao thành công. Cảm ơn bạn đã mua sắm.', link: orderLink(f) };
    case 'order_returned':
      return { title: 'Đơn hàng đã hoàn về', body: 'Đơn hàng của bạn đã được hoàn về cửa hàng.', link: orderLink(f) };
    case 'order_expired':
      return {
        title: 'Đơn hàng đã hết hạn thanh toán',
        body: code ? `Đơn #${code} đã quá hạn thanh toán nên không còn hiệu lực. Bạn có thể đặt lại đơn mới.` : 'Đơn hàng của bạn đã quá hạn thanh toán nên không còn hiệu lực. Bạn có thể đặt lại đơn mới.',
        link: orderLink(f),
      };
    case 'welcome':
      return { title: 'Chào mừng bạn đến với cửa hàng', body: 'Tài khoản của bạn đã được tạo. Hãy xác minh email để có thể đặt hàng.', link: null };
    case 'password_changed':
      return {
        title: 'Mật khẩu đã được thay đổi',
        body: `Mật khẩu tài khoản của bạn vừa được đổi lúc ${formatVn(f.changed_at ?? new Date(0).toISOString())} (giờ Việt Nam). Nếu không phải bạn, hãy đặt lại mật khẩu ngay.`,
        link: '/forgot-password',
      };
    case 'low_stock':
      return { title: 'Sản phẩm sắp hết hàng', body: `Sản phẩm ${f.product_name ?? ''} có tồn kho thấp: còn ${f.available ?? 0}, ngưỡng cảnh báo ${f.threshold ?? 0}.`, link: '/admin/inventory' };
    case 'refund_failed':
      return { title: 'Hoàn tiền thất bại', body: code ? `Hoàn tiền của đơn #${code} bị lỗi và cần xử lý thủ công.` : `Hoàn tiền ${f.ref8 ?? ''} bị lỗi và cần xử lý thủ công.`, link: null };
    case 'account_locked':
      return { title: 'Tài khoản của bạn đã bị khóa', body: LOCK_SENTENCE[f.lock_reason ?? 'admin'], link: null };
  }
}

// --- Kế hoạch xử lý một event: đã kiểm dạng, chưa chạm CSDL hay AUTH ---

export interface NotifSpec { type: NotificationType; title: string; body: string; link: string | null; data: Json; dedupeKey: string }
export interface EmailSpec { type: EmailType; data: Json; dedupeKey: string }
export interface Plan {
  audience: { kind: 'owner'; userId: string } | { kind: 'roles'; roles: ('staff' | 'admin')[] };
  notification?: NotifSpec;
  email?: EmailSpec;
  /** Mã cảnh báo (không chứa giá trị) để ghi log mức warn khi xử lý (ví dụ trường tùy chọn sai dạng). */
  notes: string[];
}
export type Planned = { ok: true; plan: Plan } | { ok: false; refs: Record<string, string | null>; skip?: true }; // `skip`: đơn hộ không có user_id, bỏ qua êm không phải lỗi (events.md mục Đơn hộ)

/** Event đơn, thanh toán, vận đơn gửi cho chủ đơn: `user_id` rỗng (null, như ORD phát) là đơn hộ của khách không tài khoản; khóa vắng hẳn vẫn là event hỏng (NTF-TC-20261006-104224870). */
const OWNER_ORDER_EVENTS = new Set(['OrderCreated', 'OrderConfirmed', 'PaymentSucceeded', 'PaymentFailed', 'OrderCancelled', 'OrderExpired', 'RefundSucceeded', 'OrderShipped', 'ShipmentFailed', 'OrderDelivered', 'OrderReturned']);

const ref = (v: unknown): string | null => (isUuid(v) ? v.toLowerCase() : null);

interface Ctx { now: Date; notes: string[] }
const codeOf = (p: Json, c: Ctx): string | undefined => {
  const v = p.order_code;
  if (typeof v === 'string' && ORDER_CODE_RE.test(v)) return v;
  c.notes.push('order-code-invalid'); // thiếu hoặc sai dạng: bỏ mã, liên kết chung (BR5); không ghi giá trị
  return undefined;
};
const trackingOf = (p: Json, c: Ctx): string | undefined => {
  const v = p.tracking_number;
  if (typeof v === 'string' && TRACKING_RE.test(v)) return v;
  c.notes.push('tracking-number-invalid');
  return undefined;
};

/**
 * Event -> kế hoạch (loại, nội dung, dữ liệu email whitelist, khóa chống trùng, người nhận). Hàm thuần: không CSDL, không AUTH, không log; `ok: false` là event không hợp lệ (bên gọi ghi log mức
 * error với `refs` chỉ gồm mã uuid hợp lệ, coi như đã xử lý). Người nhận chủ đơn là `user_id` của payload (không bảng chiếu, K-08); cảnh báo nội bộ theo role (BR3).
 */
export function planEvent(env: EventEnvelope, now: Date): Planned {
  const p = env.payload ?? {};
  const c: Ctx = { now, notes: [] };
  const eid = env.event_id;
  const refs = (extra: Json = {}): Planned => ({ ok: false, refs: { order_id: ref(p.order_id), payment_id: ref(p.payment_id), refund_id: ref(p.refund_id), product_id: ref(p.product_id), ...Object.fromEntries(Object.entries(extra).map(([k, v]) => [k, ref(v)])) } });
  if (OWNER_ORDER_EVENTS.has(env.type) && (p.user_id === null || p.user_id === '')) return { ok: false, refs: {}, skip: true };
  const owner = (): string | null => ref(p.user_id);
  const orderId = (): string | null => ref(p.order_id);
  const done = (plan: Omit<Plan, 'notes'>): Planned => ({ ok: true, plan: { ...plan, notes: c.notes } });
  const key = (t: string): string => `${t}:${eid}`;

  switch (env.type) {
    case 'OrderCreated': {
      const user = owner(), oid = orderId();
      if (!user || !oid || !isMoney(p.grand_total)) return refs();
      const f: Fields = { order_code: codeOf(p, c), amount: p.grand_total };
      if (p.payment_method === 'vnpay') {
        if (isIso(p.payment_expires_at) && Date.parse(p.payment_expires_at) > now.getTime()) f.payment_expires_at = new Date(p.payment_expires_at).toISOString();
        else c.notes.push('payment-expiry-invalid');
      } else if (p.payment_method !== 'cod') c.notes.push('payment-method-invalid');
      const n = notificationContent('order_created', f);
      return done({
        audience: { kind: 'owner', userId: user },
        notification: { type: 'order_created', ...n, data: { order_id: oid }, dedupeKey: key('order_created') },
        email: { type: 'order_created', data: emailData(f), dedupeKey: key('order_created') },
      });
    }
    case 'OrderConfirmed': {
      const user = owner(), oid = orderId();
      if (!user || !oid) return refs();
      return done({ audience: { kind: 'owner', userId: user }, notification: { type: 'order_confirmed', ...notificationContent('order_confirmed', { order_code: codeOf(p, c) }), data: { order_id: oid }, dedupeKey: key('order_confirmed') } });
    }
    case 'PaymentSucceeded': {
      const user = owner(), oid = orderId(), pid = ref(p.payment_id);
      if (!user || !oid || !pid || !isMoney(p.amount) || p.amount <= 0) return refs();
      const f: Fields = { order_code: codeOf(p, c), amount: p.amount };
      const k = `payment_succeeded:${pid}`; // khóa tự nhiên: hai event khác event_id cho cùng một thanh toán chỉ một thông báo (BR5)
      return done({
        audience: { kind: 'owner', userId: user },
        notification: { type: 'payment_succeeded', ...notificationContent('payment_succeeded', f), data: { order_id: oid }, dedupeKey: k },
        email: { type: 'payment_succeeded', data: emailData(f), dedupeKey: k },
      });
    }
    case 'PaymentFailed': {
      const user = owner(), oid = orderId();
      if (!user || !oid) return refs();
      const f: Fields = { order_code: codeOf(p, c) };
      if (typeof p.attempt_no === 'number' && Number.isSafeInteger(p.attempt_no) && p.attempt_no >= 1) f.attempt_no = p.attempt_no;
      if (p.is_final === true) f.final = true;
      else if (p.is_final !== false) c.notes.push('is-final-invalid'); // thiếu hoặc không phải boolean: coi là chưa cuối (K-03); NTF không tự so attempt_no với PAY_MAX_ATTEMPTS
      return done({ audience: { kind: 'owner', userId: user }, notification: { type: 'payment_failed', ...notificationContent('payment_failed', f), data: { order_id: oid }, dedupeKey: key('payment_failed') } });
    }
    case 'OrderCancelled': {
      const user = owner(), oid = orderId();
      if (!user || !oid) return refs();
      const f: Fields = { order_code: codeOf(p, c) };
      if (p.was_paid === true) f.was_paid = true;
      else if (p.was_paid !== false) c.notes.push('was-paid-invalid');
      return done({
        audience: { kind: 'owner', userId: user },
        notification: { type: 'order_cancelled', ...notificationContent('order_cancelled', f), data: { order_id: oid }, dedupeKey: key('order_cancelled') },
        email: { type: 'order_cancelled', data: emailData(f), dedupeKey: key('order_cancelled') },
      });
    }
    case 'OrderExpired': {
      const user = owner(), oid = orderId();
      if (!user || !oid) return refs();
      return done({ audience: { kind: 'owner', userId: user }, notification: { type: 'order_expired', ...notificationContent('order_expired', { order_code: codeOf(p, c) }), data: { order_id: oid }, dedupeKey: key('order_expired') } });
    }
    case 'RefundSucceeded': {
      const user = owner(), oid = orderId(), rid = ref(p.refund_id);
      if (!user || !oid || !rid || !isMoney(p.amount) || p.amount <= 0) return refs();
      const f: Fields = { order_code: codeOf(p, c), amount: p.amount };
      const k = `refund_succeeded:${rid}`;
      return done({
        audience: { kind: 'owner', userId: user },
        notification: { type: 'refund_succeeded', ...notificationContent('refund_succeeded', f), data: { order_id: oid }, dedupeKey: k },
        email: { type: 'refund_succeeded', data: emailData(f), dedupeKey: k },
      });
    }
    case 'OrderShipped': {
      const user = owner(), oid = orderId();
      if (!user || !oid) return refs();
      const f: Fields = { order_code: codeOf(p, c), tracking_number: trackingOf(p, c) };
      return done({
        audience: { kind: 'owner', userId: user },
        notification: { type: 'order_shipped', ...notificationContent('order_shipped', f), data: { order_id: oid }, dedupeKey: key('order_shipped') },
        email: { type: 'order_shipped', data: emailData(f), dedupeKey: key('order_shipped') },
      });
    }
    case 'ShipmentFailed': {
      const user = owner(), oid = orderId();
      if (!user || !oid) return refs();
      const reason = (FAIL_REASONS as readonly unknown[]).includes(p.reason) ? (p.reason as FailReason) : 'other'; // văn bản tự do và giá trị lạ không bao giờ vào nội dung (BR4)
      const f: Fields = { order_code: codeOf(p, c), reason };
      return done({
        audience: { kind: 'owner', userId: user },
        notification: { type: 'shipment_failed', ...notificationContent('shipment_failed', f), data: { order_id: oid }, dedupeKey: key('shipment_failed') },
        email: { type: 'shipment_failed', data: emailData(f), dedupeKey: key('shipment_failed') },
      });
    }
    case 'OrderDelivered':
    case 'OrderReturned': {
      const user = owner(), oid = orderId();
      if (!user || !oid) return refs();
      const type = env.type === 'OrderDelivered' ? 'order_delivered' : 'order_returned';
      const f: Fields = { order_code: codeOf(p, c) };
      return done({
        audience: { kind: 'owner', userId: user },
        notification: { type, ...notificationContent(type, f), data: { order_id: oid }, dedupeKey: key(type) },
        email: { type, data: emailData(f), dedupeKey: key(type) },
      });
    }
    case 'UserRegistered': {
      const user = owner();
      if (!user) return refs();
      // `email` trong payload bị bỏ qua: không dùng, không lưu, không log (T9); địa chỉ luôn hỏi AUTH lúc gửi.
      return done({ audience: { kind: 'owner', userId: user }, notification: { type: 'welcome', ...notificationContent('welcome', {}), data: {}, dedupeKey: key('welcome') } });
    }
    case 'PasswordChanged': {
      const user = owner();
      if (!user) return refs();
      const changed = isIso(p.changed_at) ? new Date(p.changed_at).toISOString() : env.occurred_at; // thiếu hoặc sai dạng: dùng lúc phát event (phong bì do platform ghi)
      if (!isIso(p.changed_at)) c.notes.push('changed-at-invalid');
      const f: Fields = { changed_at: changed };
      return done({
        audience: { kind: 'owner', userId: user },
        notification: { type: 'password_changed', ...notificationContent('password_changed', f), data: {}, dedupeKey: key('password_changed') },
        email: { type: 'password_changed', data: emailData(f), dedupeKey: key('password_changed') },
      });
    }
    case 'UserLocked': {
      const user = owner();
      if (!user) return refs();
      const lock_reason = p.reason === 'too_many_attempts' ? 'too_many_attempts' : 'admin'; // lý do tự do của admin không có trong event và không bao giờ vào email (BR7)
      return done({ audience: { kind: 'owner', userId: user }, email: { type: 'account_locked', data: { reason: lock_reason }, dedupeKey: key('account_locked') } });
    }
    case 'LowStockDetected': {
      const pid = ref(p.product_id);
      if (!pid || !isCount(p.on_hand) || !isCount(p.available) || !isCount(p.threshold)) return refs();
      const name = typeof p.product_name === 'string' ? cleanText(p.product_name, PRODUCT_NAME_MAX) : '';
      const f: Fields = { product_name: name || pid.slice(0, 8), available: p.available, threshold: p.threshold };
      return done({ audience: { kind: 'roles', roles: ['staff', 'admin'] }, notification: { type: 'low_stock', ...notificationContent('low_stock', f), data: { product_id: pid }, dedupeKey: key('low_stock') } });
    }
    case 'RefundFailed': {
      const rid = ref(p.refund_id);
      if (!rid) return refs();
      // `user_id` của payload là chủ đơn, KHÔNG phải người nhận; `reason`, `failure_reason` không bao giờ hiển thị (BR2)
      const f: Fields = { order_code: codeOf(p, c), ref8: rid.slice(0, 8) };
      return done({ audience: { kind: 'roles', roles: ['admin'] }, notification: { type: 'refund_failed', ...notificationContent('refund_failed', f), data: { refund_id: rid }, dedupeKey: key('refund_failed') } });
    }
    default:
      return { ok: false, refs: {} };
  }
}

/** Dữ liệu whitelist lưu ở `email_deliveries.data` (NTF-DB): chỉ các trường mẫu cần, không địa chỉ email, họ tên hay token. */
export function emailData(f: Fields): Json {
  const d: Json = {};
  if (f.order_code) d.order_code = f.order_code;
  if (f.amount !== undefined) d.amount = f.amount;
  if (f.payment_expires_at) d.payment_expires_at = f.payment_expires_at;
  if (f.tracking_number) d.tracking_number = f.tracking_number;
  if (f.reason) d.reason = f.reason;
  if (f.was_paid === true) d.was_paid = true;
  if (f.changed_at) d.changed_at = f.changed_at;
  return d;
}

/** Đọc lại và kiểm LẦN NỮA `data` của một bản ghi email trước khi dựng thư (phòng dữ liệu hỏng hay sửa tay): trường sai dạng bị bỏ, không bao giờ chèn chuỗi thô. */
export function fieldsFromData(type: EmailType, data: unknown): Fields {
  const d = (data && typeof data === 'object' ? data : {}) as Json;
  const f: Fields = {};
  if (typeof d.order_code === 'string' && ORDER_CODE_RE.test(d.order_code)) f.order_code = d.order_code;
  if (isMoney(d.amount)) f.amount = d.amount;
  if (isIso(d.payment_expires_at)) f.payment_expires_at = d.payment_expires_at;
  if (typeof d.tracking_number === 'string' && TRACKING_RE.test(d.tracking_number)) f.tracking_number = d.tracking_number;
  if ((FAIL_REASONS as readonly unknown[]).includes(d.reason)) f.reason = d.reason as FailReason;
  if (d.was_paid === true) f.was_paid = true;
  if (isIso(d.changed_at)) f.changed_at = d.changed_at;
  if (type === 'account_locked') f.lock_reason = d.reason === 'too_many_attempts' ? 'too_many_attempts' : 'admin';
  return f;
}

// --- Email chứa bí mật ---
export interface TokenPlan { type: 'email_verification' | 'password_reset'; userId: string; token: string; expiresAt: Date }
export type TokenPlanned = { ok: true; plan: TokenPlan } | { ok: false; level: 'warn' | 'error'; code: string; userId: string | null };

/**
 * PasswordResetRequested, EmailVerificationRequested (NTF-REQ-20261006-103209078 BR1 đến BR4): `token_ref` là token thô, chỉ ở bộ nhớ. Sai dạng, `expires_at` thiếu hoặc sai dạng thì không gửi (error);
 * đã hết hạn lúc xử lý (còn lại không lớn hơn 0 giây) thì không gửi (warn). Kết quả không bao giờ chứa token khi `ok: false`.
 */
export function planToken(env: EventEnvelope, now: Date): TokenPlanned {
  const p = env.payload ?? {};
  const type = env.type === 'PasswordResetRequested' ? 'password_reset' : 'email_verification';
  const userId = ref(p.user_id);
  if (!userId) return { ok: false, level: 'error', code: 'event-invalid', userId: null };
  if (typeof p.token_ref !== 'string' || !TOKEN_RE.test(p.token_ref)) return { ok: false, level: 'error', code: 'token-invalid', userId };
  if (!isIso(p.expires_at)) return { ok: false, level: 'error', code: 'expires-invalid', userId };
  const expiresAt = new Date(p.expires_at);
  if (expiresAt.getTime() <= now.getTime()) return { ok: false, level: 'warn', code: 'token-expired', userId };
  return { ok: true, plan: { type, userId, token: p.token_ref, expiresAt } };
}

export { GREETING_NAME_MAX, MAX_RECIPIENTS };
