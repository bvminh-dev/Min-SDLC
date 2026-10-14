import { GREETING_NAME_MAX, type EmailType } from './config';
import { cleanText, fieldsFromData, formatVn, notificationContent, type Content } from './templates';

export interface RenderedMail { subject: string; text: string; html: string }
export interface RenderContext {
  /** Họ tên hỏi AUTH lúc gửi: chỉ vào lời chào ở thân, sau khi làm sạch (không bao giờ vào tiêu đề hay header, NTF-REQ-20261006-103208551 BR7). */
  fullName: string;
  /** `APP_BASE_URL` từ cấu hình (không lấy từ dữ liệu event hay Host header, BR8), không có dấu `/` cuối. */
  baseUrl: string;
  /** Chỉ cho hai loại chứa bí mật: token thô ở bộ nhớ và hạn của nó. */
  secret?: { token: string; expiresAt: Date };
}

export const escapeHtml = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

/** Lời chào: họ tên bỏ ký tự xuống dòng và điều khiển (đổi thành một khoảng trắng), cắt 50 ký tự (còn escape khi vào phần HTML). */
export const greetingName = (fullName: unknown): string => (typeof fullName === 'string' ? cleanText(fullName, GREETING_NAME_MAX) : '');

function contentOf(type: EmailType, data: unknown, ctx: RenderContext): Content {
  if (type === 'password_reset' || type === 'email_verification') {
    const s = ctx.secret;
    if (!s) throw new Error('email chứa bí mật cần token');
    const until = formatVn(s.expiresAt.toISOString());
    return type === 'password_reset'
      ? { title: 'Đặt lại mật khẩu', body: `Chúng tôi nhận được yêu cầu đặt lại mật khẩu cho tài khoản của bạn. Liên kết có hiệu lực đến ${until} (giờ Việt Nam). Nếu không phải bạn, hãy bỏ qua email này.`, link: `/reset-password#token=${s.token}` }
      : { title: 'Xác minh email của bạn', body: `Vui lòng xác minh địa chỉ email của bạn. Liên kết có hiệu lực đến ${until} (giờ Việt Nam).`, link: `/verify-email#token=${s.token}` };
  }
  return notificationContent(type, fieldsFromData(type, data));
}

/**
 * Dựng thư từ mẫu cố định (NTF-REQ-20261006-103208551 BR7, BR8): tiêu đề chỉ từ mẫu; thân chữ thuần và HTML có lời chào, nội dung mẫu và liên kết `<APP_BASE_URL><đường dẫn cố định>`.
 * Mọi giá trị vào HTML đều escape (SB-12). Không có tiêu đề hay header nào chứa dữ liệu người dùng.
 */
export function renderEmail(type: EmailType, data: unknown, ctx: RenderContext): RenderedMail {
  const c = contentOf(type, data, ctx);
  const name = greetingName(ctx.fullName);
  const hello = name ? `Xin chào ${name},` : 'Xin chào,';
  const url = c.link ? `${ctx.baseUrl}${c.link}` : null;
  const text = [hello, '', c.body, ...(url ? ['', url] : []), ''].join('\n');
  const html = `<!doctype html><html><body><p>${escapeHtml(hello)}</p><p>${escapeHtml(c.body)}</p>${url ? `<p><a href="${escapeHtml(url)}">${escapeHtml(url)}</a></p>` : ''}</body></html>`;
  return { subject: c.title, text, html };
}
