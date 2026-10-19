---
screen: analytics-sources
epic: DSH
status: approved
covers: [DSH-REQ-20261015-092608812, DSH-REQ-20261006-105126549]
roles: [admin]
---
# Báo cáo theo nguồn đơn

Trang để đọc **số đơn và doanh thu theo từng nguồn đơn** (website, hotline, Facebook, TikTok...) trong một khoảng ngày, và xuất CSV, làm cơ sở tính lương marketing. Khuôn giống `analytics-revenue` (khoảng ngày, hàng số, nội dung chính, dòng ghi chú). Doanh thu ở đây là **giá trị đơn theo ORD**, không phải tiền PAY; đơn `cancelled`, `expired`, `returned` không được tính. Chỉ admin; sale, staff và customer thấy màn `access-denied` của AUTH.

Đường dẫn web: `/admin/reports/sources` (cùng nhóm `/admin/reports/*`). Khi URL chỉ có `to` hoặc chỉ có `from`, ô còn lại hiện đúng giá trị máy chủ đã dùng (thiếu `to` là hôm nay, thiếu `from` là `to` trừ 29 ngày), bằng hàm dùng chung `appliedRange` của các trang báo cáo. Vào từ menu quản trị, mục Báo cáo, cạnh ba báo cáo hiện có.

## Wireframe
Phương án đã chọn: **A** (khoảng ngày, hàng số, bảng theo nguồn có thanh tỷ trọng, nút Xuất CSV). **Đây là lựa chọn mặc định** (người dùng ủy quyền "chạy làm hết đi để done", 2026-10-15; khớp mẫu "Trang báo cáo" của evon và màn `analytics-revenue`), chưa có người dùng chọn. Không dựng HTML hay chạy probe ở phase này.

| Phương án | Việc chính thấy ở đâu | Đổi gì | Đánh đổi |
|---|---|---|---|
| **A. Hàng số, bảng theo nguồn kèm thanh tỷ trọng (khuyên dùng, đã chọn)** | Con số chính xác ở bảng, tỷ trọng ở thanh ngay trên mỗi dòng | Đối chiếu số để tính lương và thấy nguồn nào lớn | Bảng dài nếu thêm nhiều nguồn; màn hẹp xếp một cột |
| B. Chỉ bảng | Số từng nguồn | Đơn giản, in được | Không thấy tỷ trọng |
| C. Biểu đồ tròn theo nguồn | Tỷ lệ doanh thu | Nhìn nhanh | Nhiều nguồn vượt giới hạn bốn phần của evon; việc chính là đọc số chính xác để tính lương |

Lý do chọn A: việc chính là có con số đúng cho từng nguồn trong khoảng để tính lương; thanh tỷ trọng chỉ phụ, mỗi nguồn vẫn có số và phần trăm bằng chữ. Không biểu đồ theo mốc vì báo cáo không chia mốc (DSH-REQ-20261015-092608812 BR3).

```
Thanh header:  ☰  Báo cáo theo nguồn đơn                                         🔔  (A)
┌──────────────────────────────────────────────────────────────────────────────────┐
│ Từ [01/10/2026]  Đến [05/10/2026]  [Áp dụng] [30 ngày qua]  [Xuất CSV]  10:00    │
├────────────────┬────────────────┬────────────────────────────────────────────────┤
│ Đơn được tính  │ Doanh thu      │ Đơn bị loại                                    │
│ 6              │ 1.650.000 đ    │ 0                                              │
├────────────────┴────────────────┴────────────────────────────────────────────────┤
│ Nguồn        Số đơn   Doanh thu    Tỷ trọng                                      │
│ Website        3       600.000 đ   36,4%  ▓▓▓▓▓▓▓                                │
│ Facebook       2       550.000 đ   33,3%  ▓▓▓▓▓▓                                 │
│ Hotline        1       500.000 đ   30,3%  ▓▓▓▓▓                                  │
│ TikTok         0             0 đ    0,0%                                         │
│ Zalo (đã tắt)  2       120.000 đ   ...                                           │
├──────────────────────────────────────────────────────────────────────────────────┤
│ Doanh thu là giá trị đơn (gồm phí giao, đã trừ giảm giá), không phải tiền đã thu.│
│ Không tính đơn đã hủy, hết hạn, hoàn về (số đơn bị loại: 0).                    │
└──────────────────────────────────────────────────────────────────────────────────┘
```

