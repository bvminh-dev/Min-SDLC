import type { Request } from 'express';
import { clientIp, type RateLimitOptions } from '../platform';

/** `TRUST_PROXY_HOPS` của platform (ADR-007) cho khóa đếm IPN: module đặt lúc khởi tạo (decorator `@RateLimit` là dữ liệu tĩnh, không đọc được cấu hình). */
let ipHops = 0;
export const setIpHops = (n: number): void => { ipHops = n; };
/** IP client của IPN: `clientIp` của platform đã đổi IPv4 ánh xạ IPv6 (`::ffff:a.b.c.d`) về `a.b.c.d` MỘT lần cho mọi module (PAY không còn `normalizeIp` riêng),
 * nên `VNPAY_IPN_IP_ALLOWLIST` và khóa đếm bậc E khớp khi máy chủ nghe `::` (nếu không, danh sách bật là từ chối mọi IPN thật, REV-PAY-02);
 * dòng này giữ vị trí cũ của `ipOf` để các bằng chứng review không lệch. */
export const ipOf = (req: Request): string => clientIp(req, ipHops);

/**
 * Bảng bậc SB-14 cho PAY (PAY-API mục Giới hạn tần suất, PAY-SEC T13, ADR-014, R-42): bậc E đếm bằng bảng PostgreSQL của platform (đúng giữa các instance): initiate và retry 10 mỗi phút mỗi người (chung bộ đếm),
 * hoàn tiền và thử lại hoàn tiền 20 mỗi phút mỗi admin (chung bộ đếm), IPN 300 mỗi phút mỗi IP (đếm theo IP kể cả khi gói tin mang cookie); đọc của customer 60 mỗi phút mỗi người (chặt hơn bậc C 120, hai
 * endpoint đọc chung bộ đếm); bậc D 30 mỗi phút mỗi người cho ba endpoint quản trị (chung bộ đếm). Ghi nhận thu COD của staff, admin là bậc D (không có số riêng ở spec).
 */
export const LIMITS = {
  start: { tier: 'E', limit: 10, windowSeconds: 60, group: 'pay-start' }, // initiate và retry
  refund: { tier: 'E', limit: 20, windowSeconds: 60, group: 'pay-refund' }, // refunds và refunds retry
  ipn: { tier: 'E', limit: 300, windowSeconds: 60, key: (req: Request) => `ip:${ipOf(req)}` },
  read: { tier: 'E', limit: 60, windowSeconds: 60, group: 'pay-read' },
  admin: { tier: 'D', limit: 30, windowSeconds: 60, group: 'pay-admin' },
  collect: { tier: 'D', limit: 30, windowSeconds: 60, group: 'pay-collect' },
} as const satisfies Record<string, RateLimitOptions>;
