import { Controller, Get, HttpCode, Post } from '@nestjs/common';
import { z } from 'zod';
import { Roles, SystemEndpoint, Validate } from '../../src/modules/platform';

/** Endpoint thử của test AUTH (module AUTH không có endpoint "nghiệp vụ" nào ngoài auth và admin/users). */
@Controller('probe')
export class ProbeController {
  @Get('any') @Roles('customer', 'staff', 'admin') @Validate({})
  any() { return { ok: true }; }

  @Get('staff') @Roles('staff', 'admin') @Validate({})
  staff() { return { ok: true }; }

  @Post('state') @HttpCode(200) @Roles('customer', 'staff', 'admin') @Validate({ body: z.object({}).passthrough() })
  state() { return { ok: true }; }

  /** Endpoint hệ thống: chỉ vào bằng chữ ký, không bao giờ bằng cookie phiên. */
  @Post('system') @HttpCode(200) @SystemEndpoint({ verifier: () => false }) @Validate({ body: z.object({}).passthrough() })
  system() { return { reached: true }; }
}

/** Endpoint không khai quyền (cố ý): guard phải từ chối với mọi role, kiểm route phải báo. */
@Controller('probe-bad')
export class UndeclaredProbeController {
  @Get('undeclared') @Validate({})
  undeclared() { return { ok: true }; }

  @Get('empty') @Roles() @Validate({})
  empty() { return { ok: true }; }
}

/** Stub của epic ORD (chưa có code): các route mà ma trận quyền và AUTH-TC-...941948, ...941994 dùng để thử guard. */
@Controller()
export class StubOrdController {
  @Get('admin/orders') @Roles('staff', 'sale', 'admin') @Validate({})
  allOrders() { return { items: [] }; }

  /** Stub của ORD `GET /order-sources` (staff, sale, admin): dùng thử role `sale` đi qua guard. */
  @Get('order-sources') @Roles('staff', 'sale', 'admin') @Validate({})
  sources() { return { items: [] }; }

  @Get('orders') @Roles('customer') @Validate({})
  myOrders() { return { items: [] }; }

  @Post('orders/:code/cancel') @HttpCode(200) @Roles('customer', 'admin') @Validate({ params: z.object({ code: z.string() }).strict(), body: z.object({}).passthrough() })
  cancel() { return { cancelled: true }; }
}
