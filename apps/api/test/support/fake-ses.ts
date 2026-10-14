import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { sha256Hex, signV4 } from '../../src/modules/platform';

export interface SesRequest { path: string; headers: Record<string, string | string[] | undefined>; raw: string; body: any; authentic: boolean }
export interface SesMail { from: string; to: string[]; subject: string; text: string; html: string }

/**
 * Amazon SES v2 giả tối thiểu (`POST /v2/email/outbound-emails`) chạy trong tiến trình test: KIỂM chữ ký SigV4 của client (tính lại bằng bộ ký của mã, vùng `ses`) và băm nội dung,
 * ghi mọi yêu cầu, trả kết quả theo kịch bản (thành công, lỗi có mã `x-amzn-ErrorType`, chậm). KHÁC SES thật: không có hạn mức gửi, danh sách chặn, xác minh người gửi, hạn ngạch; chữ ký chỉ được kiểm
 * bằng CHÍNH hàm ký của mã nên cần thêm vectơ hằng số (test/notification/ses.spec.ts). Dùng chung cho Jest và máy chủ E2E.
 */
export class FakeSes {
  readonly requests: SesRequest[] = [];
  /** Kịch bản theo thứ tự yêu cầu hợp lệ: trạng thái và mã lỗi; hết kịch bản thì `fallback`. */
  script: { status: number; type?: string }[] = [];
  fallback: { status: number; type?: string } = { status: 200 };
  delayMs = 0;
  private server: Server | null = null;
  url = '';
  constructor(readonly region = 'ap-southeast-1', readonly accessKey = 'AKIAFAKESESKEY00000', readonly secretKey = 'fakeSesSecretKeyOnlyForTests0123456789') {} // scan-secrets:allow giá trị giả của test

  async start(port = 0): Promise<string> {
    this.server = createServer((req, res) => void this.handle(req, res));
    await new Promise<void>((r) => this.server!.listen(port, '127.0.0.1', r));
    this.url = `http://127.0.0.1:${(this.server.address() as AddressInfo).port}`;
    return this.url;
  }
  async stop(): Promise<void> { await new Promise<void>((r) => (this.server ? this.server.close(() => r()) : r())); this.server?.closeAllConnections(); }
  reset(): void { this.requests.length = 0; this.script = []; this.fallback = { status: 200 }; this.delayMs = 0; }
  get mails(): SesMail[] {
    return this.requests.filter((r) => r.authentic && r.body?.Content?.Simple).map((r) => ({
      from: r.body.FromEmailAddress, to: r.body.Destination.ToAddresses, subject: r.body.Content.Simple.Subject.Data,
      text: r.body.Content.Simple.Body.Text.Data, html: r.body.Content.Simple.Body.Html.Data,
    }));
  }

  private authentic(req: IncomingMessage, raw: string): boolean {
    const m = String(req.headers.authorization ?? '').match(/^AWS4-HMAC-SHA256 Credential=([^/]+)\/(\d{8})\/([^/]+)\/ses\/aws4_request, SignedHeaders=([^,]+), Signature=([0-9a-f]{64})$/);
    if (!m || m[1] !== this.accessKey || m[3] !== this.region) return false;
    const amzDate = String(req.headers['x-amz-date'] ?? '');
    const headers: Record<string, string> = {};
    for (const n of m[4].split(';')) if (n !== 'host') headers[n] = String(req.headers[n] ?? '');
    const url = new URL(req.url ?? '/', 'http://x');
    const expect = signV4({ method: req.method ?? 'POST', host: String(req.headers.host), path: decodeURIComponent(url.pathname), headers, payloadHash: sha256Hex(raw), amzDate, region: m[3], service: 'ses', accessKey: this.accessKey, secretKey: this.secretKey });
    return expect.signature === m[5];
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const raw = Buffer.concat(chunks).toString('utf8');
    let body: any = null;
    try { body = JSON.parse(raw); } catch { /* thân không phải JSON */ }
    const url = new URL(req.url ?? '/', 'http://x');
    const authentic = req.method === 'POST' && url.pathname === '/v2/email/outbound-emails' && this.authentic(req, raw);
    this.requests.push({ path: url.pathname, headers: { ...req.headers }, raw, body, authentic });
    if (this.delayMs) await new Promise((r) => setTimeout(r, this.delayMs));
    if (!authentic) { res.writeHead(403, { 'Content-Type': 'application/json', 'x-amzn-ErrorType': 'SignatureDoesNotMatch' }); res.end('{"message":"The request signature we calculated does not match"}'); return; }
    const step = this.script.length ? this.script.shift()! : this.fallback;
    if (step.status === 200) { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('{"MessageId":"0000000000000000-fake"}'); return; }
    res.writeHead(step.status, { 'Content-Type': 'application/json', ...(step.type ? { 'x-amzn-ErrorType': step.type } : {}) });
    res.end(JSON.stringify({ message: 'fake SES error with details: u1@shop.vn token=SECRET-DETAIL' })); // thân lỗi có chi tiết nhạy cảm: client không được đưa vào log hay lỗi
  }
}
