import { createHmac } from 'node:crypto';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { HttpVnpayGateway } from '../../src/modules/payment/gateway';
import { buildPayUrl, failReasonOf, fromVnpAmount, hmac512, isSuccess, sameHex, sign, signData, toVnpAmount, verifySignature, vnpDate } from '../../src/modules/payment/vnpay';
import { loadConfig } from '../../src/modules/platform';
import { PAY_ENV, SECRET, TMN } from '../support/pay';
import { testDbUrl } from '../support/db';

// Cổng VNPay: ký, kiểm chữ ký, đường dẫn thanh toán, truy vấn và hoàn tiền. YẾU: bộ giả lập (máy chủ HTTP cục bộ) dựng theo tài liệu VNPay v2.1.0, CHƯA thử với sandbox thật của VNPay (xem report PAY, Lệch spec).
const REF = 'a1b2c3d4e5f6071801';
const rawHmac = (data: string) => createHmac('sha512', SECRET).update(data, 'utf8').digest('hex'); // tính độc lập với mã module

describe('PAY ký và kiểm chữ ký VNPay (vnpay.ts)', () => {
  it('PAY-TC-20261006-104539065 (T1): chuỗi ký theo thứ tự chữ cái của tên tham số, giá trị mã hóa (khoảng trắng thành +), bỏ vnp_SecureHash và vnp_SecureHashType; HMAC-SHA512 khớp bản tính độc lập', () => {
    const params = { vnp_TxnRef: REF, vnp_Amount: '35000000', vnp_OrderInfo: 'Thanh toan don 7K3M9Q2XH4TB', vnp_ReturnUrl: 'https://shop.example/orders/7K3M9Q2XH4TB/payment?a=b&c=d', vnp_SecureHash: 'x', vnp_SecureHashType: 'HmacSHA512', vnp_Bank: 'Ngân hàng' };
    const data = signData(params);
    expect(data).toBe(`vnp_Amount=35000000&vnp_Bank=Ng%C3%A2n+h%C3%A0ng&vnp_OrderInfo=Thanh+toan+don+7K3M9Q2XH4TB&vnp_ReturnUrl=https%3A%2F%2Fshop.example%2Forders%2F7K3M9Q2XH4TB%2Fpayment%3Fa%3Db%26c%3Dd&vnp_TxnRef=${REF}`);
    expect(sign(params, SECRET)).toBe(rawHmac(data));
    expect(sign(params, SECRET)).toMatch(/^[0-9a-f]{128}$/);
    expect(sign({ ...params, vnp_Amount: '1' }, SECRET)).not.toBe(sign(params, SECRET)); // mọi tham số đều nằm trong chữ ký
    expect(sign(params, 'khoa-khac')).not.toBe(sign(params, SECRET));
    const reordered = Object.fromEntries(Object.entries(params).reverse());
    expect(sign(reordered, SECRET)).toBe(sign(params, SECRET)); // thứ tự khóa đầu vào không ảnh hưởng
  });

  it('PAY-TC-20261006-104539065 (T1): verifySignature chỉ đúng khi chuỗi hex 128 ký tự khớp (không phân biệt hoa thường của hex), khóa rỗng thì luôn sai; sameHex loại chữ ký sai độ dài hay không phải hex', () => {
    const params = { vnp_TxnRef: REF, vnp_Amount: '35000000' };
    const good = sign(params, SECRET);
    expect(verifySignature(params, good, SECRET)).toBe(true);
    expect(verifySignature(params, good.toUpperCase(), SECRET)).toBe(true);
    expect(verifySignature({ ...params, vnp_Amount: '100' }, good, SECRET)).toBe(false);
    expect(verifySignature(params, good, 'sai-khoa')).toBe(false);
    for (const bad of [undefined, null, 42, '', 'abc', good.slice(1), `${good}0`, `${good.slice(0, 127)}z`, [good], { x: good }]) expect(verifySignature(params, bad, SECRET)).toBe(false);
    expect(verifySignature(params, sign(params, ''), '')).toBe(false); // khóa rỗng không bao giờ xác thực
    expect(sameHex(good, good)).toBe(true);
    expect(sameHex('abc', 'abc')).toBe(false); // không phải 128 hex
  });

  it('PAY-TC-20261006-104538705: số tiền ×100 bằng BigInt (không mất chữ số), ngược lại chỉ nhận số nguyên dương chia hết cho 100; ngày giờ theo GMT+7 qua nửa đêm; thành công khi cả hai mã là 00', () => {
    expect(toVnpAmount(350000n)).toBe('35000000');
    expect(toVnpAmount(999_999_999n)).toBe('99999999900');
    expect(toVnpAmount(9_007_199_254_740_993n)).toBe('900719925474099300'); // vượt 2^53: Number làm mất chữ số cuối
    expect(fromVnpAmount('35000000')).toBe(350000n);
    for (const bad of ['', '0', '100.0', '35000050', '-100', '1e5', ' 100', '0x64', 'abc', '9'.repeat(21), '１００']) expect([bad, fromVnpAmount(bad)]).toEqual([bad, null]);
    expect(fromVnpAmount('900719925474099300')).toBe(9_007_199_254_740_993n);
    expect(vnpDate(new Date('2026-10-06T09:00:00Z'))).toBe('20261006160000');
    expect(vnpDate(new Date('2026-12-31T17:00:00Z'))).toBe('20270101000000'); // 00:00 ngày kế theo giờ Việt Nam
    expect(vnpDate(new Date('2026-01-01T16:59:59Z'))).toBe('20260101235959');
    expect([isSuccess('00', '00'), isSuccess('00', '02'), isSuccess('24', '00'), isSuccess('', ''), isSuccess('00', '')]).toEqual([true, false, false, false, false]);
  });

  it('PAY-TC-20261006-104538705 (T2, SB-23): đường dẫn thanh toán dựng lại được từng ký tự từ dữ liệu đã lưu, chữ ký phủ mọi tham số, mô tả chỉ có mã đơn', () => {
    const input = { payUrl: 'https://sandbox.vnpayment.vn/paymentv2/vpcpay.html', tmnCode: TMN, secret: SECRET, amount: 350000n, txnRef: REF, orderCode: '7K3M9Q2XH4TB', returnUrl: 'https://shop.example/orders/7K3M9Q2XH4TB/payment', ip: '127.0.0.1', createDate: new Date('2026-10-06T09:01:00Z'), expireDate: new Date('2026-10-06T09:11:00Z') };
    const u = buildPayUrl(input);
    expect(buildPayUrl({ ...input })).toBe(u);
    const url = new URL(u);
    const params = Object.fromEntries(url.searchParams.entries());
    expect(url.origin + url.pathname).toBe(input.payUrl);
    expect(params).toMatchObject({ vnp_Version: '2.1.0', vnp_Command: 'pay', vnp_TmnCode: TMN, vnp_Amount: '35000000', vnp_CurrCode: 'VND', vnp_TxnRef: REF, vnp_OrderInfo: 'Thanh toan don 7K3M9Q2XH4TB', vnp_CreateDate: '20261006160100', vnp_ExpireDate: '20261006161100', vnp_IpAddr: '127.0.0.1' });
    const { vnp_SecureHash: given, ...rest } = params;
    expect(verifySignature(rest, given, SECRET)).toBe(true);
    expect(given).toBe(rawHmac(signData(rest)));
    expect(buildPayUrl({ ...input, amount: 1n })).not.toBe(u);
    expect(u).not.toContain(SECRET);
  });

  it('PAY-TC-20261006-130000400 (M-06): ánh xạ mã trả lời của cổng sang mã lý do cố định của PaymentFailed', () => {
    expect(failReasonOf('24')).toBe('cancelled_by_user');
    expect(failReasonOf('11')).toBe('timeout');
    for (const c of ['07', '09', '10', '12', '13', '51', '65', '79']) expect([c, failReasonOf(c)]).toEqual([c, 'declined']);
    for (const c of ['75', '99', '', 'x', '00', '24 ']) expect([c, failReasonOf(c)]).toEqual([c, 'other']);
  });
});

