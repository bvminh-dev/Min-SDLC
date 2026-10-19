// Cấu hình chỉ đọc từ biến môi trường, tại MỘT nơi này (PRJ-REQ-20261006-095422735 BR2, BR6); lint cấm process.env ở nơi khác.
import { z } from 'zod';

export type Env = Record<string, string | undefined>;

export interface ConfigVar {
  zod: z.ZodTypeAny;
  sensitive: boolean;
  default?: string;
  /** Chỉ kiểm riêng (TLS...) mà không áp quy tắc bí mật của prod. */
  secretRules?: boolean;
  /** Có `default` rỗng để dev chạy được, nhưng staging và prod bắt buộc đặt (ví dụ kho ảnh của USR): thiếu thì dừng lúc khởi động, nêu tên biến. */
  requiredOutsideDev?: boolean;
}
export type ConfigFragment = Record<string, ConfigVar>;

const bad = (message: string) => ({ message });
const intRe = /^-?\d+$/;

/** Hàm dựng biến cấu hình. Biến nhạy cảm (`secret`) không có tùy chọn `default` (BR3). */
export const cfg = {
  string: (o: { default?: string } = {}): ConfigVar => ({ zod: z.string(), sensitive: false, default: o.default }),
  int: (o: { default?: number; min?: number; max?: number } = {}): ConfigVar => ({
    zod: z
      .string()
      .refine((v) => intRe.test(v), bad('phải là số nguyên'))
      .transform(Number)
      .pipe(z.number().min(o.min ?? Number.MIN_SAFE_INTEGER, bad(`phải >= ${o.min}`)).max(o.max ?? Number.MAX_SAFE_INTEGER, bad(`phải <= ${o.max}`))),
    sensitive: false,
    default: o.default === undefined ? undefined : String(o.default),
  }),
  bool: (o: { default?: boolean } = {}): ConfigVar => ({
    zod: z.enum(['true', 'false']).transform((v) => v === 'true'),
    sensitive: false,
    default: o.default === undefined ? undefined : String(o.default),
  }),
  enum: <T extends string>(values: readonly [T, ...T[]], o: { default?: T } = {}): ConfigVar => ({
    zod: z.string().refine((v) => (values as readonly string[]).includes(v), bad(`phải thuộc ${values.join(', ')}`)),
    sensitive: false,
    default: o.default,
  }),
  csv: (o: { default?: string } = {}): ConfigVar => ({
    zod: z.string().transform((v) => v.split(',').map((s) => s.trim()).filter(Boolean)),
    sensitive: false,
    default: o.default,
  }),
  /** Bí mật: không có mặc định; ở prod bị từ chối nếu giữ chỗ hoặc ngắn hơn 32 ký tự (BR4). */
  secret: (): ConfigVar => ({ zod: z.string(), sensitive: true, secretRules: true }),
};

const ORIGIN_RE = /^https?:\/\/[^/\s*]+$/;
const LEVELS = ['trace', 'debug', 'info', 'warn', 'error', 'fatal'] as const;

