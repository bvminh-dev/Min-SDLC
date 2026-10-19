---
screen: analytics-sales
epic: DSH
status: approved
covers: [DSH-REQ-20261015-092608849, DSH-REQ-20261006-105126549]
roles: [admin]
---
# Báo cáo theo sale

Trang để đọc **số đơn và doanh thu của từng sale** (người tạo đơn) trong một khoảng ngày, kèm một dòng "Khách tự đặt (website)", và xuất CSV, làm cơ sở tính lương sale. Khuôn giống `analytics-sources` và `analytics-revenue`. Doanh thu là **giá trị đơn theo ORD**, không phải tiền PAY; đơn `cancelled`, `expired`, `returned` không được tính. Chỉ admin; sale không xem được báo cáo của chính mình (v1), staff và customer cũng không: thấy màn `access-denied` của AUTH.

Đường dẫn web: `/admin/reports/sales`. Khoảng ngày và `appliedRange` như `analytics-sources`.

## Wireframe
Phương án đã chọn: **A** (khoảng ngày, hàng số, bảng theo người tạo đơn, dòng website cố định ở cuối, nút Xuất CSV). **Đây là lựa chọn mặc định** (người dùng ủy quyền "chạy làm hết đi để done", 2026-10-15), chưa có người dùng chọn. Không dựng HTML hay chạy probe ở phase này.

| Phương án | Việc chính thấy ở đâu | Đổi gì | Đánh đổi |
|---|---|---|---|
| **A. Hàng số, bảng theo sale, dòng website cuối bảng (khuyên dùng, đã chọn)** | Con số của từng sale ở bảng, dòng website tách riêng ở cuối | Đối chiếu lương từng người; thấy phần khách tự đặt không thuộc sale nào | Bảng dài theo số sale (khoảng 10 người, chấp nhận) |
| B. Gộp dòng website vào bảng, sắp theo doanh thu | Một danh sách | Gọn | Dòng website lẫn vào xếp hạng sale, dễ nhầm là một người |
| C. Biểu đồ cột xếp hạng sale | Hình xếp hạng | Nhìn nhanh | Việc chính là số chính xác để tính lương; so sánh sale bằng hình dễ gây hiểu nhầm |

Lý do chọn A: dòng "Khách tự đặt (website)" không phải một người nên đứng riêng, không tham gia thứ tự doanh thu (DSH-REQ-20261015-092608849 BR4); bảng đơn giản nhất cho 10 sale.

```
Thanh header:  ☰  Báo cáo theo sale                                              🔔  (A)
┌──────────────────────────────────────────────────────────────────────────────────┐
│ Từ [01/10/2026]  Đến [05/10/2026]  [Áp dụng] [30 ngày qua]  [Xuất CSV]  10:00    │
├────────────────┬────────────────┬────────────────────────────────────────────────┤
│ Đơn được tính  │ Doanh thu      │ Đơn bị loại                                    │
│ 6              │ 980.000 đ      │ 0                                              │
├────────────────┴────────────────┴────────────────────────────────────────────────┤
│ Người tạo đơn                  Số đơn   Doanh thu                                │
│ Bình                             1       500.000 đ                               │
│ An                               2       300.000 đ                               │
│ Cường (đã đổi role vẫn hiện)     3       450.000 đ                               │
│ (tài khoản đã xóa)               2       120.000 đ                               │
│ ──────────────────────────────────────────────────────────────────────────────── │
│ Khách tự đặt (website)           3       180.000 đ                               │
├──────────────────────────────────────────────────────────────────────────────────┤
│ Doanh thu là giá trị đơn (gồm phí giao, đã trừ giảm giá), không phải tiền đã thu.│
│ Không tính đơn đã hủy, hết hạn, hoàn về (số đơn bị loại: 0).                    │
└──────────────────────────────────────────────────────────────────────────────────┘
```

