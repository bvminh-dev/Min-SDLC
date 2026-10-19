# Câu hỏi còn mở của epic PRD (sdlc-research, sdlc-tech-design, sdlc-ui-ux, sdlc-test-design)

Chạy tự động nên không hỏi trực tiếp. Mọi mặc định dưới đây đã áp vào requirement, thiết kế, màn hình và test; đổi quyết định thì chạy `sdlc-impact`. Mọi file spec của PRD vẫn `draft`. Đã đồng bộ với nền mới ngày 2026-10-06 (xem cuối file).

## A. Quyết định ở phạm vi PRD (đã chốt thay người dùng ngày 2026-10-06, người dùng rà lại ở cuối file)
1. [RESOLVED] Độ sâu danh mục tối đa? quyết định (mặc định, người dùng ủy quyền 2026-10-06): 3 cấp, kiểm cả ở ràng buộc DB (PRD-REQ-20261006-095502507 BR3, BR5). `Category.depth` đã có ở entities.md (E-07) nhưng nền chưa chốt giá trị tối đa (áp dụng ở epic, nền chưa có).
2. [RESOLVED] Cây danh mục công khai có hiện danh mục chưa có sản phẩm đang bán không? quyết định (mặc định, người dùng ủy quyền 2026-10-06): có, `product_count` = 0 (PRD-REQ-20261006-095502484 BR4).
3. [RESOLVED] `archived` có khôi phục được? E-24 (entities.md): `archived` là trạng thái cuối, khôi phục để SAU (cần sdlc-impact trên INV, CRT). Phần còn lại [RESOLVED]: quyết định (mặc định, người dùng ủy quyền 2026-10-06): `sku` khóa từ khi `active` (PRD-REQ-20261006-095502571 BR3).
4. [RESOLVED] Khoảng giá hợp lệ? quyết định (mặc định, người dùng ủy quyền 2026-10-06): số nguyên VND 1..1.000.000.000 (PRD-REQ-20261006-095502550 BR4).
5. [RESOLVED] Giới hạn ảnh sản phẩm: ADR-018 và SB-10 (S-08): tối đa 5 MB, 8 ảnh, JPEG/PNG/WebP, 25 megapixel đầu vào, cạnh dài 1600 px, re-encode, bỏ EXIF, khóa ngẫu nhiên, job dọn 24 giờ. Áp dụng vào PRD-REQ-20261006-095502592 BR3, BR8, thiết kế DB, API, SEC T7 và test PRD-TC-20261006-120604408.
6. [RESOLVED] Tìm kiếm khớp những trường nào? quyết định (mặc định, người dùng ủy quyền 2026-10-06): tên và sku, không phân biệt hoa thường và dấu, mọi từ phải khớp; chưa tìm trong mô tả và chưa sắp xếp theo điểm đánh giá (PRD-REQ-20261006-095502718 BR3). Công cụ đã chốt: ADR-019 (PostgreSQL `pg_trgm`, `unaccent`).
7. [RESOLVED] Staff xem sản phẩm ở trang quản trị: roles.md (R-02): staff xem sản phẩm ở trang quản trị, chỉ đọc; mọi ghi là admin (PRD-REQ-20261006-095502655 BR1). Không audit việc xem (K-16).
8. [RESOLVED] Địa chỉ trang chi tiết: E-07 ghi "chưa thêm `slug` cho Product", nên dùng `id` (uuid) ở v1; thêm `slug` là migration mới kèm sdlc-impact.
9. [RESOLVED] Giới hạn tần suất duyệt, tìm kiếm công khai: SB-14, ADR-014 (S-01) bậc C: 120 yêu cầu mỗi phút mỗi IP, trần `limit` 100, `q` 100 ký tự, 429 kèm `Retry-After`, chỉ tin `X-Forwarded-For` từ proxy cấu hình. Áp dụng vào PRD-REQ-20261006-095502697 BR7, PRD-REQ-20261006-095502718 BR7, API, SEC T6 và test PRD-TC-20261006-100356041.
10. [RESOLVED] Thư viện UI và CSS của web (ADR-002 chỉ nói Next.js)? quyết định (mặc định, người dùng ủy quyền 2026-10-06): Tailwind và `references/tokens.css` theo evon (áp dụng ở epic, nền chưa có ADR; PRJ nạp khi dựng dự án).

