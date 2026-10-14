import { clientIp, normalizeIp } from '../../src/modules/platform';

// IP client của nền (PRJ-REQ-20261006-095422650 BR9): một nơi chuẩn hóa IPv4 ánh xạ IPv6 cho mọi module (giới hạn tần suất, log, danh sách IP của PAY).
const req = (socket: string | undefined, xff?: string | string[]) => ({ socket: { remoteAddress: socket }, headers: xff === undefined ? {} : { 'x-forwarded-for': xff } }) as never;

describe('clientIp và normalizeIp của platform (PRJ-REQ-20261006-095422650 BR9)', () => {
  it('PRJ-TC-20261013-184314345: IPv4 ánh xạ IPv6 `::ffff:a.b.c.d` đổi về `a.b.c.d` ở IP kết nối và ở X-Forwarded-For; mọi chuỗi khác giữ nguyên; bước proxy vẫn đếm từ phải', () => {
    expect(normalizeIp('::ffff:203.0.113.50')).toBe('203.0.113.50');
    expect(normalizeIp('::FFFF:203.0.113.50')).toBe('203.0.113.50');
    for (const keep of ['203.0.113.50', '2001:db8::1', '::1', '::ffff:zz', '::ffff:1.2.3', 'unknown', '::ffff:1.2.3.4.5', '::ffff:999.1.1.1', '::ffff:0:1.2.3.4']) expect(normalizeIp(keep)).toBe(keep);

    expect(clientIp(req('::ffff:203.0.113.51'), 0)).toBe('203.0.113.51'); // IP kết nối, không tin X-Forwarded-For
    expect(clientIp(req('::ffff:10.0.0.1', '198.51.100.7'), 0)).toBe('10.0.0.1');
    expect(clientIp(req('10.0.0.1', '203.0.113.9, ::ffff:198.51.100.7'), 1)).toBe('198.51.100.7'); // phần tử do proxy tin cậy thêm cũng được chuẩn hóa
    expect(clientIp(req('10.0.0.1', ['203.0.113.9', '198.51.100.7, 198.51.100.8']), 2)).toBe('198.51.100.7'); // nhiều header gộp lại
    expect(clientIp(req('::ffff:10.0.0.1', 'khong-phai-ip'), 1)).toBe('10.0.0.1'); // phần tử sai thì về IP kết nối (đã chuẩn hóa)
    expect(clientIp(req('::ffff:10.0.0.1'), 1)).toBe('10.0.0.1'); // không có header
    expect(clientIp(req(undefined), 0)).toBe('unknown');
    expect(clientIp(req('2001:db8::5', '2001:db8::9'), 1)).toBe('2001:db8::9'); // IPv6 thật giữ nguyên
  });
});