## Trạng thái
| Trạng thái | Trông ra sao | Requirement | testid |
|---|---|---|---|
| đang tải | Khung xám đúng hình hàng số và bảng; ô khoảng ngày vẫn dùng được; nút Xuất CSV khóa | DSH-REQ-20261015-092608849 | dsh-analytics-sales-loading |
| có dữ liệu | Hàng số, bảng theo người tạo đơn (doanh thu giảm dần), dòng "Khách tự đặt (website)" cuối bảng, hai dòng ghi chú, dòng "Cập nhật lúc" | DSH-REQ-20261015-092608849 | dsh-analytics-sales-table |
| không có đơn | Hàng số 0, bảng không có dòng sale, dòng website hiện 0 đơn 0 đ, dòng "Không có đơn được tính từ 01/10/2026 tới 05/10/2026" kèm liên kết về 30 ngày qua (200, không phải lỗi) | DSH-REQ-20261015-092608849 | dsh-analytics-sales-empty |
| tài khoản đã xóa | Dòng có tên "(tài khoản đã xóa)" vẫn đủ số đơn và doanh thu, kèm mã người dùng rút gọn ở tooltip; không bị gộp vào website | DSH-REQ-20261015-092608849 | dsh-analytics-sales-row-deleted |
| có đơn bị loại | Hàng số "Đơn bị loại" > 0 và dòng chú thích nêu số đơn, không cộng vào Doanh thu | DSH-REQ-20261015-092608849 | dsh-analytics-sales-excluded-note |
| xuất CSV | Bấm Xuất CSV: nút khóa kèm "Đang tạo tệp", rồi tải `bao-cao-sale_<từ>_<đến>.csv` | DSH-REQ-20261015-092608849 | dsh-analytics-sales-export-loading |
| xuất CSV lỗi | 403, 429, 503 khi tải tệp: dòng lỗi dưới nút; không tải tệp rỗng | DSH-REQ-20261015-092608849 | dsh-analytics-sales-export-error |
| khoảng ngày sai | 400: dòng lỗi dưới ô khoảng ngày; giữ báo cáo của khoảng trước | DSH-REQ-20261015-092608849 | dsh-analytics-sales-range-error |
| lỗi | ORD lỗi (503, kể cả không tra được tên): banner "Không tải được báo cáo theo sale." kèm Thử lại; không hiện bảng thiếu tên hay toàn 0 | DSH-REQ-20261006-105126549 | dsh-analytics-sales-error |
| quá nhiều yêu cầu | 429: dải "Thao tác quá nhanh, thử lại sau N giây" | DSH-REQ-20261006-105126549 | dsh-analytics-sales-rate-limit |
| hết phiên | 401: hộp thoại "Phiên đã hết hạn" của AUTH kèm Đăng nhập | DSH-REQ-20261006-105126549 | - |
| không có quyền | sale, staff hoặc customer (403): màn `access-denied` của AUTH, không có số nào | DSH-REQ-20261006-105126549 | - |

