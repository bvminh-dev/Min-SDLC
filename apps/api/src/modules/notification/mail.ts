import { ConfigError, signV4, sha256Hex, type ConfigService } from '../platform';
import { SES_TIMEOUT_MS, type NtfConfig } from './config';

/** Thông điệp gửi đi: mọi trường đã dựng từ mẫu cố định (NTF-REQ-20261006-103208551 BR7); `to` là địa chỉ hỏi AUTH lúc gửi, không bao giờ từ payload. */
export interface MailMessage { from: string; to: string; subject: string; text: string; html: string }

/** Lỗi gửi đã chuẩn hóa: `code` là mã ngắn cố định (lưu ở `delivery_reason`), không bao giờ chứa nội dung phản hồi thô của SES (có thể nêu chi tiết hạ tầng, NTF-DB). `permanent` thì không thử lại. */
export class MailError extends Error {
  constructor(readonly code: string, readonly permanent: boolean) { super(code); this.name = 'MailError'; }
}

export interface MailTransport { send(m: MailMessage, signal?: AbortSignal): Promise<void> }
export const MAIL_TRANSPORT = Symbol('MAIL_TRANSPORT');

/** Chưa cấu hình SES (dev): không gửi đi đâu, mọi thư thất bại ngay với mã cố định. */
export class UnconfiguredTransport implements MailTransport {
  async send(): Promise<void> { throw new MailError('ses_unconfigured', true); }
}

export interface SesOptions { endpoint: string; region: string; accessKey: string; secretKey: string }
const amzDate = (d: Date): string => d.toISOString().replace(/[-:]|\.\d{3}/g, '');

/**
 * Client Amazon SES v2 (`POST /v2/email/outbound-emails`, nội dung `Simple`) ký SigV4 bằng bộ ký dùng chung của platform; không thêm SDK cho một thao tác (ADR-010).
 * Nội dung gửi là JSON có trường riêng cho `Subject`, `To`: không dựng thông điệp MIME bằng tay nên không có chỗ để chèn header (`Bcc`, `Subject`) qua xuống dòng (NTF-SEC T3);
 * `Destination` chỉ có `ToAddresses`. CHƯA thử với SES thật (chỉ với bộ giả lập tự dựng kiểm chữ ký, xem report NTF).
 */
export class SesTransport implements MailTransport {
  private readonly base: URL;
  constructor(private readonly o: SesOptions, private readonly fetchFn: typeof fetch = fetch, private readonly nowFn: () => Date = () => new Date()) {
    this.base = new URL(o.endpoint);
  }

  async send(m: MailMessage, signal?: AbortSignal): Promise<void> {
    const body = JSON.stringify({
      FromEmailAddress: m.from,
      Destination: { ToAddresses: [m.to] },
      Content: { Simple: { Subject: { Data: m.subject, Charset: 'UTF-8' }, Body: { Text: { Data: m.text, Charset: 'UTF-8' }, Html: { Data: m.html, Charset: 'UTF-8' } } } },
    });
    const payloadHash = sha256Hex(body);
    const date = amzDate(this.nowFn());
    const path = '/v2/email/outbound-emails';
    const headers = { 'content-type': 'application/json', 'x-amz-date': date };
    const sig = signV4({ method: 'POST', host: this.base.host, path, headers, payloadHash, amzDate: date, region: this.o.region, service: 'ses', accessKey: this.o.accessKey, secretKey: this.o.secretKey });
    let res: Response;
    try {
      res = await this.fetchFn(`${this.base.origin}${path}`, {
        method: 'POST', headers: { ...headers, Authorization: sig.authorization }, body,
        signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(SES_TIMEOUT_MS)]) : AbortSignal.timeout(SES_TIMEOUT_MS),
      });
    } catch (e) {
      const name = (e as Error)?.name;
      throw new MailError(name === 'TimeoutError' || name === 'AbortError' ? 'ses_timeout' : 'ses_network', false);
    }
    if (res.ok) { await res.arrayBuffer().catch(() => undefined); return; }
    const type = String(res.headers.get('x-amzn-errortype') ?? '').split(':')[0];
    await res.arrayBuffer().catch(() => undefined); // đọc hết để giải phóng kết nối, không đọc nội dung
    if (res.status === 429 || /Throttl|TooManyRequests/i.test(type)) throw new MailError('ses_throttled', false);
    if (res.status >= 500) throw new MailError('ses_unavailable', false);
    if (res.status === 401 || res.status === 403) throw new MailError('ses_auth', true);
    throw new MailError('ses_rejected', true);
  }
}

/** Cấu hình đã kiểm cho NTF; dừng lúc khởi động khi sai (ADR-007): ngoài dev `APP_BASE_URL` và `SES_ENDPOINT` (nếu đặt) phải là https (NTF-REQ-20261006-103208551 BR8, SB-09). */
export function createNtfConfig(c: ConfigService): NtfConfig {
  const v: NtfConfig = {
    SES_REGION: c.get<string>('SES_REGION'), MAIL_FROM: c.get<string>('MAIL_FROM'), APP_BASE_URL: c.get<string>('APP_BASE_URL'),
    SES_ACCESS_KEY: c.get<string>('SES_ACCESS_KEY'), SES_SECRET_KEY: c.get<string>('SES_SECRET_KEY'), SES_ENDPOINT: c.get<string>('SES_ENDPOINT'),
  };
  const dev = c.get('APP_ENV') === 'dev';
  const problems: { name: string; reason: string }[] = [];
  if (!dev && !v.APP_BASE_URL.startsWith('https://')) problems.push({ name: 'APP_BASE_URL', reason: 'phải là https ở staging và prod (SB-09)' });
  if (!dev && v.SES_ENDPOINT && !v.SES_ENDPOINT.startsWith('https://')) problems.push({ name: 'SES_ENDPOINT', reason: 'phải là https ở staging và prod (SB-09)' });
  if (problems.length) throw new ConfigError(problems);
  return { ...v, APP_BASE_URL: (v.APP_BASE_URL || 'http://localhost:3000').replace(/\/+$/, '') };
}

/** Bộ chuyển thư theo cấu hình: thiếu khóa, vùng hay người gửi thì `UnconfiguredTransport` (dev); ngoài dev, thiếu biến đã dừng ở bước nạp cấu hình. */
export function createMailTransport(c: NtfConfig): MailTransport {
  const endpoint = c.SES_ENDPOINT || (c.SES_REGION ? `https://email.${c.SES_REGION}.amazonaws.com` : '');
  if (!endpoint || !c.SES_ACCESS_KEY || !c.SES_SECRET_KEY || !c.MAIL_FROM) return new UnconfiguredTransport();
  return new SesTransport({ endpoint, region: c.SES_REGION || 'us-east-1', accessKey: c.SES_ACCESS_KEY, secretKey: c.SES_SECRET_KEY });
}