## B. Phụ thuộc epic khác
11. [RESOLVED] INV: ProductActivated tạo StockItem, ProductArchived đặt `archived_at`: INV-REQ-20261006-101122685 đã có handler; PRD chỉ ghi outbox, không gọi INV. Khai Consumer INV ở events.md khớp (V-02, V-09).
12. [RESOLVED] CRT: xử lý giỏ có sản phẩm `archived` ở CRT-REQ-20261006-103226614 (`unavailable_reason` = `product_archived`); giá hiện hành qua giao diện `getForCart(product_ids)` (CRT-API đề xuất, bảng Giao diện module của architecture.md A-02, PRD-API đã nhận). Không có event đổi giá: ProductPriceChanged là backlog v1 (events.md); số tiền luôn do server tính lại (SB-23).
13. [RESOLVED] REV: ReviewHidden mang `rating`, thêm ReviewDeleted và ReviewRatingChanged: V-12, K-11. PRD giữ `ProductReviewRating` (E-07) để cập nhật idempotent; xử lý ở PRD-REQ-20261006-095502739 BR2..BR6.
14. [RESOLVED] AUTH và PRJ: guard phiên là interface `SessionContext` của platform (ADR-012, A-01), audit là `AuditService.record()` đồng bộ (ADR-021, E-02); PRD không khai phụ thuộc (`depends_on: []`).
15. [RESOLVED] Requirement của INV cho endpoint công khai `GET /inventory/availability?product_ids=` (K-12, SB-37) nay là INV-REQ-20261006-120036236; quyết định (mặc định, người dùng ủy quyền 2026-10-06): PRD-REQ-20261006-095502676 và PRD-REQ-20261006-095502697 đã `links` tới nó.
16. [RESOLVED] Chữ ký giao diện nội bộ PRD phơi ra: `getForCart` (CRT, đã có), `getSummaries` và `searchProductIds` (INV, REV; INV-DB ghi gọi lô tới PRD lấy tên, sku và tối đa 200 id theo `q`), `countByStatus` (DSH, DSH-API đề xuất), và `listActiveProductIds` (INV đối soát; hàng INV -> PRD của architecture.md). quyết định (mặc định, người dùng ủy quyền 2026-10-06): chữ ký ở PRD-API là bản chốt, bên gọi dùng đúng; nền chỉ có tên (áp dụng ở epic, nền chưa có).
17. [RESOLVED] Bậc giới hạn tần suất cho endpoint quản trị đọc của PRD (staff, admin): nền đợt 3 (R-42) đã thêm danh sách sản phẩm quản trị vào bậc D, 30 yêu cầu mỗi phút mỗi người, kho đếm PostgreSQL; PRD-API đã khớp.
18. [RESOLVED] Có thêm sắp xếp theo điểm đánh giá (`rating_avg`) ở danh sách không? quyết định (mặc định, người dùng ủy quyền 2026-10-06): chưa (PRD-REQ-20261006-095502697); dữ liệu đã có từ event REV nên thêm được bằng một chỉ mục và giá trị `sort` mới, kèm sdlc-impact.

## Nền còn thiếu sau lần sửa 2026-10-06
1. `spec/domain/events.md`: ProductPriceChanged (PRD phát, CRT nhận) mới ở backlog v1; giỏ không được báo khi giá đổi cho tới khi nền làm event (PRD-SEC rủi ro còn lại).
2. `spec/security-baseline.md` SB-14: đã đủ sau đợt 3 (R-42 gán bậc D cho danh sách sản phẩm quản trị); không còn thiếu.
3. `spec/domain/entities.md`: chưa có `slug` cho Product và chưa có chuyển `archived -> draft` hoặc `active` (khôi phục để SAU, E-24).

