---
epic: INV
status: draft
kit_version: 3
clean_run: pass
test_command: NEXT_TELEMETRY_DISABLED=1 STORAGE_TEST_ENDPOINT=http://localhost:9210 pnpm test
test_result: Tests:       425 passed, 425 total
---
# Báo cáo triển khai: INV

## Kế hoạch task
Thứ tự theo phụ thuộc: DB, rồi nền dùng chung, rồi API và giao diện nội bộ, rồi consumer và job, rồi giao diện web, rồi E2E. Mọi task `done`; không có task `blocked`. Module `inventory` (`apps/api/src/modules/inventory/`), web ở `apps/web/` (route `/admin/inventory`, `/admin/inventory/[id]`, `/admin/inventory/[id]/history`).

| # | Task | Nguồn | Phụ thuộc | Trạng thái |
|---|---|---|---|---|
| 1 | Migration `20261007000900_inventory_tables` (3 bảng, 3 enum, CHECK `reserved <= on_hand`, unique một phần của lịch sử, trigger chỉ-thêm và thu quyền UPDATE, DELETE, TRUNCATE của vai trò ứng dụng), schema Prisma `inventory.prisma` | INV-DB-20261006-101122740 | - | done |
| 2 | Nền dùng chung sửa kèm: `request_hash` của Idempotency-Key gồm tham số đường dẫn (platform); phía ngược của khóa ngoại `stock_items.product_id` trong `catalog.prisma` | INV-API-20261006-101122767, INV-SEC-20261006-101122793 | 1 | done |
| 3 | Đọc: danh sách, tồn thấp, chi tiết, lịch sử, xem còn hàng công khai; giao diện nội bộ `getAvailability` (CRT) và `getLowStockSummary` (DSH) | INV-API-20261006-101122767, INV-DB-20261006-101122740 | 1 | done |
| 4 | Thao tác kho: nhập, xuất, điều chỉnh (Idempotency-Key, một câu UPDATE có điều kiện, lịch sử, audit), đổi ngưỡng kèm `version`, đánh giá tồn thấp và LowStockDetected | INV-API-20261006-101122767, INV-DB-20261006-101122740, INV-SEC-20261006-101122793 | 1, 2 | done |
| 5 | Giữ hàng `InventoryApi.reserve` trong giao dịch của CHK (khóa theo `id` tăng dần, SAVEPOINT, StockReserved qua outbox) và chống bán vượt | INV-DB-20261006-101122740, INV-API-20261006-101122767, INV-SEC-20261006-101122793 | 1 | done |
| 6 | Consumer `inventory` của sáu event: chốt (PaymentSucceeded, OrderConfirmed), nhả (OrderCancelled), hoàn về (ShipmentReturned), tạo và khóa bản ghi (ProductActivated, ProductArchived), thu tiền trễ | INV-DB-20261006-101122740, INV-API-20261006-101122767 | 1, 5 | done |
| 7 | Job `inventory.expire-reservations` (lô 500, hạn thời gian, đóng khi không chắc) và `inventory.reconcile` (đối soát chỉ báo, tạo bù có trần) | INV-DB-20261006-101122740, INV-SEC-20261006-101122793 | 5, 6 | done |
| 8 | Kiểm lệch ma trận quyền phủ route của INV trên AppModule thật | INV-SEC-20261006-101122793 | 3, 4 | done |
| 9 | Màn danh sách tồn kho (hai tab, tìm, lọc, sắp xếp, trạng thái 429 có thoát) | ui/inventory-list | 3 | done |
| 10 | Màn chi tiết tồn kho (nhập, xuất, điều chỉnh, đổi ngưỡng trong hộp thoại, Idempotency-Key mỗi lần mở) | ui/inventory-detail | 4 | done |
| 11 | Màn lịch sử biến động kho (lọc loại và khoảng ngày) | ui/inventory-history | 3 | done |
| 12 | E2E trình duyệt thật, bảng đột biến INV và cổng kiểm của nó | INV-E2E-20261006-101122818, INV-E2E-20261006-101122845, INV-E2E-20261006-101122872, INV-E2E-20261006-101122895, INV-E2E-20261006-101122919 | 8, 9, 10, 11 | done |

## Kết quả test
Mọi TC và E2E của epic một dòng (52 TC của API, 3 TC của giao diện, 5 E2E). TC API chạy trên PostgreSQL thật (`ecom_test`) với nhiều kết nối thật chạy song song (pool 16); ORD, PAY, SHP, CHK chưa có code nên event của họ (PaymentSucceeded, OrderConfirmed, OrderCancelled, ShipmentReturned) và lời gọi `reserve` của CHK được dựng trong test theo đúng phong bì event và chữ ký của spec (TC `...101123353` ghi rõ "test dựng event giả với event_id riêng"); consumer của ORD và PAY là consumer giả ghi lại theo `event_id`. E2E chạy Chromium thật trên API thật (`ecom_e2e`) và bản build production của web. Ghi chú `YẾU:` nêu ở mục Lệch spec.

