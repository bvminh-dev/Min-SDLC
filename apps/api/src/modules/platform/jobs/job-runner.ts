import { Injectable, type OnApplicationShutdown } from '@nestjs/common';
import { Client } from 'pg';
import { newCorrelationId, runWithCorrelation } from '../common/context';
import { ConfigService } from '../config/config';
import { toPgConfig } from '../db/pg-config';
import { AppLogger } from '../logging/logger';

export interface JobDef {
  name: string;
  module: string;
  /** Chu kỳ chạy, mili giây. */
  every: number;
  /** `signal` bị hủy khi quá hạn: thân job phải dừng sớm (kiểm `signal.aborted` giữa các bước, truyền cho I/O hỗ trợ). */
  run: (ctx: { correlationId: string; signal: AbortSignal }) => Promise<void>;
  /** Hạn thời gian một lần chạy (SB-34); mặc định JOB_TIMEOUT_MS. */
  timeoutMs?: number;
  /** Sau khi hủy, chờ thân dừng tối đa chừng này rồi mới ngắt kết nối giữ khóa; mặc định JOB_ABORT_GRACE_MS. */
  abortGraceMs?: number;
}
export const JOB_TIMEOUT_MS = 60_000;
export const JOB_ABORT_GRACE_MS = 5_000;
export type JobResult = 'ran' | 'skipped' | 'failed';

/**
 * Job nền chung (ADR-013, SB-34): một lần chạy tại một thời điểm trên toàn cụm nhờ pg_try_advisory_lock giữ trên MỘT kết nối
 * riêng ngoài pool Prisma. Mỗi lần chạy có correlation_id mới. Không lấy được khóa thì bỏ qua lượt.
 * ponytail: không tự thử lại trong một lượt; lượt kế tiếp là lần thử lại. Thêm backoff theo job khi cần.
 */
@Injectable()
export class JobRunner implements OnApplicationShutdown {
  private readonly jobs = new Map<string, JobDef>();
  private readonly timers: NodeJS.Timeout[] = [];
  private readonly running = new Set<string>();
  private client: Client | null = null;
  private readonly log: AppLogger;

  constructor(private readonly config: ConfigService, logger: AppLogger) {
    this.log = logger.for('jobs');
  }

  register(def: JobDef): void {
    if (this.jobs.has(def.name)) throw new Error(`Job đã đăng ký: ${def.name}`);
    this.jobs.set(def.name, def);
  }

  start(): void {
    for (const def of this.jobs.values()) {
      const t = setInterval(() => void this.runOnce(def.name), def.every);
      t.unref();
      this.timers.push(t);
    }
  }

  async runOnce(name: string): Promise<JobResult> {
    const def = this.jobs.get(name);
    if (!def) throw new Error(`Job chưa đăng ký: ${name}`);
    // Khóa tư vấn tái nhập trong cùng một phiên, nên cần cờ trong tiến trình để không chạy chồng chính nó.
    if (this.running.has(name)) return 'skipped';
    this.running.add(name);
    const correlationId = newCorrelationId();
    return runWithCorrelation(correlationId, async () => {
      let locked = false;
      let holdRunning = false;
      let timer: NodeJS.Timeout | undefined;
      try {
        const client = await this.connection();
        const r = await client.query<{ ok: boolean }>('SELECT pg_try_advisory_lock(hashtext($1)) AS ok', [name]);
        locked = r.rows[0].ok;
        if (!locked) return 'skipped';
        // Hết hạn thì HỦY thân job (AbortSignal) và chỉ nhả khóa sau khi thân đã dừng, để không có hai thân cùng chạy (SB-34).
        const ac = new AbortController();
        const body = def.run({ correlationId, signal: ac.signal });
        const timeout = new Promise<'timeout'>((res) => { timer = setTimeout(() => res('timeout'), def.timeoutMs ?? JOB_TIMEOUT_MS); });
        if ((await Promise.race([body.then(() => 'done' as const), timeout])) === 'done') return 'ran';
        ac.abort(new Error('job quá hạn'));
        let grace: NodeJS.Timeout | undefined;
        const stopped = await Promise.race([
          body.then(() => true, () => true),
          new Promise<false>((res) => { grace = setTimeout(() => res(false), def.abortGraceMs ?? JOB_ABORT_GRACE_MS); }),
        ]);
        clearTimeout(grace);
        if (!stopped) {
          // Thân không chịu dừng: ngắt kết nối (khóa tư vấn gắn với phiên nên mất theo) và không cho chạy chồng trong tiến trình cho tới khi thân dừng.
          this.log.error('job không dừng sau khi bị hủy, bỏ khóa', { job: name, job_module: def.module });
          locked = false;
          this.dropClient();
          holdRunning = true;
          void body.then(() => undefined, () => undefined).then(() => this.running.delete(name));
        }
        throw new Error('job quá hạn');
      } catch (err) {
        this.log.error('job lỗi', { job: name, job_module: def.module, err });
        return 'failed';
      } finally {
        if (timer) clearTimeout(timer);
        if (locked) await this.client?.query('SELECT pg_advisory_unlock(hashtext($1))', [name]).catch(() => this.dropClient());
        if (!holdRunning) this.running.delete(name);
      }
    });
  }

  private async connection(): Promise<Client> {
    if (this.client) return this.client;
    const c = new Client(toPgConfig(this.config.get('DATABASE_URL')));
    c.on('error', () => { if (this.client === c) this.dropClient(); }); // mất CSDL không làm sập tiến trình
    await c.connect();
    this.client = c;
    return c;
  }
  private dropClient(): void {
    const c = this.client;
    this.client = null;
    c?.end().catch(() => undefined);
  }

  async onApplicationShutdown(): Promise<void> {
    await this.stop();
  }
  async stop(): Promise<void> {
    for (const t of this.timers) clearInterval(t);
    this.timers.length = 0;
    const c = this.client;
    this.client = null;
    await c?.end().catch(() => undefined);
  }
}
