import { resolve } from 'node:path';
import { API_DIR } from '../support/db';
import { runScript } from '../support/sh';

const F = resolve(API_DIR, 'test/fixtures/boundaries');
const check = (dir: string) => runScript('scripts/check-boundaries.mjs', ['--modules', `${F}/${dir}/modules`, '--schemas', `${F}/schemas`]);

describe('Kiểm ranh giới module (PRJ-REQ-20261006-095422475 BR5, BR11; SB-35)', () => {
  it('PRJ-TC-20261006-100124114: chặn import trái cột Phụ thuộc và import vào tệp bên trong module, nêu tệp, module nguồn, module đích và quy tắc', () => {
    const r = check('f114');
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/catalog\/uses-order\.ts:1: \[catalog -> order\] order không nằm trong cột Phụ thuộc của catalog/);
    expect(r.stderr).toMatch(/catalog\/uses-order\.ts:1: \[catalog -> order\] import file bên trong order \(internal\/helper\)/);
    expect(r.stderr).toMatch(/order\/uses-payment\.ts:1: \[order -> payment\] payment không nằm trong cột Phụ thuộc của order/);
    expect(r.stderr).not.toContain('[order -> auth]'); // order phụ thuộc AUTH nên hợp lệ
  });

  it('PRJ-TC-20261006-100124207: payment import điểm vào công khai của order (xuôi) qua; order import payment (ngược) thất bại, nêu liên lạc ngược chiều chỉ bằng domain event', () => {
    const r = check('f207');
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/order\/backward\.ts:1: \[order -> payment\].*liên lạc ngược chiều chỉ bằng domain event/);
    expect(r.stderr).not.toMatch(/payment\/forward\.ts/);
  });

  it('PRJ-TC-20261006-110200114: module không đọc bảng của module khác, báo lỗi nêu tệp, dòng và module sở hữu; truy cập bảng của chính nó qua', () => {
    const r = check('f114t');
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/catalog\/reads-orders\.ts:2: \[catalog -> order\] đọc\/ghi model Prisma order thuộc module order/);
    expect(r.stderr).toMatch(/catalog\/reads-orders\.ts:3: \[catalog -> order\] SQL thô đọc\/ghi bảng orders thuộc module order/);
    expect(r.stderr).not.toContain('reads-own.ts'); // order đọc bảng của chính nó
    expect(r.stderr).not.toContain('reads-orders.ts:4'); // catalog đọc bảng products của chính nó
  });

  it('PRJ-TC-20261006-110200115: platform là mối quan tâm cắt ngang, import điểm vào công khai không cần khai; import tệp nội bộ của platform thất bại', () => {
    expect(check('okmods').status).toBe(0);
    const r = check('f115');
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/uses-platform\.ts:2: \[catalog -> platform\] import file nội bộ của platform/);
    expect(r.stderr).not.toMatch(/uses-platform\.ts:1:/);
  });

  it('PRJ-TC-20261006-110200114 (review SHP): mảnh Prisma.sql và Prisma.raw dựng riêng rồi ghép vào câu truy vấn cũng bị quét tên bảng; công cụ hỏng (thư mục modules hay schemas không có, quét rỗng) thì đỏ mã 2, không in sạch', () => {
    const r = check('f114s');
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/catalog\/builds-sql\.ts:2: \[catalog -> order\] SQL thô đọc\/ghi bảng orders/);
    expect(r.stderr).toMatch(/catalog\/builds-sql\.ts:3: \[catalog -> order\] SQL thô đọc\/ghi bảng orders/);
    expect(r.stderr).not.toMatch(/builds-sql\.ts:4|reads-own\.ts/); // bảng của chính module qua
    const ok = ['--modules', `${F}/okmods/modules`, '--schemas', `${F}/schemas`];
    for (const args of [['--modules', `${F}/khong-co`, '--schemas', `${F}/schemas`], ['--modules', `${F}/okmods/modules`, '--schemas', `${F}/khong-co`], ['--modules', `${F}/schemas`, '--schemas', `${F}/schemas`]]) {
      const bad = runScript('scripts/check-boundaries.mjs', args);
      expect([args.join(' '), bad.status]).toEqual([args.join(' '), 2]);
      expect(bad.stdout).not.toMatch(/sạch/);
    }
    expect(runScript('scripts/check-boundaries.mjs', ok).status).toBe(0);
  });

  it('review SAL, ORD (đợt bán hộ): module không sở hữu bảng bị chặn import động @prisma/client và $queryRawUnsafe, $executeRawUnsafe', () => {
    const r = check('sal331');
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/sales\/dyn-import\.ts:1: \[sales\] module không sở hữu bảng không được import động @prisma\/client/);
    expect(r.stderr).toMatch(/sales\/unsafe-sql\.ts:1: \[sales\] module không sở hữu bảng không được chạy SQL thô \(\$queryRawUnsafe\)/);
    expect(r.stderr).toMatch(/sales\/unsafe-sql\.ts:2: \[sales\] module không sở hữu bảng không được chạy SQL thô \(\$executeRawUnsafe\)/);
  });

  it('review ORD (đợt bán hộ): tên hàm XxxApi được gọi phải nằm trong bảng Giao diện module đúng cặp gọi -> được gọi (hàm có ở cặp khác cũng bị chặn)', () => {
    const r = check('api331');
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/payment\/uses-order\.ts:6: \[payment -> order\] OrderApi\.createPending không có trong bảng Giao diện module/);
    expect(r.stderr).toMatch(/shipping\/uses-order\.ts:6: \[shipping -> order\] OrderApi\.getSalesReport không có trong bảng Giao diện module/); // DSH -> ORD mới có hàm này
    expect(r.stderr).not.toMatch(/uses-order\.ts:5/); // findForPayment (PAY), findForShipment (SHP) hợp lệ
  });

  it('mã thật của repo sạch', () => {
    expect(runScript('scripts/check-boundaries.mjs').status).toBe(0);
  });
});
