import type { Request, Response } from 'express';
import { errorRegistry, type ErrorRegistry, type ProblemErrorItem, type ProblemExtra } from './registry';

export interface ProblemBody {
  type: string; title: string; status: number; trace_id: string; detail?: string; errors?: ProblemErrorItem[]; [extra: string]: unknown;
}

// `title` và `detail` cố định để 404 "của người khác" và "không tồn tại" giống hệt nhau (BR3).
const FIXED_DETAIL: Record<string, string> = { 'not-found': 'The requested resource was not found' };

/** Khóa của problem+json mà `extra` không được ghi đè. */
const RESERVED = new Set(['type', 'title', 'status', 'trace_id', 'detail', 'errors']);

export function buildProblem(code: string, traceId: string, o: { detail?: string; errors?: ProblemErrorItem[]; extra?: Record<string, ProblemExtra>; status?: number } = {}, registry: ErrorRegistry = errorRegistry): ProblemBody {
  const def = registry.get(code) ?? registry.get('internal-error')!;
  const body: ProblemBody = { type: `urn:ecom:error:${def.code}`, title: def.title, status: Number.isInteger(o.status) && o.status! >= 400 && o.status! <= 599 ? o.status! : def.status, trace_id: traceId };
  const detail = FIXED_DETAIL[def.code] ?? o.detail;
  if (detail) body.detail = detail;
  if (o.errors?.length) body.errors = o.errors;
  // Trường phụ có tên do module khai (ví dụ `reason` của image-invalid, `code` snake_case của lỗi nghiệp vụ, `reasons` và `missing` của PRD): giá trị vô hướng hoặc danh sách mã, không đè khóa chuẩn.
  for (const [k, v] of Object.entries(o.extra ?? {})) if (!RESERVED.has(k)) body[k] = v;
  return body;
}

export const traceIdOf = (req: Request): string => (req as Request & { correlationId?: string }).correlationId ?? 'unknown';

/** Gửi lỗi problem+json (dùng cả cho middleware trước Nest, nơi bộ lọc ngoại lệ chưa tới). */
export function sendProblem(req: Request, res: Response, code: string, o: { detail?: string; errors?: ProblemErrorItem[]; headers?: Record<string, string>; extra?: Record<string, ProblemExtra>; status?: number } = {}): void {
  const body = buildProblem(code, traceIdOf(req), o);
  for (const [k, v] of Object.entries(o.headers ?? {})) res.setHeader(k, v);
  res.status(body.status).setHeader('Content-Type', 'application/problem+json; charset=utf-8').send(JSON.stringify(body));
}
