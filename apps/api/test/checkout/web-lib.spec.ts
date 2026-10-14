import { BLOCKER_TEXT, addressText, availabilityText, blockerText, completeUrl, payErrorOf, payErrorText, sessionStatusOf, validIso, waitText } from '../../../web/lib/checkout';
import { BLOCKERS } from '../../src/modules/checkout/config';

// Hàm thuần của web (apps/web/lib/checkout.ts) đưa vào test API bằng import (như safe-next.spec.ts): không cần trình duyệt, chạy nhanh trong đột biến.
const api = (code: string | undefined, body: Record<string, unknown> = {}, status = 409) => ({ status, ok: false, body, code, fieldErrors: {} });

describe('Web checkout: hàm thuần (CHK-REQ-20261006-105051681 BR5, ...105051386, ...105052414)', () => {
  it('CHK-TC-20261006-110702169 (web): mọi mã blocker của API đều có câu tiếng Việt riêng, mã lạ (kể cả khóa của Object.prototype) không làm vỡ giao diện', () => {
    for (const b of BLOCKERS) expect([b, BLOCKER_TEXT[b]?.length > 5]).toEqual([b, true]);
    expect(blockerText('cart_empty')).toBe('Giỏ hàng đang trống');
    expect(blockerText('missing_address')).toBe('Chưa chọn địa chỉ giao hàng');
    expect(blockerText('mã_lạ')).toBe('Chưa đặt hàng được (mã_lạ)');
    expect(blockerText('constructor')).toBe('Chưa đặt hàng được (constructor)');
    expect(blockerText('__proto__')).toBe('Chưa đặt hàng được (__proto__)');
  });

  it('CHK-TC-20261006-110702693 (web): nhãn tồn kho chỉ có cho dòng thiếu, không lộ số của dòng đủ hàng', () => {
    expect(availabilityText({ status: 'ok' })).toBeNull();
    expect(availabilityText({ status: 'unknown' })).toBeNull();
    expect(availabilityText({ status: 'out_of_stock' })).toBe('Hết hàng');
    expect(availabilityText({ status: 'insufficient', available: 2 })).toBe('Chỉ còn 2');
    expect(availabilityText({ status: 'unavailable' })).toBe('Ngừng bán');
  });

  it('CHK-TC-20261006-110701599 (web): lỗi chọn thanh toán ánh xạ đúng: khoảng VNPay lấy min, max của máy chủ, đơn 0 đồng, quá nhiều đơn mở kèm số hiện có', () => {
    expect(payErrorOf(api('amount-out-of-range-online', { min: 5000, max: 999999999 }, 422))).toEqual({ kind: 'range', min: 5000, max: 999999999 });
    expect(payErrorOf(api('zero-total-unsupported', {}, 422))).toEqual({ kind: 'zero' });
    expect(payErrorOf(api('too-many-open-orders', { kind: 'vnpay', limit: 3, current: 3 }))).toEqual({ kind: 'open-orders', current: 3, limit: 3 });
    expect(payErrorOf(api('price-changed'))).toBeNull();
    expect(payErrorText({ kind: 'range', min: 5000, max: 999999999 })).toBe('VNPay chỉ nhận từ 5.000 đến 999.999.999 đ, hãy chọn COD');
    expect(payErrorText({ kind: 'zero' })).toBe('Đơn 0 đồng chưa được hỗ trợ');
    expect(payErrorText({ kind: 'open-orders', current: 3, limit: 3 })).toBe('Bạn đang có quá nhiều đơn chưa hoàn tất (hiện có 3, tối đa 3)');
    expect(payErrorText({ kind: 'open-orders', current: Number.NaN, limit: Number.NaN })).toBe('Bạn đang có quá nhiều đơn chưa hoàn tất');
  });

  it('CHK-TC-20261006-110703759 (web): trạng thái phiên đóng đọc từ session_status (không phải status = mã HTTP); thiếu thì coi là hết hạn', () => {
    expect(sessionStatusOf(api('checkout-session-closed', { session_status: 'cancelled', status: 409 }))).toBe('cancelled');
    expect(sessionStatusOf(api('checkout-session-closed', { session_status: 'expired', status: 409 }))).toBe('expired');
    expect(sessionStatusOf(api('checkout-session-closed', { status: 409 }))).toBe('expired');
  });

  it('CHK-TC-20261007-085336918 (web): địa chỉ trang kết quả mang mã đơn, cờ đã đặt và hạn giữ hàng của máy chủ; hạn không phải ISO bị bỏ', () => {
    expect(completeUrl('7K3M9Q2XH4TB')).toBe('/checkout/complete?code=7K3M9Q2XH4TB');
    expect(completeUrl('7K3M9Q2XH4TB', { replayed: true, deadline: '2026-10-09T10:15:00.000Z' })).toBe('/checkout/complete?code=7K3M9Q2XH4TB&replayed=1&deadline=2026-10-09T10%3A15%3A00.000Z');
    expect(validIso('2026-10-09T10:15:00.000Z')).toBe('2026-10-09T10:15:00.000Z');
    expect(validIso('không phải ngày')).toBeNull();
    expect(validIso(null)).toBeNull();
    expect(validIso('')).toBeNull();
  });

  it('CHK-TC-20261007-085336884 (web): câu chờ thử lại có số giây của Retry-After (mặc định 60); địa chỉ một dòng bỏ phần rỗng và không có tên, điện thoại', () => {
    expect(waitText(12)).toBe('Bạn thao tác quá nhanh, thử lại sau 12 giây');
    expect(waitText()).toBe('Bạn thao tác quá nhanh, thử lại sau 60 giây');
    expect(addressText({ line1: '45 Nguyễn Huệ', ward: 'Bến Nghé', district: null, city: 'Hà Nội' })).toBe('45 Nguyễn Huệ, Bến Nghé, Hà Nội');
  });
});
