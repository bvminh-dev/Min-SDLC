/**
 * Tham số `next` sau đăng nhập chỉ nhận đường dẫn tương đối nội bộ (AUTH-REQ-20261006-095515738 BR9, SB-28, AUTH-SEC T16):
 * bắt đầu bằng một `/`, không `//`, không `\`, không ký tự điều khiển. Giá trị khác trả `null` (về trang mặc định theo role).
 */
export function safeNext(raw: string | null | undefined): string | null {
  if (typeof raw !== 'string' || raw === '') return null;
  if (!raw.startsWith('/') || raw.startsWith('//')) return null;
  // eslint-disable-next-line no-control-regex
  if (raw.includes('\\') || /[\u0000-\u001f\u007f]/.test(raw)) return null;
  return raw;
}