## Phần tử
| testid | Phần tử | Role | Hành động | Requirement |
|---|---|---|---|---|
| dsh-analytics-sales-range-from | Ô ngày Từ | admin | Chọn ngày bắt đầu | DSH-REQ-20261015-092608849 |
| dsh-analytics-sales-range-to | Ô ngày Đến (không cho chọn sau hôm nay) | admin | Chọn ngày kết thúc | DSH-REQ-20261015-092608849 |
| dsh-analytics-sales-range-apply | Nút Áp dụng | admin | Tải báo cáo theo khoảng | DSH-REQ-20261015-092608849 |
| dsh-analytics-sales-range-reset | Nút 30 ngày qua | admin | Đặt lại khoảng mặc định | DSH-REQ-20261015-092608849 |
| dsh-analytics-sales-range-error | Dòng lỗi khoảng ngày (400) | admin | - | DSH-REQ-20261015-092608849 |
| dsh-analytics-sales-as-of | Dòng "Cập nhật lúc HH:mm" | admin | - | DSH-REQ-20261006-105126549 |
| dsh-analytics-sales-total-orders | Số Đơn được tính | admin | - | DSH-REQ-20261015-092608849 |
| dsh-analytics-sales-total-revenue | Số Doanh thu (giá trị đơn) | admin | - | DSH-REQ-20261015-092608849 |
| dsh-analytics-sales-total-excluded | Số Đơn bị loại | admin | - | DSH-REQ-20261015-092608849 |
| dsh-analytics-sales-table | Bảng theo người tạo đơn | admin | - | DSH-REQ-20261015-092608849 |
| dsh-analytics-sales-row | Một dòng sale (Tên, Số đơn, Doanh thu) | admin | - | DSH-REQ-20261015-092608849 |
| dsh-analytics-sales-row-deleted | Nhãn "(tài khoản đã xóa)" trên dòng của người không còn tra được tên | admin | - | DSH-REQ-20261015-092608849 |
| dsh-analytics-sales-website-row | Dòng cố định "Khách tự đặt (website)" ở cuối bảng, luôn có | admin | - | DSH-REQ-20261015-092608849 |
| dsh-analytics-sales-revenue-note | Dòng ghi chú "Doanh thu là giá trị đơn (gồm phí vận chuyển, đã trừ giảm giá), không phải tiền đã thu" | admin | - | DSH-REQ-20261015-092608849 |
| dsh-analytics-sales-excluded-note | Dòng chú thích "Không tính đơn đã hủy, hết hạn, hoàn về (cơ sở tính lương)" kèm số đơn bị loại | admin | - | DSH-REQ-20261015-092608849 |
| dsh-analytics-sales-export-csv | Nút Xuất CSV (tải tệp theo khoảng đang xem) | admin | Tải tệp CSV | DSH-REQ-20261015-092608849 |
| dsh-analytics-sales-export-loading | Trạng thái đang tạo tệp trên nút Xuất CSV (nút khóa) | admin | - | DSH-REQ-20261015-092608849 |
| dsh-analytics-sales-export-error | Dòng lỗi xuất CSV (403, 429, 503 hoặc 400 khi tải tệp; không tải được tệp) | admin | - | DSH-REQ-20261015-092608849 |
| dsh-analytics-sales-empty | Vùng "Không có đơn được tính từ ... tới ..." | admin | - | DSH-REQ-20261015-092608849 |
| dsh-analytics-sales-loading | Khung chờ | admin | - | DSH-REQ-20261006-105126549 |
| dsh-analytics-sales-error | Banner lỗi (503) | admin | - | DSH-REQ-20261006-105126549 |
| dsh-analytics-sales-retry | Nút Thử lại | admin | Tải lại báo cáo | DSH-REQ-20261006-105126549 |
| dsh-analytics-sales-rate-limit | Dải "Thao tác quá nhanh" (429) | admin | - | DSH-REQ-20261006-105126549 |

## Ghi chú thiết kế (mặc định, chưa duyệt)
- Tên sale là chữ do người dùng nhập: hiển thị là văn bản thuần (thoát HTML), cắt dài bằng dấu "…" và đầy đủ ở tooltip; không bao giờ dựng HTML từ tên. Hai sale trùng tên vẫn hai dòng (gom theo mã người dùng), mã rút gọn hiện ở tooltip để phân biệt.
- Dòng "Khách tự đặt (website)" nền khác nhẹ và ngăn cách bằng đường kẻ, không có hành động nào; luôn hiện kể cả 0 đơn.
- Thứ tự dòng lấy nguyên từ API để bảng khớp tệp CSV; tổng ở hàng số bằng tổng các dòng cộng dòng website.
- Hai dòng ghi chú luôn hiện: giá trị đơn không phải tiền PAY; ba trạng thái bị loại.
- Nút Xuất CSV như `analytics-sources`: dùng khoảng đã Áp dụng, tệp do server dựng (chống công thức ở server, DSH-REQ-20261015-092608849 BR8).
- Không biểu đồ, không so sánh sale; không có liên kết vào đơn của từng sale ở v1 (ngoài requirement).
- Hết phiên dùng hộp thoại của AUTH; 403 dùng `access-denied` của AUTH.
