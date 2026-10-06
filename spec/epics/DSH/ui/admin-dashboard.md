---
screen: admin-dashboard
epic: DSH
status: draft
covers: [DSH-REQ-20261006-105125714, DSH-REQ-20261006-105125811, DSH-REQ-20261006-105125901, DSH-REQ-20261006-105125995, DSH-REQ-20261006-105126089, DSH-REQ-20261006-105126180, DSH-REQ-20261006-105126549]
roles: [admin]
---
# Dashboard quản trị (tổng quan)

Màn tổng quan để admin **bắt tay làm việc**: nhìn bốn số chính, thấy việc cần xử lý (hoàn tiền thất bại, sản phẩm tồn thấp), mở đơn mới. Xem xu hướng theo thời gian thuộc các màn báo cáo (`analytics-revenue`, `analytics-orders`, `analytics-products`), không nhét biểu đồ vào đây. Chỉ admin; staff và customer mở `/admin/dashboard` thấy màn không có quyền chung của AUTH (`access-denied`), không phải màn này.

## Wireframe
Phương án đã chọn: **A** (hàng số liệu một khối chia kẻ, dưới là hai widget: đơn gần đây chiếm gấp đôi, tồn thấp ở cột phụ). **Đây là lựa chọn mặc định** (khuyến nghị theo `U3` và mẫu Dashboard A của evon), chưa có người dùng chọn. Không dựng HTML hay chạy probe ở phase này (việc của implement). Vùng quản trị cho nhân viên thuộc nhóm "app quản lý", không phải "cửa hàng online phía người mua", nên luật evon áp dụng đủ.

| Phương án | Việc chính thấy ở đâu | Đổi gì | Đánh đổi |
|---|---|---|---|
| **A. Hàng số liệu, hai widget bên dưới (khuyên dùng, đã chọn)** | Bốn số ở trên cùng; việc cần làm (tồn thấp, đơn mới) ngay dưới | Một ánh nhìn là biết tình hình và việc cần làm | Cần bốn nguồn tải song song, đã có từng khối lỗi riêng (DSH-REQ-20261006-105126549 BR2) |
| B. Một cột xếp chồng, mỗi khối một thẻ | Cuộn dọc qua từng khối | Đơn giản cho màn hẹp | Bốn thẻ cùng cấp làm số quan trọng nhất không nổi; màn rộng thừa chỗ trống |
| C. Hai tab Tổng quan và Việc cần làm | Việc cần làm ở tab thứ hai | Trang gọn | Việc cần làm (tồn thấp, hoàn tiền thất bại) bị giấu sau một lần bấm, trái mục đích màn |

Lý do chọn A: admin vào màn để biết "hôm nay có gì cần làm", nên bốn số ở dòng đầu và hai danh sách việc cần làm thấy ngay không cuộn. Bốn ô số dùng một màu (con số khác nhau, không màu khác nhau); hoàn tiền thất bại là cảnh báo (amber) vì mang nghĩa cần chú ý, đứng tách trên hàng số.

```
Thanh header:  ☰  Dashboard                                                     🔔  (A)
┌──────────────────────────────────────────────────────────────────────────────────┐
│ Từ [01/10/2026]  Đến [06/10/2026]  [Áp dụng] [30 ngày qua]        Cập nhật 10:00 ⟳│
│ ⚠ 2 hoàn tiền thất bại cần xử lý  → Xem hàng đợi hoàn tiền        (chỉ khi có)    │
├────────────────────┬────────────────┬────────────────┬───────────────────────────┤
│ Doanh thu thuần    │ Tổng đơn       │ Khách hàng     │ Sản phẩm đang bán         │
│ 470.000 đ          │ 45             │ 1.200          │ 120                       │
│ Thu 670.000 · Hoàn │ Hiệu lực 37    │ Mới 37 · Khóa  │ Tổng 143 · Nháp 8         │
│ 200.000 · 3 giao dịch│ chờ 3 · ... │ 15             │ · Ngừng bán 15            │
│ Xem báo cáo →      │ Xem báo cáo →  │                │ Xem báo cáo →             │
├────────────────────┴────────────────┴────────────────┼───────────────────────────┤
│ Đơn gần đây                          Xem tất cả →     │ Tồn thấp (7)  Xem tất cả →│
│ Mã đơn         Tạo lúc     Trạng thái  TT     Tổng    │ Tất cổ cao   TC-014    0  │
│ 7K3M9Q2XH4TB   06/10 09:00 Đã TT       VNPay  350.000 │ Áo thun      AT-001    2  │
│ 5FQ2H8B7C1ZD   03/10 21:14 Đã hủy      COD     90.000 │ ... (tối đa 5 dòng)       │
│ ... (10 dòng)                                         │                           │
└───────────────────────────────────────────────────────┴───────────────────────────┘
Mỗi khối có trạng thái đang tải, lỗi (kèm Thử lại) và rỗng riêng; khối lỗi không đổi thành 0.
Khoảng ngày chỉ áp cho Doanh thu, Tổng đơn, Khách mới; Sản phẩm, Tồn thấp, Đơn gần đây là số hiện tại.
```

