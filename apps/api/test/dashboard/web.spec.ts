import { addDays, appliedRange, asOfText, bucketLabel, count, defaultRange, failed, formatYmd, limitedText, money, moneyOrDash, percentText, rangeQuery, todayYmd } from '../../../web/lib/dashboard-format';

// Hàm thuần của giao diện DSH nhập thẳng từ `apps/web/lib/dashboard-format.ts` (không React, không `window`): ngày theo giờ Việt Nam, tiền, phần trăm, nhãn mốc, khối lỗi. Khớp spec/epics/DSH/ui.
describe('DSH giao diện: hàm thuần', () => {
  it('DSH-TC-20261006-110330022 (giao diện): hôm nay và 30 ngày qua theo giờ Việt Nam, qua 00:00 giờ Việt Nam là ngày mới dù UTC còn ngày cũ', () => {
    expect([todayYmd(Date.parse('2026-10-06T16:59:59Z')), todayYmd(Date.parse('2026-10-06T17:00:00Z')), todayYmd(Date.parse('2026-12-31T17:00:00Z'))]).toEqual(['2026-10-06', '2026-10-07', '2027-01-01']);
    expect(defaultRange(Date.parse('2026-10-06T03:00:00Z'))).toEqual({ from: '2026-09-07', to: '2026-10-06' }); // 30 ngày gồm hai đầu
    expect(defaultRange(Date.parse('2024-03-01T03:00:00Z'))).toEqual({ from: '2024-02-01', to: '2024-03-01' }); // qua ngày nhuận
    expect([addDays('2026-10-06', -29), addDays('2026-03-01', -1), addDays('2025-12-31', 1), addDays('2026-10-06', 0)]).toEqual(['2026-09-07', '2026-02-28', '2026-01-01', '2026-10-06']);
    // khoảng đang áp dụng từ URL điền tham số thiếu đúng như máy chủ: thiếu `from` là `to` trừ 29 ngày (không phải hôm nay trừ 29), thiếu `to` là hôm nay
    const now = Date.parse('2026-10-06T03:00:00Z');
    expect([appliedRange(null, null, now), appliedRange('2026-10-01', null, now), appliedRange(null, '2026-09-15', now), appliedRange('2026-10-01', '2026-10-06', now)])
      .toEqual([null, { from: '2026-10-01', to: '2026-10-06' }, { from: '2026-08-17', to: '2026-09-15' }, { from: '2026-10-01', to: '2026-10-06' }]);
  });

  it('DSH-TC-20261013-232147091 (giao diện): URL chỉ có `to` thì ô Từ là `to` trừ 29 (không phải hôm nay trừ 29); chỉ có `from` thì ô Đến là hôm nay; đủ hai hoặc không có tham số thì đúng như máy chủ', () => {
    const now = Date.parse('2026-10-06T03:00:00Z');
    expect(appliedRange(null, '2026-09-15', now)).toEqual({ from: '2026-08-17', to: '2026-09-15' });
    expect(appliedRange(null, '2026-09-15', now)?.from).not.toBe(defaultRange(now).from); // 2026-09-07: giá trị sai cũ
    expect(appliedRange('2026-10-01', null, now)).toEqual({ from: '2026-10-01', to: '2026-10-06' });
    expect(appliedRange('2026-10-01', '2026-10-06', now)).toEqual({ from: '2026-10-01', to: '2026-10-06' });
    expect(appliedRange(null, null, now)).toBeNull(); // không tham số: khoảng mặc định
    expect(defaultRange(now)).toEqual({ from: '2026-09-07', to: '2026-10-06' });
  });

  it('DSH-E2E-20261006-110407878 (giao diện): "Cập nhật lúc HH:mm" theo giờ Việt Nam từ as_of UTC, ngày dd/mm/yyyy, truy vấn khoảng ngày chỉ có tham số đã đặt', () => {
    expect([asOfText('2026-10-06T03:00:00Z'), asOfText('2026-10-06T17:05:00Z'), asOfText('2026-10-06T16:59:00Z'), asOfText(undefined)]).toEqual(['Cập nhật lúc 10:00', 'Cập nhật lúc 00:05', 'Cập nhật lúc 23:59', '']);
    expect([formatYmd('2026-09-01'), formatYmd('2026-12-31'), formatYmd('không phải ngày')]).toEqual(['01/09/2026', '31/12/2026', 'không phải ngày']);
    expect([rangeQuery(null, null), rangeQuery('2026-10-01', null), rangeQuery('2026-10-01', '2026-10-06'), rangeQuery(null, null, { sort: 'amount', limit: '5' }), rangeQuery('2026-10-01', '2026-10-06', { limit: '5' })])
      .toEqual(['', '?from=2026-10-01', '?from=2026-10-01&to=2026-10-06', '?sort=amount&limit=5', '?from=2026-10-01&to=2026-10-06&limit=5']);
  });

  it('DSH-TC-20261006-110329988 (giao diện): tiền dạng "470.000 đ", số âm giữ dấu trừ, số đếm có dấu chấm ngăn cách, giá trị rỗng là "—"', () => {
    expect([money(470000), money(0), money(-200000), money(1234567), count(1200), moneyOrDash(350000), moneyOrDash(null), moneyOrDash(undefined), moneyOrDash(0)]).toEqual(['470.000 đ', '0 đ', '-200.000 đ', '1.234.567 đ', '1.200', '350.000 đ', '—', '—', '0 đ']);
  });

  it('DSH-TC-20261006-110331728 (giao diện): tỷ lệ là "15,0%" với dấu phẩy, null là "—" chứ không bao giờ "0,0%"; 0 thật là "0,0%"', () => {
    expect([percentText(15), percentText(4), percentText(14.3), percentText(0), percentText(100), percentText(null), percentText(undefined)]).toEqual(['15,0%', '4,0%', '14,3%', '0,0%', '100,0%', '—', '—']);
  });

  it('DSH-TC-20261006-110331351 (giao diện): nhãn mốc ngày và tuần là dd/mm/yyyy (tuần ghi thứ Hai), tháng là mm/yyyy', () => {
    expect([bucketLabel('day', '2026-09-02'), bucketLabel('week', '2026-06-29'), bucketLabel('month', '2026-09-01'), bucketLabel('month', '2026-01-01')]).toEqual(['02/09/2026', '29/06/2026', '09/2026', '01/2026']);
  });

  it('DSH-TC-20261006-110332248 (giao diện): dải 429 nêu số giây từ Retry-After, mặc định 60 khi thiếu', () => {
    expect([limitedText(19), limitedText(undefined), limitedText(1)]).toEqual(['Thao tác quá nhanh, thử lại sau 19 giây', 'Thao tác quá nhanh, thử lại sau 60 giây', 'Thao tác quá nhanh, thử lại sau 1 giây']);
  });

  it('DSH-TC-20261006-110330139 (giao diện): khối lỗi nguồn không hiện số (kể cả khi còn số cũ); 429 giữ số cũ nhưng lần đầu chưa có số thì là lỗi; 400 giữ số khoảng trước', () => {
    const d = { net: 1 };
    expect([failed({ status: 'error', data: null }), failed({ status: 'error', data: d }), failed({ status: 'limited', data: null }), failed({ status: 'limited', data: d }), failed({ status: 'invalid', data: d }),
      failed({ status: 'ready', data: d }), failed({ status: 'loading', data: null }), failed({ status: 'forbidden', data: null })]).toEqual([true, true, true, false, false, false, false, false]);
  });
});
