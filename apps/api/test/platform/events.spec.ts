import { spawn } from 'node:child_process';
import {
  AppLogger, Clock, ConfigService, EventsService, JobRunner, OutboxRelay, PrismaService, RetentionService, TransactionService,
  currentCorrelationId, runWithCorrelation, type EventEnvelope,
} from '../../src/modules/platform';
import { JOB_ABORT_GRACE_MS, JOB_TIMEOUT_MS } from '../../src/modules/platform/jobs/job-runner';
import { LEASE_MS } from '../../src/modules/platform/events/outbox-relay';
import { FakeClock, LogCapture, testConfig } from '../support/app';
import { waitFor } from '../support/boot';
import { API_DIR, testDbUrl, truncateAll } from '../support/db';

const DAY = 86_400_000;
// Mốc tương lai tương đối: `next_attempt_at` mặc định là now() của CSDL thật, nên mốc cố định trong quá khứ làm relay không nhặt được event (đã vỡ ngày 2026-10-06 sau 10:00 UTC).
const NOW = new Date(Math.floor((Date.now() + DAY) / 1000) * 1000);

function stack(env: Record<string, string> = {}) {
  const config: ConfigService = testConfig(env);
  const prisma = new PrismaService(config);
  const logs = new LogCapture();
  const logger = AppLogger.create({ level: 'info', env: 'dev', destination: logs });
  const clock: Clock & FakeClock = new FakeClock(NOW);
  const transactions = new TransactionService(prisma, config, logger);
  const events = new EventsService(transactions, logger);
  const relay = new OutboxRelay(prisma, transactions, events, config, clock, logger);
  const retention = new RetentionService(prisma, clock, config, logger);
  return { config, prisma, logs, logger, clock, transactions, events, relay, retention };
}
const publish = (s: ReturnType<typeof stack>, type: string, agg: string, corr = 'corr-1') =>
  runWithCorrelation(corr, () => s.transactions.run((tx) => s.events.publish(tx, { type, aggregate_type: 'order', aggregate_id: agg, payload: { order_id: agg } })));
const outbox = (s: ReturnType<typeof stack>) => s.prisma.$queryRaw<any[]>`SELECT * FROM outbox_events ORDER BY occurred_at, id`;
const processed = (s: ReturnType<typeof stack>) => s.prisma.$queryRaw<any[]>`SELECT * FROM processed_events`;

