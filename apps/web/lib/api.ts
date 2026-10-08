// Lớp gọi API của web (ADR-016): cùng site với API, `Content-Type: application/json`, cookie phiên HttpOnly do trình duyệt tự gửi;
// không có CSRF token, không lưu token ở localStorage.
import { API_BASE_URL as BASE } from './config';

export interface ApiResult<T = any> {
  /** 0 khi lỗi mạng. */
  status: number;
  ok: boolean;
  body: T;
  /** Từ `type` của problem+json, ví dụ `invalid_credentials`. */
  code?: string;
  /** Giây, từ Retry-After khi 429. */
  retryAfter?: number;
  /** Lỗi theo trường của 400: { field -> code }. */
  fieldErrors: Record<string, string>;
}

export const SESSION_EXPIRED_EVENT = 'auth:session-expired';

/** `silentExpired`: 401 session_expired không bật hộp thoại phiên hết hạn (đăng xuất coi như đã xong). */
export async function api<T = any>(path: string, o: { method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE'; body?: unknown; silentExpired?: boolean; headers?: Record<string, string> } = {}): Promise<ApiResult<T>> {
  try {
    // FormData (tải ảnh đại diện): để trình duyệt tự đặt multipart/form-data kèm ranh giới; còn lại luôn là JSON.
    const form = typeof FormData !== 'undefined' && o.body instanceof FormData;
    const res = await fetch(`${BASE}${path}`, {
      method: o.method ?? 'GET',
      credentials: 'include',
      headers: o.method && o.method !== 'GET' && !form ? { 'Content-Type': 'application/json', ...o.headers } : o.headers,
      body: o.body === undefined ? undefined : form ? (o.body as FormData) : JSON.stringify(o.body),
    });
    const text = res.status === 204 ? '' : await res.text();
    let body: any = {};
    try { body = text ? JSON.parse(text) : {}; } catch { body = {}; }
    const code = typeof body?.type === 'string' ? body.type.replace('urn:ecom:error:', '') : undefined;
    const retry = Number(res.headers.get('Retry-After'));
    const fieldErrors: Record<string, string> = {};
    if (res.status === 400 && Array.isArray(body?.errors)) for (const e of body.errors) if (e?.field && !fieldErrors[e.field]) fieldErrors[e.field] = String(e.code);
    if (res.status === 401 && code === 'session_expired' && !o.silentExpired && typeof window !== 'undefined') window.dispatchEvent(new Event(SESSION_EXPIRED_EVENT));
    return { status: res.status, ok: res.ok, body, code, retryAfter: Number.isFinite(retry) && retry > 0 ? retry : undefined, fieldErrors };
  } catch {
    return { status: 0, ok: false, body: {} as T, fieldErrors: {} };
  }
}