## Trạng thái
Mỗi khối có trạng thái riêng. Lỗi của khối này không làm hỏng khối kia (DSH-REQ-20261006-105126549 BR2). Trạng thái "không có quyền" của staff và customer là màn `access-denied` của AUTH, không nằm ở màn này.

| Trạng thái | Trông ra sao | Requirement |
|---|---|---|
| đang tải | Mỗi khối một khung xám đúng chiều cao (ô số: số xám và dòng phụ xám; danh sách: 5 hoặc 10 dòng xám); ô khoảng ngày vẫn dùng được | DSH-REQ-20261006-105126549 |
| có dữ liệu | Số và danh sách; dòng "Cập nhật lúc HH:mm" (giờ Việt Nam) theo `as_of` | DSH-REQ-20261006-105126549 |
| lỗi | Khối nguồn lỗi (503) hiện "Không tải được <tên khối>." kèm nút Thử lại ngay trong khung khối; giữ nguyên các khối khác; không hiện 0 hay "không có dữ liệu" | DSH-REQ-20261006-105126549 |
| quá nhiều yêu cầu | 429: dải "Thao tác quá nhanh, thử lại sau N giây" (N từ `Retry-After`) ở đầu trang, giữ số cũ đang hiển thị | DSH-REQ-20261006-105126549 |
| hết phiên | 401: hộp thoại "Phiên đã hết hạn" của AUTH (`auth-account-menu-session-expired`) kèm nút Đăng nhập | DSH-REQ-20261006-105126549 |
| khoảng ngày sai | 400: dòng lỗi dưới ô khoảng ngày ("Khoảng tối đa 366 ngày, không sau hôm nay, Từ không sau Đến"); giữ số của khoảng trước | DSH-REQ-20261006-105125714 |
| doanh thu không có giao dịch | Ô doanh thu hiện 0 đ, `Thu 0 · Hoàn 0 · 0 giao dịch` (200, không phải lỗi) | DSH-REQ-20261006-105125714 |
| doanh thu âm | Số âm hiện dấu trừ rõ ràng ("-200.000 đ"), không đổi màu; dòng phụ giải thích hoàn tiền kỳ trước | DSH-REQ-20261006-105125714 |
| có hoàn tiền thất bại | Dải cảnh báo amber "N hoàn tiền thất bại cần xử lý" kèm lối tới hàng đợi hoàn tiền; N = 0 thì ẩn dải | DSH-REQ-20261006-105125714 |
| đơn rỗng | Ô Tổng đơn hiện 0 và tám trạng thái 0 (200); khối Đơn gần đây hiện "Chưa có đơn hàng nào" và không có "Xem tất cả" | DSH-REQ-20261006-105126180 |
| tồn thấp rỗng | Khối Tồn thấp hiện "Không có sản phẩm tồn thấp", không có "Xem tất cả" | DSH-REQ-20261006-105126089 |
| tồn thấp nhiều hơn 5 | Hiện 5 dòng, tiêu đề ghi tổng thật "Tồn thấp (7)" và có "Xem tất cả" | DSH-REQ-20261006-105126089 |
| khách chưa có | Ô Khách hàng hiện 0, mới 0, khóa 0 | DSH-REQ-20261006-105125901 |
| sản phẩm chưa có | Ô Sản phẩm hiện 0, ba trạng thái 0 | DSH-REQ-20261006-105125995 |

## Phần tử
testid dạng `dsh-admin-dashboard-<phần-tử>`; mọi phần tử chỉ dành cho admin.