| ID | Loại | Test code | Kết quả | Ghi chú |
|---|---|---|---|---|
| INV-E2E-20261006-101122818 | E2E | apps/api/test/e2e/inv.e2e.spec.ts | pass | E2E: Staff nhập kho rồi thấy số tăng và dòng lịch sử |
| INV-E2E-20261006-101122845 | E2E | apps/api/test/e2e/inv.e2e.spec.ts | pass | E2E: Admin xuất kho vượt số còn bán được thì bị từ chối |
| INV-E2E-20261006-101122872 | E2E | apps/api/test/e2e/inv.e2e.spec.ts | pass | E2E: Hai nhân viên điều chỉnh cùng lúc, người sau gặp xung đột phiên bản |
| INV-E2E-20261006-101122895 | E2E | apps/api/test/e2e/inv.e2e.spec.ts | pass | E2E: Admin nâng ngưỡng thì sản phẩm vào tab Tồn thấp |
| INV-E2E-20261006-101122919 | E2E | apps/api/test/e2e/inv.e2e.spec.ts | pass | E2E: Staff lọc lịch sử kho theo loại biến động |
| INV-TC-20261006-101122944 | TC | apps/api/test/inventory/read.spec.ts | pass | - |
| INV-TC-20261006-101122968 | TC | apps/api/test/inventory/read.spec.ts | pass | - |
| INV-TC-20261006-101122994 | TC | apps/api/test/inventory/read.spec.ts | pass | - |
| INV-TC-20261006-101123021 | TC | apps/api/test/inventory/stock-write.spec.ts | pass | - |
| INV-TC-20261006-101123047 | TC | apps/api/test/inventory/stock-write.spec.ts | pass | - |
| INV-TC-20261006-101123076 | TC | apps/api/test/inventory/stock-write.spec.ts | pass | - |
| INV-TC-20261006-101123100 | TC | apps/api/test/inventory/stock-write.spec.ts | pass | Gồm test nền `test/platform/http.spec.ts` cho request_hash theo tham số đường dẫn (Lệch spec mục 1) |
| INV-TC-20261006-101123124 | TC | apps/api/test/inventory/stock-write.spec.ts | pass | - |
| INV-TC-20261006-101123148 | TC | apps/api/test/inventory/stock-write.spec.ts | pass | - |
| INV-TC-20261006-101123171 | TC | apps/api/test/inventory/stock-write.spec.ts | pass | - |
| INV-TC-20261006-101123195 | TC | apps/api/test/inventory/stock-write.spec.ts | pass | - |
| INV-TC-20261006-101123218 | TC | apps/api/test/inventory/stock-write.spec.ts | pass | - |
| INV-TC-20261006-101123241 | TC | apps/api/test/inventory/stock-write.spec.ts | pass | - |
| INV-TC-20261006-101123263 | TC | apps/api/test/inventory/reserve.spec.ts | pass | - |
| INV-TC-20261006-101123286 | TC | apps/api/test/inventory/reserve.spec.ts | pass | - |
| INV-TC-20261006-101123308 | TC | apps/api/test/inventory/reserve.spec.ts | pass | - |
| INV-TC-20261006-101123330 | TC | apps/api/test/inventory/reserve.spec.ts | pass | - |
| INV-TC-20261006-101123353 | TC | apps/api/test/inventory/lifecycle.spec.ts | pass | - |
| INV-TC-20261006-101123375 | TC | apps/api/test/inventory/lifecycle.spec.ts | pass | - |
| INV-TC-20261006-101123398 | TC | apps/api/test/inventory/lifecycle.spec.ts | pass | - |
| INV-TC-20261006-101123421 | TC | apps/api/test/inventory/lifecycle.spec.ts | pass | - |
| INV-TC-20261006-101123443 | TC | apps/api/test/inventory/lifecycle.spec.ts | pass | Một đơn hai dòng, cặp bản ghi kho có id ngược thứ tự product_id; đếm bế tắc bằng `pg_stat_database.deadlocks`; kết cục hợp lệ gồm cả StockCommitted rồi StockReleased (Lệch spec mục 9) |
| INV-TC-20261006-101123465 | TC | apps/api/test/inventory/jobs.spec.ts | pass | - |
| INV-TC-20261006-101123489 | TC | apps/api/test/inventory/jobs.spec.ts | pass | YẾU: lỗi CSDL giữa lô ép bằng trigger test ném lỗi ở dòng kho thứ 250, không hủy kết nối |
| INV-TC-20261006-101123513 | TC | apps/api/test/inventory/jobs.spec.ts | pass | - |
| INV-TC-20261006-101123535 | TC | apps/api/test/inventory/jobs.spec.ts | pass | YẾU: ranh giới 1 mili giây kiểm bằng tham số `now` của job, không đổi đồng hồ CSDL; hai instance là hai ứng dụng trong cùng một tiến trình test |
| INV-TC-20261006-101123557 | TC | apps/api/test/inventory/lowstock.spec.ts | pass | - |
| INV-TC-20261006-101123580 | TC | apps/api/test/inventory/lowstock.spec.ts | pass | - |
| INV-TC-20261006-101123603 | TC | apps/api/test/inventory/lowstock.spec.ts | pass | - |
| INV-TC-20261006-101123631 | TC | apps/api/test/inventory/read.spec.ts | pass | - |
| INV-TC-20261006-101123657 | TC | apps/api/test/inventory/read.spec.ts | pass | - |
| INV-TC-20261006-101123679 | TC | apps/api/test/inventory/read.spec.ts | pass | - |
| INV-TC-20261006-101123702 | TC | apps/api/test/inventory/read.spec.ts | pass | - |
| INV-TC-20261006-101123724 | TC | apps/api/test/inventory/reserve.spec.ts | pass | - |
| INV-TC-20261006-101123746 | TC | apps/api/test/inventory/reserve.spec.ts | pass | - |
| INV-TC-20261006-101123769 | TC | apps/api/test/inventory/reserve.spec.ts | pass | YẾU: "không truy vấn CSDL" đếm bằng spy trên PrismaService, không phải nhật ký truy vấn của CSDL |
| INV-TC-20261006-101123791 | TC | apps/api/test/inventory/jobs.spec.ts | pass | - |
| INV-TC-20261006-101123813 | TC | apps/api/test/inventory/lifecycle.spec.ts | pass | - |
| INV-TC-20261006-101123835 | TC | apps/api/test/inventory/lifecycle.spec.ts | pass | - |
| INV-TC-20261006-101123858 | TC | apps/api/test/inventory/lifecycle.spec.ts | pass | - |
| INV-TC-20261006-101123881 | TC | apps/api/test/inventory/jobs.spec.ts | pass | - |
| INV-TC-20261006-121043533 | TC | apps/api/test/inventory/read.spec.ts | pass | - |
| INV-TC-20261006-121043713 | TC | apps/api/test/inventory/public.spec.ts | pass | - |
| INV-TC-20261006-121043811 | TC | apps/api/test/inventory/public.spec.ts | pass | YẾU: "không chạm CSDL" đếm bằng spy trên PrismaService (`$queryRaw`, `$executeRaw`), không phải nhật ký truy vấn của CSDL |
| INV-TC-20261006-121043905 | TC | apps/api/test/inventory/public.spec.ts | pass | - |
| INV-TC-20261006-121043995 | TC | apps/api/test/inventory/lifecycle.spec.ts | pass | - |
| INV-TC-20261006-121044093 | TC | apps/api/test/inventory/jobs.spec.ts | pass | SIGKILL thật bằng tiến trình con (`test/fixtures/expire-then-die.ts`) |
| INV-TC-20261006-121044188 | TC | apps/api/test/inventory/lowstock.spec.ts | pass | - |
| INV-TC-20261006-153000100 | TC | apps/api/test/inventory/lowstock.spec.ts | pass | - |
| INV-TC-20261007-124048486 | TC | apps/api/test/inventory/read.spec.ts | pass | TC mới của lượt sdlc-impact: tìm `q` khi PRD lỗi là 503 `service-unavailable` (spy trên `CatalogApi`) |
| INV-TC-20261007-124049537 | TC | apps/api/test/inventory/review.spec.ts | pass | TC mới: thứ tự lịch sử theo `clock_timestamp()` (REV-INV-02); PostgreSQL thật, hai giao dịch thật |
| INV-TC-20261007-124050601 | TC | apps/api/test/inventory/review.spec.ts | pass | TC mới: `request_hash` gồm tham số đường dẫn, cùng key khác sản phẩm là 422, 12 yêu cầu song song (REV-INV-05) |
| INV-TC-20261007-085337018 | TC | apps/api/test/e2e/inv.e2e.spec.ts | pass | E2E Chromium thật; đồng hồ API tua bằng cổng điều khiển, nút Thử lại bấm khi còn giờ chờ |
| INV-TC-20261007-085337051 | TC | apps/api/test/e2e/inv.e2e.spec.ts | pass | E2E Chromium thật; chung một bộ đếm bậc D với danh sách, tồn thấp, lịch sử |
| INV-TC-20261007-085337083 | TC | apps/api/test/e2e/inv.e2e.spec.ts | pass | E2E Chromium thật; banner mất khi áp khoảng ngày hợp lệ |
| INV-TC-20261015-094057637 | TC | apps/api/test/inventory/read.spec.ts | pass | Đợt bán hộ: sale 403 ở danh sách và chi tiết, không on_hand, reserved, available trong thân; staff vẫn 200. Không đổi mã INV (`@Roles('staff', 'admin')` đã loại sale), chỉ thêm ca; PostgreSQL thật |

