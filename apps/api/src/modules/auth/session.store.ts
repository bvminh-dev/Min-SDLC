import type { PrismaClient } from '@prisma/client';
import type { EventsService, Tx } from '../platform';
import { SESSION_ABSOLUTE_MS, SESSION_IDLE_MS } from './config';
import { hashToken, newToken } from './crypto';

export type Q = Tx | PrismaClient;
export type RevokeReason = 'logout' | 'password_changed' | 'admin_lock' | 'replaced';

/** Cấp phiên mới: token ngẫu nhiên 256 bit, chỉ băm được lưu (SB-04). Trả token thô cho lớp HTTP đặt cookie, không ghi đâu khác. */
export async function createSession(q: Q, userId: string, now: Date): Promise<{ id: string; token: string }> {
  const token = newToken();
  const absolute = new Date(now.getTime() + SESSION_ABSOLUTE_MS);
  const idle = new Date(Math.min(now.getTime() + SESSION_IDLE_MS, absolute.getTime()));
  const rows = await q.$queryRaw<{ id: string }[]>`
    INSERT INTO sessions (user_id, token_hash, status, created_at, last_seen_at, expires_at, absolute_expires_at, updated_at)
    VALUES (${userId}::uuid, ${hashToken(token)}, 'active', ${now}::timestamptz, ${now}::timestamptz, ${idle}::timestamptz, ${absolute}::timestamptz, ${now}::timestamptz)
    RETURNING id`;
  return { id: rows[0].id, token };
}

/** Mỗi phiên bị thu hồi một OutboxEvent SessionRevoked cùng giao dịch (ADR-011). */
export async function emitSessionRevoked(events: EventsService, tx: Tx, userId: string, ids: string[], reason: RevokeReason): Promise<void> {
  for (const id of ids) {
    await events.publish(tx, { type: 'SessionRevoked', aggregate_type: 'session', aggregate_id: id, payload: { session_id: id, user_id: userId, reason } });
  }
}

/** Thu hồi mọi phiên `active` của user (đặt lại mật khẩu, admin khóa); trả id từng phiên. */
export async function revokeAllSessions(events: EventsService, tx: Tx, userId: string, reason: RevokeReason, now: Date): Promise<string[]> {
  const rows = await tx.$queryRaw<{ id: string }[]>`
    UPDATE sessions SET status = 'revoked', revoked_at = ${now}::timestamptz, revoked_reason = ${reason}::session_revoke_reason, updated_at = ${now}::timestamptz
    WHERE user_id = ${userId}::uuid AND status = 'active' RETURNING id`;
  const ids = rows.map((r) => r.id);
  await emitSessionRevoked(events, tx, userId, ids, reason);
  return ids;
}
