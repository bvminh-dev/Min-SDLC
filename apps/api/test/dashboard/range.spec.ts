import { bucketList, bucketStart, civil, dayNum, fmt, granularityOf, hourChunks, ictDayOf, isoZ, parseDate, resolveRange, todayNum, dayStartUtcMs, type ParamError } from '../../src/modules/dashboard/range';
import { percent1 } from '../../src/modules/dashboard/blocks.service';
import { parseParams, cacheKey } from '../../src/modules/dashboard/policy';
import { DomainError } from '../../src/modules/platform';
import { CHUNK_HOURS, HOUR_MS } from '../../src/modules/dashboard/config';

// Hàm thuần của DSH: lịch, múi giờ Việt Nam, mốc ngày, tuần, tháng, chia đoạn theo giờ, phần trăm, kiểm tham số (DSH-REQ-20261006-105125714 BR5, DSH-REQ-20261006-105126271 BR3, BR4; DSH-SEC-20261006-105535103 T3).
const SEC = 'DSH-SEC-20261006-105535103';
const NOW = new Date('2026-10-06T03:00:00Z'); // fixed-clock: hàm thuần nhận `now` tường minh, không có nguồn thời gian khác
const errs = (q: Record<string, unknown>, now = NOW): ParamError[] => { const e: ParamError[] = []; resolveRange(q, now, e); return e; };