## Nhật ký đồng bộ nền 2026-10-06
- `requirements/PRD-REQ-...095502739` (viết lại): K-11, V-12, E-07, V-13, ADR-011; `roles` thêm `system` (R-01); links tới REV-REQ-...103135835, ...103135477, ...103135385; thêm ReviewDeleted, ReviewRatingChanged, bản chiếu `counted`, `rating_sum`, chống trùng theo `event_id`; đã chốt các câu hỏi mở (nay đánh dấu đã chốt).
- `requirements/PRD-REQ-...095502613`, `...634`: ADR-011, SB-27: event ghi outbox cùng giao dịch, consumer chống trùng; thêm ca tiến trình chết sau commit; links tới INV-REQ-...101122685, CRT-REQ-...103226614 trong BR; câu hỏi mở về outbox đã chốt.
- `requirements/PRD-REQ-...095502592`: ADR-018, SB-10 (S-08): thêm 25 megapixel, cạnh dài 1600 px, `width`, `height`, `bytes`, job dọn 24 giờ, entity ProductImage (E-07); thêm ca 30 megapixel.
- `requirements/PRD-REQ-...095502676`, `...697`: K-12, SB-37: nhãn còn hàng ghép ở web từ INV `in_stock`; thêm ca INV trả `in_stock` và INV lỗi; `...697` BR7: SB-14 bậc C (ADR-014, S-01).
- `requirements/PRD-REQ-...095502718`: ADR-019 (công cụ tìm kiếm), SB-14 bậc C.
- `requirements/PRD-REQ-...095502655`: R-02, K-16: staff xem sản phẩm quản trị, không audit.
- `requirements/PRD-REQ-...095502507`, `...529`, `...550`, `...571`, `...484`: ADR-021 (AuditLog đồng bộ), E-07 (`Category.depth`, `version`), SB-30; `...571` BR6: ProductPriceChanged là backlog (events.md), câu hỏi mở đã chốt.
- `design/PRD-DB-...`: E-07, ADR-011, ADR-018, ADR-019, ADR-021, ADR-012: entities thêm ProductImage, ProductReviewRating; `product_images` thêm `width`, `height`, đổi `size_bytes` thành `bytes`; cách xử lý 4 event điểm (ProcessedEvent, `counted`); outbox cho 2 event; AuditService; job dọn ảnh; extension `unaccent`; bỏ các câu hỏi mở về outbox, audit, tìm kiếm, entity.
- `design/PRD-API-...`: A-01, A-02, A-03, ADR-023, ADR-014, ADR-016, K-12, V-12: `depends_on: []` (platform ngầm, không khai PRJ), `consumes` thêm ReviewDeleted, ReviewRatingChanged; `type` lỗi dạng URN; giới hạn tần suất bậc C; giao diện nội bộ phơi ra (`getForCart`, `getSummaries`, `searchProductIds`, `countByStatus`); P2, P4, P7 cập nhật.
- `design/PRD-SEC-...`: SB-10, SB-14, SB-19, SB-27, SB-30, ADR-011, ADR-018, ADR-021: T6 SB-14, T7 25 megapixel, T8 AuditLog, T10 SB-30, T11 bốn event và chống trùng, T15 outbox (Kiểm bằng `test`); cập nhật rủi ro còn lại.
- `flows/PRD-FLOW-...`: ADR-011, V-12, K-12: outbox ở nhánh công bố, ngừng bán; sơ đồ 2 thêm ReviewDeleted, ReviewRatingChanged, chống trùng `event_id`; bậc C ở nhánh công khai.
- `ui/product-list.md`, `ui/product-detail.md`: K-12, SB-37: thêm testid `prd-product-list-card-stock`, `prd-product-detail-stock` và trạng thái còn hàng, hết hàng, không biết tồn kho; `ui/admin-product-edit.md`: ADR-018 (25 megapixel trong thông báo lỗi ảnh).
- `tests/` thêm: PRD-TC-20261006-120604121 (ReviewDeleted, ReviewRatingChanged), PRD-TC-20261006-120604215 (hết ẩn, ẩn lặp), PRD-TC-20261006-120604307 (outbox, T15), PRD-TC-20261006-120604408 (25 megapixel), PRD-TC-20261006-120604504 (nhãn tồn kho ở chi tiết), PRD-TC-20261006-120650138 (nhãn tồn kho ở danh sách).
- `tests/` sửa: PRD-TC-...100356165, ...100356189, ...100356212 (rating_sum, payload có `rating`, ReviewDeleted, event_id, `counted`); ...100355739, ...100355762, ...100355784, ...100355807, ...100355830, ...100355853, ...100355524 (kiểm dòng OutboxEvent thay cho bus giả lập); ...100356041 (SB-14 bậc C, `X-Forwarded-For` giả); ...100355971 (`type` URN); ...100355364, ...100355456, ...100355592, ...100355666 (AuditLog); PRD-E2E-...100417248 (nhãn tồn kho).
- Không có test nào bị xóa.