| testid | Phần tử | Role | Hành động | Requirement |
|---|---|---|---|---|
| dsh-admin-dashboard-range-from | Ô ngày Từ (mặc định hôm nay trừ 29 ngày) | admin | Chọn ngày bắt đầu | DSH-REQ-20261006-105125714 |
| dsh-admin-dashboard-range-to | Ô ngày Đến (mặc định hôm nay; không cho chọn sau hôm nay) | admin | Chọn ngày kết thúc | DSH-REQ-20261006-105125714 |
| dsh-admin-dashboard-range-apply | Nút Áp dụng | admin | Tải lại ba khối theo khoảng (doanh thu, đơn, khách) | DSH-REQ-20261006-105125714 |
| dsh-admin-dashboard-range-reset | Nút 30 ngày qua | admin | Đặt lại khoảng mặc định | DSH-REQ-20261006-105125714 |
| dsh-admin-dashboard-range-error | Dòng lỗi khoảng ngày (400) | admin | - | DSH-REQ-20261006-105125714 |
| dsh-admin-dashboard-as-of | Dòng "Cập nhật lúc HH:mm" | admin | - | DSH-REQ-20261006-105126549 |
| dsh-admin-dashboard-refresh | Nút Làm mới (gọi lại các khối, có thể nhận nội dung đệm tối đa 60 giây) | admin | Tải lại tất cả khối | DSH-REQ-20261006-105126549 |
| dsh-admin-dashboard-rate-limit | Dải "Thao tác quá nhanh" (429) | admin | - | DSH-REQ-20261006-105126549 |
| dsh-admin-dashboard-refund-alert | Dải cảnh báo hoàn tiền thất bại (chỉ khi N lớn hơn 0) | admin | - | DSH-REQ-20261006-105125714 |
| dsh-admin-dashboard-refund-alert-link | Liên kết tới hàng đợi hoàn tiền (PAY) | admin | Mở hàng đợi hoàn tiền | DSH-REQ-20261006-105125714 |
| dsh-admin-dashboard-kpi-revenue | Ô Doanh thu thuần (số lớn, tabular-nums) | admin | - | DSH-REQ-20261006-105125714 |
| dsh-admin-dashboard-kpi-revenue-detail | Dòng phụ Thu, Hoàn, số giao dịch | admin | - | DSH-REQ-20261006-105125714 |
| dsh-admin-dashboard-kpi-revenue-report-link | Liên kết Xem báo cáo doanh thu | admin | Mở màn báo cáo doanh thu | DSH-REQ-20261006-105125714 |
| dsh-admin-dashboard-kpi-revenue-loading | Khung chờ ô doanh thu | admin | - | DSH-REQ-20261006-105126549 |
| dsh-admin-dashboard-kpi-revenue-error | Lỗi ô doanh thu | admin | - | DSH-REQ-20261006-105126549 |
| dsh-admin-dashboard-kpi-revenue-retry | Nút Thử lại ô doanh thu | admin | Gọi lại khối doanh thu | DSH-REQ-20261006-105126549 |
| dsh-admin-dashboard-kpi-orders | Ô Tổng đơn (số lớn) | admin | - | DSH-REQ-20261006-105125811 |
| dsh-admin-dashboard-kpi-orders-effective | Dòng phụ số đơn hiệu lực | admin | - | DSH-REQ-20261006-105125811 |
| dsh-admin-dashboard-kpi-orders-by-status | Danh sách tám trạng thái (kể cả Hoàn về) và số đơn | admin | - | DSH-REQ-20261006-105125811 |
| dsh-admin-dashboard-kpi-orders-report-link | Liên kết Xem báo cáo đơn | admin | Mở màn báo cáo đơn | DSH-REQ-20261006-105125811 |
| dsh-admin-dashboard-kpi-orders-loading | Khung chờ ô đơn | admin | - | DSH-REQ-20261006-105126549 |
| dsh-admin-dashboard-kpi-orders-error | Lỗi ô đơn | admin | - | DSH-REQ-20261006-105126549 |
| dsh-admin-dashboard-kpi-orders-retry | Nút Thử lại ô đơn | admin | Gọi lại khối đơn | DSH-REQ-20261006-105126549 |
| dsh-admin-dashboard-kpi-customers | Ô Khách hàng (số lớn) | admin | - | DSH-REQ-20261006-105125901 |
| dsh-admin-dashboard-kpi-customers-new | Dòng phụ khách mới trong khoảng | admin | - | DSH-REQ-20261006-105125901 |
| dsh-admin-dashboard-kpi-customers-locked | Dòng phụ khách đang khóa | admin | - | DSH-REQ-20261006-105125901 |
| dsh-admin-dashboard-kpi-customers-loading | Khung chờ ô khách | admin | - | DSH-REQ-20261006-105126549 |
| dsh-admin-dashboard-kpi-customers-error | Lỗi ô khách | admin | - | DSH-REQ-20261006-105126549 |
| dsh-admin-dashboard-kpi-customers-retry | Nút Thử lại ô khách | admin | Gọi lại khối khách | DSH-REQ-20261006-105126549 |
| dsh-admin-dashboard-kpi-products | Ô Sản phẩm đang bán (số lớn) | admin | - | DSH-REQ-20261006-105125995 |
| dsh-admin-dashboard-kpi-products-breakdown | Dòng phụ tổng, nháp, ngừng bán | admin | - | DSH-REQ-20261006-105125995 |
| dsh-admin-dashboard-kpi-products-loading | Khung chờ ô sản phẩm | admin | - | DSH-REQ-20261006-105126549 |
| dsh-admin-dashboard-kpi-products-error | Lỗi ô sản phẩm | admin | - | DSH-REQ-20261006-105126549 |
| dsh-admin-dashboard-kpi-products-retry | Nút Thử lại ô sản phẩm | admin | Gọi lại khối sản phẩm | DSH-REQ-20261006-105126549 |
| dsh-admin-dashboard-low-stock-count | Tổng số sản phẩm tồn thấp ở tiêu đề khối | admin | - | DSH-REQ-20261006-105126089 |
| dsh-admin-dashboard-low-stock-row | Dòng sản phẩm tồn thấp (tên, sku, còn bán) | admin | Bấm để mở tồn kho của sản phẩm | DSH-REQ-20261006-105126089 |
| dsh-admin-dashboard-low-stock-view-all | Liên kết Xem tất cả (tới tab Tồn thấp của INV; ẩn khi không có mục) | admin | Mở danh sách tồn thấp | DSH-REQ-20261006-105126089 |
| dsh-admin-dashboard-low-stock-empty | Vùng "Không có sản phẩm tồn thấp" | admin | - | DSH-REQ-20261006-105126089 |
| dsh-admin-dashboard-low-stock-loading | Khung chờ khối tồn thấp | admin | - | DSH-REQ-20261006-105126549 |
| dsh-admin-dashboard-low-stock-error | Lỗi khối tồn thấp | admin | - | DSH-REQ-20261006-105126549 |
| dsh-admin-dashboard-low-stock-retry | Nút Thử lại khối tồn thấp | admin | Gọi lại khối tồn thấp | DSH-REQ-20261006-105126549 |
| dsh-admin-dashboard-recent-orders-row | Dòng đơn gần đây | admin | Bấm để mở chi tiết đơn | DSH-REQ-20261006-105126180 |
| dsh-admin-dashboard-recent-orders-code | Mã đơn (font-mono) | admin | - | DSH-REQ-20261006-105126180 |
| dsh-admin-dashboard-recent-orders-status | Badge trạng thái đơn (nhãn chữ, không chỉ màu) | admin | - | DSH-REQ-20261006-105126180 |
| dsh-admin-dashboard-recent-orders-payment | Phương thức và trạng thái thanh toán | admin | - | DSH-REQ-20261006-105126180 |
| dsh-admin-dashboard-recent-orders-total | Tổng tiền đơn, căn phải (không gọi là doanh thu) | admin | - | DSH-REQ-20261006-105126180 |
| dsh-admin-dashboard-recent-orders-view-all | Liên kết Xem tất cả (tới danh sách đơn của ORD; ẩn khi không có đơn) | admin | Mở danh sách đơn quản trị | DSH-REQ-20261006-105126180 |
| dsh-admin-dashboard-recent-orders-empty | Vùng "Chưa có đơn hàng nào" | admin | - | DSH-REQ-20261006-105126180 |
| dsh-admin-dashboard-recent-orders-loading | Khung chờ khối đơn gần đây | admin | - | DSH-REQ-20261006-105126549 |
| dsh-admin-dashboard-recent-orders-error | Lỗi khối đơn gần đây | admin | - | DSH-REQ-20261006-105126549 |
| dsh-admin-dashboard-recent-orders-retry | Nút Thử lại khối đơn gần đây | admin | Gọi lại khối đơn gần đây | DSH-REQ-20261006-105126549 |

