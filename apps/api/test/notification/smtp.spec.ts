import { MailError, SmtpTransport, UnconfiguredTransport, createMailTransport, createNtfConfig } from '../../src/modules/notification/mail';
import { testConfig } from '../support/app';

// Bộ chuyển thư SMTP (thay SES, vd Office 365): chọn theo SMTP_HOST, ưu tiên hơn SES; thiếu tài khoản hay người gửi thì "chưa cấu hình"
const SMTP = { SMTP_HOST: 'smtp.office365.com', SMTP_USER: 'itadmin@shop.vn', SMTP_PASSWORD: 'pw', MAIL_FROM: 'itadmin@shop.vn', MAIL_FROM_NAME: 'ECom' };
const MSG = { from: 'itadmin@shop.vn', to: 'u1@shop.vn', subject: 'Xin chào', text: 'Nội dung', html: '<p>Nội dung</p>' };

describe('NTF bộ chuyển thư SMTP', () => {
  it('chọn SmtpTransport khi đủ SMTP_HOST, SMTP_USER, SMTP_PASSWORD, MAIL_FROM; ưu tiên hơn SES', () => {
    expect(createMailTransport(createNtfConfig(testConfig(SMTP)))).toBeInstanceOf(SmtpTransport);
    expect(createMailTransport(createNtfConfig(testConfig({ ...SMTP, SES_REGION: 'ap-southeast-1', SES_ACCESS_KEY: 'k', SES_SECRET_KEY: 's' })))).toBeInstanceOf(SmtpTransport);
  });

  it('thiếu mật khẩu, tài khoản hay MAIL_FROM thì UnconfiguredTransport (không gọi mạng)', () => {
    for (const miss of ['SMTP_USER', 'SMTP_PASSWORD', 'MAIL_FROM'] as const) {
      expect(createMailTransport(createNtfConfig(testConfig({ ...SMTP, [miss]: '' })))).toBeInstanceOf(UnconfiguredTransport);
    }
  });

  it('mặc định cổng 587 và STARTTLS bật; tên hiển thị có xuống dòng hay dấu nháy bị từ chối lúc nạp cấu hình', () => {
    const c = createNtfConfig(testConfig(SMTP));
    expect(c).toMatchObject({ SMTP_PORT: 587, SMTP_STARTTLS: true });
    for (const bad of ['A\r\nBcc: x@y.z', 'A"B', 'A<b>']) expect(() => createNtfConfig(testConfig({ ...SMTP, MAIL_FROM_NAME: bad }))).toThrow();
  });

  it('không kết nối được máy chủ: lỗi tạm thời smtp_error, không lộ thông điệp thô', async () => {
    const t = new SmtpTransport({ host: '127.0.0.1', port: 1, startTls: true, user: 'u', password: 'p', fromName: 'ECom' });
    const e = await t.send(MSG).then(() => null, (x: unknown) => x);
    expect(e).toBeInstanceOf(MailError);
    expect(e).toMatchObject({ permanent: false, code: 'smtp_error', message: 'smtp_error' });
  });
});
