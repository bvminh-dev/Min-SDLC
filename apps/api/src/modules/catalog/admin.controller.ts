import { Controller, Delete, Get, HttpCode, Patch, Post, Put, Req, Res, StreamableFile } from '@nestjs/common';
import type { Request, Response } from 'express';
import { Action, CurrentSession, RateLimit, Roles, Validate, ValidBody, ValidParams, ValidQuery, allowMultipart, type SessionContext } from '../platform';
import { CategoryService } from './category.service';
import { LIMITS } from './http';
import { ImageService } from './image.service';
import { ImportService } from './import.service';
import { TEMPLATE_FILENAME, XLSX_MIME, templateXlsx } from './import-template';
import {
  adminListQuery, categoryCreateBody, categoryPatchBody, idParams, imageOrderBody, imageParams, importQuery, noParams, productCreateBody, productPatchBody,
  type AdminListQuery, type ImportQuery, type CategoryCreate, type CategoryPatch, type ProductCreate, type ProductPatch,
} from './policy';
import { ProductService } from './product.service';
import { QueryService } from './query.service';

// Tải ảnh là multipart/form-data: ngoại lệ hẹp của quy tắc application/json, vẫn qua kiểm Origin (PRD-API đầu tài liệu).
allowMultipart('POST', '/api/v1/admin/products/:id/images');
allowMultipart('POST', '/api/v1/admin/products/import'); // import .xlsx hoặc .csv (PRD-REQ-20261015-092431191): cùng ngoại lệ hẹp, vẫn qua Origin, quyền và bậc E

/** Quản lý danh mục (admin): ghi chỉ admin (SB-05, SB-07). */
@Controller('admin/categories')
export class AdminCategoryController {
  constructor(private readonly categories: CategoryService) {}

  @Post() @Action('Tạo và sửa danh mục') @Roles('admin') @RateLimit(LIMITS.adminWrite) @Validate({ body: categoryCreateBody })
  create(@CurrentSession() s: SessionContext, @ValidBody() b: CategoryCreate) { return this.categories.create(s, b); }

  @Patch(':id') @Action('Tạo và sửa danh mục') @Roles('admin') @RateLimit(LIMITS.adminWrite) @Validate({ params: idParams, body: categoryPatchBody })
  update(@CurrentSession() s: SessionContext, @ValidParams() p: { id: string }, @ValidBody() b: CategoryPatch) { return this.categories.update(s, p.id, b); }

  @Delete(':id') @Action('Xóa danh mục') @HttpCode(204) @Roles('admin') @RateLimit(LIMITS.adminWrite) @Validate({ params: idParams })
  async remove(@CurrentSession() s: SessionContext, @ValidParams() p: { id: string }) { await this.categories.remove(s, p.id); }
}

/** Quản lý sản phẩm (admin ghi; staff và admin đọc, bậc D 30 mỗi phút mỗi người). */
@Controller('admin/products')
export class AdminProductController {
  constructor(private readonly products: ProductService, private readonly images: ImageService, private readonly queries: QueryService, private readonly imports: ImportService) {}

  @Post() @Action('Tạo sản phẩm nháp') @Roles('admin') @RateLimit(LIMITS.adminWrite) @Validate({ body: productCreateBody })
  create(@CurrentSession() s: SessionContext, @ValidBody() b: ProductCreate) { return this.products.create(s, b); }

  // Serializer theo role của phiên (SB-42): chỉ admin nhận `cost_price`; staff và sale cùng hình dạng nhưng KHÔNG có khóa đó. Không có tham số nào bật giá vốn.
  @Get() @Action('Xem danh sách và chi tiết sản phẩm ở trang quản trị (mọi trạng thái)') @Roles('staff', 'sale', 'admin') @RateLimit(LIMITS.adminRead) @Validate({ query: adminListQuery })
  list(@CurrentSession() s: SessionContext, @ValidQuery() q: AdminListQuery) { return this.queries.adminList(q, s.role === 'admin'); }

  @Get(':id') @Action('Xem danh sách và chi tiết sản phẩm ở trang quản trị (mọi trạng thái)') @Roles('staff', 'sale', 'admin') @RateLimit(LIMITS.adminRead) @Validate({ params: idParams, query: noParams })
  detail(@CurrentSession() s: SessionContext, @ValidParams() p: { id: string }) { return this.queries.adminDetail(p.id, s.role === 'admin'); }

  /** Import sản phẩm: bậc E, chỉ admin; kiểm tần suất trước khi đọc tệp (PRD-API: 401, 403, 429, 400, ...). */
  @Post('import') @Action('Import sản phẩm từ tệp .xlsx hoặc .csv (xem trước `dry_run` và xác nhận)') @HttpCode(200) @Roles('admin') @RateLimit(LIMITS.import) @Validate({ query: importQuery })
  import(@CurrentSession() s: SessionContext, @ValidQuery() q: ImportQuery, @Req() req: Request, @Res({ passthrough: true }) res: Response) { return this.imports.run(s, q.dry_run, req, res); }

  @Get('import/template') @Action('Tải tệp mẫu import sản phẩm') @Roles('admin') @RateLimit(LIMITS.importTemplate) @Validate({ query: noParams })
  template() { return new StreamableFile(templateXlsx(), { type: XLSX_MIME, disposition: `attachment; filename="${TEMPLATE_FILENAME}"` }); }

  @Patch(':id') @Action('Sửa thông tin sản phẩm') @Roles('admin') @RateLimit(LIMITS.adminWrite) @Validate({ params: idParams, body: productPatchBody })
  update(@CurrentSession() s: SessionContext, @ValidParams() p: { id: string }, @ValidBody() b: ProductPatch) { return this.products.update(s, p.id, b); }

  @Post(':id/images') @Action('Quản lý ảnh sản phẩm') @Roles('admin') @RateLimit(LIMITS.adminWrite) @Validate({ params: idParams })
  upload(@CurrentSession() s: SessionContext, @ValidParams() p: { id: string }, @Req() req: Request, @Res({ passthrough: true }) res: Response) { return this.images.upload(s, p.id, req, res); }

  @Put(':id/images/order') @Action('Quản lý ảnh sản phẩm') @Roles('admin') @RateLimit(LIMITS.adminWrite) @Validate({ params: idParams, body: imageOrderBody })
  reorder(@CurrentSession() s: SessionContext, @ValidParams() p: { id: string }, @ValidBody() b: { image_ids: string[] }) { return this.images.reorder(s, p.id, b.image_ids); }

  @Delete(':id/images/:image_id') @Action('Quản lý ảnh sản phẩm') @HttpCode(204) @Roles('admin') @RateLimit(LIMITS.adminWrite) @Validate({ params: imageParams })
  async removeImage(@CurrentSession() s: SessionContext, @ValidParams() p: { id: string; image_id: string }) { await this.images.remove(s, p.id, p.image_id); }

  @Post(':id/publish') @Action('Công bố sản phẩm') @HttpCode(200) @Roles('admin') @RateLimit(LIMITS.adminWrite) @Validate({ params: idParams })
  publish(@CurrentSession() s: SessionContext, @ValidParams() p: { id: string }) { return this.products.publish(s, p.id); }

  @Post(':id/archive') @Action('Ngừng bán hoặc hủy nháp sản phẩm') @HttpCode(200) @Roles('admin') @RateLimit(LIMITS.adminWrite) @Validate({ params: idParams })
  archive(@CurrentSession() s: SessionContext, @ValidParams() p: { id: string }) { return this.products.archive(s, p.id); }
}