describe('DSH lịch và khoảng ngày (hàm thuần)', () => {
  it(`${SEC} T3: parseDate chỉ nhận YYYY-MM-DD hợp lệ theo lịch, kể cả ngày nhuận (1900 không nhuận, 2000 và 2024 nhuận)`, () => {
    for (const ok of ['2026-10-06', '2024-02-29', '2000-02-29', '1970-01-01', '9999-12-31', '2026-12-31']) expect([ok, parseDate(ok)]).toEqual([ok, expect.any(Number)]);
    for (const bad of ['2026-02-30', '2025-02-29', '1900-02-29', '2026-13-01', '2026-00-10', '2026-10-00', '2026-10-32', '2026-9-1', '06/10/2026', '2026-10-06 ', ' 2026-10-06', '2026-10-06T00:00:00Z', '', '２０２６-10-06', '2026-10-06\n', '+2026-10-06', '20261006', '2026/10/06']) expect([bad, parseDate(bad)]).toEqual([bad, null]);
  });

  it('dayNum và civil là cặp nghịch đảo trên mọi ngày từ 0001 tới 9999 (lấy mẫu mỗi 37 ngày, cộng các ngày cuối năm), 1970-01-01 là ngày 0', () => {
    expect(dayNum(1970, 1, 1)).toBe(0);
    expect(fmt(0)).toBe('1970-01-01');
    for (let n = dayNum(1, 1, 1); n <= dayNum(9999, 12, 31); n += 37) expect(dayNum(civil(n).y, civil(n).m, civil(n).d)).toBe(n);
    for (const y of [1999, 2000, 2024, 2026, 2100]) { expect(fmt(dayNum(y, 12, 31))).toBe(`${y}-12-31`); expect(dayNum(y + 1, 1, 1) - dayNum(y, 1, 1)).toBe([2000, 2024].includes(y) ? 366 : 365); }
    expect(fmt(dayNum(0, 1, 1))).toBe('0000-01-01');
  });

  it('DSH-REQ-20261006-105125714 BR5: ranh giới ngày theo giờ Việt Nam, 16:59:59Z thuộc ngày hôm trước và 17:00:00Z thuộc ngày hôm sau; ranh giới ngày tháng năm', () => {
    const d = (s: string) => fmt(ictDayOf(Date.parse(s)));
    expect([d('2026-10-05T16:59:59Z'), d('2026-10-05T17:00:00Z'), d('2026-10-05T17:00:00.001Z'), d('2026-12-31T17:00:00Z'), d('2026-02-28T16:59:59.999Z'), d('2024-02-28T17:00:00Z')]).toEqual(['2026-10-05', '2026-10-06', '2026-10-06', '2027-01-01', '2026-02-28', '2024-02-29']);
    expect(new Date(dayStartUtcMs(dayNum(2026, 10, 6))).toISOString()).toBe('2026-10-05T17:00:00.000Z');
    expect(fmt(todayNum(NOW))).toBe('2026-10-06');
    expect(fmt(todayNum(new Date('2026-10-06T16:59:59Z')))).toBe('2026-10-06');
    expect(fmt(todayNum(new Date('2026-10-06T17:00:00Z')))).toBe('2026-10-07'); // qua 00:00 giờ Việt Nam là ngày mới dù UTC còn ngày cũ
  });

  it('resolveRange: mặc định 30 ngày gồm hai đầu, khoảng nửa mở theo giờ Việt Nam, thiếu một đầu thì lấy mặc định tương ứng', () => {
    const e: ParamError[] = [];
    const r = resolveRange({}, NOW, e)!;
    expect([e, r.from, r.to, r.days, r.fromUtc.toISOString(), r.toUtc.toISOString()]).toEqual([[], '2026-09-07', '2026-10-06', 30, '2026-09-06T17:00:00.000Z', '2026-10-06T17:00:00.000Z']);
    expect(resolveRange({ to: '2026-10-02' }, NOW, [])).toMatchObject({ from: '2026-09-03', to: '2026-10-02' });
    expect(resolveRange({ from: '2026-10-06' }, NOW, [])).toMatchObject({ from: '2026-10-06', to: '2026-10-06', days: 1 });
    expect(resolveRange({ from: '2025-10-06', to: '2026-10-06' }, NOW, [])?.days).toBe(366);
    expect(resolveRange({ from: '2024-02-29', to: '2024-02-29' }, NOW, [])?.days).toBe(1);
    expect(resolveRange({ from: '1970-01-01', to: '1970-01-01' }, NOW, [])?.fromUtc.toISOString()).toBe('1969-12-31T17:00:00.000Z');
  });

  it(`${SEC} T3: resolveRange từ chối từng lỗi bằng đúng tên tham số: sau hôm nay, đảo ngược, 367 ngày, sai dạng, sai lịch, quá sớm, kiểu không phải chuỗi`, () => {
    const f = (q: Record<string, unknown>) => errs(q).map((e) => `${e.field}:${e.code}`);
    expect(f({ to: '2026-10-07' })).toEqual(['to:after_today']);
    expect(f({ from: '2026-10-05', to: '2026-10-01' })).toEqual(['from:from_after_to']);
    expect(f({ from: '2025-10-05', to: '2026-10-06' })).toEqual(['from:range_too_long']);
    expect(f({ from: '2026-10-07' })).toEqual(['from:from_after_to']); // from sau hôm nay, to mặc định hôm nay
    expect(f({ from: '06/10/2026' })).toEqual(['from:invalid_format']);
    expect(f({ from: '2026-02-30' })).toEqual(['from:invalid_date']);
    expect(f({ to: '1969-12-31' })).toEqual(['to:too_early']);
    expect(f({ to: '1970-01-10' })).toEqual(['from:too_early']); // from mặc định (to trừ 29 ngày) rơi trước 1970
    expect(f({ from: ['2026-10-01', '2026-10-02'] })).toEqual(['from:invalid_value']);
    expect(f({ from: '1970-01-01' })).toEqual(['from:range_too_long']);
    expect(f({ from: 5, to: {} })).toEqual(['from:invalid_value', 'to:invalid_value']);
    for (const e of errs({ to: '2026-10-07' })) expect(e).toEqual({ field: 'to', code: 'after_today', reason: 'after_today' });
  });

  it('DSH-REQ-20261006-105126271 BR3: độ mịn theo số ngày, 31 ngày là day, 32 và 92 là week, 93 là month', () => {
    expect([1, 30, 31, 32, 92, 93, 366].map(granularityOf)).toEqual(['day', 'day', 'day', 'week', 'week', 'month', 'month']);
  });

  it('DSH-REQ-20261006-105126271 BR4: tuần bắt đầu thứ Hai (kể cả qua năm 2026, 2027), tháng bắt đầu ngày 1, mốc đầu có thể trước khoảng, đủ mốc kể cả mốc trống', () => {
    for (let n = dayNum(2024, 12, 20); n < dayNum(2028, 1, 10); n++) {
      const s = bucketStart('week', n);
      expect([n, new Date(s * 86_400_000).getUTCDay(), n - s >= 0 && n - s < 7]).toEqual([n, 1, true]);
      expect(civil(bucketStart('month', n)).d).toBe(1);
      expect(bucketStart('day', n)).toBe(n);
    }
    const weeks = bucketList('week', dayNum(2026, 7, 1), dayNum(2026, 9, 30));
    expect([weeks.length, fmt(weeks[0]), fmt(weeks[13])]).toEqual([14, '2026-06-29', '2026-09-28']);
    expect(bucketList('day', dayNum(2026, 9, 1), dayNum(2026, 9, 30))).toHaveLength(30);
    const months = bucketList('month', dayNum(2026, 1, 1), dayNum(2026, 9, 30));
    expect(months.map(fmt)).toEqual(Array.from({ length: 9 }, (_, i) => `2026-${String(i + 1).padStart(2, '0')}-01`));
    expect(bucketList('month', dayNum(2025, 10, 6), dayNum(2026, 10, 6)).map(fmt)).toEqual(['2025-10-01', '2025-11-01', '2025-12-01', ...Array.from({ length: 10 }, (_, i) => `2026-${String(i + 1).padStart(2, '0')}-01`)]);
    expect(bucketList('week', dayNum(2026, 12, 28), dayNum(2027, 1, 3)).map(fmt)).toEqual(['2026-12-28']); // tuần qua năm: một mốc
    expect(bucketList('month', dayNum(2026, 12, 31), dayNum(2027, 1, 1)).map(fmt)).toEqual(['2026-12-01', '2027-01-01']);
  });

  it(`${SEC} T4: hourChunks phủ kín khoảng không hở không chồng và mỗi đoạn tối đa ${CHUNK_HOURS} giờ (dưới trần 1000 mốc của nguồn)`, () => {
    for (const hours of [1, 24, 959, 960, 961, 2208, 8784]) {
      const from = new Date('2025-10-05T17:00:00Z'), to = new Date(from.getTime() + hours * HOUR_MS);
      const cs = hourChunks(from, to);
      expect(cs[0].from).toEqual(from);
      expect(cs[cs.length - 1].to).toEqual(to);
      for (let i = 1; i < cs.length; i++) expect(cs[i].from).toEqual(cs[i - 1].to);
      for (const c of cs) expect((c.to.getTime() - c.from.getTime()) / HOUR_MS).toBeLessThanOrEqual(CHUNK_HOURS);
      expect(cs.length).toBe(Math.ceil(hours / CHUNK_HOURS));
    }
    expect(hourChunks(new Date(5), new Date(5))).toEqual([]);
  });

  it('DSH-TC-20261006-110331785: percent1 là làm tròn nửa lên bằng số nguyên, khớp bảng tính chính xác trên nhiều cặp', () => {
    expect([percent1(1, 7), percent1(1, 8), percent1(1, 16), percent1(2, 3), percent1(0, 9), percent1(9, 9), percent1(1, 0)]).toEqual([14.3, 12.5, 6.3, 66.7, 0, 100, null]);
    for (let total = 1; total <= 60; total++) for (let part = 0; part <= total; part++) {
      const exact = (part * 1000) / total; // phần nghìn: nửa lên là Math.floor(exact + 0.5) khi exact không rơi vào sai số nhị phân; so với số nguyên thuần
      const expected = Math.floor((part * 2000 + total) / (2 * total)) / 10;
      expect([part, total, percent1(part, total)]).toEqual([part, total, expected]);
      expect(Math.abs((percent1(part, total) as number) * 10 - exact)).toBeLessThanOrEqual(0.5 + 1e-9);
    }
  });

  it('DSH-REQ-20261006-105126549 BR4: isoZ bỏ phần .000 của mili giây và giữ phần mili giây khác 0', () => {
    expect([isoZ(new Date('2026-10-06T03:00:00.000Z')), isoZ(new Date('2026-10-06T03:00:00.123Z')), isoZ('2026-10-06T02:00:00.000Z')]).toEqual(['2026-10-06T03:00:00Z', '2026-10-06T03:00:00.123Z', '2026-10-06T02:00:00Z']);
  });

  it(`${SEC} T3, T7: parseParams từ chối tham số lạ theo danh sách của từng khối (kể cả __proto__, constructor), khóa đệm gồm toàn bộ tham số chuẩn hóa`, () => {
    const proto = JSON.parse('{"__proto__":"x"}') as Record<string, unknown>; // khóa __proto__ là thuộc tính thường như node querystring tạo ra
    const fail = (block: Parameters<typeof parseParams>[0], q: Record<string, unknown>) => { try { parseParams(block, q, NOW); return null; } catch (e) { return (e as DomainError).options.errors?.map((x) => `${x.field}:${x.code}`); } };
    expect(fail('products', proto)).toEqual(['__proto__:unknown_parameter']);
    expect(fail('revenue', { constructor: '1', toString: '1' })).toEqual(['constructor:unknown_parameter', 'toString:unknown_parameter']);
    expect(fail('revenue', { sort: 'units' })).toEqual(['sort:unknown_parameter']);
    expect(fail('report-revenue', { limit: '5' })).toEqual(['limit:unknown_parameter']);
    expect(fail('low-stock', { from: '2026-10-01' })).toEqual(['from:unknown_parameter']);
    expect(fail('report-products', { limit: '51', sort: 'x', from: 'z' })).toEqual(['from:invalid_format', 'sort:invalid_value', 'limit:out_of_range']);
    expect(fail('revenue', { ['a'.repeat(200)]: '1', 'a\u0000b': '1' })).toEqual(['(parameter):unknown_parameter', '(parameter):unknown_parameter']);
    const a = parseParams('report-products', { from: '2026-09-01', to: '2026-09-30' }, NOW);
    const b = parseParams('report-products', { from: '2026-09-01', to: '2026-09-30', sort: 'amount', limit: '5' }, NOW);
    expect([a.sort, a.limit, b.sort, b.limit]).toEqual(['units', 10, 'amount', 5]);
    expect(new Set([cacheKey('report-products', a), cacheKey('report-products', b), cacheKey('report-orders', a), cacheKey('report-products', { ...a, limit: 11 })]).size).toBe(4);
    expect(cacheKey('revenue', parseParams('revenue', {}, NOW))).toBe('revenue:2026-09-07:2026-10-06:-:-');
  });
});
