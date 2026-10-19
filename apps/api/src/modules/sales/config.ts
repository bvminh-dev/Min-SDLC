import type { RateLimitOptions } from '../platform';

// Hằng số của SAL đã chốt ở spec (SAL-API mục Cấu hình: SAL không thêm biến môi trường; đổi phải chạy sdlc-impact).
export const SCOPE = 'sales.create_order'; // scope của IdempotencyKey: không phải action audit (SAL không ghi audit, ORD ghi `order.created_ho`)
export const ROUTE = '/api/v1/sales/orders';
export const IDEMPOTENCY_KEY_RE = /^[A-Za-z0-9_-]{8,64}$/;
export const ITEMS_MAX = 50; // khớp trần của InventoryApi.reserve
export const QTY_MAX = 100_000;
export const NOTE_MAX = 1000; // ghi chú đơn (ký tự Unicode)
export const ITEM_NOTE_MAX = 500; // ghi chú dòng hàng
export const TOTAL_MAX = 10_000_000_000; // trần miền `subtotal` của ShippingApi.quote
export const DEPENDENCY_TIMEOUT_MS = 2000; // hạn mỗi lời gọi module khác (SAL-API mục Kết nối)
export const LOOKUP_ITEMS_MAX = 5;
export const ORDER_STATUSES = ['pending', 'confirmed', 'paid', 'shipped', 'delivered', 'cancelled', 'expired', 'returned'] as const;
export const PAYMENT_METHODS = ['cod', 'cash', 'bank_transfer'] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

/**
 * Bảng bậc SB-14 cho SAL (SAL-API mục Endpoint, ADR-014): tạo đơn bậc B 10 mỗi phút mỗi người, tra khách bậc D 30 mỗi phút CHUNG bộ đếm với tra cứu khách của USR,
 * báo phí, danh sách và chi tiết bậc C 120 mỗi phút. Khóa đếm mặc định của platform: người dùng đã đăng nhập.
 */
export const LIMITS = {
  create: { tier: 'B', limit: 10, windowSeconds: 60 },
  lookup: { tier: 'D', limit: 30, windowSeconds: 60, group: 'usr:customer-lookup' },
  suggest: { tier: 'C', limit: 120, windowSeconds: 60 }, // gõ tìm theo từng phím (đã debounce ở web)
  read: { tier: 'C', limit: 120, windowSeconds: 60 },
} as const satisfies Record<string, RateLimitOptions>;
