import { cancelText, createOutcome, fieldErrorText, len, lookupQuery, parseQty, type ApiLike } from '../../../web/lib/sales';

// Hàm thuần của web (apps/web/lib/sales.ts) đưa vào test API bằng import (như checkout/web-lib.spec.ts): không cần trình duyệt. Phần giao diện chạy bằng E2E (xem report.md).
const res = (status: number, body: Record<string, unknown> = {}, code?: string, extra: Partial<ApiLike> = {}): ApiLike => ({ status, body, code, fieldErrors: {}, ...extra });

describe('Web SAL: hàm thuần (SAL-REQ-20261015-092710847, ...092710942, ...092711128, ...092711321)', () => {
  it('SAL-TC-20261015-093909632 (web): thành công 201 và phát lại 200 cùng ra mã đơn để mở chi tiết', () => {
    expect(createOutcome(res(201, { order: { code: 'HD261015-00003' } }))).toEqual({ k: 'done', code: 'HD261015-00003' });
    expect(createOutcome(res(200, { replayed: true, order: { code: 'HD261015-00003' } }))).toEqual({ k: 'done', code: 'HD261015-00003' });
  });

  it('SAL-TC-20261015-093911042 (web): mỗi lỗi của POST /sales/orders đổi thành đúng một trạng thái giao diện, giữ dữ liệu dòng lỗi (SAL-REQ ...092711128 BR7)', () => {
    expect(createOutcome(res(409, { previous_grand_total: 300000, review: { grand_total: 330000 } }, 'price-changed'))).toEqual({ k: 'price', previous: 300000, next: 330000 });
    expect(createOutcome(res(409, {}, 'order-source-unavailable'))).toEqual({ k: 'source' });
    expect(createOutcome(res(409, { items: [{ product_id: 'p1', reason: 'unavailable' }] }, 'product-unavailable'))).toEqual({ k: 'products', ids: ['p1'] });
    expect(createOutcome(res(409, { items: [{ product_id: 'p2', name: 'Tất cổ cao', requested: 5, available: 3, reason: 'insufficient_stock' }] }, 'insufficient-stock')))
      .toEqual({ k: 'stock', items: [{ product_id: 'p2', name: 'Tất cổ cao', requested: 5, available: 3 }] });
    expect(createOutcome(res(409, {}, 'shipping-method-unavailable'))).toEqual({ k: 'shipping' });
    expect(createOutcome(res(422, {}, 'customer-not-found'))).toEqual({ k: 'customer' });
    expect(createOutcome(res(422, {}, 'order-total-out-of-range'))).toEqual({ k: 'range' });
    expect(createOutcome(res(401, {}, 'unauthenticated'))).toEqual({ k: 'login' });
    expect(createOutcome(res(429, {}, 'rate-limited', { retryAfter: 17 }))).toEqual({ k: 'rate', seconds: 17 });
    expect(createOutcome(res(400, {}, 'validation-failed', { fieldErrors: { 'customer.phone': 'invalid_phone' } }))).toEqual({ k: 'form', fields: { 'customer.phone': 'invalid_phone' } });
    for (const bad of [res(503, {}, 'dependency-unavailable'), res(0), res(500), res(409, {}, 'ma-la')]) expect(createOutcome(bad)).toEqual({ k: 'error' });
    expect(createOutcome(res(409, { items: 'khong-phai-mang' }, 'insufficient-stock'))).toEqual({ k: 'stock', items: [] }); // thân lạ không làm vỡ giao diện
  });

  it('SAL-TC-20261015-093910324 (web): ô tra khách có @ thì tra theo email, còn lại theo điện thoại; khóa được mã hóa URL', () => {
    expect(lookupQuery(' 0901234567 ')).toBe('phone=0901234567');
    expect(lookupQuery('+84 901 234 567')).toBe('phone=%2B84%20901%20234%20567');
    expect(lookupQuery('an.nguyen@shop.vn')).toBe('email=an.nguyen%40shop.vn');
  });

  it('SAL-TC-20261015-093910128 (web): đếm ký tự theo điểm mã (emoji một ký tự) và số lượng 1 đến 100000', () => {
    expect(len('😀'.repeat(10) + 'a'.repeat(990))).toBe(1000);
    expect([parseQty('1'), parseQty('100000'), parseQty('100001'), parseQty('0'), parseQty(''), parseQty('1.5'), parseQty('abc')]).toEqual([1, 100000, null, null, null, null, null]);
  });

  it('SAL-TC-20261015-093912079 (web): lý do hủy là nhãn cố định, mã lạ (kể cả khóa của Object.prototype) không hiện mã thô', () => {
    expect(cancelText('admin')).toBe('Quản trị viên hủy');
    expect(cancelText('ma_la')).toBe('Đơn đã bị hủy');
    expect(cancelText('constructor')).toBe('Đơn đã bị hủy');
    expect(cancelText('__proto__')).toBe('Đơn đã bị hủy');
  });

  it('SAL-TC-20261015-093909831 (web): mã lỗi trường có câu tiếng Việt, mã lạ thành "Không hợp lệ"', () => {
    expect(fieldErrorText('invalid_phone')).toBe('Số điện thoại không hợp lệ');
    expect(fieldErrorText('duplicate_product')).toBe('Sản phẩm bị trùng');
    expect(fieldErrorText('constructor')).toBe('Không hợp lệ');
  });
});
