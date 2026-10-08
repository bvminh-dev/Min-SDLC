import { Body, Controller, Delete, Get, HttpCode, Patch, Post, Put } from '@nestjs/common';
import { z } from 'zod';
import {
  AuditService, CurrentSession, DbTx, DomainError, TransactionService, type SessionContext, Idempotent, Public, RateLimit, Roles, SystemEndpoint, Validate, ValidBody, ValidParams, ValidQuery,
  paginate, paginationQuery, registerProblem, toPage, type PaginationQuery, type Tx,
} from '../../src/modules/platform';

registerProblem({ code: 'fixture-teapot', status: 409, title: 'Fixture conflict' });

const strictBody = z.object({ name: z.string() }).strict();
export const fixtureState = { listTotal: 25, created: [] as string[], boomCount: 0, ipnHandled: 0 };

/** Controller thử của test (platform không có endpoint nghiệp vụ nào ngoài health). */
@Controller('fx')
export class FixtureController {
  constructor(private readonly transactions: TransactionService, private readonly audit: AuditService) {}

  /** Mô phỏng ORD hủy đơn: đổi trạng thái và ghi audit trong CÙNG một giao dịch (audit lỗi thì đơn không đổi). */
  @Post('cancel') @Roles('admin') @Validate({ body: z.object({ id: z.number(), reason: z.string() }).strict() })
  cancel(@ValidBody() b: { id: number; reason: string }, @CurrentSession() s: SessionContext) {
    return this.transactions.run(async (tx) => {
      await tx.$executeRaw`UPDATE test_orders SET status = 'cancelled' WHERE id = ${b.id}`;
      await this.audit.record(tx, {
        actor_id: s.user_id, actor_role: s.role, action: 'order.cancel', target_type: 'order', target_id: String(b.id),
        before: { status: 'paid' }, after: { status: 'cancelled' }, reason: b.reason,
      });
      return { id: b.id, status: 'cancelled' };
    });
  }
  @Get('items') @Roles('customer', 'admin') @Validate({ query: paginationQuery })
  list(@ValidQuery() q: PaginationQuery) {
    const { skip, take } = paginate(q);
    return toPage(Array.from({ length: fixtureState.listTotal }, (_, i) => ({ n: i })).slice(skip, skip + take), fixtureState.listTotal, q);
  }

  @Post('items') @Roles('customer') @Validate({ body: strictBody })
  create(@ValidBody() b: { name: string }) { return { name: b.name }; }

  @Get('open') @Public() @Validate({})
  open() { return { ok: true }; }

  @Get('admin-only') @Roles('admin') @Validate({})
  adminOnly() { return { ok: true }; }

  @Get('boom') @Public() @Validate({})
  boom() { fixtureState.boomCount++; throw new TypeError('secret detail at /srv/app/x.ts'); }

  /** Lỗi mà message, thuộc tính và `cause` chứa dữ liệu nhạy cảm (SB-18). Ghép lúc chạy để mã quét bí mật không bắt chuỗi giả. */
  @Get('boom-leak') @Public() @Validate({})
  boomLeak() {
    const e = new Error(['connect postgresql://app:', 'Pa55w0rdXyz@db.internal:5432/x failed; Bearer ', 'abc.def-ghi_123; password=hunter2; thẻ 4111 1111 1111 1111'].join(''), { cause: new Error('token=cause-secret-value') }); // scan-secrets:allow
    Object.assign(e, { token: 'prop-secret-token', meta: { password: 'nested-pw', note: 'số thẻ 4111-1111-1111-1111 trong ghi chú' } });
    throw e;
  }

  @Get('orders/:code') @Roles('customer') @Validate({ params: z.object({ code: z.string() }).strict() })
  order(@ValidParams() p: { code: string }) { return { code: p.code }; }

  @Get('resource/:id') @Roles('customer') @Validate({ params: z.object({ id: z.string() }).strict() })
  resource(@ValidParams() p: { id: string }) { if (p.id !== 'mine') throw new DomainError('not-found'); return { id: p.id }; }

  @Get('domain') @Public() @Validate({})
  domain() { throw new DomainError('fixture-teapot'); }

  @Get('unregistered') @Public() @Validate({})
  unregistered() { throw new DomainError('ma-chua-dang-ky'); }

  @Post('echo') @Public() @Validate({ body: strictBody })
  echo(@ValidBody() b: { name: string }) { return { length: b.name.length }; }

  @Post('state') @Roles('customer') @Validate({ body: strictBody })
  state(@ValidBody() b: { name: string }) { return { name: b.name }; }

  @Put('state') @Roles('customer') @Validate({ body: strictBody })
  putState(@ValidBody() b: { name: string }) { return { name: b.name }; }