## Ghi chú thiết kế (mặc định, chưa duyệt)
- Hàng số liệu là **một khối chia kẻ, không bốn thẻ**, và một màu (luật `Dashboard A` của evon); cảnh báo hoàn tiền là chỗ duy nhất dùng màu trạng thái (amber).
- Chỉ ba ô (Doanh thu, Tổng đơn, Khách hàng mới) theo khoảng ngày; hai ô còn lại và hai danh sách là số hiện tại. Khoảng ngày ghi một lần ở đầu hàng, không lặp trong từng ô. Không có kỳ so sánh (DSH-REQ-20261006-105126271, xung đột [OPEN]).
- Không biểu đồ trên màn này: bốn khối, không biểu đồ xu hướng, vì xu hướng thuộc các báo cáo (evon: "ba khối là mỏng, bốn tới năm vừa"; ở đây có hàng số, đơn gần đây, tồn thấp, và dải việc cần làm).
- Tiền định dạng `1.234.567 đ`, số `tabular-nums`; giá trị rỗng là `—`; nhãn trạng thái đơn và thanh toán viết chữ, không chỉ màu. Dưới `sm` hàng số thành lưới 2x2 và hai danh sách xếp dọc.
- Tiêu đề ô "Doanh thu thuần" kèm giải thích ngắn "Tiền thu thành công trừ hoàn tiền (theo PAY)"; cột "Tổng" của đơn gần đây đặt nhãn "Giá trị đơn", không "Doanh thu" (DSH-REQ-20261006-105126180 BR4).
- Hết phiên (401) dùng hộp thoại của AUTH; không có testid riêng ở màn này. `access-denied` của AUTH là nơi staff và customer thấy kết quả 403.
