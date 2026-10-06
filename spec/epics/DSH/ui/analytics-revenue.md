---
screen: analytics-revenue
epic: DSH
status: draft
covers: [DSH-REQ-20261006-105126271, DSH-REQ-20261006-105126549]
roles: [admin]
---
# Phân tích doanh thu (báo cáo doanh thu)

Trang để **đọc số theo một khoảng ngày** (khác dashboard là nơi bắt tay làm). Số tiền lấy từ PAY: chỉ Payment thu thành công trừ hoàn tiền thành công. Chỉ admin; staff và customer thấy màn `access-denied` của AUTH.

## Wireframe
Phương án đã chọn: **A** (bộ lọc khoảng ngày, hàng số tổng, biểu đồ chính theo mốc, rồi bảng mốc và khối theo phương thức). **Đây là lựa chọn mặc định** (khuyến nghị theo `U3` và mẫu "Trang báo cáo" của evon), chưa có người dùng chọn. Không dựng HTML hay chạy probe ở phase này.

| Phương án | Việc chính thấy ở đâu | Đổi gì | Đánh đổi |
|---|---|---|---|
| **A. Biểu đồ chính cộng bảng mốc và khối phương thức (khuyên dùng, đã chọn)** | Xu hướng ở biểu đồ, con số chính xác ở bảng ngay dưới | Đọc xu hướng rồi đối chiếu số | Dài hơn một chút; màn hẹp xếp một cột |
| B. Chỉ bảng mốc | Số liệu từng dòng | Đơn giản, in được | Không thấy xu hướng; 30 dòng khó đọc |
| C. Biểu đồ tròn theo phương thức là chính | Tỷ lệ VNPay và COD | Nhìn tỷ lệ nhanh | Việc chính là xu hướng theo thời gian; chỉ hai phần nên không cần biểu đồ tròn (evon: tròn tối đa bốn phần, hai phần dùng thanh) |

Lý do chọn A: việc chính của báo cáo là xu hướng thu theo mốc và tổng; mốc có thể âm (hoàn tiền) nên cần đọc cả con số. Hai phương thức chỉ hai dòng thanh ngang có số và phần trăm.

```
Thanh header:  ☰  Báo cáo doanh thu                                              🔔  (A)
┌──────────────────────────────────────────────────────────────────────────────────┐
│ Từ [01/09/2026]  Đến [30/09/2026]  [Áp dụng] [30 ngày qua]        Cập nhật 10:00 │
├────────────────┬────────────────┬────────────────┬───────────────────────────────┤
│ Thu            │ Hoàn tiền      │ Doanh thu thuần│ Số giao dịch                  │
│ 320.000 đ      │ 200.000 đ      │ 120.000 đ      │ 2                             │
├────────────────┴────────────────┴────────────────┴───────────────────────────────┤
│ Doanh thu theo ngày                                                              │
│ 200 N ─────────●─────────────────────────────────────────────────────────────── │
│   0   ─────────────●───────────────────────────────────────────────────────────│
│ -200 N ─────────────────────────────────────●─────────────────────────────────── │
│        02/09   10/09                       20/09                        30/09     │
├──────────────────────────────────────────────────────────────────────────────────┤
│ Mốc          Thu       Hoàn tiền   Thuần      Giao dịch                          │
│ 02/09/2026   200.000   0           200.000    1                                  │
│ 10/09/2026   120.000   0           120.000    1                                  │
│ 20/09/2026   0         200.000     -200.000   0                                  │
│ ... (đủ mọi mốc, kể cả mốc 0)                                                    │
├──────────────────────────────────────────────────────────────────────────────────┤
│ Theo phương thức                                                                 │
│ VNPay  Thu 200.000 · Hoàn 200.000 · Thuần 0                                      │
│ COD    Thu 120.000 · Hoàn 0 · Thuần 120.000                                      │
└──────────────────────────────────────────────────────────────────────────────────┘
Dòng ghi chú: "Tiền theo PAY: thu thành công trừ hoàn tiền thành công. Hoàn tiền tính vào ngày hoàn."
```

## Trạng thái
| Trạng thái | Trông ra sao | Requirement |
|---|---|---|
| đang tải | Khung xám đúng hình hàng số, biểu đồ và bảng; ô khoảng ngày vẫn dùng được | DSH-REQ-20261006-105126271 |
| có dữ liệu | Hàng số, biểu đồ theo mốc, bảng mốc, khối phương thức, dòng "Cập nhật lúc" | DSH-REQ-20261006-105126271 |
| độ mịn | Tiêu đề biểu đồ đổi theo `granularity`: "Doanh thu theo ngày" (1 tới 31 ngày), "theo tuần" (32 tới 92), "theo tháng" (từ 93); tuần ghi thứ Hai bắt đầu | DSH-REQ-20261006-105126271 |
| không có giao dịch | Hàng số 0, bảng đủ mốc giá trị 0 và dòng "Không có giao dịch từ 01/09/2026 tới 30/09/2026" kèm liên kết về 30 ngày qua (200, không phải lỗi) | DSH-REQ-20261006-105126271 |
| mốc âm | Mốc có Thuần âm hiện dấu trừ ở bảng và biểu đồ (điểm dưới trục 0); không đổi sắc chỉ vì âm | DSH-REQ-20261006-105126271 |
| khoảng ngày sai | 400: dòng lỗi dưới ô khoảng ngày; giữ báo cáo của khoảng trước | DSH-REQ-20261006-105126271 |
| lỗi | PAY lỗi (503): banner "Không tải được báo cáo doanh thu." kèm Thử lại; không vẽ biểu đồ toàn 0 | DSH-REQ-20261006-105126549 |
| quá nhiều yêu cầu | 429: dải "Thao tác quá nhanh, thử lại sau N giây" | DSH-REQ-20261006-105126549 |
| hết phiên | 401: hộp thoại "Phiên đã hết hạn" của AUTH kèm Đăng nhập | DSH-REQ-20261006-105126549 |

