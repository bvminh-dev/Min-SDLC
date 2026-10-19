import type { RateLimitOptions } from '../platform';

/** Bảng bậc SB-14 cho PRD (PRD-API mục Giới hạn tần suất): endpoint công khai dùng bậc C mặc định của platform (120 mỗi phút mỗi IP, không khai ở đây). */
export const LIMITS = {
  adminRead: { tier: 'D', limit: 30, windowSeconds: 60, group: 'prd:admin-read' }, // danh sách và chi tiết quản trị chung một bộ đếm mỗi người
  adminWrite: { tier: 'D', limit: 30, windowSeconds: 60, group: 'prd:admin-write' }, // tạo, sửa, xóa danh mục; tạo, sửa, ảnh, công bố, ngừng bán sản phẩm: chung một bộ đếm mỗi người (PRD-API đầu tài liệu)
  import: { tier: 'E', limit: 20, windowSeconds: 3600, group: 'prd:import' }, // import sản phẩm: 20 mỗi giờ mỗi admin, dry_run và xác nhận chung bộ đếm (PRD-REQ-20261015-092431191 BR13)
  importTemplate: { tier: 'D', limit: 30, windowSeconds: 60, group: 'prd:import-template' }, // tải tệp mẫu (PRD-REQ-20261015-092431230 BR4)
} as const satisfies Record<string, RateLimitOptions>;
