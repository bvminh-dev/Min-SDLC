---
screen: analytics-orders
epic: DSH
status: draft
covers: [DSH-REQ-20261006-105126368, DSH-REQ-20261006-105126549]
roles: [admin]
---
# Phân tích đơn hàng (báo cáo đơn hàng)

Trang để đọc số đơn theo mốc và trạng thái, tỷ lệ hủy, hết hạn và giá trị đơn trung bình trong một khoảng ngày. Đây là số đếm và giá trị đơn, **không phải doanh thu** (doanh thu ở `analytics-revenue`). Chỉ admin; staff và customer thấy màn `access-denied` của AUTH.

## Wireframe
Phương án đã chọn: **A** (khoảng ngày, hàng số, biểu đồ theo mốc, bảng mốc theo tám trạng thái). **Đây là lựa chọn mặc định** (khuyến nghị theo `U3` và mẫu "Trang báo cáo" của evon), chưa có người dùng chọn. Không dựng HTML hay chạy probe ở phase này.

| Phương án | Việc chính thấy ở đâu | Đổi gì | Đánh đổi |
|---|---|---|---|
| **A. Hàng số, biểu đồ theo mốc, bảng theo trạng thái (khuyên dùng, đã chọn)** | Số tổng và tỷ lệ ở trên; phân bổ trạng thái theo mốc ở bảng | Thấy cả tỷ lệ hủy lẫn mốc nào hủy nhiều | Tám cột trạng thái làm bảng rộng; màn hẹp cuộn ngang trong bảng |
| B. Chỉ hàng số và bảng tổng theo trạng thái | Tám con số tổng | Rất gọn | Không thấy mốc nào có vấn đề |
| C. Biểu đồ tròn theo trạng thái | Tỷ lệ tám trạng thái | Nhìn tỷ lệ nhanh | Tám phần vượt giới hạn bốn phần của evon, không đọc được; thay bằng danh sách thanh |

Lý do chọn A: việc chính là biết chất lượng đơn theo thời gian (hủy, hết hạn nhiều ở mốc nào); tám trạng thái xếp thành danh sách thanh ngang có số và phần trăm cho tổng, và cột trong bảng cho từng mốc.

```
Thanh header:  ☰  Báo cáo đơn hàng                                               🔔  (A)
┌──────────────────────────────────────────────────────────────────────────────────┐
│ Từ [01/09/2026]  Đến [30/09/2026]  [Áp dụng] [30 ngày qua]        Cập nhật 10:00 │
├────────────────┬────────────────┬────────────────┬───────────────────────────────┤
│ Tổng đơn       │ Tỷ lệ hủy      │ Tỷ lệ hết hạn  │ Giá trị đơn trung bình        │
│ 200            │ 15,0%          │ 4,0%           │ 350.000 đ                     │
├────────────────┴────────────────┴────────────────┴───────────────────────────────┤
│ Đơn theo ngày                                                                    │
│ (30 mốc dùng đường, số ở điểm đang xem)                                          │
├──────────────────────────────────────────────────────────────────────────────────┤
│ Mốc        Tổng  Chờ  Xác nhận  Đã TT  Đang giao  Đã giao  Hoàn về  Đã hủy  Hết hạn │
│ 01/09/2026   7    0     0         1       0         5        0        1       0     │
│ ... (đủ mọi mốc, kể cả mốc 0)                                                    │
├──────────────────────────────────────────────────────────────────────────────────┤
│ Theo trạng thái:  Đã giao 119 (59,5%)  ▓▓▓▓▓▓   Đã hủy 30 (15%)  ▓▓  ...           │
└──────────────────────────────────────────────────────────────────────────────────┘
Ghi chú: "Số đơn và giá trị đơn, không phải doanh thu. Trạng thái là trạng thái hiện tại. Giá trị trung bình chỉ tính đơn đã thu tiền."
```

## Trạng thái
| Trạng thái | Trông ra sao | Requirement |
|---|---|---|
| đang tải | Khung xám đúng hình hàng số, biểu đồ và bảng; ô khoảng ngày vẫn dùng được | DSH-REQ-20261006-105126368 |
| có dữ liệu | Hàng số, biểu đồ theo mốc, bảng theo tám trạng thái, danh sách thanh theo trạng thái, dòng "Cập nhật lúc" | DSH-REQ-20261006-105126368 |
| độ mịn | Tiêu đề biểu đồ đổi theo `granularity` (ngày, tuần, tháng) như báo cáo doanh thu | DSH-REQ-20261006-105126368 |
| không có đơn | Tỷ lệ hủy, hết hạn và giá trị trung bình hiện `—` (không phải 0%), tổng 0, bảng đủ mốc 0, dòng "Không có đơn từ ... tới ..." (200) | DSH-REQ-20261006-105126368 |
| khoảng ngày sai | 400: dòng lỗi dưới ô khoảng ngày; giữ báo cáo của khoảng trước | DSH-REQ-20261006-105126368 |
| lỗi | ORD lỗi (503): banner "Không tải được báo cáo đơn." kèm Thử lại; không vẽ biểu đồ toàn 0 | DSH-REQ-20261006-105126549 |
| quá nhiều yêu cầu | 429: dải "Thao tác quá nhanh, thử lại sau N giây" | DSH-REQ-20261006-105126549 |
| hết phiên | 401: hộp thoại "Phiên đã hết hạn" của AUTH kèm Đăng nhập | DSH-REQ-20261006-105126549 |

