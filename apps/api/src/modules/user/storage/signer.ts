import { createHash, createHmac } from 'node:crypto';

// AWS Signature Version 4 cho dịch vụ S3 tương thích (ADR-010), chỉ dùng node:crypto: không thêm SDK cho ba thao tác (PUT, DELETE, LIST).
// Kiểm bằng các ví dụ công bố trong tài liệu AWS (test/user/storage.spec.ts).
export interface SignInput {
  method: string;
  host: string;
  /** Đường dẫn chưa mã hóa, bắt đầu bằng `/` (S3 chỉ mã hóa một lần). */
  path: string;
  query?: Record<string, string>;
  /** Header cần ký (tên không phân biệt hoa thường); `host` được thêm tự động. */
  headers?: Record<string, string>;
  payloadHash: string;
  /** `YYYYMMDDTHHMMSSZ`. */
  amzDate: string;
  region: string;
  service?: string;
  accessKey: string;
  secretKey: string;
}

export const sha256Hex = (d: string | Buffer): string => createHash('sha256').update(d).digest('hex');
const hmac = (k: Buffer | string, d: string): Buffer => createHmac('sha256', k).update(d).digest();
export const enc = (s: string): string => encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);

export const amzDateOf = (d: Date): string => d.toISOString().replace(/[-:]|\.\d{3}/g, '');

export function signV4(i: SignInput): { authorization: string; signature: string; signedHeaders: string } {
  const service = i.service ?? 's3';
  const headers: Record<string, string> = { host: i.host };
  for (const [k, v] of Object.entries(i.headers ?? {})) headers[k.toLowerCase()] = v.trim().replace(/\s+/g, ' ');
  const names = Object.keys(headers).sort();
  const signedHeaders = names.join(';');
  const canonicalQuery = Object.entries(i.query ?? {}).map(([k, v]) => [enc(k), enc(v)] as const)
    .sort((a, b) => (a[0] === b[0] ? (a[1] < b[1] ? -1 : 1) : a[0] < b[0] ? -1 : 1)).map(([k, v]) => `${k}=${v}`).join('&');
  const canonicalRequest = [i.method, i.path.split('/').map(enc).join('/'), canonicalQuery, names.map((n) => `${n}:${headers[n]}\n`).join(''), signedHeaders, i.payloadHash].join('\n');
  const date = i.amzDate.slice(0, 8);
  const scope = `${date}/${i.region}/${service}/aws4_request`;
  const stringToSign = ['AWS4-HMAC-SHA256', i.amzDate, scope, sha256Hex(canonicalRequest)].join('\n');
  const signature = hmac(hmac(hmac(hmac(`AWS4${i.secretKey}`, date), i.region), service), 'aws4_request');
  const hex = hmac(signature, stringToSign).toString('hex');
  return { authorization: `AWS4-HMAC-SHA256 Credential=${i.accessKey}/${scope}, SignedHeaders=${signedHeaders}, Signature=${hex}`, signature: hex, signedHeaders };
}