## Nhật ký đồng bộ nền đợt 3 (2026-10-06)
- R-20 (ReviewUnpublished): PRD nhận thêm event; `requirements/PRD-REQ-...095502739` (BR3, BR6, kịch bản mới, mục Dữ liệu và sự kiện), `design/PRD-API-...` (`consumes`, mục Nhận), `design/PRD-DB-...` (mục 7 xử lý như ReviewHidden), `design/PRD-SEC-...` (T11), `flows/PRD-FLOW-...` (sơ đồ 2, chú thích); `tests/` thêm PRD-TC-20261006-130100111, sửa PRD-TC-20261006-100356189.
- R-42, SB-14: `design/PRD-API-...` bậc D cho danh sách sản phẩm quản trị khớp nền; `design/PRD-SEC-...` rủi ro còn lại ghi kho đếm PostgreSQL cho bậc D.
- R-35, R-33, ADR-022: `design/PRD-DB-...` mục 11 ghi `OUTBOX_MAX_ATTEMPTS`, hạn lưu OutboxEvent 14 ngày, ProcessedEvent 30 ngày.
- Giao diện nội bộ: `design/PRD-API-...` thêm `listActiveProductIds` (hàng INV -> PRD của architecture.md) và chốt chữ ký.
- Liên kết: `requirements/PRD-REQ-...095502676`, `...697` `links` tới INV-REQ-20261006-120036236.
- Rà, không đổi: R-03, R-04, R-05, R-07, R-08, R-10, R-11, R-17, R-19, R-32, R-39 đến R-41, R-43, R-45 đến R-47 (PRD không có luồng đơn, Idempotency-Key, token hay email; không endpoint ghi nào của PRD thuộc ADR-017); cột SB của PRD-SEC không còn `-`.

## Quyết định thay người dùng 2026-10-06
- Câu 1 (độ sâu danh mục): tối đa 3 cấp, kiểm ở DB; lý do: mặc định của requirement, đủ cho cửa hàng v1, tăng sau là migration nhẹ.
- Câu 2 (danh mục rỗng): vẫn hiện với `product_count` = 0; lý do: đơn giản, tránh cây nhảy khi hàng hết.
- Câu 3 (`sku`): khóa từ khi sản phẩm `active`, `archived` không khôi phục ở v1; lý do: đơn hàng, kho tham chiếu sku, khôi phục cần sdlc-impact trên INV, CRT.
- Câu 4 (khoảng giá): số nguyên VND 1..1.000.000.000; lý do: chặn giá 0 và nhập nhầm thừa số 0, khớp R-03 (đơn lớn hơn 0 đồng).
- Câu 6 (phạm vi tìm kiếm): tên và sku, không tìm mô tả; lý do: nhẹ, đủ dùng, khớp ADR-019 (pg_trgm), thêm mô tả sau là đổi chỉ mục.
- Câu 10 (UI và CSS): Tailwind và `references/tokens.css`; lý do: mặc định evon, nền chưa có ADR.
- Câu 15 (link INV): thêm `links` tới INV-REQ-20261006-120036236; lý do: requirement đã tồn tại.
- Câu 16 (chữ ký giao diện nội bộ): chốt ở PRD-API gồm `getForCart`, `getSummaries`, `searchProductIds`, `countByStatus`, `listActiveProductIds`; lý do: nền chỉ ghi tên, các bên gọi cần chữ ký cụ thể, `listActiveProductIds` do hàng INV -> PRD đòi nhưng PRD-API chưa khai.
- Câu 17 (bậc quản trị đọc): bậc D, 30 mỗi phút mỗi người; lý do: nền đợt 3 (R-42) đã gán.
- Câu 18 (sắp xếp theo điểm): chưa có ở v1; lý do: không có yêu cầu nghiệp vụ, thêm sau bằng chỉ mục và giá trị `sort` kèm sdlc-impact.
- R-20 (ReviewUnpublished): PRD trừ điểm như ReviewHidden (`counted = false`), cộng lại khi nhận ReviewPublished; lý do: theo events.md đợt 3, tránh điểm lệch khi bản sửa bị từ chối.