export const CORE_VARS: ConfigFragment = {
  APP_ENV: cfg.enum(['dev', 'staging', 'prod']),
  PORT: cfg.int({ default: 3802, min: 1, max: 65535 }),
  DATABASE_URL: {
    zod: z.string().refine((v) => /^postgres(ql)?:\/\//.test(v), bad('phải là URL postgresql://')),
    sensitive: true, // không in giá trị, không có mặc định; chỉ kiểm TLS ở staging và prod (BR4, DB BR7)
  },
  // Kết nối riêng (vai trò app_retention) cho job dọn audit_logs: DATABASE_URL của ứng dụng không có quyền DELETE ở đó (PRJ-DB mục 12). Rỗng: dùng DATABASE_URL (chỉ dev, chạy bằng superuser); staging và prod bắt buộc đặt (ADR-007).
  RETENTION_DATABASE_URL: {
    zod: z.string().refine((v) => v === '' || /^postgres(ql)?:\/\//.test(v), bad('phải là URL postgresql:// hoặc để trống')),
    sensitive: true,
    default: '',
  },
  // min 2: consumer của outbox giữ một kết nối của giao dịch giao event rồi đọc module khác bằng kết nối thứ hai (SHP tạo vận đơn đọc ORD, INV đọc PRD): pool một kết nối treo mãi tới hạn chờ (L71, SHP report mục 7).
  DB_POOL_MAX: cfg.int({ default: 10, min: 2, max: 200 }),
  LOG_LEVEL: cfg.enum(LEVELS, { default: 'info' }),
  CORS_ALLOWED_ORIGINS: {
    zod: z
      .string()
      .transform((v) => v.split(',').map((s) => s.trim()).filter(Boolean))
      .refine((l) => l.length > 0 && l.every((o) => o === '*' || ORIGIN_RE.test(o)), bad('phải là danh sách nguồn http(s)://host[:cổng] cách nhau bằng dấu phẩy')),
    sensitive: false,
  },
  TRUST_PROXY_HOPS: cfg.int({ default: 0, min: 0, max: 10 }),
  RATE_LIMIT_PER_MINUTE: cfg.int({ default: 120, min: 1 }),
  OUTBOX_MAX_ATTEMPTS: cfg.int({ default: 10, min: 1 }),
  // Biến vận hành bổ sung (không có trong danh sách lõi của PRJ-REQ BR3, ghi ở report.md mục Lệch spec):
  DB_CONNECT_RETRY_SECONDS: cfg.int({ default: 30, min: 0 }),
  DB_TRANSACTION_TIMEOUT_MS: cfg.int({ default: 10_000, min: 100 }),
  DB_TRANSACTION_RETRIES: cfg.int({ default: 3, min: 0, max: 10 }),
  DB_STATEMENT_TIMEOUT_MS: cfg.int({ default: 15_000, min: 100 }),
};

export interface CoreConfig {
  APP_ENV: 'dev' | 'staging' | 'prod';
  PORT: number;
  DATABASE_URL: string;
  RETENTION_DATABASE_URL: string;
  DB_POOL_MAX: number;
  LOG_LEVEL: (typeof LEVELS)[number];
  CORS_ALLOWED_ORIGINS: string[];
  TRUST_PROXY_HOPS: number;
  RATE_LIMIT_PER_MINUTE: number;
  OUTBOX_MAX_ATTEMPTS: number;
  DB_CONNECT_RETRY_SECONDS: number;
  DB_TRANSACTION_TIMEOUT_MS: number;
  DB_TRANSACTION_RETRIES: number;
  DB_STATEMENT_TIMEOUT_MS: number;
}

export interface VarStatus { name: string; status: 'set' | 'default' }
export interface ConfigProblem { name: string; reason: string }

export class ConfigError extends Error {
  constructor(readonly problems: ConfigProblem[]) {
    super(`Cấu hình không hợp lệ: ${problems.map((p) => p.name).join(', ')}`);
  }
  /** Mỗi dòng: TÊN: lý do. Không bao giờ chứa giá trị. */
  format(): string {
    return this.problems.map((p) => `  ${p.name}: ${p.reason}`).join('\n');
  }
}

/** Cấu hình bất biến, có kiểu (BR9). */
export class ConfigService {
  constructor(private readonly values: Readonly<Record<string, unknown>>, readonly statuses: readonly VarStatus[] = []) {
    Object.freeze(this.values);
  }
  get<K extends keyof CoreConfig>(name: K): CoreConfig[K];
  get<T = unknown>(name: string): T;
  get(name: string): unknown {
    if (!(name in this.values)) throw new Error(`Biến cấu hình chưa khai báo: ${name}`);
    return this.values[name];
  }
}

const registry = new Map<string, ConfigVar>();
/** Module đăng ký biến của mình vào schema chung (ADR-007). Đăng ký trùng tên là lỗi lập trình. */
export function registerConfigSchema(fragment: ConfigFragment): void {
  for (const [name, v] of Object.entries(fragment)) {
    if (name in CORE_VARS || registry.has(name)) throw new Error(`Biến cấu hình đã đăng ký: ${name}`);
    registry.set(name, v);
  }
}

const PLACEHOLDER_PREFIXES = ['changeme', 'example', 'test', 'placeholder', 'your'];
const hasTls = (url: string) => /[?&]sslmode=(require|verify-ca|verify-full)\b/.test(url) || /[?&]ssl=true\b/.test(url);

function secretProblem(value: string): string | null {
  const lower = value.toLowerCase();
  const prefix = PLACEHOLDER_PREFIXES.find((p) => lower.startsWith(p));
  if (prefix) return `giá trị giữ chỗ (tiền tố ${prefix})`;
  if (/^(.)\1*$/s.test(value)) return 'giá trị giữ chỗ (một ký tự lặp lại)';
  if (value.length < 32) return 'quá ngắn (cần tối thiểu 32 ký tự)';
  return null;
}

/**
 * Đọc và kiểm toàn bộ cấu hình. Gom MỌI lỗi một lượt, chỉ nêu tên biến và lý do, không in giá trị (SB-16, SB-18).
 * `extra` để test truyền thêm schema mà không đụng sổ đăng ký toàn cục.
 */
export function loadConfig(env: Env, extra: ConfigFragment[] = []): ConfigService {
  const all: ConfigFragment = { ...CORE_VARS, ...Object.fromEntries(registry), ...Object.assign({}, ...extra) };
  const values: Record<string, unknown> = {};
  const raws: Record<string, string> = {};
  const statuses: VarStatus[] = [];
  const problems: ConfigProblem[] = [];

  for (const [name, v] of Object.entries(all)) {
    const raw = env[name]?.trim();
    let text = raw;
    if (!text) {
      if (v.default === undefined) {
        problems.push({ name, reason: v.sensitive ? 'thiếu hoặc rỗng (rỗng coi như thiếu, không dùng giá trị giữ chỗ)' : 'thiếu hoặc rỗng' });
        continue;
      }
      text = v.default;
      statuses.push({ name, status: 'default' });
    } else statuses.push({ name, status: 'set' });
    const r = v.zod.safeParse(text);
    if (!r.success) {
      const issue = r.error.issues[0];
      problems.push({ name, reason: issue.code === 'custom' ? issue.message : `không hợp lệ (${issue.code})` });
      continue;
    }
    values[name] = r.data;
    raws[name] = text;
  }

  if (!problems.length && values.APP_ENV !== undefined) {
    const appEnv = values.APP_ENV as string;
    const prod = appEnv === 'prod';
    if (appEnv !== 'dev' && !hasTls(raws.DATABASE_URL)) problems.push({ name: 'DATABASE_URL', reason: 'phải bật TLS (sslmode=require trở lên) ở staging và prod' });
    if (appEnv !== 'dev' && !raws.RETENTION_DATABASE_URL) problems.push({ name: 'RETENTION_DATABASE_URL', reason: 'bắt buộc ở staging và prod (vai trò app_retention cho job dọn audit_logs)' });
    if (appEnv !== 'dev' && raws.RETENTION_DATABASE_URL && !hasTls(raws.RETENTION_DATABASE_URL)) problems.push({ name: 'RETENTION_DATABASE_URL', reason: 'phải bật TLS (sslmode=require trở lên) ở staging và prod' });
    if (appEnv !== 'dev') {
      for (const [name, v] of Object.entries(all)) if (v.requiredOutsideDev && !raws[name]) problems.push({ name, reason: 'bắt buộc ở staging và prod (rỗng chỉ được ở dev)' });
    }
    if (prod) {
      for (const [name, v] of Object.entries(all)) {
        if (!v.secretRules) continue;
        const why = secretProblem(raws[name]);
        if (why) problems.push({ name, reason: why });
      }
      if ((values.CORS_ALLOWED_ORIGINS as string[]).includes('*')) problems.push({ name: 'CORS_ALLOWED_ORIGINS', reason: 'không được chứa * ở prod' });
      if (['debug', 'trace'].includes(values.LOG_LEVEL as string)) problems.push({ name: 'LOG_LEVEL', reason: 'không được là debug hoặc trace ở prod' });
    }
  }

  if (problems.length) throw new ConfigError(problems);
  return new ConfigService(values, statuses);
}

let singleton: ConfigService | undefined;
/** Điểm đọc `process.env` duy nhất của ứng dụng (lúc khởi động, một lần). */
export function loadConfigFromProcess(): ConfigService {
  return (singleton ??= loadConfig(process.env));
}
