import { registerProblem } from '../platform';

// Mã lỗi của PRD (PRD-API mục Hợp đồng dữ liệu, ADR-023): `type` = urn:ecom:error:<mã kebab-case>. `validation-failed`, `not-found`, `conflict`, `rate-limited`,
// `unauthenticated`, `forbidden`, `csrf_failed`, `service-unavailable`, `image-invalid` (dùng chung với USR) là mã nền của platform.
const defs: [string, number, string][] = [
  ['category-name-taken', 409, 'Category name already used under this parent'],
  ['category-cycle', 409, 'Category cannot move into its own branch'],
  ['category-too-deep', 409, 'Category tree is limited to 3 levels'],
  ['category-not-empty', 409, 'Category still has children or products'],
  ['product-sku-taken', 409, 'SKU already used'],
  ['product-sku-locked', 409, 'SKU cannot change after the product was published'],
  ['product-version-conflict', 409, 'Product was changed by someone else'],
  ['product-archived', 409, 'Product is archived'],
  ['product-image-limit', 409, 'Product already has the maximum number of images'],
  ['product-last-image', 409, 'An active product must keep at least one image'],
  ['product-not-publishable', 422, 'Product is missing required data'],
  ['import-file-invalid', 400, 'Import file rejected'], // PRD-API mục import: kèm `reason` (và `missing` khi header_invalid)
];
for (const [code, status, title] of defs) registerProblem({ code, status, title });
