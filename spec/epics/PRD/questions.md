# Câu hỏi còn mở của epic PRD (sdlc-research, sdlc-tech-design, sdlc-ui-ux, sdlc-test-design)

Chạy tự động nên không hỏi trực tiếp. Mọi mặc định dưới đây đã áp vào requirement, thiết kế, màn hình và test; đổi quyết định thì chạy `sdlc-impact`. Mọi file spec của PRD vẫn `draft`. Đã đồng bộ với nền mới ngày 2026-10-06 (xem cuối file).

## A. Cần người quyết ở phạm vi PRD
1. [OPEN] Độ sâu danh mục tối đa? Mặc định: 3 cấp, kiểm cả ở ràng buộc DB (PRD-REQ-20261006-095502507 BR3, BR5). `Category.depth` đã có ở entities.md (E-07) nhưng nền chưa chốt giá trị tối đa.
2. [OPEN] Cây danh mục công khai có hiện danh mục chưa có sản phẩm đang bán không? Mặc định: có, `product_count` = 0 (PRD-REQ-20261006-095502484 BR4).
3. [RESOLVED] `archived` có khôi phục được? E-24 (entities.md): `archived` là trạng thái cuối, khôi phục để SAU (cần sdlc-impact trên INV, CRT). [OPEN] phần còn lại: `sku` khóa từ khi `active` là mặc định chờ người quyết (PRD-REQ-20261006-095502571 BR3).
4. [OPEN] Khoảng giá hợp lệ? Mặc định: số nguyên VND 1..1.000.000.000 (PRD-REQ-20261006-095502550 BR4).
5. [RESOLVED] Giới hạn ảnh sản phẩm: ADR-018 và SB-10 (S-08): tối đa 5 MB, 8 ảnh, JPEG/PNG/WebP, 25 megapixel đầu vào, cạnh dài 1600 px, re-encode, bỏ EXIF, khóa ngẫu nhiên, job dọn 24 giờ. Áp dụng vào PRD-REQ-20261006-095502592 BR3, BR8, thiết kế DB, API, SEC T7 và test PRD-TC-20261006-120604408.
6. [OPEN] Tìm kiếm khớp những trường nào? Mặc định: tên và sku, không phân biệt hoa thường và dấu, mọi từ phải khớp; chưa tìm trong mô tả và chưa sắp xếp theo điểm đánh giá (PRD-REQ-20261006-095502718 BR3). Công cụ đã chốt: ADR-019 (PostgreSQL `pg_trgm`, `unaccent`).
7. [RESOLVED] Staff xem sản phẩm ở trang quản trị: roles.md (R-02): staff xem sản phẩm ở trang quản trị, chỉ đọc; mọi ghi là admin (PRD-REQ-20261006-095502655 BR1). Không audit việc xem (K-16).
8. [RESOLVED] Địa chỉ trang chi tiết: E-07 ghi "chưa thêm `slug` cho Product", nên dùng `id` (uuid) ở v1; thêm `slug` là migration mới kèm sdlc-impact.
9. [RESOLVED] Giới hạn tần suất duyệt, tìm kiếm công khai: SB-14, ADR-014 (S-01) bậc C: 120 yêu cầu mỗi phút mỗi IP, trần `limit` 100, `q` 100 ký tự, 429 kèm `Retry-After`, chỉ tin `X-Forwarded-For` từ proxy cấu hình. Áp dụng vào PRD-REQ-20261006-095502697 BR7, PRD-REQ-20261006-095502718 BR7, API, SEC T6 và test PRD-TC-20261006-100356041.
10. [OPEN] Thư viện UI và CSS của web (ADR-002 chỉ nói Next.js)? Mặc định theo evon: Tailwind và `references/tokens.css`; cần chốt khi chạy PRJ (Project setup).