## Trạng thái
| Trạng thái | Trông ra sao | Requirement | testid |
|---|---|---|---|
| đang tải | Khung xám đúng hình hàng số và bảng; ô khoảng ngày vẫn dùng được; nút Xuất CSV khóa | DSH-REQ-20261015-092608812 | dsh-analytics-sources-loading |
| có dữ liệu | Hàng số, bảng theo nguồn đủ mọi nguồn đang bật (kể cả 0 đơn) và nguồn tắt có đơn (kèm nhãn "đã tắt"), thanh tỷ trọng, hai dòng ghi chú, dòng "Cập nhật lúc" | DSH-REQ-20261015-092608812 | dsh-analytics-sources-table |
| không có đơn | Hàng số 0, bảng vẫn liệt kê các nguồn đang bật với 0, dòng "Không có đơn được tính từ 01/10/2026 tới 05/10/2026" kèm liên kết về 30 ngày qua (200, không phải lỗi); tỷ trọng hiện `—` khi tổng 0 | DSH-REQ-20261015-092608812 | dsh-analytics-sources-empty |
| có đơn bị loại | Hàng số "Đơn bị loại" > 0 và dòng chú thích nêu số đơn, không cộng vào Doanh thu | DSH-REQ-20261015-092608812 | dsh-analytics-sources-excluded-note |
| xuất CSV | Bấm Xuất CSV: nút khóa kèm "Đang tạo tệp", rồi trình duyệt tải `bao-cao-nguon-don_<từ>_<đến>.csv`; khoảng đang xem phải là khoảng đã Áp dụng | DSH-REQ-20261015-092608812 | dsh-analytics-sources-export-loading |
| xuất CSV lỗi | 403, 429, 503 khi tải tệp: dòng lỗi dưới nút kèm Thử lại bằng bấm lại nút; không tải tệp rỗng | DSH-REQ-20261015-092608812 | dsh-analytics-sources-export-error |
| khoảng ngày sai | 400: dòng lỗi dưới ô khoảng ngày; giữ báo cáo của khoảng trước | DSH-REQ-20261015-092608812 | dsh-analytics-sources-range-error |
| lỗi | ORD lỗi (503): banner "Không tải được báo cáo theo nguồn đơn." kèm Thử lại; không vẽ bảng toàn 0 | DSH-REQ-20261006-105126549 | dsh-analytics-sources-error |
| quá nhiều yêu cầu | 429: dải "Thao tác quá nhanh, thử lại sau N giây" | DSH-REQ-20261006-105126549 | dsh-analytics-sources-rate-limit |
| hết phiên | 401: hộp thoại "Phiên đã hết hạn" của AUTH kèm Đăng nhập | DSH-REQ-20261006-105126549 | - |
| không có quyền | sale, staff hoặc customer (403): màn `access-denied` của AUTH, không có số nào | DSH-REQ-20261006-105126549 | - |

