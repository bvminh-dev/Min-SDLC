import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { sha256Hex, signV4 } from '../../src/modules/user/storage/signer';

export interface FakeObject { body: Buffer; contentType: string; headers: Record<string, string>; lastModified: Date }
export interface FakeRequest { method: string; path: string; query: Record<string, string>; headers: Record<string, string | string[] | undefined> }

/**
 * Dịch vụ S3 giả tối thiểu (path-style: PUT, DELETE, GET đối tượng, GET list-type=2 có phân trang) chạy trong tiến trình test.
 * KHÁC MinIO thật: không có điều khiển truy cập, phiên bản, đa vùng; chỉ KIỂM chữ ký SigV4 của client (tính lại bằng bộ ký của mã) và băm nội dung,
 * để client S3 của USR được chạy thật qua HTTP chứ không bị giả ở mức hàm. Dùng chung cho Jest và máy chủ E2E.
 */
export class FakeS3 {
  readonly objects = new Map<string, FakeObject>();
  readonly requests: FakeRequest[] = [];
  /** Số đối tượng tối đa mỗi trang list (để thử phân trang). */
  pageSize = 1000;
  /** Khi đặt, PUT trả lỗi này (mô phỏng storage hỏng); DELETE khi `failDelete`. */
  failPut: number | null = null;
  failDelete: number | null = null;
  private server: Server | null = null;
  url = '';

  constructor(readonly bucket = 'test-bucket', readonly accessKey = 'AKIAFAKEKEY', readonly secretKey = 'fake-secret-key-for-tests') {}

  async start(port = 0): Promise<string> {
    this.server = createServer((req, res) => void this.handle(req, res));
    await new Promise<void>((r) => this.server!.listen(port, '127.0.0.1', r));
    this.url = `http://127.0.0.1:${(this.server.address() as AddressInfo).port}`;
    return this.url;
  }
  async stop(): Promise<void> { await new Promise<void>((r) => (this.server ? this.server.close(() => r()) : r())); this.server?.closeAllConnections(); }
  keys(prefix = ''): string[] { return [...this.objects.keys()].filter((k) => k.startsWith(prefix)).sort(); }
  reset(): void { this.objects.clear(); this.requests.length = 0; this.pageSize = 1000; this.failPut = null; this.failDelete = null; }
  /** Tạo đối tượng có sẵn (ảnh cũ hay ảnh mồ côi) với thời điểm sửa tùy ý. */
  seed(key: string, body: Buffer, lastModified: Date, contentType = 'image/webp'): void { this.objects.set(key, { body, contentType, headers: {}, lastModified }); }

  private authentic(req: IncomingMessage, url: URL, body: Buffer): boolean {
    const auth = String(req.headers.authorization ?? '');
    const m = auth.match(/^AWS4-HMAC-SHA256 Credential=([^/]+)\/(\d{8})\/([^/]+)\/s3\/aws4_request, SignedHeaders=([^,]+), Signature=([0-9a-f]{64})$/);
    if (!m || m[1] !== this.accessKey) return false;
    const amzDate = String(req.headers['x-amz-date'] ?? '');
    const payloadHash = String(req.headers['x-amz-content-sha256'] ?? '');
    if (payloadHash !== sha256Hex(body)) return false;
    const headers: Record<string, string> = {};
    for (const n of m[4].split(';')) if (n !== 'host') headers[n] = String(req.headers[n] ?? '');
    const query: Record<string, string> = {};
    url.searchParams.forEach((v, k) => { query[k] = v; });
    const expect = signV4({ method: req.method ?? 'GET', host: String(req.headers.host), path: decodeURIComponent(url.pathname), query, headers, payloadHash, amzDate, region: m[3], accessKey: this.accessKey, secretKey: this.secretKey });
    return expect.signature === m[5];
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const body = Buffer.concat(chunks);
    const url = new URL(req.url ?? '/', 'http://x');
    const reply = (status: number, text = '', type = 'application/xml') => { res.writeHead(status, { 'Content-Type': type }); res.end(text); };
    const query: Record<string, string> = {};
    url.searchParams.forEach((v, k) => { query[k] = v; });
    const path = decodeURIComponent(url.pathname);
    this.requests.push({ method: req.method ?? '', path, query, headers: { ...req.headers } });

    const method = req.method ?? 'GET';
    const isPublicRead = method === 'GET' && path.startsWith(`/${this.bucket}/`) && !req.headers.authorization; // ảnh công khai đọc theo khóa (ADR-018)
    if (!isPublicRead && !this.authentic(req, url, body)) return reply(403, '<Error><Code>SignatureDoesNotMatch</Code></Error>');
    const prefix = `/${this.bucket}/`;
    if (method === 'PUT' && path.startsWith(prefix)) {
      if (this.failPut) return reply(this.failPut, '<Error><Code>InternalError</Code></Error>');
      const h = Object.fromEntries(Object.entries(req.headers).map(([k, v]) => [k, String(v)]));
      this.objects.set(path.slice(prefix.length), { body, contentType: h['content-type'] ?? '', headers: h, lastModified: new Date() });
      return reply(200);
    }
    if (method === 'DELETE' && path.startsWith(prefix)) {
      if (this.failDelete) return reply(this.failDelete, '<Error><Code>InternalError</Code></Error>');
      this.objects.delete(path.slice(prefix.length));
      return reply(204);
    }
    if (method === 'GET' && path.startsWith(prefix)) {
      const o = this.objects.get(path.slice(prefix.length));
      if (!o) return reply(404, '<Error><Code>NoSuchKey</Code></Error>');
      res.writeHead(200, { 'Content-Type': o.contentType });
      res.end(o.body);
      return;
    }
    if (method === 'GET' && path === `/${this.bucket}` && query['list-type'] === '2') {
      const all = this.keys(query.prefix ?? '');
      const start = query['continuation-token'] ? all.findIndex((k) => k > query['continuation-token']) : 0;
      const page = start < 0 ? [] : all.slice(start, start + this.pageSize);
      const more = start >= 0 && start + this.pageSize < all.length;
      const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
      return reply(200, `<?xml version="1.0"?><ListBucketResult><IsTruncated>${more}</IsTruncated>${more ? `<NextContinuationToken>${esc(page[page.length - 1])}</NextContinuationToken>` : ''}` +
        page.map((k) => `<Contents><Key>${esc(k)}</Key><LastModified>${this.objects.get(k)!.lastModified.toISOString()}</LastModified><Size>${this.objects.get(k)!.body.length}</Size></Contents>`).join('') + '</ListBucketResult>');
    }
    return reply(400, '<Error><Code>BadRequest</Code></Error>');
  }
}
