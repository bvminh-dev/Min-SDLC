import { safeNext } from '../../../web/lib/safe-next';

describe('Tham số next sau đăng nhập (AUTH-REQ-20261006-095515738 BR9, SB-28)', () => {
  it('AUTH-TC-20261006-100641376: next chỉ nhận đường dẫn nội bộ; giá trị khác bị bỏ để về trang mặc định', () => {
    for (const ok of ['/orders', '/admin/users?page=2', '/a/b#c']) expect(safeNext(ok)).toBe(ok);
    for (const bad of ['//evil.example', 'https://evil.example', '/\\evil.example', 'javascript:alert(1)', 'orders', '', null, undefined, '/ok\n//evil.example', '/\t/evil.example']) {
      expect([bad, safeNext(bad as string)]).toEqual([bad, null]);
    }
  });
});