## B. Phụ thuộc epic khác
11. [RESOLVED] INV: ProductActivated tạo StockItem, ProductArchived đặt `archived_at`: INV-REQ-20261006-101122685 đã có handler; PRD chỉ ghi outbox, không gọi INV. Khai Consumer INV ở events.md khớp (V-02, V-09).
12. [RESOLVED] CRT: xử lý giỏ có sản phẩm `archived` ở CRT-REQ-20261006-103226614 (`unavailable_reason` = `product_archived`); giá hiện hành qua giao diện `getForCart(product_ids)` (CRT-API đề xuất, bảng Giao diện module của architecture.md A-02, PRD-API đã nhận). Không có event đổi giá: ProductPriceChanged là backlog v1 (events.md); số tiền luôn do server tính lại (SB-23).
13. [RESOLVED] REV: ReviewHidden mang `rating`, thêm ReviewDeleted và ReviewRatingChanged: V-12, K-11. PRD giữ `ProductReviewRating` (E-07) để cập nhật idempotent; xử lý ở PRD-REQ-20261006-095502739 BR2..BR6.
14. [RESOLVED] AUTH và PRJ: guard phiên là interface `SessionContext` của platform (ADR-012, A-01), audit là `AuditService.record()` đồng bộ (ADR-021, E-02); PRD không khai phụ thuộc (`depends_on: []`).
15. [OPEN] Requirement của INV cho endpoint công khai `GET /inventory/availability?product_ids=` (K-12, SB-37) chưa có ID (INV chưa đồng bộ xong); PRD-REQ-20261006-095502676 và PRD-REQ-20261006-095502697 chưa thể `links` tới nó. Thêm link khi INV có requirement.
16. [OPEN] Chữ ký giao diện nội bộ PRD phơi ra: `getForCart` (CRT, đã có), `getSummaries` và `searchProductIds` (INV, REV; INV-DB ghi gọi lô tới PRD lấy tên, sku và tối đa 200 id theo `q`), `countByStatus` (DSH, DSH-API đề xuất). Chữ ký chốt cùng epic bên gọi khi đồng bộ.
17. [OPEN] Bậc giới hạn tần suất cho endpoint quản trị đọc của PRD (staff, admin): bảng bậc ở security-baseline.md chưa liệt kê danh sách sản phẩm quản trị; mặc định áp bậc D (30 yêu cầu mỗi phút mỗi người), chốt ở implement.
18. [OPEN] Có thêm sắp xếp theo điểm đánh giá (`rating_avg`) ở danh sách không? Mặc định: chưa (PRD-REQ-20261006-095502697); dữ liệu đã có từ event REV nên thêm được bằng một chỉ mục và giá trị `sort` mới, kèm sdlc-impact.

## Nền còn thiếu sau lần sửa 2026-10-06
1. `spec/domain/events.md`: ProductPriceChanged (PRD phát, CRT nhận) mới ở backlog v1; giỏ không được báo khi giá đổi cho tới khi nền làm event (PRD-SEC rủi ro còn lại).
2. `spec/security-baseline.md` SB-14: bảng bậc chưa gán endpoint quản trị đọc sản phẩm (xem mục 17).
3. `spec/domain/entities.md`: chưa có `slug` cho Product và chưa có chuyển `archived -> draft` hoặc `active` (khôi phục để SAU, E-24).

