// Sổ mã lỗi (PRJ-REQ-20261006-095422820 BR2, ADR-023): `type` = urn:ecom:error:<mã>.
export interface ProblemDef { code: string; status: number; title: string }
export interface ProblemErrorItem { field: string; code: string }

export class ErrorRegistry {
  private readonly defs = new Map<string, ProblemDef>();
  private readonly problems: string[] = [];

  register(def: ProblemDef): void {
    if (this.defs.has(def.code)) this.problems.push(`mã lỗi trùng hoặc đổi nghĩa sau khi đã đăng ký: ${def.code}`);
    else this.defs.set(def.code, def);
  }
  get(code: string): ProblemDef | undefined { return this.defs.get(code); }

  /** Test quét sổ mã (CI): trùng, sai dạng kebab-case, sai status, thiếu mã chung. Rỗng nghĩa là sạch. */
  audit(): string[] {
    const out = [...this.problems];
    for (const d of this.defs.values()) {
      if (!/^[a-z0-9]+([-_][a-z0-9]+)*$/.test(d.code)) out.push(`mã lỗi không phải chữ thường nối bằng - hoặc _: ${d.code}`);
      if (!Number.isInteger(d.status) || d.status < 400 || d.status > 599) out.push(`status không hợp lệ cho ${d.code}`);
    }
    for (const [code, status] of Object.entries(BASE_STATUS)) {
      if (this.defs.get(code)?.status !== status) out.push(`thiếu hoặc sai status mã chung: ${code} (${status})`);
    }
    return out;
  }
}

const BASE_STATUS: Record<string, number> = {
  'validation-failed': 400, unauthenticated: 401, session_expired: 401, forbidden: 403, csrf_failed: 403, 'not-found': 404, conflict: 409,
  'idempotency-key-required': 400, 'payload-too-large': 413, 'unsupported-media-type': 415,
  'idempotency-key-reused': 422, 'rate-limited': 429, 'internal-error': 500, 'service-unavailable': 503,
};
const BASE_TITLES: Record<string, string> = {
  'validation-failed': 'Request validation failed',
  unauthenticated: 'Authentication required',
  session_expired: 'Session expired',
  forbidden: 'Access denied',
  csrf_failed: 'Request origin not allowed',
  'not-found': 'Resource not found',
  conflict: 'Request conflicts with the current state',
  'idempotency-key-required': 'Idempotency-Key header is missing or malformed',
  'payload-too-large': 'Request body too large',
  'unsupported-media-type': 'Unsupported media type',
  'idempotency-key-reused': 'Idempotency-Key was already used with a different request',
  'rate-limited': 'Too many requests',
  'internal-error': 'Internal server error',
  'service-unavailable': 'Service temporarily unavailable',
};

/** Sổ toàn cục: module đăng ký mã riêng khi import (mỗi mã đúng một lần). */
export const errorRegistry = new ErrorRegistry();
for (const [code, status] of Object.entries(BASE_STATUS)) errorRegistry.register({ code, status, title: BASE_TITLES[code] });

export const registerProblem = (def: ProblemDef): void => errorRegistry.register(def);

/** Lỗi miền có mã; platform ánh xạ sang HTTP, module không tự đặt phản hồi lỗi (BR7). */
export class DomainError extends Error {
  constructor(
    readonly code: string,
    readonly options: { detail?: string; errors?: ProblemErrorItem[]; headers?: Record<string, string>; extra?: Record<string, string | number | boolean> } = {},
  ) {
    super(code);
    this.name = 'DomainError';
  }
}
