import { JobRunner } from '../../src/modules/platform';
import { NOW0, createAuthApp, q, seedSession, seedToken, seedUser, type AuthApp } from '../support/auth';
import { truncateAll } from '../support/db';

const DAY = 24 * 3600_000;
const ago = (ms: number) => new Date(NOW0.getTime() - ms);

// Job dọn mỗi giờ `auth.cleanup` (AUTH-DB mục 11, ADR-013, ADR-022): đánh dấu `expired`, xóa bản ghi đóng quá 30 ngày, chạy lại không đổi gì. Chu kỳ, hạn thời gian và khóa không chạy chồng thuộc bộ chạy job của platform.
describe('AUTH job dọn mỗi giờ auth.cleanup', () => {
  let t: AuthApp;
  beforeAll(async () => { t = await createAuthApp(); });
  afterAll(() => t.close());
  beforeEach(async () => { await truncateAll(t.prisma); t.clock.set(NOW0); });

  const status = async (table: string, id?: string) => (await q<{ status: string }>(t, `SELECT status FROM ${table}${id ? ` WHERE id = '${id}'` : ''}`)).map((r) => r.status);
  const count = async (table: string) => (await q<{ n: number }>(t, `SELECT count(*)::int AS n FROM ${table}`))[0].n;
  /** Dựng đủ các loại bản ghi quanh các mốc: còn hạn, quá hạn chưa đóng, đóng cách 35, 31, 30, 29 ngày. */
  async function seedAll() {
    const u = await seedUser(t);
    const live = await seedSession(t, u.id);
    const idle = await seedSession(t, u.id, { createdAt: ago(3 * 3600_000) }); // hạn trượt đã qua
    const oldRevoked = await seedSession(t, u.id, { createdAt: ago(40 * DAY) });
    const edgeRevoked = await seedSession(t, u.id, { createdAt: ago(40 * DAY) });
    await t.prisma.$executeRaw`UPDATE sessions SET status = 'revoked', revoked_at = ${ago(35 * DAY)}::timestamptz, revoked_reason = 'logout' WHERE id = ${oldRevoked.id}::uuid`;
    await t.prisma.$executeRaw`UPDATE sessions SET status = 'revoked', revoked_at = ${ago(30 * DAY)}::timestamptz, revoked_reason = 'logout' WHERE id = ${edgeRevoked.id}::uuid`;
    await seedToken(t, 'reset', u.id, { status: 'issued', createdAt: ago(3600_000), expiresAt: ago(600_000) }); // quá hạn nhưng chưa đóng
    await seedToken(t, 'verify', u.id, { status: 'issued' }); // còn hạn
    await seedToken(t, 'verify', u.id, { status: 'used', createdAt: ago(40 * DAY) });
    await seedToken(t, 'reset', u.id, { status: 'used', createdAt: ago(29 * DAY) });
    await seedToken(t, 'reset', u.id, { status: 'expired', createdAt: ago(32 * DAY), expiresAt: ago(31 * DAY) });
    return { live, idle, oldRevoked, edgeRevoked };
  }

  it('AUTH-TC-20261013-232524831: đánh dấu hết hạn, xóa bản ghi đóng quá 30 ngày (không xóa đúng 30 ngày), không đụng bản ghi còn hạn; chạy lại không đổi gì', async () => {
    const s = await seedAll();
    expect(await t.cleanup.run()).toEqual({ expired: 2, deleted: 3 });
    expect((await q<{ id: string; status: string }>(t, 'SELECT id, status FROM sessions')).sort((a, b) => a.id.localeCompare(b.id)).map((r) => [r.id, r.status]))
      .toEqual([[s.live.id, 'active'], [s.idle.id, 'expired'], [s.edgeRevoked.id, 'revoked']].sort((a, b) => a[0].localeCompare(b[0]))); // revoked 35 ngày đã xóa
    expect((await status('password_reset_tokens')).sort()).toEqual(['expired', 'used']); // quá hạn nay expired; used 29 ngày còn; expired 31 ngày đã xóa
    expect((await status('email_verification_tokens')).sort()).toEqual(['issued']); // còn hạn còn nguyên; used 40 ngày đã xóa
    const before = [await count('sessions'), await count('password_reset_tokens'), await count('email_verification_tokens')];
    expect(await t.cleanup.run()).toEqual({ expired: 0, deleted: 0 }); // idempotent
    expect([await count('sessions'), await count('password_reset_tokens'), await count('email_verification_tokens')]).toEqual(before);
  });

  it('AUTH-TC-20261013-232524831: chạy qua bộ chạy job theo tên auth.cleanup trả ran; tên chưa đăng ký thì ném lỗi', async () => {
    await seedAll();
    const runner = t.app.get(JobRunner);
    expect(await runner.runOnce('auth.cleanup')).toBe('ran');
    expect((await status('password_reset_tokens')).sort()).toEqual(['expired', 'used']);
    await expect(runner.runOnce('auth.khong-co')).rejects.toThrow(/chưa đăng ký/);
  });
});
