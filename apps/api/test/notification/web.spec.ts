import { NOTIFICATION_TYPES } from '../../src/modules/notification/config';
import { POLL_MS, TYPE_LABEL, badgeText, isType, safeLink, typesFor } from '../../../web/lib/notification-const';

// Hàm thuần của giao diện NTF (nhãn, huy hiệu, liên kết an toàn) nhập thẳng từ `apps/web/lib/notification-const.ts` (không kéo theo React hay `window`), khớp spec/epics/NTF/ui (L116).
describe('NTF giao diện: hàm thuần', () => {
  it('NTF-TC-20261006-104302702: huy hiệu ẩn khi 0, số thật tới 99, "99+" khi lớn hơn 99 (API trả số thật)', () => {
    expect([badgeText(0), badgeText(1), badgeText(99), badgeText(100), badgeText(120), badgeText(1_000_000)]).toEqual(['', '1', '99', '99+', '99+', '99+']);
    expect(POLL_MS).toBe(60_000); // làm mới mỗi 60 giây (ui/notification-bell)
  });

  it('NTF-TC-20261006-104303290 (T10): nhãn có đủ 15 loại của API; ô lọc customer không có tồn kho và hoàn tiền thất bại, staff thêm tồn kho, admin thêm cả hai; không tra nhầm thuộc tính của Object.prototype', () => {
    expect(Object.keys(TYPE_LABEL).sort()).toEqual([...NOTIFICATION_TYPES].sort());
    expect(typesFor('customer')).not.toEqual(expect.arrayContaining(['low_stock']));
    expect(typesFor('customer')).toHaveLength(13);
    expect(typesFor('staff')).toEqual([...typesFor('customer'), 'low_stock']);
    expect(typesFor('admin')).toEqual([...typesFor('customer'), 'low_stock', 'refund_failed']);
    expect(typesFor(undefined)).toEqual(typesFor('customer'));
    for (const bad of ['__proto__', 'constructor', 'toString', 'foo', '', null, undefined]) expect([bad, isType(bad as string)]).toEqual([bad, false]);
    expect(isType('order_expired')).toBe(true);
    expect(TYPE_LABEL.low_stock).toBe('Tồn kho');
  });

  it('NTF-TC-20261006-104223060 (T15): chỉ đường dẫn nội bộ một dấu gạch chéo đầu mới được điều hướng ở trình duyệt', () => {
    expect(['/orders/7K3M9Q2XH4TB', '/orders', '/admin/inventory', '/forgot-password', '/'].map(safeLink)).toEqual(['/orders/7K3M9Q2XH4TB', '/orders', '/admin/inventory', '/forgot-password', '/']);
    for (const bad of ['//evil.test', 'https://evil.test', 'javascript:alert(1)', '/orders?next=//x', '/a b', '/orders/../x', 'orders', '', null, undefined, 5, '/\\evil', '//evil', '//intranet/x', '//2130706433', '///']) expect([bad, safeLink(bad)]).toEqual([bad, null]);
  });
});
