import { Controller, Get } from '@nestjs/common';
import { DiscoveryModule } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { Action, Public, Roles, auditPermissions } from '../../src/modules/platform';

// Cổng lệch ma trận quyền ở nền (AUTH-REQ-20261006-095515918 BR5; dùng bởi AUTH và USR): mỗi hàng ma trận khớp ĐÚNG role của mọi endpoint nó phủ, không có ngoại lệ
// (tùy chọn `narrow` đã xóa: hàng phủ endpoint hẹp hơn phải được tách thành hai hàng). Test dùng ma trận và controller nhỏ tại chỗ, không đọc spec thật.
const MATRIX = `| Hành động | Requirement | guest | customer | staff | admin | system |
|---|---|---|---|---|---|---|
| Xem công khai | ZZZ-REQ-1 | Y | Y | Y | Y | - |
| Xem theo email | ZZZ-REQ-2 | - | - | Y | Y | - |
| Xem theo id | ZZZ-REQ-3 | - | - | - | Y | - |
`;

@Controller('probe')
class ProbeController {
  @Get('public') @Public() @Action('Xem công khai') pub() { return {}; }
  @Get('email') @Roles('staff', 'admin') @Action('Xem theo email') byEmail() { return {}; }
  @Get('id') @Roles('admin') @Action('Xem theo id') byId() { return {}; }
  @Get('wide-id') @Roles('staff', 'admin') @Action('Xem theo id') wideById() { return {}; } // rộng hơn hàng của nó
  @Get('narrow-email') @Roles('admin') @Action('Xem theo email') narrowByEmail() { return {}; } // hẹp hơn hàng của nó: không còn ngoại lệ `narrow`
  @Get('undeclared') @Roles('admin') undeclared() { return {}; }
  @Get('unknown') @Roles('admin') @Action('Hàng không có trong ma trận') unknown() { return {}; }
}
@Controller('good')
class GoodController {
  @Get('a') @Public() @Action('Xem công khai') pub() { return {}; }
  @Get('b') @Roles('admin', 'staff') @Action('Xem theo email') byEmail() { return {}; }
  @Get('c') @Roles('admin') @Action('Xem theo id') byId() { return {}; }
}

const build = async (c: new () => object): Promise<INestApplication> => {
  const m = await Test.createTestingModule({ imports: [DiscoveryModule], controllers: [c] }).compile();
  const app = m.createNestApplication({ logger: false });
  await app.init();
  return app;
};
const opts = { scope: () => true, prefix: '' };

describe('platform auditPermissions: lệch ma trận (AUTH-REQ-20261006-095515918 BR5)', () => {
  it('khớp ma trận thì sạch, kể cả phủ đủ hàng của epic', async () => {
    const app = await build(GoodController);
    try {
      expect(auditPermissions(app, MATRIX, opts)).toEqual([]);
      expect(auditPermissions(app, MATRIX, { ...opts, epic: 'ZZZ' })).toEqual([]);
    } finally { await app.close(); }
  });

  it('đỏ khi role trong code rộng hơn hay hẹp hơn hàng ma trận, thiếu @Action hay @Action không có trong ma trận (không còn ngoại lệ `narrow`)', async () => {
    const app = await build(ProbeController);
    try {
      const out = auditPermissions(app, MATRIX, opts).join('\n');
      expect(out).toContain('GET /probe/wide-id: code cho [admin, staff] nhưng ma trận (Xem theo id) cho [admin]');
      expect(out).toContain('GET /probe/narrow-email: code cho [admin] nhưng ma trận (Xem theo email) cho [admin, staff]');
      expect(out).toContain('GET /probe/undeclared: thiếu @Action');
      expect(out).toContain('GET /probe/unknown: @Action("Hàng không có trong ma trận") không có trong permissions-matrix.md');
      expect(out).not.toMatch(/GET \/probe\/(public|email|id):/);
    } finally { await app.close(); }
  });

  it('đóng khi công cụ hỏng: ma trận rỗng hay không đọc được là lỗi; phạm vi không khớp route nào mà epic có hàng thì báo từng hàng', async () => {
    const app = await build(GoodController);
    try {
      expect(auditPermissions(app, '', opts)).toEqual(['ma trận quyền rỗng hoặc không đọc được (không tìm thấy hàng nào có mã requirement)']);
      expect(auditPermissions(app, MATRIX, { scope: () => false, epic: 'ZZZ', prefix: '' }).filter((l) => l.includes('không có endpoint nào khai @Action'))).toHaveLength(3);
    } finally { await app.close(); }
  });
});
