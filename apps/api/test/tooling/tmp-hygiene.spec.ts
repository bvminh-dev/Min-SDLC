import { existsSync, mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRunRoot, leftovers, sweepRunRoot } from '../support/tmp-root';
import { mkTmp } from '../support/tmp';

// Cổng chống test rò thư mục tạm làm đầy đĩa: gốc của lần chạy (ecom-run-*) là TMPDIR; global-teardown đỏ cả lần chạy nếu còn sót.
describe('Thư mục tạm của test được dọn (PRJ-REQ-20261006-095422475 BR11, cổng global-teardown)', () => {
  it('mọi thư mục tạm của lần chạy nằm trong gốc ecom-run-* (TMPDIR), nên rò thì global-teardown thấy', () => {
    const root = process.env.ECOM_RUN_TMP as string;
    expect(root).toMatch(/ecom-run-/);
    expect(tmpdir()).toBe(root);
    const d = mkTmp('ecom-probe-');
    expect(d.startsWith(`${root}/`)).toBe(true);
  });

  it('gốc có mục sót thì sweepRunRoot ném lỗi nêu tên mục và vẫn xóa gốc; gốc sạch thì qua', () => {
    const ok = createRunRoot();
    expect(() => sweepRunRoot(ok)).not.toThrow();
    expect(existsSync(ok)).toBe(false);
    const leaky = createRunRoot();
    mkdirSync(join(leaky, 'ecom-ci-quen-don'));
    writeFileSync(join(mkdtempSync(join(leaky, 'ecom-node-ok-')), 'f'), 'x');
    expect(leftovers(leaky)).toHaveLength(2);
    expect(() => sweepRunRoot(leaky)).toThrow(/ecom-ci-quen-don/);
    expect(existsSync(leaky)).toBe(false);
  });

  it('gốc của lượt chạy cũ bị ngắt (quá một ngày) bị xóa khi dựng gốc mới; gốc của lượt chạy đang chạy thì giữ', () => {
    const old = join(tmpdir(), 'ecom-run-bi-ngat'), fresh = join(tmpdir(), 'ecom-run-dang-chay');
    for (const d of [old, fresh]) { mkdirSync(d); writeFileSync(join(d, 'ecom-node-ok-du'), 'x'); }
    const past = new Date(Date.now() - 3 * 24 * 3600_000);
    utimesSync(old, past, past);
    const root = createRunRoot();
    expect(existsSync(old)).toBe(false);
    expect(existsSync(fresh)).toBe(true);
    for (const d of [fresh, root]) rmSync(d, { recursive: true, force: true }); // dọn gốc thử để global-teardown không thấy sót
  });
});
