import { Controller, Get, HttpCode, Patch, Post, Res } from '@nestjs/common';
import type { Response } from 'express';
import { Action, CurrentSession, DbTx, Idempotent, Public, RateLimit, Roles, Validate, ValidBody, ValidParams, ValidQuery, type SessionContext, type Tx } from '../platform';
import { LIMITS } from './http';
import {
  adjustBody, availabilityQuery, listQuery, lowStockQuery, movementsQuery, noParams, productParams, stockInBody, stockOutBody, thresholdBody,
  type Adjust, type AvailabilityQuery, type ListQuery, type LowStockQuery, type MovementsQuery, type StockIn, type StockOut, type Threshold,
} from './policy';
import { ReadService } from './read.service';
import { StockService } from './stock.service';

type Params = { product_id: string };

/** Quản trị tồn kho (staff, admin; INV-API mục Endpoint). Bậc D 30 mỗi phút mỗi người, mọi endpoint chung một bộ đếm (ADR-014). Tuyến tĩnh `low-stock` đăng ký trước `:product_id`. */
@Controller('admin/inventory')
export class AdminInventoryController {
  constructor(private readonly reads: ReadService, private readonly stock: StockService) {}

  @Get() @Action('Xem danh sách và chi tiết tồn kho') @Roles('staff', 'admin') @RateLimit(LIMITS.admin) @Validate({ query: listQuery })
  list(@ValidQuery() q: ListQuery) { return this.reads.list(q); }

  @Get('low-stock') @Action('Xem danh sách sản phẩm tồn thấp') @Roles('staff', 'admin') @RateLimit(LIMITS.admin) @Validate({ query: lowStockQuery })
  lowStock(@ValidQuery() q: LowStockQuery) { return this.reads.lowStock(q); }

  @Get(':product_id') @Action('Xem danh sách và chi tiết tồn kho') @Roles('staff', 'admin') @RateLimit(LIMITS.admin) @Validate({ params: productParams, query: noParams })
  detail(@ValidParams() p: Params) { return this.reads.detail(p.product_id); }

  @Post(':product_id/stock-in') @Action('Nhập kho') @HttpCode(200) @Roles('staff', 'admin') @RateLimit(LIMITS.admin) @Idempotent({ scope: 'inventory.stock-in' }) @Validate({ params: productParams, body: stockInBody })
  stockIn(@CurrentSession() s: SessionContext, @DbTx() tx: Tx, @ValidParams() p: Params, @ValidBody() b: StockIn) { return this.stock.stockIn(tx, s, p.product_id, b); }

  @Post(':product_id/stock-out') @Action('Xuất kho thủ công') @HttpCode(200) @Roles('staff', 'admin') @RateLimit(LIMITS.admin) @Idempotent({ scope: 'inventory.stock-out' }) @Validate({ params: productParams, body: stockOutBody })
  stockOut(@CurrentSession() s: SessionContext, @DbTx() tx: Tx, @ValidParams() p: Params, @ValidBody() b: StockOut) { return this.stock.stockOut(tx, s, p.product_id, b); }

  @Post(':product_id/adjustments') @Action('Điều chỉnh tồn kho theo kiểm kê') @HttpCode(200) @Roles('staff', 'admin') @RateLimit(LIMITS.admin) @Idempotent({ scope: 'inventory.adjust' }) @Validate({ params: productParams, body: adjustBody })
  adjust(@CurrentSession() s: SessionContext, @DbTx() tx: Tx, @ValidParams() p: Params, @ValidBody() b: Adjust) { return this.stock.adjust(tx, s, p.product_id, b); }

  @Patch(':product_id/threshold') @Action('Đặt ngưỡng tồn thấp') @Roles('staff', 'admin') @RateLimit(LIMITS.admin) @Validate({ params: productParams, body: thresholdBody })
  threshold(@CurrentSession() s: SessionContext, @ValidParams() p: Params, @ValidBody() b: Threshold) { return this.stock.setThreshold(s, p.product_id, b); }

  @Get(':product_id/movements') @Action('Xem lịch sử biến động kho của một sản phẩm') @Roles('staff', 'admin') @RateLimit(LIMITS.admin) @Validate({ params: productParams, query: movementsQuery })
  movements(@ValidParams() p: Params, @ValidQuery() q: MovementsQuery) { return this.reads.movements(p.product_id, q); }
}

/** Công khai duy nhất của INV: chỉ `in_stock` theo lô, không số nào (SB-37, K-12). Bậc C 120 mỗi phút mỗi IP. */
@Controller('inventory')
export class PublicInventoryController {
  constructor(private readonly reads: ReadService) {}

  @Get('availability') @Action('Xem còn hàng hay hết hàng theo lô (công khai, không lộ số tồn)') @Public() @RateLimit(LIMITS.publicRead) @Validate({ query: availabilityQuery })
  availability(@ValidQuery() q: AvailabilityQuery, @Res({ passthrough: true }) res: Response) {
    res.setHeader('Cache-Control', 'no-store');
    return this.reads.inStock(q.product_ids);
  }
}
