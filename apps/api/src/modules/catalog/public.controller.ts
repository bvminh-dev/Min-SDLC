import { Controller, Get } from '@nestjs/common';
import { Action, Public, Validate, ValidParams, ValidQuery } from '../platform';
import { CategoryService } from './category.service';
import { browseQuery, idParams, noParams, searchQuery, type BrowseQuery, type SearchQuery } from './policy';
import { QueryService } from './query.service';

/** Khu vực công khai (guest, mọi role): chỉ đọc, chỉ sản phẩm `active`, giới hạn tần suất bậc C mặc định của platform (SB-14). */
@Controller()
export class PublicCatalogController {
  constructor(private readonly categories: CategoryService, private readonly queries: QueryService) {}

  @Get('categories') @Public() @Action('Xem cây danh mục') @Validate({ query: noParams })
  async tree() { return { items: await this.categories.tree() }; }

  @Get('products') @Public() @Action('Duyệt sản phẩm theo danh mục, lọc giá, sắp xếp') @Validate({ query: browseQuery })
  browse(@ValidQuery() q: BrowseQuery) { return this.queries.browse(q); }

  // Tuyến tĩnh `search` đăng ký TRƯỚC `:id`; `:id` sai định dạng (kể cả chữ khác "search") trả 404 như sản phẩm không tồn tại.
  @Get('products/search') @Public() @Action('Tìm kiếm sản phẩm theo từ khóa') @Validate({ query: searchQuery })
  search(@ValidQuery() q: SearchQuery) { return this.queries.browse(q); }

  @Get('products/:id') @Public() @Action('Xem chi tiết sản phẩm đang bán') @Validate({ params: idParams, query: noParams })
  detail(@ValidParams() p: { id: string }) { return this.queries.publicDetail(p.id); }
}