  @Patch('state') @Roles('customer') @Validate({ body: strictBody })
  patchState(@ValidBody() b: { name: string }) { return { name: b.name }; }

  @Delete('state') @Roles('customer') @Validate({})
  deleteState() { return { ok: true }; }

  @Get('limited-b') @Roles('customer') @RateLimit({ tier: 'B', limit: 5, windowSeconds: 60 }) @Validate({})
  limitedB() { return { ok: true }; }

  // review USR: RateLimit.group (cùng group chung một bộ đếm) và route không khai group (bộ đếm riêng mỗi route)
  @Get('limited-g1') @Roles('customer') @RateLimit({ tier: 'B', limit: 3, windowSeconds: 60, group: 'fx:g' }) @Validate({})
  limitedG1() { return { ok: true }; }
  @Get('limited-g2') @Roles('customer') @RateLimit({ tier: 'B', limit: 3, windowSeconds: 60, group: 'fx:g' }) @Validate({})
  limitedG2() { return { ok: true }; }
  @Get('limited-h') @Roles('customer') @RateLimit({ tier: 'B', limit: 3, windowSeconds: 60 }) @Validate({})
  limitedH() { return { ok: true }; }

  @Get('limited-a') @Public() @RateLimit({ tier: 'A', limit: 3, windowSeconds: 60 }) @Validate({})
  limitedA() { return { ok: true }; }

  /** Thứ tự kiểm của nền (PRJ-TC-20261006-180338418): ghi, chỉ admin, schema đóng, bậc A một yêu cầu mỗi cửa sổ. */
  @Post('ordered') @Roles('admin') @RateLimit({ tier: 'A', limit: 1, windowSeconds: 60 }) @Validate({ body: strictBody })
  ordered(@ValidBody() b: { name: string }) { return { name: b.name }; }

  @Get('limited-d') @Roles('admin') @RateLimit({ tier: 'D', limit: 2, windowSeconds: 10 }) @Validate({})
  limitedD() { return { ok: true }; }

  /** Khóa đếm theo tài khoản được thử (chống dò mật khẩu theo tài khoản), không theo người dùng hay IP. */
  @Get('limited-key') @Public() @Validate({ query: z.object({ account: z.string() }).strict() })
  @RateLimit({ tier: 'A', limit: 2, windowSeconds: 60, key: (req) => `acct:${String(req.query.account)}` })
  limitedKey() { return { ok: true }; }

  @Get('limited-c') @Roles('customer') @Validate({})
  limitedC() { return { ok: true }; }

  @Get('public-c') @Public() @Validate({})
  publicC() { return { ok: true }; }

  @Post('ipn') @HttpCode(200) @SystemEndpoint({ verifier: (req) => req.headers['x-sign'] === 'good' }) @Validate({ body: z.object({ ref: z.string() }).strict() })
  ipn(@Body() _b: unknown) { fixtureState.ipnHandled++; return { RspCode: '00', Message: 'Confirm Success' }; }

  @Post('ipn-crash') @HttpCode(200) @SystemEndpoint({ verifier: () => true }) @Validate({})
  ipnCrash() { throw new Error('select * from payments -- secret'); }

  @Post('idem') @Roles('customer') @Idempotent({ scope: 'test.create' }) @Validate({ body: z.object({ qty: z.number() }).strict() })
  async idem(@ValidBody() b: { qty: number }, @DbTx() tx: Tx) {
    if (b.qty < 0) throw new Error('lỗi 5xx cố ý');
    const rows = await tx.$queryRaw<{ id: number }[]>`INSERT INTO test_idem_records (qty) VALUES (${b.qty}) RETURNING id`;
    return { id: rows[0].id, qty: b.qty };
  }

  /** Như `idem` nhưng nhắm một tài nguyên theo tham số đường dẫn (kho: nhập cho sản phẩm nào): tham số là một phần nội dung của yêu cầu. */
  @Post('idem-on/:target') @Roles('customer') @Idempotent({ scope: 'test.create-on' }) @Validate({ params: z.object({ target: z.string() }).strict(), body: z.object({ qty: z.number() }).strict() })
  async idemOn(@ValidParams() p: { target: string }, @ValidBody() b: { qty: number }, @DbTx() tx: Tx) {
    const rows = await tx.$queryRaw<{ id: number }[]>`INSERT INTO test_idem_records (qty) VALUES (${b.qty}) RETURNING id`;
    return { id: rows[0].id, target: p.target };
  }
}

/** Controller vi phạm để kiểm test quét route. */
@Controller('bad')
export class BadController {
  @Get('no-auth') @Validate({}) noAuth() { return 1; }
  @Get('no-schema') @Public() noSchema() { return 1; }
  @Post('ipn-no-verifier') @SystemEndpoint({} as never) @Validate({}) ipnNoVerifier() { return 1; }
}