## Phần tử
| testid | Phần tử | Role | Hành động | Requirement |
|---|---|---|---|---|
| dsh-analytics-orders-range-from | Ô ngày Từ | admin | Chọn ngày bắt đầu | DSH-REQ-20261006-105126368 |
| dsh-analytics-orders-range-to | Ô ngày Đến (không cho chọn sau hôm nay) | admin | Chọn ngày kết thúc | DSH-REQ-20261006-105126368 |
| dsh-analytics-orders-range-apply | Nút Áp dụng | admin | Tải báo cáo theo khoảng | DSH-REQ-20261006-105126368 |
| dsh-analytics-orders-range-reset | Nút 30 ngày qua | admin | Đặt lại khoảng mặc định | DSH-REQ-20261006-105126368 |
| dsh-analytics-orders-range-error | Dòng lỗi khoảng ngày (400) | admin | - | DSH-REQ-20261006-105126368 |
| dsh-analytics-orders-as-of | Dòng "Cập nhật lúc HH:mm" | admin | - | DSH-REQ-20261006-105126549 |
| dsh-analytics-orders-total | Số Tổng đơn | admin | - | DSH-REQ-20261006-105126368 |
| dsh-analytics-orders-cancel-rate | Số Tỷ lệ hủy | admin | - | DSH-REQ-20261006-105126368 |
| dsh-analytics-orders-expired-rate | Số Tỷ lệ hết hạn | admin | - | DSH-REQ-20261006-105126368 |
| dsh-analytics-orders-aov | Số Giá trị đơn trung bình | admin | - | DSH-REQ-20261006-105126368 |
| dsh-analytics-orders-chart | Biểu đồ số đơn theo mốc | admin | Tab vào mốc để xem số của mốc | DSH-REQ-20261006-105126368 |
| dsh-analytics-orders-granularity | Tiêu đề biểu đồ nêu độ mịn | admin | - | DSH-REQ-20261006-105126368 |
| dsh-analytics-orders-table | Bảng mốc theo tám trạng thái | admin | - | DSH-REQ-20261006-105126368 |
| dsh-analytics-orders-row | Một dòng mốc | admin | - | DSH-REQ-20261006-105126368 |
| dsh-analytics-orders-by-status | Danh sách thanh theo trạng thái, kèm số và phần trăm | admin | - | DSH-REQ-20261006-105126368 |
| dsh-analytics-orders-note | Dòng ghi chú "không phải doanh thu" | admin | - | DSH-REQ-20261006-105126368 |
| dsh-analytics-orders-empty | Vùng "Không có đơn từ ... tới ..." | admin | - | DSH-REQ-20261006-105126368 |
| dsh-analytics-orders-loading | Khung chờ | admin | - | DSH-REQ-20261006-105126549 |
| dsh-analytics-orders-error | Banner lỗi (503) | admin | - | DSH-REQ-20261006-105126549 |
| dsh-analytics-orders-retry | Nút Thử lại | admin | Tải lại báo cáo | DSH-REQ-20261006-105126549 |
| dsh-analytics-orders-rate-limit | Dải "Thao tác quá nhanh" (429) | admin | - | DSH-REQ-20261006-105126549 |

## Ghi chú thiết kế (mặc định, chưa duyệt)
- Tám trạng thái là phân loại từ 5 nhóm trở lên nên mỗi nhóm một sắc trong thang mặc định của evon (tối đa 6 sắc, các nhóm còn lại gộp "Khác", ví dụ `returned` và `pending` ghép chung nếu thiếu sắc; số riêng của từng trạng thái vẫn nằm ở bảng mốc), nhưng tránh đỏ, hổ phách, xanh lá vì trùng badge trạng thái; mỗi nhóm luôn có số và phần trăm bằng chữ (màu không mang giá trị). Nếu thấy rối, phương án B (chỉ bảng) là lối lui.
- Tỷ lệ không có mẫu (`total` = 0) hiện `—`, không hiện `0%` (DSH-REQ-20261006-105126368 BR3): `null` khác 0.
- Mốc không có đơn vẫn có dòng với số 0 (trục liên tục, DSH-REQ-20261006-105126368 BR1).
- Hết phiên dùng hộp thoại của AUTH; 403 dùng `access-denied` của AUTH.
