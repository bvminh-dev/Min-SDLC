import { amzDateOf, enc, sha256Hex, signV4 } from './signer';
import type { ObjectStorage, StoredObject } from './storage';

export interface S3Options { endpoint: string; bucket: string; region: string; accessKey: string; secretKey: string; publicBase?: string }
const TIMEOUT_MS = 10_000;
const xmlText = (s: string): string => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');

/** Client S3 kiểu path (`<endpoint>/<bucket>/<khóa>`) ký SigV4; chạy với AWS S3, MinIO và dịch vụ tương thích. Lỗi không kèm thân phản hồi (có thể nêu chi tiết hạ tầng). */
export class S3Storage implements ObjectStorage {
  private readonly base: URL;
  private readonly publicBase: string;
  constructor(private readonly o: S3Options, private readonly fetchFn: typeof fetch = fetch) {
    this.base = new URL(o.endpoint);
    this.publicBase = (o.publicBase || `${o.endpoint.replace(/\/+$/, '')}/${o.bucket}`).replace(/\/+$/, '');
  }

  private async call(method: string, path: string, o: { query?: Record<string, string>; body?: Buffer; headers?: Record<string, string> } = {}): Promise<Response> {
    const payloadHash = sha256Hex(o.body ?? '');
    const headers: Record<string, string> = { ...(o.headers ?? {}), 'x-amz-content-sha256': payloadHash, 'x-amz-date': amzDateOf(new Date()) };
    const sig = signV4({ method, host: this.base.host, path, query: o.query, headers, payloadHash, amzDate: headers['x-amz-date'], region: this.o.region, accessKey: this.o.accessKey, secretKey: this.o.secretKey });
    const qs = o.query ? `?${Object.entries(o.query).map(([k, v]) => `${enc(k)}=${enc(v)}`).join('&')}` : ''; // cùng cách mã hóa với chữ ký
    const url = `${this.base.origin}${path.split('/').map(enc).join('/')}${qs}`;
    const res = await this.fetchFn(url, { method, headers: { ...headers, Authorization: sig.authorization }, body: o.body ? new Uint8Array(o.body) : undefined, signal: AbortSignal.timeout(TIMEOUT_MS) });
    return res;
  }

  async put(key: string, body: Buffer, o: { contentType: string; headers?: Record<string, string> }): Promise<void> {
    const res = await this.call('PUT', `/${this.o.bucket}/${key}`, { body, headers: { 'content-type': o.contentType, ...(o.headers ?? {}) } });
    if (!res.ok) throw new Error(`storage PUT ${res.status}`);
  }

  async delete(key: string): Promise<void> {
    const res = await this.call('DELETE', `/${this.o.bucket}/${key}`);
    if (!res.ok && res.status !== 404) throw new Error(`storage DELETE ${res.status}`);
  }

  async list(prefix: string): Promise<StoredObject[]> {
    const out: StoredObject[] = [];
    let token: string | undefined;
    do {
      const res = await this.call('GET', `/${this.o.bucket}`, { query: { 'list-type': '2', prefix, ...(token ? { 'continuation-token': token } : {}) } });
      if (!res.ok) throw new Error(`storage LIST ${res.status}`);
      const xml = await res.text();
      for (const m of xml.matchAll(/<Contents>([\s\S]*?)<\/Contents>/g)) {
        const key = m[1].match(/<Key>([\s\S]*?)<\/Key>/)?.[1];
        const at = m[1].match(/<LastModified>([\s\S]*?)<\/LastModified>/)?.[1];
        const lastModified = at ? new Date(at) : null;
        if (key && lastModified && !Number.isNaN(lastModified.getTime())) out.push({ key: xmlText(key), lastModified });
      }
      token = /<IsTruncated>true<\/IsTruncated>/.test(xml) ? xmlText(xml.match(/<NextContinuationToken>([\s\S]*?)<\/NextContinuationToken>/)?.[1] ?? '') || undefined : undefined;
    } while (token);
    return out;
  }

  urlFor(key: string): string { return `${this.publicBase}/${key}`; }
  keyOf(url: string): string | null { return url.startsWith(`${this.publicBase}/`) ? url.slice(this.publicBase.length + 1) : null; }
}