## Đợt bán hàng hộ 2026-10-15 (giá vốn, import sản phẩm; spec/changes/ban-ho-sale-nguon-don-20261015.md)
Chạy tự động theo lời người dùng "chạy làm hết đi để done"; mọi mặc định dưới đây đã áp vào requirement, màn hình, test; đổi thì chạy `sdlc-impact`.
- G1 (giá vốn bắt buộc hay tùy chọn): tùy chọn, `null` là chưa có; lý do: entities.md ghi tùy chọn, sản phẩm nháp và hàng import có thể chưa có giá vốn (PRD-REQ-20261006-095502550 BR9).
- G2 (trần giá vốn): 0..1.000.000.000, cùng trần giá bán; lý do: chặn tràn bigint và nhập nhầm; giá vốn lớn hơn giá bán vẫn nhận (bán lỗ có chủ ý).
- G3 (staff, sale với giá vốn): khóa `cost_price` vắng mặt (không phải `null`) trong phản hồi của staff, sale; lý do: `null` làm lộ sản phẩm nào đã có giá vốn (SB-42).
- G4 (sale xem sản phẩm quản trị): có, chỉ đọc, không giá vốn, `roles` của PRD-REQ-20261006-095502655 thêm `sale`; lý do: roles.md; bậc giới hạn tần suất D như staff.
- G5 (import, hai bước): một endpoint, `dry_run=true` không ghi và không audit, `dry_run=false` kiểm lại rồi ghi; không giữ trạng thái giữa hai lần (giao diện gửi lại đúng tệp); lý do: ADR-025, đơn giản hơn phiên xem trước.
- G6 (công thức): từ chối dòng (`formula_rejected`) thay vì coi là chữ thuần; hệ quả: tên bắt đầu bằng `-` hay `+` bị từ chối; lý do: ADR-025 cho phép hai cách, từ chối rõ ràng hơn.
- G7 (ô trống ở sản phẩm có sẵn): giữ nguyên; import không xóa được giá vốn (xóa bằng sửa sản phẩm); lý do: tệp KiotViet có ô trống thường xuyên, tránh mất dữ liệu hàng loạt.
- G8 (ĐVT, Tồn kho): đọc, báo trong `ignored_columns`, không ghi; lý do: PRD không có đơn vị tính, tồn kho đi qua INV (ADR-025).
- G9 (giới hạn tần suất import, bậc E): 20 yêu cầu mỗi giờ mỗi admin, cả hai chế độ chung bộ đếm; lý do: ADR-025 chỉ nói "bậc E" không có số; ghi số vào PRD-API khi sửa tài liệu.
- G10 (trần giải nén xlsx): 50 MB hằng số (10 lần trần tệp), không thêm biến môi trường; lý do: ADR-025 chỉ nói "giới hạn kích thước giải nén"; biến `PRD_IMPORT_MAX_ROWS`, `PRD_IMPORT_MAX_BYTES` cần có trong bảng biến của architecture.md (ADR-007), nhờ sdlc-impact nếu chưa có.
- G11 (audit import): một AuditLog mỗi lần xác nhận, kèm cặp giá bán, giá vốn cũ và mới theo sku cho dòng đổi giá; lý do: đổi giá hàng loạt sai phải truy vết được (ADR-025 hệ quả).
- G12 (tệp mẫu): chỉ `.xlsx`, không dòng dữ liệu mẫu, có trang "Hướng dẫn"; lý do: tránh import nhầm mã mẫu.
- G13 (đọc giá vốn lúc bán): ORD chụp `cost_snapshot` qua một giao diện nội bộ của PRD chỉ trả cho ORD (tên và chữ ký chốt ở PRD-API khi sửa thiết kế); không qua HTTP, không qua `getForCart`.