describe('Outbox, relay, consumer idempotent (PRJ-REQ-20261006-095422563 BR12, BR13)', () => {
  const s = stack();
  afterAll(() => s.prisma.$disconnect());
  beforeEach(async () => { await truncateAll(s.prisma); s.clock.set(NOW); s.logs.clear(); });

  it('PRJ-TC-20261006-110200101: event ghi cùng giao dịch, relay phát lên bus, consumer xử lý đúng một lần; rollback thì không có event', async () => {
    const seen: EventEnvelope[] = [];
    s.events.subscribe('TC101-consumer', 'OrderPaid', async (_tx, e) => { seen.push(e); });
    const eventId = await publish(s, 'OrderPaid', 'order-1', 'req-corr-77');
    const [row] = await outbox(s);
    expect(row).toMatchObject({ id: eventId, type: 'OrderPaid', aggregate_id: 'order-1', correlation_id: 'req-corr-77', dispatched_at: null, attempts: 0 });
    expect(row.occurred_at).toBeInstanceOf(Date);
    expect(seen).toHaveLength(0); // chưa relay thì chưa phát

    expect(await s.relay.runOnce(NOW)).toMatchObject({ picked: 1, dispatched: 1, failed: 0 });
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ event_id: eventId, correlation_id: 'req-corr-77', payload: { order_id: 'order-1' } });
    expect((await outbox(s))[0].dispatched_at).toEqual(NOW);
    expect(await processed(s)).toHaveLength(1);
    await s.relay.runOnce(new Date(NOW.getTime() + 120_000)); // chạy lại: không phát lần hai
    expect(seen).toHaveLength(1);

    // rollback: ném lỗi sau publish thì không có dòng outbox
    await expect(s.transactions.run(async (tx) => {
      await s.events.publish(tx, { type: 'OrderPaid', aggregate_type: 'order', aggregate_id: 'order-2', payload: {} });
      throw new Error('rollback');
    })).rejects.toThrow('rollback');
    expect((await outbox(s)).filter((r) => r.aggregate_id === 'order-2')).toHaveLength(0);
  });

  it('ORD-TC-20261006-111225380: hai event của cùng một đơn ghi trong CÙNG giao dịch (OrderCreated rồi OrderConfirmed của đơn COD) được relay phát đúng thứ tự ghi, lặp trên 40 đơn để uuid ngẫu nhiên lộ ra (occurred_at là clock_timestamp, không phải now() đứng yên trong giao dịch)', async () => {
    const seen: string[] = [];
    // loại event riêng cho ca này: bộ đăng ký của `s` dùng chung giữa các ca, OrderConfirmed thật sẽ kéo consumer này vào ca sau
    for (const type of ['TC380Created', 'TC380Confirmed']) s.events.subscribe('TC380-consumer', type, async (_tx, e) => { seen.push(`${e.aggregate_id}:${type}`); });
    const aggs = Array.from({ length: 40 }, (_, i) => `cod-${i}`);
    for (const agg of aggs) await s.transactions.run(async (tx) => {
      await s.events.publish(tx, { type: 'TC380Created', aggregate_type: 'order', aggregate_id: agg, payload: {} });
      await s.events.publish(tx, { type: 'TC380Confirmed', aggregate_type: 'order', aggregate_id: agg, payload: {} });
    });
    for (let i = 0; i < 4; i++) await s.relay.runOnce(new Date(NOW.getTime() + i * 120_000));
    expect(seen).toHaveLength(80);
    for (const agg of aggs) expect(seen.filter((x) => x.startsWith(`${agg}:`))).toEqual([`${agg}:TC380Created`, `${agg}:TC380Confirmed`]);
  });

  it('PRJ-TC-20261006-110200102: handler lỗi rollback, relay thử lại sau backoff, event không mất, tác động đúng một lần', async () => {
    let calls = 0, effects = 0;
    s.events.subscribe('NTF', 'OrderConfirmed', async (tx) => {
      calls++;
      await tx.$executeRaw`SELECT 1`;
      if (calls === 1) throw new Error('lỗi lần đầu');
      effects++;
    });
    await publish(s, 'OrderConfirmed', 'order-3');
    expect(await s.relay.runOnce(NOW)).toMatchObject({ failed: 1, dispatched: 0 });
    let [row] = await outbox(s);
    expect(row.attempts).toBe(1);
    expect(row.dispatched_at).toBeNull();
    expect(row.next_attempt_at).toEqual(new Date(NOW.getTime() + 5_000));
    expect(await processed(s)).toHaveLength(0); // giao dịch handler đã rollback kể cả ProcessedEvent

    expect(await s.relay.runOnce(new Date(NOW.getTime() + 2_000))).toMatchObject({ picked: 0 }); // chưa tới next_attempt_at
    const later = new Date(NOW.getTime() + 6_000);
    expect(await s.relay.runOnce(later)).toMatchObject({ dispatched: 1 });
    [row] = await outbox(s);
    expect(row.dispatched_at).toEqual(later);
    expect(await processed(s)).toHaveLength(1);
    expect(effects).toBe(1);
  });

  it('PRJ-TC-20261006-110200103: hai event mang token thô không đi outbox, phát in-process sau commit; event khác bị từ chối', async () => {
    const got: EventEnvelope[] = [];
    s.events.subscribe('NTF', 'PasswordResetRequested', async (_tx, e) => { got.push(e); });
    const payload = { user_id: 'u1', token_ref: 'RAW-TOKEN-VALUE-123' }; // scan-secrets:allow giá trị giả của test
    await s.transactions.run(async (tx) => {
      await tx.$executeRaw`SELECT 1`;
      s.events.publishAfterCommit({ type: 'PasswordResetRequested', aggregate_type: 'user', aggregate_id: 'u1', payload });
      expect(got).toHaveLength(0); // chưa commit thì chưa phát
    });
    expect(await waitFor(() => got.length === 1, 5000)).toBe(true);
    expect(got[0].payload.token_ref).toBe('RAW-TOKEN-VALUE-123');
    expect(await outbox(s)).toHaveLength(0);
    expect(s.logs.lines.join('\n')).not.toMatch(/token_ref|RAW-TOKEN-VALUE-123/);

    // rollback thì không phát
    await expect(s.transactions.run(async () => {
      s.events.publishAfterCommit({ type: 'PasswordResetRequested', aggregate_type: 'user', aggregate_id: 'u2', payload });
      throw new Error('rollback');
    })).rejects.toThrow();
    await new Promise((r) => setTimeout(r, 200));
    expect(got).toHaveLength(1);

    expect(() => s.events.publishAfterCommit({ type: 'OrderPaid', aggregate_type: 'order', aggregate_id: 'o', payload: {} })).toThrow(/publishAfterCommit/);
    await expect(s.transactions.run((tx) => s.events.publish(tx, { type: 'PasswordResetRequested', aggregate_type: 'user', aggregate_id: 'u1', payload }))).rejects.toThrow(/publishAfterCommit/);
    expect(await outbox(s)).toHaveLength(0);
  });

  it('PRJ-TC-20261006-110200104: tiến trình chết (SIGKILL) giữa commit và phát, khởi động lại relay vẫn phát event, consumer xử lý đúng một lần', async () => {
    const child = spawn(process.execPath, ['-r', 'ts-node/register/transpile-only', 'test/fixtures/commit-then-die.ts'], {
      cwd: API_DIR, env: { PATH: process.env.PATH ?? '', DATABASE_URL: testDbUrl() }, stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    child.stdout.on('data', (d) => { out += d; });
    const exited = new Promise((r) => child.on('exit', r));
    expect(await waitFor(() => out.includes('COMMITTED'), 30_000)).toBe(true);
    child.kill('SIGKILL');
    await exited;
    const [row] = await outbox(s);
    expect(row).toMatchObject({ aggregate_id: 'order-killed', dispatched_at: null, correlation_id: 'child-corr-1' }); // đã commit, chưa phát

    const seen: string[] = [];
    s.events.subscribe('TC104', 'OrderPaid', async (_tx, e) => { seen.push(e.event_id); });
    await s.relay.runOnce(new Date(Date.now() + 1000)); // tiến trình "khởi động lại" và relay chạy
    expect(seen).toEqual([row.id]);
    expect((await outbox(s))[0].dispatched_at).not.toBeNull();
    await s.relay.runOnce(new Date(Date.now() + 120_000));
    expect(seen).toHaveLength(1);
  }, 60_000);

  it('PRJ-TC-20261006-110200105: event giao trùng thì handler bỏ qua lần hai; consumer khác vẫn xử lý lần đầu; hai worker song song cũng chỉ một lần', async () => {
    const a: string[] = [], b: string[] = [];
    const subA = { consumer: 'A', handler: async (_t: unknown, e: EventEnvelope) => { a.push(e.event_id); } };
    const subB = { consumer: 'B', handler: async (_t: unknown, e: EventEnvelope) => { b.push(e.event_id); } };
    const id = await publish(s, 'OrderPaid', 'order-5');
    const env: EventEnvelope = { event_id: id, type: 'OrderPaid', aggregate_type: 'order', aggregate_id: 'order-5', payload: {}, occurred_at: NOW.toISOString(), correlation_id: 'c' };
    expect(await s.events.deliver(subA as never, env)).toBe('processed');
    expect(await s.events.deliver(subA as never, env)).toBe('skipped'); // relay chết trước dispatched_at rồi giao lại
    expect(await s.events.deliver(subB as never, env)).toBe('processed');
    expect([a.length, b.length]).toEqual([1, 1]);
    const id2 = await publish(s, 'OrderPaid', 'order-6');
    const env2 = { ...env, event_id: id2, aggregate_id: 'order-6' };
    const slow = { consumer: 'A', handler: async (_t: unknown, e: EventEnvelope) => { await new Promise((r) => setTimeout(r, 150)); a.push(e.event_id); } };
    const res = await Promise.all([s.events.deliver(slow as never, env2), s.events.deliver(slow as never, env2)]);
    expect(res.sort()).toEqual(['processed', 'skipped']);
    expect(a.filter((x) => x === id2)).toHaveLength(1);
  });

  it('PRJ-TC-20261006-110200106: hai instance cùng chạy job chỉ một chạy, instance kia bỏ qua lượt không báo lỗi; mỗi lượt có correlation_id mới; không event nào phát hai lần', async () => {
    const delivered: string[] = [];
    s.events.subscribe('TC106', 'OrderPaid', async (_tx, e) => { await new Promise((r) => setTimeout(r, 120)); delivered.push(e.event_id); });
    for (let i = 0; i < 4; i++) await publish(s, 'OrderPaid', `order-j${i}`);
    const mk = () => {
      const runner = new JobRunner(s.config, s.logger);
      const ids: (string | undefined)[] = [];
      runner.register({ name: 'outbox-relay', module: 'platform', every: 3000, run: async () => { ids.push(currentCorrelationId()); await s.relay.runOnce(NOW); } });
      return { runner, ids };
    };
    const i1 = mk(), i2 = mk();
    try {
      const results = await Promise.all([i1.runner.runOnce('outbox-relay'), i2.runner.runOnce('outbox-relay')]);
      expect(results.sort()).toEqual(['ran', 'skipped']);
      expect(delivered).toHaveLength(4);
      expect(new Set(delivered).size).toBe(4);
      expect(s.logs.records.filter((l) => l.level === 'error')).toHaveLength(0);
      const first = [...i1.ids, ...i2.ids][0];
      await i1.runner.runOnce('outbox-relay'); // lượt sau của cùng instance: correlation_id mới
      const all = [...i1.ids, ...i2.ids];
      expect(new Set(all).size).toBe(all.length);
      expect(first).toBeTruthy();
    } finally { await i1.runner.stop(); await i2.runner.stop(); }
  });

  it('PRJ-TC-20261006-110200106: SB-34 job quá hạn bị hủy (AbortSignal) và khóa chỉ nhả SAU khi thân dừng; instance khác không chạy chồng; thân bỏ qua tín hiệu thì sau hạn chờ ngắt kết nối giữ khóa', async () => {
    let active = 0, maxActive = 0, sawAbort = false;
    const enter = () => { active++; maxActive = Math.max(maxActive, active); };
    const mk = (body: (signal: AbortSignal) => Promise<void>, over: { abortGraceMs?: number } = {}) => {
      const r = new JobRunner(s.config, s.logger);
      r.register({ name: 'tc-sb34', module: 'platform', every: 60_000, timeoutMs: 100, ...over, run: async ({ signal }) => { enter(); try { await body(signal); } finally { active--; } } });
      return r;
    };
    // (1) thân tôn trọng tín hiệu: dừng ngay khi quá hạn, runOnce trả failed khi thân đã dừng
    const a = mk(async (signal) => { for (let i = 0; i < 100 && !signal.aborted; i++) await new Promise((r) => setTimeout(r, 20)); sawAbort = signal.aborted; });
    const b = mk(async () => { await new Promise((r) => setTimeout(r, 10)); });
    try {
      expect(await a.runOnce('tc-sb34')).toBe('failed');
      expect(sawAbort).toBe(true);
      expect(active).toBe(0); // runOnce chỉ trả về (nhả khóa) khi thân đã dừng hẳn
      expect(await b.runOnce('tc-sb34')).toBe('ran'); // khóa đã nhả, instance khác chạy được
      expect(maxActive).toBe(1); // không bao giờ hai thân cùng chạy
      expect(s.logs.records.some((l) => l.level === 'error' && l.msg === 'job lỗi')).toBe(true);
    } finally { await a.stop(); await b.stop(); }
    // (2) thân bỏ qua tín hiệu: sau hạn chờ, ngắt kết nối giữ khóa (khóa tư vấn mất theo phiên), log error; cùng instance không chạy chồng chính nó
    s.logs.clear();
    const stubborn = mk(async () => { await new Promise((r) => setTimeout(r, 600)); }, { abortGraceMs: 50 });
    try {
      expect(await stubborn.runOnce('tc-sb34')).toBe('failed');
      expect(s.logs.records.some((l) => l.level === 'error' && /không dừng/.test(l.msg))).toBe(true);
      expect(await stubborn.runOnce('tc-sb34')).toBe('skipped'); // thân cũ còn chạy: không chạy chồng trong tiến trình
      expect(await waitFor(() => active === 0, 5000)).toBe(true);
      expect(await stubborn.runOnce('tc-sb34')).toBe('failed'); // hết thân cũ: lượt mới chạy lại (và lại quá hạn)
    } finally { await stubborn.stop(); }
  });

  it('SB-34: hạn thuê của relay lớn hơn hạn job cộng hạn chờ hủy, để event đang xử lý không bị lượt khác nhặt lại khi job còn chạy', () => {
    expect(LEASE_MS).toBeGreaterThan(JOB_TIMEOUT_MS + JOB_ABORT_GRACE_MS);
  });

  it('SB-34: relay thôi phát các event còn lại khi tín hiệu hủy; event chưa phát giữ nguyên để lượt sau nhặt', async () => {
    const seen: string[] = [];
    const ac = new AbortController();
    s.events.subscribe('TC-abort', 'OrderPaid', async (_tx, e) => { seen.push(e.aggregate_id); ac.abort(); });
    for (let i = 0; i < 3; i++) await publish(s, 'OrderPaid', `order-ab${i}`);
    const r = await s.relay.runOnce(NOW, ac.signal);
    expect(seen).toHaveLength(1);
    expect(r.dispatched).toBe(1);
    expect((await outbox(s)).filter((e) => e.dispatched_at === null)).toHaveLength(2);
  });

  it('PRJ-TC-20261006-100125518: handler event giữ correlation_id của nguồn (relay chạy sau, ngoài request); job nền có correlation_id khác', async () => {
    const log = s.logger.for('handler');
    s.events.subscribe('TC-100125518', 'OrderPaid', async () => { log.info('handler đang xử lý'); });
    await publish(s, 'OrderPaid', 'order-c1', 'req-corr-X'); // request có correlation_id X phát event
    s.logs.clear();
    await s.relay.runOnce(NOW); // relay chạy sau, không nằm trong ngữ cảnh của request
    const h = s.logs.records.find((l) => l.msg === 'handler đang xử lý')!;
    expect(h.correlation_id).toBe('req-corr-X');
    const runner = new JobRunner(s.config, s.logger);
    runner.register({ name: 'tc-518-job', module: 'platform', every: 60_000, run: async () => { s.logger.for('jobs').info('job đang chạy'); } });
    try {
      expect(await runner.runOnce('tc-518-job')).toBe('ran');
      const j = s.logs.records.find((l) => l.msg === 'job đang chạy')!;
      expect(j.correlation_id).not.toBe('req-corr-X');
      expect(j.correlation_id).toMatch(/^[0-9a-f-]{36}$/);
    } finally { await runner.stop(); }
  });

  it('PRJ-TC-20261006-110200107: job dọn xóa OutboxEvent đã phát quá 14 ngày và IdempotencyKey hết hạn, giữ phần còn lại, log số đã xóa từng bảng', async () => {
    const old = new Date(NOW.getTime() - 15 * DAY);
    await s.prisma.$executeRaw`INSERT INTO outbox_events (type, aggregate_type, aggregate_id, payload, correlation_id, occurred_at, dispatched_at) VALUES ('E', 'o', 'a1', '{}', 'c', ${old}::timestamptz, ${old}::timestamptz)`;
    await s.prisma.$executeRaw`INSERT INTO outbox_events (type, aggregate_type, aggregate_id, payload, correlation_id, occurred_at) VALUES ('E', 'o', 'a2', '{}', 'c', ${old}::timestamptz)`; // chưa phát
    const u = '55555555-5555-4555-8555-555555555555';
    await s.prisma.$executeRaw`INSERT INTO idempotency_keys (scope, key, user_id, request_hash, response, expires_at) VALUES ('s', 'expired-key-1', ${u}::uuid, 'h', '{}', ${new Date(NOW.getTime() - DAY)}::timestamptz)`;
    await s.prisma.$executeRaw`INSERT INTO idempotency_keys (scope, key, user_id, request_hash, response, expires_at) VALUES ('s', 'valid-key-123', ${u}::uuid, 'h', '{}', ${new Date(NOW.getTime() + DAY)}::timestamptz)`;
    const counts = await s.retention.run(NOW);
    expect(counts).toMatchObject({ outbox_events: 1, idempotency_keys: 1, processed_events: 0, audit_logs: 0 });
    expect((await outbox(s)).map((r) => r.aggregate_id)).toEqual(['a2']);
    expect((await s.prisma.$queryRaw<any[]>`SELECT key FROM idempotency_keys`).map((r) => r.key)).toEqual(['valid-key-123']);
    const logged = Object.fromEntries(s.logs.records.filter((l) => l.msg === 'retention đã xóa').map((l) => [l.table, l.deleted]));
    expect(logged).toMatchObject({ outbox_events: 1, idempotency_keys: 1 });
  });

  it('PRJ-TC-20261006-120200104: relay dừng ở OUTBOX_MAX_ATTEMPTS với backoff 5..600 giây, event sau của cùng aggregate chờ, aggregate khác chạy bình thường, log error đúng một dòng', async () => {
    const t = stack({ OUTBOX_MAX_ATTEMPTS: '10' });
    try {
      await truncateAll(t.prisma);
      const ids = { e1: '00000000-0000-4000-8000-0000000000e1', e2: '00000000-0000-4000-8000-0000000000e2', e3: '00000000-0000-4000-8000-0000000000e3' };
      const ins = (id: string, type: string, agg: string, at: Date) =>
        t.prisma.$executeRaw`INSERT INTO outbox_events (id, type, aggregate_type, aggregate_id, payload, correlation_id, occurred_at, next_attempt_at) VALUES (${id}::uuid, ${type}, 'order', ${agg}, '{}', 'c', ${at}::timestamptz, ${new Date(0)}::timestamptz)`;
      await ins(ids.e1, 'OrderPaid', 'order-X', new Date(NOW.getTime() - 3000));
      await ins(ids.e2, 'OrderCancelled', 'order-X', new Date(NOW.getTime() - 2000));
      await ins(ids.e3, 'OrderPaid', 'order-Y', new Date(NOW.getTime() - 1000));
      const calls: string[] = [];
      t.events.subscribe('TC-120200104', 'OrderPaid', async (_tx, e) => { calls.push(e.event_id); if (e.event_id === ids.e1) throw new Error('luôn lỗi'); });
      t.events.subscribe('TC-120200104', 'OrderCancelled', async (_tx, e) => { calls.push(e.event_id); });

      let now = new Date(NOW);
      const waits: number[] = [];
      for (let run = 1; run <= 10; run++) {
        await t.relay.runOnce(now);
        const e1 = (await t.prisma.$queryRaw<any[]>`SELECT attempts, next_attempt_at FROM outbox_events WHERE id = ${ids.e1}::uuid`)[0];
        expect(e1.attempts).toBe(run);
        waits.push((e1.next_attempt_at.getTime() - now.getTime()) / 1000);
        now = new Date(e1.next_attempt_at.getTime()); // chạy lại đúng lúc tới next_attempt_at
      }
      expect(waits.slice(0, 9)).toEqual([5, 10, 20, 40, 80, 160, 320, 600, 600]);
      const callsBefore = calls.filter((c) => c === ids.e1).length;
      expect(callsBefore).toBe(10);
      await t.relay.runOnce(new Date(now.getTime() + 3600_000)); // lần 11: không giao E1
      expect(calls.filter((c) => c === ids.e1)).toHaveLength(10);
      expect(calls).not.toContain(ids.e2); // E2 chờ E1 cùng aggregate
      expect(calls).toContain(ids.e3); // E3 phát bình thường
      const rows = Object.fromEntries((await outbox(t)).map((r) => [r.id, r]));
      expect(rows[ids.e1].attempts).toBe(10);
      expect(rows[ids.e1].dispatched_at).toBeNull();
      expect(rows[ids.e3].dispatched_at).not.toBeNull();
      expect(rows[ids.e2].dispatched_at).toBeNull();
      const errors = t.logs.records.filter((l) => l.level === 'error');
      expect(errors).toHaveLength(1);
      expect(errors[0].event_id).toBe(ids.e1);
      expect(await t.relay.stuckCount()).toBe(1);
    } finally { await t.prisma.$disconnect(); }
  }, 60_000);

  it('PRJ-TC-20261006-120200105: job dọn xóa ProcessedEvent quá 30 ngày, giữ 30 ngày trừ 1 giờ và 1 ngày; event giao trùng vẫn bị chặn', async () => {
    const mk = async (consumer: string, eventId: string, at: Date) =>
      s.prisma.$executeRaw`INSERT INTO processed_events (consumer, event_id, processed_at) VALUES (${consumer}, ${eventId}::uuid, ${at}::timestamptz)`;
    const E = (n: number) => `00000000-0000-4000-8000-00000000000${n}`;
    await mk('C', E(1), new Date(NOW.getTime() - 31 * DAY));
    await mk('C', E(2), new Date(NOW.getTime() - 30 * DAY + 3600_000));
    await mk('C', E(3), new Date(NOW.getTime() - DAY));
    const counts = await s.retention.run(NOW);
    expect(counts.processed_events).toBe(1);
    expect(s.logs.records.find((l) => l.msg === 'retention đã xóa' && l.table === 'processed_events')?.deleted).toBe(1);
    expect((await processed(s)).map((r) => r.event_id).sort()).toEqual([E(2), E(3)]);
    let ran = 0;
    const sub = { consumer: 'C', handler: async () => { ran++; } };
    const env = (id: string): EventEnvelope => ({ event_id: id, type: 'X', aggregate_type: 'a', aggregate_id: 'a', payload: {}, occurred_at: NOW.toISOString(), correlation_id: 'c' });
    expect(await s.events.deliver(sub as never, env(E(2)))).toBe('skipped');
    expect(await s.events.deliver(sub as never, env(E(1)))).toBe('processed'); // đã xóa nên xử lý lại (hạn 30 ngày đã qua)
    expect(ran).toBe(1);
  });
});