## Nhật ký đồng bộ nền 2026-10-06
- `requirements/PRD-REQ-...095502739` (viết lại): K-11, V-12, E-07, V-13, ADR-011; `roles` thêm `system` (R-01); links tới REV-REQ-...103135835, ...103135477, ...103135385; thêm ReviewDeleted, ReviewRatingChanged, bản chiếu `counted`, `rating_sum`, chống trùng theo `event_id`; bỏ [NEEDS CLARIFICATION], [OPEN] thành [RESOLVED].
- `requirements/PRD-REQ-...095502613`, `...634`: ADR-011, SB-27: event ghi outbox cùng giao dịch, consumer chống trùng; thêm ca tiến trình chết sau commit; links tới INV-REQ-...101122685, CRT-REQ-...103226614 trong BR; [OPEN] outbox thành [RESOLVED].
- `requirements/PRD-REQ-...095502592`: ADR-018, SB-10 (S-08): thêm 25 megapixel, cạnh dài 1600 px, `width`, `height`, `bytes`, job dọn 24 giờ, entity ProductImage (E-07); thêm ca 30 megapixel.
- `requirements/PRD-REQ-...095502676`, `...697`: K-12, SB-37: nhãn còn hàng ghép ở web từ INV `in_stock`; thêm ca INV trả `in_stock` và INV lỗi; `...697` BR7: SB-14 bậc C (ADR-014, S-01).
- `requirements/PRD-REQ-...095502718`: ADR-019 (công cụ tìm kiếm), SB-14 bậc C.
- `requirements/PRD-REQ-...095502655`: R-02, K-16: staff xem sản phẩm quản trị, không audit.
- `requirements/PRD-REQ-...095502507`, `...529`, `...550`, `...571`, `...484`: ADR-021 (AuditLog đồng bộ), E-07 (`Category.depth`, `version`), SB-30; `...571` BR6: ProductPriceChanged là backlog (events.md), [OPEN] thành [RESOLVED].
- `design/PRD-DB-...`: E-07, ADR-011, ADR-018, ADR-019, ADR-021, ADR-012: entities thêm ProductImage, ProductReviewRating; `product_images` thêm `width`, `height`, đổi `size_bytes` thành `bytes`; cách xử lý 4 event điểm (ProcessedEvent, `counted`); outbox cho 2 event; AuditService; job dọn ảnh; extension `unaccent`; bỏ [OPEN] outbox, audit, tìm kiếm, entity.
- `design/PRD-API-...`: A-01, A-02, A-03, ADR-023, ADR-014, ADR-016, K-12, V-12: `depends_on: []` (platform ngầm, không khai PRJ), `consumes` thêm ReviewDeleted, ReviewRatingChanged; `type` lỗi dạng URN; giới hạn tần suất bậc C; giao diện nội bộ phơi ra (`getForCart`, `getSummaries`, `searchProductIds`, `countByStatus`); P2, P4, P7 cập nhật.
- `design/PRD-SEC-...`: SB-10, SB-14, SB-19, SB-27, SB-30, ADR-011, ADR-018, ADR-021: T6 SB-14, T7 25 megapixel, T8 AuditLog, T10 SB-30, T11 bốn event và chống trùng, T15 outbox (Kiểm bằng `test`); cập nhật rủi ro còn lại.
- `flows/PRD-FLOW-...`: ADR-011, V-12, K-12: outbox ở nhánh công bố, ngừng bán; sơ đồ 2 thêm ReviewDeleted, ReviewRatingChanged, chống trùng `event_id`; bậc C ở nhánh công khai.
- `ui/product-list.md`, `ui/product-detail.md`: K-12, SB-37: thêm testid `prd-product-list-card-stock`, `prd-product-detail-stock` và trạng thái còn hàng, hết hàng, không biết tồn kho; `ui/admin-product-edit.md`: ADR-018 (25 megapixel trong thông báo lỗi ảnh).
- `tests/` thêm: PRD-TC-20261006-120604121 (ReviewDeleted, ReviewRatingChanged), PRD-TC-20261006-120604215 (hết ẩn, ẩn lặp), PRD-TC-20261006-120604307 (outbox, T15), PRD-TC-20261006-120604408 (25 megapixel), PRD-TC-20261006-120604504 (nhãn tồn kho ở chi tiết), PRD-TC-20261006-120650138 (nhãn tồn kho ở danh sách).
- `tests/` sửa: PRD-TC-...100356165, ...100356189, ...100356212 (rating_sum, payload có `rating`, ReviewDeleted, event_id, `counted`); ...100355739, ...100355762, ...100355784, ...100355807, ...100355830, ...100355853, ...100355524 (kiểm dòng OutboxEvent thay cho bus giả lập); ...100356041 (SB-14 bậc C, `X-Forwarded-For` giả); ...100355971 (`type` URN); ...100355364, ...100355456, ...100355592, ...100355666 (AuditLog); PRD-E2E-...100417248 (nhãn tồn kho).
- Không có test nào bị xóa.
