import { cfg, registerConfigSchema } from '../platform';

// Hằng số nghiệp vụ của catalog đã chốt ở spec (đổi phải chạy sdlc-impact). Kho object (STORAGE_*) là phần dùng chung của platform.
export const MAX_IMAGES = 8; // PRD-REQ-20261006-095502592 BR2, ADR-018
export const IMAGE_MAX_BYTES = 5_242_880; // 5 MB (BR3, ADR-018); cũng là CHECK của product_images.bytes
export const IMAGE_MAX_PIXELS = 25_000_000; // 25 megapixel đầu vào, kiểm từ tiêu đề trước khi giải mã (ADR-018, SB-10)
export const IMAGE_MAX_EDGE = 1600; // cạnh dài sau xử lý lại (ADR-018)
export const IMAGE_ORPHAN_AGE_MS = 24 * 3600_000; // ADR-018, PRD-DB mục 13
export const IMAGE_SWEEP_BATCH = 500; // giới hạn lô của job dọn ảnh (PRD-DB mục 13, SB-34): cấu hình sai cũng không xóa quá chừng này mỗi lượt
export const IMAGE_CACHE_CONTROL = 'public, max-age=300'; // ADR-018 (phát ảnh): cùng chính sách với ảnh đại diện, ảnh đã xóa hết phát trong 5 phút
export const IMAGE_PREFIX = 'products/';
export const MAX_DEPTH = 3; // PRD-REQ-20261006-095502484 BR2
export const BATCH_LIMIT = 100; // getForCart, getSummaries
export const SEARCH_LIMIT = 200; // searchProductIds
export const SEARCH_Q_MAX = 100; // độ dài tối đa của q (PRD-REQ-20261006-095502718 BR2), cũng áp cho searchProductIds
export const ACTIVE_ID_LIMIT = 500; // listActiveProductIds

// Import sản phẩm (ADR-025, PRD-REQ-20261015-092431191 BR3): hai trần cấu hình được (ADR-007), mặc định 5 MB và 2000 dòng dữ liệu.
export const PRD_VARS = {
  PRD_IMPORT_MAX_BYTES: cfg.int({ default: 5_242_880, min: 1 }),
  PRD_IMPORT_MAX_ROWS: cfg.int({ default: 2000, min: 1 }),
};
registerConfigSchema(PRD_VARS);
export const IMPORT_MAX_UNCOMPRESSED = 50 * 1024 * 1024; // tổng kích thước giải nén của xlsx (hằng số, BR3): giải nén dừng ngay khi vượt
export const IMPORT_SHEET_MAX_COL = 64; // số cột tối đa đọc từ trang tính (mẫu KiotViet ~20 cột): tham chiếu ô vượt là tệp giả, không bao giờ cấp mảng theo cột khai
export const IMPORT_SHEET_MAX_CELLS = 500_000; // tổng số thẻ ô <c> tối đa của trang tính (SB-43: tệp nhỏ không được bắt vòng đọc chạy vô hạn)
export const IMPORT_SHEET_MAX_ROW = 1_048_576; // số dòng tối đa của Excel: chiều trang tính khai lớn hơn là tệp giả, bị từ chối trước khi quét (PRD-TC-20261015-093100429)
export const COST_MAX = 1_000_000_000; // giá vốn 0..COST_MAX (PRD-API mục giá vốn)
