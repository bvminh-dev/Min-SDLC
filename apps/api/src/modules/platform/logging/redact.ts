// Bộ che dữ liệu nhạy cảm trung tâm (SB-18, PRJ-REQ-20261006-095422908 BR3): theo TÊN trường và theo MẪU giá trị
// (chuỗi tự do: message lỗi, msg, giá trị lồng). Dùng chung cho log và audit (before/after) để chỉ có MỘT danh sách.
const SENSITIVE_KEY = /(authorization|cookie|passw|^pwd$|^pass$|secret|token|card|cvv|cvc|^pan$|api[_-]?key|session[_-]?id|jwt|credential|email|phone|address|receiver)/i;
export const REDACTED = '[REDACTED]';

const PATTERNS: [RegExp, string][] = [
  [/\b([a-z][a-z0-9+.-]*:\/\/)[^\s/@]*@/gi, `$1${REDACTED}@`], // URL có userinfo (user:mật_khẩu@host)
  [/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/gi, `$1 ${REDACTED}`],
  [/\b(authorization|passw(?:or)?d|pwd|secret|token|api[_-]?key|session[_-]?id|jwt)(["']?\s*[=:]\s*["']?)[^\s&,;"']+/gi, `$1$2${REDACTED}`],
  [/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g, REDACTED], // email (vd: lỗi CSDL `Key (email)=(a@b.c)`)
];
// Số thẻ: 13-19 chữ số liền, hoặc nhóm 4-4-4-4(-n) / 4-6-5 ngăn bằng một dấu cách hoặc gạch; chỉ che khi qua kiểm Luhn.
// Nhóm cố định để UUID, mã `20261006-100124068`, timestamp không bị che nhầm.
const CARD = /(?<![\w-])(?:\d{13,19}|\d{4}(?:[ -]\d{4}){2,3}(?:[ -]\d{1,3})?|\d{4}[ -]\d{6}[ -]\d{5})(?![\w-])/g;
const luhn = (digits: string): boolean => {
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let d = Number(digits[digits.length - 1 - i]);
    if (i % 2 === 1 && (d *= 2) > 9) d -= 9;
    sum += d;
  }
  return sum % 10 === 0;
};

export function redactString(s: string): string {
  let out = s;
  for (const [re, to] of PATTERNS) out = out.replace(re, to);
  return out.replace(CARD, (m) => (luhn(m.replace(/\D/g, '')) ? REDACTED : m));
}

/** Lỗi thành đối tượng thường: type, message, stack, cause và thuộc tính riêng đều qua bộ che (pino `err` serializer chạy SAU bộ che nên không còn dùng). */
function errorToObject(e: Error, depth: number): Record<string, unknown> {
  const out: Record<string, unknown> = { type: e.name };
  for (const k of Object.getOwnPropertyNames(e)) out[k] = SENSITIVE_KEY.test(k) ? REDACTED : redactDeep((e as unknown as Record<string, unknown>)[k], depth + 1);
  return out;
}

export function redactDeep(value: unknown, depth = 0): unknown {
  if (typeof value === 'string') return redactString(value);
  if (value === null || typeof value !== 'object') return value;
  if (depth > 10) return REDACTED;
  if (Array.isArray(value)) return value.map((v) => redactDeep(v, depth + 1));
  if (value instanceof Date) return value;
  if (value instanceof Error) return errorToObject(value, depth);
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] = SENSITIVE_KEY.test(k) ? REDACTED : redactDeep(v, depth + 1);
  }
  return out;
}
