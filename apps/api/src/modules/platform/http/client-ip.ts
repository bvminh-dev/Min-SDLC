import { isIP } from 'node:net';
import type { Request } from 'express';

/**
 * IP client (PRJ-REQ-20261006-095422650 BR9): chỉ tin X-Forwarded-For ở bước thứ `hops` tính từ phải
 * (phần tử do proxy tin cậy thêm); hops = 0 thì dùng IP kết nối.
 */
export function clientIp(req: Request, hops: number): string {
  const socket = req.socket?.remoteAddress ?? 'unknown';
  if (hops <= 0) return socket;
  const xff = req.headers['x-forwarded-for'];
  const list = (Array.isArray(xff) ? xff.join(',') : xff ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  const pick = list[list.length - hops];
  return pick && isIP(pick) ? pick : socket;
}