## Kiểm đột biến
Epic có TC `lỗi` kiểm mối đe dọa SEC nên gài đột biến có chủ ý: 58 đột biến, mỗi SB `Kiểm bằng: test` của INV-SEC (SB-05, 06, 07, 11, 14, 19, 24, 25, 26, 27, 30, 31, 32, 33, 34, 37, 40) có ít nhất một đột biến, kể cả nền sửa kèm (`request_hash` của platform) và migration (trigger chỉ-thêm, thu quyền). Chạy lại bằng script chung: `node .claude/skills/sdlc-review/scripts/mutate.mjs apps/api/scripts/mutations-inv.json --cwd apps/api` (từ gốc repo, cần `docker compose up -d db minio minio-bucket minio-policy`; mỗi đột biến chạy đúng một TC bằng `-t`). `apps/api/scripts/check-mutations.mjs` kiểm riêng bảng (SB phủ, đoạn cần phá còn đúng một lần, ID có trong test) và `apps/api/test/tooling/mutations-inv.spec.ts` chạy cổng đó. Không có đột biến lọt và không có ca tương đương.

| Chỗ phá | Test đỏ | Kết quả |
|---|---|---|
| SB-05, T1: customer được nhập kho (sai ma trận) | INV-TC-20261006-101123047 | bắt |
| SB-05, T1: danh sách tồn kho mở cho khách chưa đăng nhập | INV-TC-20261006-101122968 | bắt |
| SB-06, T10: id sai định dạng trả 400 thay vì cùng một 404 với id không có bản ghi | INV-TC-20261006-101122968 | bắt |
| SB-37, T10: endpoint công khai trả thêm số còn bán | INV-TC-20261006-121043713 | bắt |
| SB-37, T16: sản phẩm ngừng bán còn tồn vẫn báo còn hàng | INV-TC-20261006-121043905 | bắt |
| SB-37, T16: endpoint công khai bị đệm (bỏ Cache-Control no-store) | INV-TC-20261006-121043713 | bắt |
| SB-11, T3: trần số lượng mỗi lần 100.000 thành 100.000.000 | INV-TC-20261006-101123047 | bắt |
| SB-11, T3: trần tồn 10.000.000 thành 100.000.000 | INV-TC-20261006-101123076 | bắt |
| SB-11, T3: số thực được nhận làm số lượng (bỏ kiểm số nguyên) | INV-TC-20261006-101123047 | bắt |
| SB-11, T12: schema nhận trường lạ (on_hand, actor_id) trong thân | INV-TC-20261006-101123580 | bắt |
| SB-11: lý do Khác không đòi ghi chú | INV-TC-20261006-101123047 | bắt |
| SB-11: điều chỉnh không đổi vẫn được ghi (bỏ no-change) | INV-TC-20261006-101123241 | bắt |
| SB-11: khoảng lọc lịch sử 366 ngày thành 3660 ngày | INV-TC-20261006-101123679 | bắt |
| SB-14, T15: bậc D 30 mỗi phút thành 3000 | INV-TC-20261006-121043533 | bắt |
| SB-14, T16: bậc C công khai 120 mỗi phút thành 12000 | INV-TC-20261006-121043905 | bắt |
| SB-19, T5: điều chỉnh không ghi audit giá trước, sau | INV-TC-20261006-101123195 | bắt |
| SB-19, T5: nhập kho không ghi audit | INV-TC-20261006-101123021 | bắt |
| SB-19, T5: xuất kho không ghi audit | INV-TC-20261006-101123124 | bắt |
| SB-19, T5: đổi ngưỡng ghi audit sai hành động | INV-TC-20261006-101123557 | bắt |
| SB-19, T9: thu tiền trễ không có audit của hệ thống | INV-TC-20261006-101123375 | bắt |
| SB-05, T12: actor_id lấy từ phiên bị thay bằng NULL | INV-TC-20261006-101123021 | bắt |
| SB-24, SB-25, T9: chốt không kiểm status = held (event trùng khác event_id trừ kho hai lần) | INV-TC-20261006-101123398 | bắt |
| SB-24, T14: nhả đơn đã chốt không kiểm status = committed (hoàn on_hand hai lần) | INV-TC-20261006-101123421 | bắt |
| SB-24, T14: ShipmentReturned không chống trùng theo shipment_id (bỏ ON CONFLICT) | INV-TC-20261006-101123421 | bắt |
| SB-24: hàng hoàn về không bán lại được vẫn cộng on_hand | INV-TC-20261006-121043995 | bắt |
| SB-24: ProductActivated nhận lại ghi đè bản ghi kho đã có | INV-TC-20261006-101123835 | bắt |
| SB-25, T2: giữ hàng không kiểm on_hand - reserved >= n trong câu UPDATE | INV-TC-20261006-101123724 | bắt |
| SB-25, T2: xuất kho lấy cả phần đang giữ (bỏ điều kiện available) | INV-TC-20261006-101123148 | bắt |
| SB-25: điều chỉnh xuống dưới số đang giữ (bỏ điều kiện new >= reserved) | INV-TC-20261006-101123218 | bắt |
| SB-25: sản phẩm ngừng bán giữ hàng được | INV-TC-20261006-101123286 | bắt |
| SB-25: nhập kho vào sản phẩm ngừng bán (bỏ kiểm archived) | INV-TC-20261006-101123047 | bắt |
| SB-25: giữ hàng nửa vời khi thiếu (bỏ SAVEPOINT quay lui) | INV-TC-20261006-101123286 | bắt |
| SB-25, SB-34, T8: job hết hạn bỏ ranh giới `<=` (đúng giờ chưa hết hạn) | INV-TC-20261006-101123535 | bắt |
| SB-25, T9: job hết hạn không kiểm status = held khi đổi trạng thái | INV-TC-20261006-101123535 | bắt |
| SB-25: ProductArchived không đặt archived_at | INV-TC-20261006-101123858 | bắt |
| SB-26, SB-33, T7: trần 50 dòng mỗi đơn thành 500 | INV-TC-20261006-101123330 | bắt |
| SB-27: giữ hàng không ghi StockReserved vào outbox | INV-TC-20261006-101123263 | bắt |
| SB-27, T13: job hết hạn không ghi StockReservationExpired | INV-TC-20261006-101123465 | bắt |
| SB-27, T9: thu tiền trễ không phát StockCommitFailed | INV-TC-20261006-101123375 | bắt |
| SB-27: chốt không phát StockCommitted | INV-TC-20261006-101123353 | bắt |
| SB-27: nhả không phát StockReleased | INV-TC-20261006-101123421 | bắt |
| SB-27: tồn thấp không ghi LowStockDetected | INV-TC-20261006-101123557 | bắt |
| SB-27, T14: LowStockDetected phát lại mỗi lần (bỏ điều kiện cờ chuyển false -> true) | INV-TC-20261006-101123603 | bắt |
| SB-30, T11: điều chỉnh bỏ kiểm version (sai version báo sai mã lỗi) | INV-TC-20261006-101123218 | bắt |
| SB-30, T11: đổi ngưỡng bỏ kiểm version trong câu UPDATE | INV-TC-20261006-153000100 | bắt |
| SB-30: đổi ngưỡng không tăng version | INV-TC-20261006-101123557 | bắt |
| SB-31, T17: đọc tên sản phẩm của PRD khi cầm khóa không có hạn (2 giây thành 10 phút) | INV-TC-20261006-101123557 | bắt |
| SB-31, T17: giữ hàng khóa dòng kho không theo id tăng dần | INV-TC-20261006-101123443 | bắt |
| SB-31, T17: chốt, nhả khóa dòng kho không theo id tăng dần | INV-TC-20261006-101123443 | bắt |
| SB-31, T17: job hết hạn khóa dòng kho không theo id tăng dần | INV-TC-20261006-101123443 | bắt |
| SB-32, T6: trigger chỉ-thêm chỉ chặn DELETE (UPDATE lịch sử được) | INV-TC-20261006-101123702 | bắt |
| SB-32, T6: vai trò ứng dụng vẫn có quyền UPDATE, DELETE lịch sử (bỏ REVOKE) | INV-TC-20261006-101123702 | bắt |
| SB-34, T8: lô hết hạn 500 đơn thành 5.000.000 (không giới hạn lô) | INV-TC-20261006-101123535 | bắt |
| SB-34, T8: job hết hạn bỏ hạn thời gian của lần chạy | INV-TC-20261006-101123489 | bắt |
| SB-34, T8: job tạo bù không đóng khi PRD lỗi (ném lỗi lên) | INV-TC-20261006-101123791 | bắt |
| SB-34, T8: job tạo bù xin trang 1000 id (quá giới hạn 500 của PRD) | INV-TC-20261006-101123791 | bắt |
| SB-40, T4: nhập kho không đòi Idempotency-Key | INV-TC-20261006-101123047 | bắt |
| SB-40, T4 (nền sửa kèm): request_hash không gồm tham số đường dẫn (cùng khóa cho sản phẩm khác bị coi là phát lại) | INV-TC-20261006-101123100 | bắt |

