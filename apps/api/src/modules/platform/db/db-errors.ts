const get = (e: unknown, k: string): unknown => (e && typeof e === 'object' ? (e as Record<string, unknown>)[k] : undefined);
const text = (e: unknown): string => String(get(e, 'message') ?? '');

/** Kết nối CSDL hỏng hoặc hết hạn chờ pool: trả 503, không sập tiến trình (PRJ-REQ-20261006-095422563 BR8). */
export function isDbUnavailable(e: unknown): boolean {
  const code = String(get(e, 'code') ?? '');
  if (/^P10\d\d$/.test(code) || code === 'P2024') return true;
  if (['ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'EPIPE', '57P01', '57P03', '08006', '08001'].includes(code)) return true;
  if (get(e, 'name') === 'PrismaClientInitializationError') return true;
  return /Can't reach database server|Server has closed the connection|Connection terminated|connection (refused|reset)|timed out fetching a new connection|Error in PostgreSQL connection/i.test(text(e));
}

/** Lỗi PostgreSQL 40001 (serialization) hoặc 40P01 (deadlock): thử lại giao dịch được. */
export function isRetryableTx(e: unknown): boolean {
  const code = String(get(e, 'code') ?? '');
  const metaCode = String(get(get(e, 'meta'), 'code') ?? '');
  if (code === 'P2034' || code === '40001' || code === '40P01' || metaCode === '40001' || metaCode === '40P01') return true;
  return /\b(40001|40P01)\b|deadlock detected|could not serialize access/i.test(text(e));
}