## Phần tử
| testid | Phần tử | Role | Hành động | Requirement |
|---|---|---|---|---|
| dsh-analytics-revenue-range-from | Ô ngày Từ | admin | Chọn ngày bắt đầu | DSH-REQ-20261006-105126271 |
| dsh-analytics-revenue-range-to | Ô ngày Đến (không cho chọn sau hôm nay) | admin | Chọn ngày kết thúc | DSH-REQ-20261006-105126271 |
| dsh-analytics-revenue-range-apply | Nút Áp dụng | admin | Tải báo cáo theo khoảng | DSH-REQ-20261006-105126271 |
| dsh-analytics-revenue-range-reset | Nút 30 ngày qua | admin | Đặt lại khoảng mặc định | DSH-REQ-20261006-105126271 |
| dsh-analytics-revenue-range-error | Dòng lỗi khoảng ngày (400) | admin | - | DSH-REQ-20261006-105126271 |
| dsh-analytics-revenue-as-of | Dòng "Cập nhật lúc HH:mm" | admin | - | DSH-REQ-20261006-105126549 |
| dsh-analytics-revenue-total-gross | Số Thu | admin | - | DSH-REQ-20261006-105126271 |
| dsh-analytics-revenue-total-refunded | Số Hoàn tiền | admin | - | DSH-REQ-20261006-105126271 |
| dsh-analytics-revenue-total-net | Số Doanh thu thuần | admin | - | DSH-REQ-20261006-105126271 |
| dsh-analytics-revenue-total-count | Số giao dịch | admin | - | DSH-REQ-20261006-105126271 |
| dsh-analytics-revenue-chart | Biểu đồ doanh thu theo mốc | admin | Tab vào mốc để xem số của mốc | DSH-REQ-20261006-105126271 |
| dsh-analytics-revenue-granularity | Tiêu đề biểu đồ nêu độ mịn (ngày, tuần, tháng) | admin | - | DSH-REQ-20261006-105126271 |
| dsh-analytics-revenue-table | Bảng mốc | admin | - | DSH-REQ-20261006-105126271 |
| dsh-analytics-revenue-row | Một dòng mốc (Thu, Hoàn, Thuần, Giao dịch) | admin | - | DSH-REQ-20261006-105126271 |
| dsh-analytics-revenue-method-vnpay | Dòng phương thức VNPay | admin | - | DSH-REQ-20261006-105126271 |
| dsh-analytics-revenue-method-cod | Dòng phương thức COD | admin | - | DSH-REQ-20261006-105126271 |
| dsh-analytics-revenue-note | Dòng ghi chú cách tính tiền theo PAY | admin | - | DSH-REQ-20261006-105126271 |
| dsh-analytics-revenue-empty | Vùng "Không có giao dịch từ ... tới ..." | admin | - | DSH-REQ-20261006-105126271 |
| dsh-analytics-revenue-loading | Khung chờ | admin | - | DSH-REQ-20261006-105126549 |
| dsh-analytics-revenue-error | Banner lỗi (503) | admin | - | DSH-REQ-20261006-105126549 |
| dsh-analytics-revenue-retry | Nút Thử lại | admin | Tải lại báo cáo | DSH-REQ-20261006-105126549 |
| dsh-analytics-revenue-rate-limit | Dải "Thao tác quá nhanh" (429) | admin | - | DSH-REQ-20261006-105126549 |

## Ghi chú thiết kế (mặc định, chưa duyệt)
- Biểu đồ chính của trang báo cáo có lưới ngang và nhãn mức (ngoại lệ "Bỏ bớt đi" của evon), số kèm mốc ở điểm đang xem, Tab vào thì hiện số của mốc. Mốc có thể âm nên trục có mức 0 và điểm nằm dưới trục. Hơn 12 mốc dùng đường, 12 mốc trở xuống (tháng) dùng cột (bảng "Cột hay đường" của evon). Không hiệu ứng vào trang, một màu.
- Không có kỳ so sánh và không xuất tệp: ngoài requirement (DSH-REQ-20261006-105126271, [OPEN]).
- Khoảng một ngày chỉ có một mốc: vẫn có bảng và hàng số, không vẽ biểu đồ một điểm (evon muốn theo giờ, requirement chưa có, [OPEN]).
- Tiền `1.234.567 đ`, `tabular-nums`, số âm có dấu trừ. Ghi chú nói rõ hoàn tiền tính vào ngày hoàn (DSH-REQ-20261006-105126271 BR7), nên mốc thu và mốc hoàn khác ngày là đúng, không phải lỗi.
- Tên màn `analytics-revenue` là trang "Báo cáo doanh thu" của roadmap (cùng cách đặt tên cho `analytics-orders`, `analytics-products`).
- Hết phiên dùng hộp thoại của AUTH; 403 dùng `access-denied` của AUTH.