## Lệch spec
Số TC, E2E ở bảng trên là toàn bộ của epic (52 TC của API, 3 TC của giao diện, 5 E2E); mọi dòng pass. Các mục dưới có nhãn; mục `[cần quyết]` cần người hoặc `sdlc-impact`, `sdlc-foundation`; mục `[chưa làm]` là việc spec yêu cầu mà chưa làm được vì epic khác chưa có code.

1. [đã chọn] Sửa nền (platform): `request_hash` của Idempotency-Key gồm cả tham số đường dẫn (`apps/api/src/modules/platform/http/idempotency.ts`). Trước đó chỉ gồm method, mẫu route và thân nên cùng khóa, cùng thân, khác sản phẩm bị coi là phát lại (trả phản hồi của sản phẩm kia, sản phẩm này không đổi gì); INV là nơi đầu tiên dùng `@Idempotent` thật. Test: INV-TC-20261006-101123100 (`apps/api/test/platform/http.spec.ts` với route `idem-on/:target` của `apps/api/test/support/fixtures.ts`, và `apps/api/test/inventory/stock-write.spec.ts`), đột biến "SB-40, T4 (nền sửa kèm)". Rủi ro: khóa đã lưu trước khi nâng cấp có hash cũ nên gửi lại trong 24 giờ sẽ bị 422; hiện chưa có khóa nào của luồng thật.
2. [đã chọn] ADR-017 và INV-SEC T4 chỉ nói "so `request_hash`" mà chưa nói hash gồm tham số đường dẫn: đã ghi vào ADR-017 (hash của method, mẫu route, tham số đường dẫn, thân) và INV-SEC T4 qua `sdlc-impact` (`spec/changes/INV-API-20261006-101122767.md`), INV-API cũng nêu; CHK, PAY, REV dựng theo cùng cách. Test: INV-TC-20261007-124050601 (`apps/api/test/inventory/review.spec.ts`), INV-TC-20261006-101123100.
3. [đã chọn] Sửa nền (schema Prisma): thêm phía ngược `stockItem StockItem?` vào model `Product` của `apps/api/prisma/schema/catalog.prisma`, vì Prisma đòi hai phía của khóa ngoại thật `stock_items.product_id -> products.id` (INV-DB; INV phụ thuộc PRD). PRD không đọc bảng của INV (`check:boundaries` sạch), không đổi mã `src/modules/catalog`. Kiểm: `pnpm --filter @ecom/api db:check` (schema khớp migration), INV-TC-20261006-101123835 (khóa ngoại thật từ chối id không có trong `products`), INV-TC-20261006-101123813.
4. [đã chọn] Mã lỗi: `product-archived` (409) dùng lại mã PRD đã khai (INV-API khai cùng mã, cùng status) và không khai lần hai vì sổ mã báo trùng; `errors.ts` của INV nạp điểm vào `../catalog` trước để mã chắc chắn đã có. Năm mã còn lại (`no-change`, `stock-limit-exceeded`, `insufficient-stock`, `below-reserved`, `stock-version-conflict`) đúng INV-API. Hai mã đã dùng trong mã mà bảng mã của INV-API không liệt kê: `reservation-exists` (`ReservationExistsError.code`, lỗi của giao diện nội bộ `reserve`, không phải HTTP; có ở INV-REQ-20261006-101122538 BR6 và INV-TC-20261006-101123308) và `service-unavailable` (503, mã nền, khi tìm `q` mà PRD lỗi); cả hai nay đã ghi ở INV-API qua `sdlc-impact` (TC mới INV-TC-20261007-124048486 kiểm 503). Test: INV-TC-20261006-101122968 (`errorRegistry.audit()` sạch trên AppModule thật), INV-TC-20261006-101123308, INV-TC-20261006-101123047.
5. [đã chọn] Hành vi lỗi của `CatalogApi` (bảng Giao diện module và PRD-API) đã đối chiếu với INV-API và khớp, không có lệch: lô quá 100 id ném `RangeError` (INV chỉ gọi theo trang tối đa 100), `searchProductIds(q, 200)` với `q` tối đa 100 ký tự đã kiểm ở biên của INV nên không bao giờ ném, `listActiveProductIds(after_id, 500)` nhận uuid, id không có bị bỏ khỏi kết quả. INV bắt mọi lỗi của PRD: danh sách, chi tiết, lịch sử trả `product: null` và số vẫn đúng (log warn); `q` mà PRD lỗi trả 503 (INV-API không nói); tạo bù của job đối soát dừng và không tạo gì; tên của LowStockDetected để rỗng. Test: INV-TC-20261006-101122944 (tên, sku, tìm `q` qua PRD), INV-TC-20261006-101123791 (PRD lỗi), INV-TC-20261006-121044188, INV-TC-20261006-101123557.
6. [đã chọn] `InventoryApi.reserve` khi thiếu hàng trả `{ ok: false, shortages: [{ product_id, requested, available, reason }] }` và KHÔNG ghi gì (SAVEPOINT quay lui) thay vì ném lỗi (CHK-API mô tả "thất bại trả danh sách thiếu"; INV-DB mục 1 nói cả giao dịch quay lui): CHK hủy giao dịch đặt hàng khi `ok: false`, nhưng kể cả khi CHK bắt lỗi và vẫn cam kết thì không có reservation nửa vời (INV-TC-20261006-101123286). Đầu vào sai ném `RangeError` (INV-TC-20261006-101123330), cùng đơn khác số lượng ném `ReservationExistsError` (INV-TC-20261006-101123308).
7. [đã chọn] CHK-API gọi `InventoryService.reserve(order_id, items, expires_at, tx)` còn mã là `InventoryApi.reserve` (cùng cách đặt tên `CatalogApi` của PRD mà CRT-API ghi `CatalogService`), và CHK-API mô tả kết quả là "danh sách reservation hoặc danh sách thiếu" còn mã trả `{ ok, reservations | shortages }`: đã chốt theo mã qua `sdlc-impact`: bảng Giao diện module (hàng CHK -> INV), INV-API (Giao tiếp giữa module), CHK-API dòng 170, CHK-REQ BR1 và CRT-API (`CatalogApi.getForCart`, `InventoryApi.getAvailability`) dùng đúng tên lớp và kết quả. CHK chưa có code nên chữ ký vẫn phải được CHK xác nhận khi dựng (mục 21).
8. [đã chọn] LowStockDetected đọc tên sản phẩm của PRD ngay trong giao dịch có hạn 2 giây (INV-DB mục 7 chỉ nói "không đọc được thì để rỗng và log warn", không nêu hạn): không để giao dịch cầm khóa treo theo PRD (SB-31). Đọc qua kết nối khác của pool nên nhiều giao dịch cùng vượt ngưỡng một lúc có thể làm cạn pool và phát tên rỗng; event không mất. Test: INV-TC-20261006-101123557 (PRD lỗi, PRD treo), đột biến "SB-31, T17: đọc tên sản phẩm của PRD khi cầm khóa không có hạn".
9. [đã chọn] (lời TC đã sửa qua `sdlc-impact`: tập sáu kết cục hợp lệ, đúng một bên thắng reservation `held`) INV-TC-20261006-101123443 từng ghi "chỉ đúng một event kết cục cho U (StockCommitted, hoặc StockReservationExpired, hoặc StockReleased)" nhưng INV-DB mục Trạng thái hợp lệ và mục Giao dịch 3 cho phép `committed -> released` (đơn đã thanh toán bị hủy trước khi giao, K-03): khi PaymentSucceeded thắng rồi OrderCancelled đến sau thì có StockCommitted rồi StockReleased là đúng thiết kế, và 50 lần lặp quan sát được cả ba kiểu kết cục (StockCommitted rồi StockReleased, StockCommitFailed cùng StockReservationExpired, StockCommitFailed cùng StockReleased). Test khẳng định tập kết cục hợp lệ (một bên thắng reservation `held`, reserved giảm đúng một lần, on_hand đúng, không bế tắc đo bằng `pg_stat_database.deadlocks`) chứ không phải "đúng một event"; sửa lời TC qua `sdlc-impact`.
10. [đã chọn] Đối soát hằng đêm so `on_hand` với `on_hand_after` của dòng lịch sử mới nhất, bản ghi chưa có dòng lịch sử nào coi như phải bằng 0 (INV-DB mục 10 chỉ nói dòng mới nhất): bản ghi tạo bởi ProductActivated có on_hand 0 nên nhất quán, bản ghi chưa có lịch sử mà on_hand khác 0 bị log error. Mỗi truy vấn đối soát có trần 1000 dòng lệch mỗi lần chạy và tạo bù tối đa 200 trang 500 sản phẩm (100.000 sản phẩm) mỗi lần chạy (SB-34); phần còn lại để lần sau. Test: INV-TC-20261006-101123791, INV-TC-20261006-101123881.
11. [đã chọn] Job `inventory.reconcile` "hằng đêm" (ADR-013, INV-DB mục 10) chạy theo chu kỳ cố định 24 giờ kể từ lúc khởi động (`JobRunner` của platform chỉ có `every`, không có giờ trong ngày) nên không bảo đảm chạy lúc đêm: người dùng chọn chấp nhận (không thêm lịch theo giờ vào `JobRunner`); ADR-013, INV-DB mục 10, INV-API và INV-SEC ghi "chu kỳ 24 giờ kể từ lúc khởi động" kèm rủi ro (khởi động lại thì đồng hồ chạy lại, triển khai thường hơn mỗi ngày thì đối soát không chạy). Test: INV-TC-20261006-101123791, INV-TC-20261006-101123881 (REV-INV-10 kiểm chu kỳ 24 giờ).
12. [đã chọn] Job hết hạn nhận tham số `now` tùy chọn (chỉ test dùng; đường chạy thật dùng `now()` của CSDL, đã có trong câu SQL qua `COALESCE`) để thử ranh giới 1 mili giây mà không đổi đồng hồ CSDL; hạn thời gian mỗi lần chạy 45 giây (hạn của JobRunner 55 giây, chu kỳ 60 giây), lô 500 đơn mỗi giao dịch, hết hạn thì lượt sau làm tiếp. YẾU: INV-TC-20261006-101123535 kiểm ranh giới 1 mili giây bằng tham số `now` và hai instance là hai ứng dụng trong cùng một tiến trình test: nâng bằng CSDL có đồng hồ giả hoặc hai tiến trình riêng. YẾU: INV-TC-20261006-101123489 ép lỗi giữa lô bằng trigger test ném lỗi ở dòng kho thứ 250 chứ không hủy kết nối: nâng bằng `pg_terminate_backend` từ kết nối khác giữa lô.
13. [đã chọn] YẾU: INV-TC-20261006-121043811 và INV-TC-20261006-101123769 chứng minh "không chạm CSDL" bằng spy trên `PrismaService` (`$queryRaw`, `$executeRaw`), spy không thấy `$transaction` hay truy vấn qua kết nối khác: nâng bằng nhật ký truy vấn của CSDL test (`log_statement = all` rồi đếm dòng). Các TC chốt, thu tiền trễ, hủy, hoàn về (INV-TC-20261006-101123353, INV-TC-20261006-101123375, INV-TC-20261006-101123398, INV-TC-20261006-101123421, INV-TC-20261006-121043995) dựng event theo đúng phong bì vì ORD, PAY, SHP chưa có code (TC ...353 đã ghi "test dựng event giả").
14. [đã chọn] Thứ tự kiểm của thao tác kho thủ công trong mã: guard (401, 403, 429), schema (400), header Idempotency-Key (400), rồi khóa idempotency, rồi 404 và 409 trong cùng giao dịch của khóa; 404 và 409 quay lui cả dòng khóa nên khóa không bị đốt (INV-TC-20261006-101123047). INV-API đặt "tìm bản ghi 404" trước "trùng khóa": chỉ khác khi gửi lại một khóa cũ cho sản phẩm không có bản ghi, mà bản ghi kho không bao giờ bị xóa nên không quan sát được.
15. [đã chọn] Danh sách: `is_low_stock` = available <= ngưỡng kể cả sản phẩm ngừng bán (INV-REQ-20261006-101122435 BR2 nguyên văn); web chỉ hiện badge "Tồn thấp" cho sản phẩm chưa ngừng bán vì tab Tồn thấp luôn loại sản phẩm ngừng bán (INV-REQ-20261006-101122611) và ui không nói rõ. Test: INV-TC-20261006-101122994, INV-TC-20261006-101123603.
16. [đã chọn] Lịch sử: `type` nhận nhiều giá trị cách nhau dấu phẩy (trùng thì gộp); `from`, `to` nhận ngày `YYYY-MM-DD` (00:00 UTC) hoặc ISO-8601 có múi giờ; ngày không có thật (30/02) là 400, `from` không trước `to` là 400, đúng 366 ngày nhận, quá là 400. Test: INV-TC-20261006-101123657, INV-TC-20261006-101123679.
17. [đã chọn] Web: bộ lọc loại ở lịch sử là `<select multiple>` (ui ghi "chọn nhiều"), không chọn gì là mọi loại; ngày gửi lên là ngày UTC. Trạng thái 429 của danh sách, chi tiết, lịch sử có nút Thử lại bấm được ngay và tự tải lại khi hết giờ chờ (`Retry-After`), banner lỗi lịch sử mất khi áp khoảng ngày hợp lệ. Test: INV-TC-20261007-085337018, INV-TC-20261007-085337051, INV-TC-20261007-085337083, INV-E2E-20261006-101122919.
18. [đã chọn] Web, chi tiết: hộp thoại không đóng khi bấm ra ngoài (Esc và Hủy đóng được, tắt khi đang gửi); hộp thoại đổi ngưỡng kiểm khoảng 0 đến 1.000.000 ngay khi gõ và bấm Lưu khi sai thì không gửi yêu cầu (INV-E2E-20261006-101122895); sau xung đột phiên bản thì "Tải lại số liệu" xóa số đếm đã nhập (không giữ số cũ lặng lẽ, INV-E2E-20261006-101122872). Nút Hủy của hộp thoại đổi ngưỡng và liên kết "Tồn kho" ở thanh đầu trang (staff, admin) chưa có testid vì `spec/testids.md` không khai; `lib/api.ts` thêm tùy chọn `headers` và `Pager` thêm tham số `unit` (mã web dùng chung của PRD). Muốn E2E cho phần chưa có testid thì thêm vào ui rồi sinh lại testids (việc của người).
19. [đã chọn] Tên người thao tác: `SessionContext.display_name` (ADR-012 đợt 4) đã có ở AUTH nên `actor_name` được ghi ngay lúc ghi (INV-TC-20261006-101123021), mục "Nền còn thiếu" 2 của `questions.md` không còn đúng; dòng cũ chưa có tên hiện `actor.id` rút gọn (INV-TC-20261006-101123631).
20. [đã chọn] Bảng đột biến 58 dòng dùng `mutate.mjs`: SB-26 và SB-33 (chặn đặt hàng khi chưa xác minh email, giới hạn đơn đang mở: thuộc CHK, ORD) chỉ được phủ phần của INV (trần 50 dòng mỗi đơn, INV-SEC T7). Lần chạy đầu có một đột biến lọt (khóa chốt và nhả không sắp theo `id`) và một đột biến làm tiến trình test treo không dừng (đọc tên PRD không hạn); đã sửa test (test khóa xác định: giữ dòng id nhỏ, chờ đường ghi, xin dòng id lớn; đọc tên PRD gọi trực tiếp, hẹn giờ `unref`) và chạy lại, cuối cùng 58 bắt, 0 lọt.
21. [chưa làm] Các bên gọi INV chưa có code: CHK (`reserve`), CRT (`getAvailability`), DSH (`getLowStockSummary`) và các bên phát event ORD, PAY, SHP nên ba giao diện nội bộ mới được kiểm bằng lời gọi trực tiếp trong test và event dựng theo phong bì spec; chữ ký phải được các epic đó xác nhận khi dựng (mục 7).
22. [đã chọn] `clean_run: pass`: chạy trong `git worktree` (HEAD cộng tệp đã sửa và chưa theo dõi chép sang, vì chưa có commit cho USR, PRD, INV), `pnpm install --frozen-lockfile --offline`, rồi `scan:secrets`, `check:boundaries`, `lint`, `typecheck`, `test` (413 pass, 0 skip, 57 bộ), `build` bằng `env -i` chỉ với PATH (cộng thư mục của pnpm), HOME (Chromium của playwright), `TEST_DB_BASE`, `NEXT_TELEMETRY_DISABLED`, `STORAGE_TEST_ENDPOINT` và dịch vụ docker db, minio như workflow CI. Lần chạy sạch đầu bắt được một test chập chờn (INV-TC-20261006-101123489 chọn "dòng kho thứ 250" trong toàn bảng nên 1 trên 501 lần trúng dòng của đơn đã chốt và không có lỗi để ép): đã chọn trong các dòng của lô rồi chạy lại cả bốn lệnh. Chưa chạy trên GitHub Actions thật (chưa push).
