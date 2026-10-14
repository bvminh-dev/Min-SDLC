import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { QueryAccumulator, nextQuery, withQuery } from '../../../web/lib/query-go';

// REV-REV-12 (bài học L135): hai lần đổi bộ lọc liền nhau trên URL phải CỘNG DỒN, không dùng chuỗi cũ của lần render làm sống lại bộ lọc vừa bỏ. Hàm thuần dùng chung của mọi trang danh sách có bộ lọc
// (`apps/web/lib/query-go.ts`, hook `useQueryGo`); E2E của ba trang REV là REV-E2E-20261006-104528550. Bài test quét chứng minh không trang nào còn tự dựng `go` từ `useSearchParams()`.
const WEB = resolve(__dirname, '../../../web');

describe('REV-REV-12: đổi tham số truy vấn trên URL cộng dồn các lần đổi liền nhau', () => {
  it('nextQuery: giá trị rỗng hay null xóa khóa; đổi bộ lọc về trang 1 trừ khi keepPage hay change tự đặt page', () => {
    expect(nextQuery('rating=5&sort=newest&page=3', { rating: null })).toBe('sort=newest');
    expect(nextQuery('rating=5&page=3', { sort: 'highest' })).toBe('rating=5&sort=highest');
    expect(nextQuery('rating=5&page=3', { sort: 'highest' }, true)).toBe('rating=5&page=3&sort=highest');
    expect(nextQuery('rating=5', { page: '2' })).toBe('rating=5&page=2'); // `go({ page })` không bị xóa page vừa đặt
    expect(nextQuery('rating=5&page=2', { rating: '' })).toBe('');
    expect(withQuery('/admin/refunds', '')).toBe('/admin/refunds');
    expect(withQuery('/admin/refunds', 'status=failed')).toBe('/admin/refunds?status=failed');
  });

  it('QueryAccumulator: lần đổi thứ hai dựng trên kết quả lần đầu, không trên chuỗi cũ của lần render (chọn lại "Tất cả sao" rồi đổi sắp xếp trước khi URL cập nhật)', () => {
    const acc = new QueryAccumulator();
    const stale = 'rating=2&sort=newest'; // `useSearchParams()` chưa đổi giữa hai lần gọi
    const first = acc.next(stale, { rating: null }); // bỏ lọc sao
    const second = acc.next(stale, { sort: 'highest' }); // đổi sắp xếp: không được làm sống lại rating=2
    expect([first, second]).toEqual(['sort=newest', 'sort=highest']);
    // chứng minh cách cũ sai: dựng lại từ chuỗi cũ làm sống lại bộ lọc vừa bỏ
    expect(nextQuery(stale, { sort: 'highest' })).toBe('rating=2&sort=highest');
    // URL đã đổi xong thì lần đổi sau lấy chuỗi mới làm nền
    acc.settle();
    expect(acc.next('sort=highest', { rating: '4' })).toBe('sort=highest&rating=4');
    // ba lần liền nhau, kể cả đổi trang
    const acc2 = new QueryAccumulator();
    expect([acc2.next('status=failed&page=2', { status: null }), acc2.next('status=failed&page=2', { order_code: 'ABC' }), acc2.next('status=failed&page=2', { page: '3' })]).toEqual(['', 'order_code=ABC', 'order_code=ABC&page=3']);
  });

  const walk = (dir: string, out: string[] = []): string[] => {
    for (const n of readdirSync(dir)) {
      if (n === 'node_modules' || n === '.next') continue;
      const p = join(dir, n);
      if (statSync(p).isDirectory()) walk(p, out); else if (/\.tsx?$/.test(n)) out.push(p);
    }
    return out;
  };

  it('quét mã web: không tệp nào tự dựng hàm `go` bằng useCallback từ `URLSearchParams(sp.toString())`; các trang danh sách dùng useQueryGo', () => {
    const files = [...walk(join(WEB, 'app')), ...walk(join(WEB, 'components'))];
    const own = files.filter((f) => /const go = useCallback\(/.test(readFileSync(f, 'utf8')) && /URLSearchParams\(sp\.toString\(\)\)/.test(readFileSync(f, 'utf8')));
    expect(own.map((f) => f.slice(WEB.length + 1))).toEqual([]);
    const users = files.filter((f) => /useQueryGo\(/.test(readFileSync(f, 'utf8'))).map((f) => f.slice(WEB.length + 1).replace(/\\/g, '/'));
    for (const must of ['app/products/page.tsx', 'app/payments/page.tsx', 'app/notifications/page.tsx', 'app/admin/products/page.tsx', 'app/admin/coupons/page.tsx', 'app/admin/inventory/page.tsx', 'app/admin/payments/page.tsx', 'app/admin/refunds/page.tsx', 'app/admin/shipments/page.tsx', 'components/OrderList.tsx', 'app/me/reviews/page.tsx', 'app/admin/reviews/page.tsx', 'app/products/[id]/reviews/page.tsx']) expect(users).toContain(must);
    // hook cài đặt một chỗ và dùng bộ cộng dồn (không dựng chuỗi từ sp của lần render)
    const hook = readFileSync(join(WEB, 'components/useQueryGo.ts'), 'utf8');
    expect(hook).toMatch(/QueryAccumulator/);
    expect(hook).not.toMatch(/new URLSearchParams\(sp/);
  });
});
