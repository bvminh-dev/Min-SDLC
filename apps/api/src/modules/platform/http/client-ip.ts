import { isIP } from 'node:net';
import type { Request } from 'express';

/**
 * IP client (PRJ-REQ-20261006-095422650 BR9): chỉ tin X-Forwarded-For ở bước thứ `hops` tính từ phải
 * (phần tử do proxy tin cậy thêm); hops = 0 thì dùng IP kết nối. Kết quả luôn qua `normalizeIp`.
 */
export function clientIp(req: Request, hops: number): string {
  const socket = normalizeIp(req.socket?.remoteAddress ?? 'unknown');
  if (hops <= 0) return socket;
  const xff = req.headers['x-forwarded-for'];
  const list = (Array.isArray(xff) ? xff.join(',') : xff ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  const pick = list[list.length - hops];
  return pick && isIP(pick) ? normalizeIp(pick) : socket;
}

const MAPPED_V4 = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i;
/**
 * Máy chủ nghe `::` (dual-stack) thấy IPv4 dưới dạng `::ffff:a.b.c.d`: đổi về `a.b.c.d` MỘT lần ở nền để khóa đếm giới hạn tần suất, log và danh sách IP của mọi module khớp nhau (không có hai khóa cho cùng một máy).
 * Chuỗi khác (IPv6 thật, `unknown`, IPv4 ánh xạ sai dạng) giữ nguyên.
 */
export function normalizeIp(ip: string): string {
  const v4 = MAPPED_V4.exec(ip)?.[1];
  return v4 && isIP(v4) === 4 ? v4 : ip;
}