## Phần tử
| testid | Phần tử | Role | Hành động | Requirement |
|---|---|---|---|---|
| dsh-analytics-sources-range-from | Ô ngày Từ | admin | Chọn ngày bắt đầu | DSH-REQ-20261015-092608812 |
| dsh-analytics-sources-range-to | Ô ngày Đến (không cho chọn sau hôm nay) | admin | Chọn ngày kết thúc | DSH-REQ-20261015-092608812 |
| dsh-analytics-sources-range-apply | Nút Áp dụng | admin | Tải báo cáo theo khoảng | DSH-REQ-20261015-092608812 |
| dsh-analytics-sources-range-reset | Nút 30 ngày qua | admin | Đặt lại khoảng mặc định | DSH-REQ-20261015-092608812 |
| dsh-analytics-sources-range-error | Dòng lỗi khoảng ngày (400) | admin | - | DSH-REQ-20261015-092608812 |
| dsh-analytics-sources-as-of | Dòng "Cập nhật lúc HH:mm" | admin | - | DSH-REQ-20261006-105126549 |
| dsh-analytics-sources-total-orders | Số Đơn được tính | admin | - | DSH-REQ-20261015-092608812 |
| dsh-analytics-sources-total-revenue | Số Doanh thu (giá trị đơn) | admin | - | DSH-REQ-20261015-092608812 |
| dsh-analytics-sources-total-excluded | Số Đơn bị loại | admin | - | DSH-REQ-20261015-092608812 |
| dsh-analytics-sources-table | Bảng theo nguồn đơn | admin | - | DSH-REQ-20261015-092608812 |
| dsh-analytics-sources-row | Một dòng nguồn (Nguồn, Số đơn, Doanh thu, tỷ trọng) | admin | - | DSH-REQ-20261015-092608812 |
| dsh-analytics-sources-row-inactive | Nhãn "đã tắt" trên dòng của nguồn đã tắt nhưng có đơn | admin | - | DSH-REQ-20261015-092608812 |
| dsh-analytics-sources-share | Thanh tỷ trọng doanh thu của nguồn (kèm số và phần trăm bằng chữ) | admin | - | DSH-REQ-20261015-092608812 |
| dsh-analytics-sources-revenue-note | Dòng ghi chú "Doanh thu là giá trị đơn (gồm phí vận chuyển, đã trừ giảm giá), không phải tiền đã thu" | admin | - | DSH-REQ-20261015-092608812 |
| dsh-analytics-sources-excluded-note | Dòng chú thích "Không tính đơn đã hủy, hết hạn, hoàn về (cơ sở tính lương)" kèm số đơn bị loại | admin | - | DSH-REQ-20261015-092608812 |
| dsh-analytics-sources-export-csv | Nút Xuất CSV (tải tệp theo khoảng đang xem) | admin | Tải tệp CSV | DSH-REQ-20261015-092608812 |
| dsh-analytics-sources-export-loading | Trạng thái đang tạo tệp trên nút Xuất CSV (nút khóa) | admin | - | DSH-REQ-20261015-092608812 |
| dsh-analytics-sources-export-error | Dòng lỗi xuất CSV (403, 429, 503 hoặc 400 khi tải tệp; không tải được tệp) | admin | - | DSH-REQ-20261015-092608812 |
| dsh-analytics-sources-empty | Vùng "Không có đơn được tính từ ... tới ..." | admin | - | DSH-REQ-20261015-092608812 |
| dsh-analytics-sources-loading | Khung chờ | admin | - | DSH-REQ-20261006-105126549 |
| dsh-analytics-sources-error | Banner lỗi (503) | admin | - | DSH-REQ-20261006-105126549 |
| dsh-analytics-sources-retry | Nút Thử lại | admin | Tải lại báo cáo | DSH-REQ-20261006-105126549 |
| dsh-analytics-sources-rate-limit | Dải "Thao tác quá nhanh" (429) | admin | - | DSH-REQ-20261006-105126549 |

## Ghi chú thiết kế (mặc định, chưa duyệt)
- Tiền `1.234.567 đ`, `tabular-nums`; tỷ trọng một chữ số thập phân, làm tròn ở giao diện từ `revenue` và `totals.revenue` (không có trường tỷ trọng ở API); tổng 0 thì `—`.
- Tên nguồn và thứ tự dòng lấy nguyên từ API (doanh thu giảm dần); không sắp lại ở giao diện để bảng khớp tệp CSV. Tên nguồn do admin đặt: hiển thị là văn bản thuần (thoát), không HTML.
- Hai dòng ghi chú luôn hiện (không ẩn trong tooltip): admin phải thấy cách tính ở ngay cạnh con số lương. Chữ chú thích nói rõ ba trạng thái bị loại (hủy, hết hạn, hoàn về) và rằng doanh thu là giá trị đơn, không phải tiền PAY.
- Nút Xuất CSV dùng đúng khoảng của `Áp dụng` gần nhất (không phải giá trị đang gõ dở trong ô), tải bằng liên kết tải về/`fetch` có cookie phiên; không tạo tệp ở trình duyệt (tệp do server dựng, chống công thức ở server).
- Không biểu đồ theo mốc và không so sánh kỳ (ngoài requirement).
- Hết phiên dùng hộp thoại của AUTH; 403 dùng `access-denied` của AUTH.