describe('PAY máy khách HTTP của VNPay (gateway.ts) với cổng giả cục bộ', () => {
  let server: Server;
  let url: string;
  let handler: (body: Record<string, string>, req: IncomingMessage) => { status?: number; json?: unknown; text?: string; delayMs?: number };
  const requests: Record<string, string>[] = [];
  beforeAll(async () => {
    server = createServer((req, res) => {
      let s = '';
      req.on('data', (d) => { s += d; });
      req.on('end', () => {
        const body = JSON.parse(s || '{}') as Record<string, string>;
        requests.push(body);
        const r = handler(body, req);
        setTimeout(() => { res.writeHead(r.status ?? 200, { 'Content-Type': 'application/json', Connection: 'close' }); res.end(r.text ?? JSON.stringify(r.json ?? {})); }, r.delayMs ?? 0);
      });
    });
    await new Promise<void>((res) => server.listen(0, '127.0.0.1', res));
    url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/transaction`;
  });
  afterAll(() => new Promise<void>((res) => { server.closeAllConnections(); server.close(() => res()); }));
  beforeEach(() => { requests.length = 0; });
  const gw = (over: Record<string, string> = {}) => new HttpVnpayGateway(loadConfig({ APP_ENV: 'dev', DATABASE_URL: testDbUrl(), CORS_ALLOWED_ORIGINS: 'http://localhost:3000', ...PAY_ENV, VNPAY_API_URL: url, VNPAY_HASH_SECRET: SECRET, ...over }));
  /** Phản hồi ký đúng theo thứ tự trường của tài liệu VNPay. */
  const signed = (f: Record<string, string>, refund = false): Record<string, string> => {
    const keys = refund
      ? ['vnp_ResponseId', 'vnp_Command', 'vnp_ResponseCode', 'vnp_Message', 'vnp_TmnCode', 'vnp_TxnRef', 'vnp_Amount', 'vnp_BankCode', 'vnp_PayDate', 'vnp_TransactionNo', 'vnp_TransactionType', 'vnp_TransactionStatus', 'vnp_OrderInfo']
      : ['vnp_ResponseId', 'vnp_Command', 'vnp_ResponseCode', 'vnp_Message', 'vnp_TmnCode', 'vnp_TxnRef', 'vnp_Amount', 'vnp_BankCode', 'vnp_PayDate', 'vnp_TransactionNo', 'vnp_TransactionType', 'vnp_TransactionStatus', 'vnp_OrderInfo', 'vnp_PromotionCode', 'vnp_PromotionAmount'];
    return { ...f, vnp_SecureHash: rawHmac(keys.map((k) => f[k] ?? '').join('|')) };
  };
  const q = { txnRef: REF, amount: 350000n, createDate: new Date('2026-10-06T09:01:00Z'), orderInfo: 'Thanh toan don 7K3M9Q2XH4TB' };

  it('PAY-TC-20261006-104539621 (T20): querydr: yêu cầu có đủ trường và chữ ký đúng thứ tự tài liệu; phản hồi 00 kèm TransactionStatus 00 là success (đúng số tiền ×100), trạng thái khác là failed, mã 91 là not_found', async () => {
    handler = () => ({ json: signed({ vnp_ResponseId: 'r1', vnp_Command: 'querydr', vnp_ResponseCode: '00', vnp_Message: 'OK', vnp_TmnCode: TMN, vnp_TxnRef: REF, vnp_Amount: '35000000', vnp_TransactionNo: '14012345', vnp_TransactionStatus: '00' }) });
    expect(await gw().queryTransaction(q)).toEqual({ kind: 'success', transactionNo: '14012345', amount: 350000n, code: '00' });
    const r = requests[0];
    expect(r).toMatchObject({ vnp_Command: 'querydr', vnp_Version: '2.1.0', vnp_TmnCode: TMN, vnp_TxnRef: REF, vnp_TransactionDate: '20261006160100', vnp_OrderInfo: q.orderInfo });
    expect(r.vnp_RequestId).toMatch(/^[0-9a-f]{32}$/);
    expect(r.vnp_SecureHash).toBe(rawHmac([r.vnp_RequestId, r.vnp_Version, r.vnp_Command, r.vnp_TmnCode, r.vnp_TxnRef, r.vnp_TransactionDate, r.vnp_CreateDate, r.vnp_IpAddr, r.vnp_OrderInfo].join('|')));
    expect(JSON.stringify(r)).not.toContain(SECRET);
    handler = () => ({ json: signed({ vnp_ResponseId: 'r2', vnp_Command: 'querydr', vnp_ResponseCode: '00', vnp_Message: 'OK', vnp_TmnCode: TMN, vnp_TxnRef: REF, vnp_Amount: '35000000', vnp_TransactionNo: '0', vnp_TransactionStatus: '02' }) });
    expect(await gw().queryTransaction(q)).toEqual({ kind: 'failed', code: '02', amount: 350000n });
    handler = () => ({ json: signed({ vnp_ResponseId: 'r3', vnp_Command: 'querydr', vnp_ResponseCode: '91', vnp_Message: 'Not found', vnp_TmnCode: TMN, vnp_TxnRef: REF }) });
    expect(await gw().queryTransaction(q)).toEqual({ kind: 'not_found' });
  });

  it('PAY-TC-20261006-104539653: querydr: lỗi cổng (HTTP 500, không phải JSON, mã khác 00 và 91, phản hồi sai chữ ký, số tiền hỏng, hết hạn gọi) đều là error (không kết luận), không bao giờ coi là thành công; khóa ký rỗng thì không gọi', async () => {
    const ok = { vnp_ResponseId: 'r', vnp_Command: 'querydr', vnp_ResponseCode: '00', vnp_Message: 'OK', vnp_TmnCode: TMN, vnp_TxnRef: REF, vnp_Amount: '35000000', vnp_TransactionNo: '14012345', vnp_TransactionStatus: '00' };
    const cases: [string, () => ReturnType<typeof handler>][] = [
      ['HTTP 500', () => ({ status: 500, text: 'lỗi' })], ['không phải JSON', () => ({ text: '<html>' })], ['mã 99', () => ({ json: signed({ ...ok, vnp_ResponseCode: '99' }) })],
      ['sai chữ ký', () => ({ json: { ...signed(ok), vnp_SecureHash: 'a'.repeat(128) } })], ['thiếu chữ ký', () => ({ json: ok })], ['sửa số tiền sau khi ký', () => ({ json: { ...signed(ok), vnp_Amount: '100' } })],
      ['số tiền hỏng', () => ({ json: signed({ ...ok, vnp_Amount: 'abc' }) })],
    ];
    for (const [name, h] of cases) { handler = h; expect([name, await gw().queryTransaction(q)]).toEqual([name, { kind: 'error' }]); }
    handler = () => ({ json: signed(ok), delayMs: 1500 });
    const slow = gw(); slow.timeoutMs = 150;
    const t0 = Date.now();
    expect(await slow.queryTransaction(q)).toEqual({ kind: 'error' }); // hết hạn gọi: không treo
    expect(Date.now() - t0).toBeLessThan(1200);
    requests.length = 0;
    expect(await gw({ VNPAY_HASH_SECRET: '' }).queryTransaction(q)).toEqual({ kind: 'error' });
    expect(requests).toEqual([]); // chưa cấu hình: không gọi mạng
    expect(await new HttpVnpayGateway(loadConfig({ APP_ENV: 'dev', DATABASE_URL: testDbUrl(), CORS_ALLOWED_ORIGINS: 'http://localhost:3000', ...PAY_ENV, VNPAY_API_URL: 'http://127.0.0.1:1/x', VNPAY_HASH_SECRET: SECRET })).queryTransaction(q)).toEqual({ kind: 'error' }); // cổng đóng
  });

  it('PAY-TC-20261006-104540177: hoàn tiền: yêu cầu loại hoàn toàn phần (02) với mã yêu cầu 32 ký tự, số tiền ×100, mã giao dịch cổng và ngày giao dịch, chữ ký đúng thứ tự; 00 là succeeded; 94 và 99 là pending; mã từ chối là declined', async () => {
    const input = { requestId: 'f'.repeat(32), txnRef: REF, amount: 350000n, transactionNo: '14012345', transactionDate: new Date('2026-10-06T09:01:00Z'), createdBy: 'system', orderInfo: 'Hoan tien don 7K3M9Q2XH4TB' };
    const resp = (code: string) => signed({ vnp_ResponseId: 'x', vnp_Command: 'refund', vnp_ResponseCode: code, vnp_Message: 'm', vnp_TmnCode: TMN, vnp_TxnRef: REF, vnp_Amount: '35000000', vnp_TransactionNo: '14012345', vnp_TransactionType: '02', vnp_TransactionStatus: '05', vnp_OrderInfo: input.orderInfo }, true);
    handler = () => ({ json: resp('00') });
    expect(await gw().refund(input)).toEqual({ kind: 'succeeded', code: '00' });
    const r = requests[0];
    expect(r).toMatchObject({ vnp_Command: 'refund', vnp_RequestId: 'f'.repeat(32), vnp_TransactionType: '02', vnp_Amount: '35000000', vnp_TransactionNo: '14012345', vnp_TransactionDate: '20261006160100', vnp_TxnRef: REF, vnp_CreateBy: 'system', vnp_TmnCode: TMN });
    expect(r.vnp_SecureHash).toBe(rawHmac([r.vnp_RequestId, r.vnp_Version, r.vnp_Command, r.vnp_TmnCode, r.vnp_TransactionType, r.vnp_TxnRef, r.vnp_Amount, r.vnp_TransactionNo, r.vnp_TransactionDate, r.vnp_CreateBy, r.vnp_CreateDate, r.vnp_IpAddr, r.vnp_OrderInfo].join('|')));
    expect(JSON.stringify(r)).not.toContain(SECRET);
    for (const [code, kind] of [['94', 'pending'], ['99', 'pending'], ['02', 'declined'], ['91', 'declined'], ['93', 'declined'], ['95', 'declined']] as const) {
      handler = () => ({ json: resp(code) });
      const out = await gw().refund(input);
      expect([code, out.kind]).toEqual([code, kind]);
    }
    handler = () => ({ json: signed({ vnp_ResponseId: 'x', vnp_Command: 'refund', vnp_ResponseCode: '00', vnp_Message: 'm', vnp_TmnCode: TMN, vnp_TxnRef: REF, vnp_Amount: '35000000', vnp_TransactionNo: '14012345', vnp_TransactionType: '02', vnp_TransactionStatus: '09', vnp_OrderInfo: input.orderInfo }, true) });
    expect(await gw().refund(input)).toEqual({ kind: 'declined', code: '09' }); // REV-PAY-06: 00 kèm TransactionStatus 09 (hoàn trả bị từ chối) không phải thành công
    handler = () => ({ json: { ...resp('00'), vnp_SecureHash: 'b'.repeat(128) } });
    expect(await gw().refund(input)).toEqual({ kind: 'pending' }); // phản hồi sai chữ ký không bao giờ là thành công
    handler = () => ({ status: 502, text: 'bad gateway' });
    expect(await gw().refund(input)).toEqual({ kind: 'pending' });
    handler = () => ({ json: resp('00'), delayMs: 1500 });
    const slow = gw(); slow.timeoutMs = 150;
    expect(await slow.refund(input)).toEqual({ kind: 'pending' }); // hết hạn gọi: để job đối soát chốt
    requests.length = 0;
    expect(await gw({ VNPAY_TMN_CODE: '' }).refund(input)).toEqual({ kind: 'pending' });
    expect(requests).toEqual([]);
    expect(hmac512('k', 'd')).toMatch(/^[0-9a-f]{128}$/);
  });
});

// Vectơ vàng (REV-PAY-05): chuỗi ký và chữ ký là HẰNG SỐ tính một lần bằng cách tách rời mã của module (mẫu Node.js của VNPay: sortObject với encodeURIComponent, `%20` thành `+`, HMAC-SHA512 trên chuỗi UTF-8), không gọi `sign`
// hay `signData` để dựng giá trị mong đợi. Nếu sửa cách mã hóa hay thứ tự thì đỏ dù cặp `sign` và kiểm lại cùng sai (các TC ký trước đây tự ký rồi tự kiểm). Vẫn CHƯA đối chiếu với vectơ do VNPay phát hành.
describe('PAY vectơ vàng chữ ký VNPay (PAY-TC-20261006-104539065)', () => {
  const vecKey = 'test-vector-0123456789-abcdefghijklmnop';
  const params = {
    vnp_TmnCode: 'DEMOV210', vnp_Amount: '35000000', vnp_Command: 'pay', vnp_CreateDate: '20261008080203', vnp_CurrCode: 'VND', vnp_IpAddr: '127.0.0.1', vnp_Locale: 'vn',
    vnp_OrderInfo: 'Thanh toan don 7K3M9Q2XH4TB', vnp_OrderType: 'other', vnp_ReturnUrl: 'https://shop.example/orders/7K3M9Q2XH4TB/payment', vnp_TxnRef: REF, vnp_Version: '2.1.0', vnp_ExpireDate: '20261008081203',
  };
  const DATA = 'vnp_Amount=35000000&vnp_Command=pay&vnp_CreateDate=20261008080203&vnp_CurrCode=VND&vnp_ExpireDate=20261008081203&vnp_IpAddr=127.0.0.1&vnp_Locale=vn&vnp_OrderInfo=Thanh+toan+don+7K3M9Q2XH4TB&vnp_OrderType=other&vnp_ReturnUrl=https%3A%2F%2Fshop.example%2Forders%2F7K3M9Q2XH4TB%2Fpayment&vnp_TmnCode=DEMOV210&vnp_TxnRef=a1b2c3d4e5f6071801&vnp_Version=2.1.0';
  const HASH = '24e0d60f6ddceed2f667c47af62e28b19e20c98a55b91d1ec77a5770be28b475ce96291c9c225d53a4e88bc16681f08e31e30acf09eace431db9950276be395c';

  it('chuỗi ký và chữ ký khớp hằng số; chữ ký hex hoa vẫn đúng; thêm vnp_SecureHashType không đổi chữ ký; đổi một ký tự thì sai', () => {
    expect(signData(params)).toBe(DATA);
    expect(sign(params, vecKey)).toBe(HASH);
    expect(sign({ ...params, vnp_SecureHashType: 'HmacSHA512', vnp_SecureHash: 'x' }, vecKey)).toBe(HASH);
    expect(verifySignature(params, HASH, vecKey)).toBe(true);
    expect(verifySignature(params, HASH.toUpperCase(), vecKey)).toBe(true);
    expect(verifySignature({ ...params, vnp_Amount: '35000001' }, HASH, vecKey)).toBe(false);
    expect(verifySignature(params, HASH.slice(0, 127) + (HASH.endsWith('5') ? '6' : '5'), vecKey)).toBe(false);
  });

  it('đường dẫn thanh toán dựng đúng hằng số (tham số, hạn theo GMT+7, chữ ký)', () => {
    const url = buildPayUrl({ payUrl: 'https://sandbox.example/pay', tmnCode: 'DEMOV210', secret: vecKey, amount: 350000n, txnRef: REF, orderCode: '7K3M9Q2XH4TB', returnUrl: params.vnp_ReturnUrl, ip: '127.0.0.1', createDate: new Date('2026-10-08T01:02:03Z'), expireDate: new Date('2026-10-08T01:12:03Z') });
    expect(url).toBe(`https://sandbox.example/pay?${DATA}&vnp_SecureHash=${HASH}`);
  });
});
