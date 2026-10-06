---
screen: analytics-products
epic: DSH
status: draft
covers: [DSH-REQ-20261006-105126458, DSH-REQ-20261006-105126549]
roles: [admin]
---
# Phân tích sản phẩm bán chạy (báo cáo sản phẩm)

Trang để đọc sản phẩm bán chạy nhất theo khoảng ngày, xếp theo số lượng hoặc giá trị hàng bán. Chỉ tính đơn đã thu tiền theo PAY, theo ngày thu tiền (`paid_at`), không tính đơn đã hủy, hết hạn hoặc hoàn về. "Giá trị hàng bán" **không phải doanh thu**. Chỉ admin; staff và customer thấy màn `access-denied` của AUTH.

## Wireframe
Phương án đã chọn: **A** (khoảng ngày, hai số tổng, một bảng xếp hạng có ô đổi cách xếp). **Đây là lựa chọn mặc định** (khuyến nghị theo `U3` và mẫu "Trang báo cáo" của evon: top mục là danh sách dòng), chưa có người dùng chọn. Không dựng HTML hay chạy probe ở phase này.

| Phương án | Việc chính thấy ở đâu | Đổi gì | Đánh đổi |
|---|---|---|---|
| **A. Bảng xếp hạng, chọn cách xếp và số dòng (khuyên dùng, đã chọn)** | Thứ hạng, tên, số lượng, giá trị trên cùng một dòng | Đổi xếp theo số lượng hay giá trị bằng một ô chọn | Cần ô chọn `sort` và `limit`; không có biểu đồ |
| B. Biểu đồ thanh ngang top 10 | Thanh dài ngắn theo số lượng | Thấy chênh lệch nhanh | Không so được giá trị tiền cùng lúc; số dòng cố định |
| C. Hai bảng song song (theo số lượng, theo giá trị) | Hai xếp hạng cùng lúc | Không phải chọn | Hai bảng dài; trùng dữ liệu; hai lời gọi |

Lý do chọn A: việc chính là biết sản phẩm nào bán chạy rồi quyết định; thứ để so là số lượng và giá trị cùng dòng, đổi cách xếp bằng ô chọn (BR3 của requirement). Có thanh nhỏ trong cột số lượng (div có `width`) nhưng số luôn ghi bằng chữ.

```
Thanh header:  ☰  Sản phẩm bán chạy                                              🔔  (A)
┌──────────────────────────────────────────────────────────────────────────────────┐
│ Từ [01/09/2026]  Đến [30/09/2026]  [Áp dụng] [30 ngày qua]        Cập nhật 10:00 │
│ Xếp theo [Số lượng ▾]   Hiển thị [10 ▾]                                          │
├────────────────────────────────────┬─────────────────────────────────────────────┤
│ Tổng số lượng bán   90             │ Số sản phẩm khác nhau   3                   │
├────────────────────────────────────┴─────────────────────────────────────────────┤
│ #  Sản phẩm          Số lượng          Giá trị hàng bán                          │
│ 1  Áo thun           40  ▓▓▓▓▓▓▓▓      4.000.000 đ                               │
│ 2  Quần jean         25  ▓▓▓▓▓         5.000.000 đ                               │
│ 3  Tất cổ cao        25  ▓▓▓▓▓         1.250.000 đ                               │
└──────────────────────────────────────────────────────────────────────────────────┘
Ghi chú: "Chỉ tính đơn đã thu tiền theo PAY, theo ngày thu, không tính đơn hủy hoặc hoàn về. Giá trị hàng bán là giá lúc đặt nhân số lượng, trước giảm giá và phí giao; không phải doanh thu."
```

## Trạng thái
| Trạng thái | Trông ra sao | Requirement |
|---|---|---|
| đang tải | Khung xám đúng hình hai số tổng và 5 dòng bảng; ô khoảng ngày và ô chọn vẫn dùng được | DSH-REQ-20261006-105126458 |
| có dữ liệu | Hai số tổng, bảng xếp hạng theo `sort` và `limit`, dòng "Cập nhật lúc" | DSH-REQ-20261006-105126458 |
| không có đơn đã thu | Hai số tổng 0, bảng không có dòng, dòng "Không có sản phẩm bán từ ... tới ..." (200) | DSH-REQ-20261006-105126458 |
| nhiều sản phẩm hơn số hiển thị | Bảng có đúng số dòng đã chọn; hai số tổng vẫn là của toàn khoảng | DSH-REQ-20261006-105126458 |
| tham số sai | 400 (khoảng ngày sai, `limit` ngoài 1 tới 50, `sort` lạ): dòng lỗi dưới thanh lọc; giữ bảng cũ | DSH-REQ-20261006-105126458 |
| lỗi | ORD lỗi (503): banner "Không tải được báo cáo sản phẩm." kèm Thử lại | DSH-REQ-20261006-105126549 |
| quá nhiều yêu cầu | 429: dải "Thao tác quá nhanh, thử lại sau N giây" | DSH-REQ-20261006-105126549 |
| hết phiên | 401: hộp thoại "Phiên đã hết hạn" của AUTH kèm Đăng nhập | DSH-REQ-20261006-105126549 |

## Phần tử
| testid | Phần tử | Role | Hành động | Requirement |
|---|---|---|---|---|
| dsh-analytics-products-range-from | Ô ngày Từ | admin | Chọn ngày bắt đầu | DSH-REQ-20261006-105126458 |
| dsh-analytics-products-range-to | Ô ngày Đến (không cho chọn sau hôm nay) | admin | Chọn ngày kết thúc | DSH-REQ-20261006-105126458 |
| dsh-analytics-products-range-apply | Nút Áp dụng | admin | Tải báo cáo theo khoảng, cách xếp và số dòng | DSH-REQ-20261006-105126458 |
| dsh-analytics-products-range-reset | Nút 30 ngày qua | admin | Đặt lại khoảng mặc định | DSH-REQ-20261006-105126458 |
| dsh-analytics-products-sort | Ô chọn cách xếp (Số lượng, Giá trị) | admin | Chọn `units` hoặc `amount` | DSH-REQ-20261006-105126458 |
| dsh-analytics-products-limit | Ô chọn số dòng hiển thị (5, 10, 20, 50) | admin | Chọn `limit` | DSH-REQ-20261006-105126458 |
| dsh-analytics-products-filter-error | Dòng lỗi tham số (400) | admin | - | DSH-REQ-20261006-105126458 |
| dsh-analytics-products-as-of | Dòng "Cập nhật lúc HH:mm" | admin | - | DSH-REQ-20261006-105126549 |
| dsh-analytics-products-units-total | Số Tổng số lượng bán | admin | - | DSH-REQ-20261006-105126458 |
| dsh-analytics-products-distinct | Số Sản phẩm khác nhau | admin | - | DSH-REQ-20261006-105126458 |
| dsh-analytics-products-table | Bảng xếp hạng | admin | - | DSH-REQ-20261006-105126458 |
| dsh-analytics-products-row | Một dòng sản phẩm (thứ hạng, tên, số lượng, giá trị) | admin | - | DSH-REQ-20261006-105126458 |
| dsh-analytics-products-note | Dòng ghi chú "không phải doanh thu, chỉ đơn đã thu tiền" | admin | - | DSH-REQ-20261006-105126458 |
| dsh-analytics-products-empty | Vùng "Không có sản phẩm bán từ ... tới ..." | admin | - | DSH-REQ-20261006-105126458 |
| dsh-analytics-products-loading | Khung chờ | admin | - | DSH-REQ-20261006-105126549 |
| dsh-analytics-products-error | Banner lỗi (503) | admin | - | DSH-REQ-20261006-105126549 |
| dsh-analytics-products-retry | Nút Thử lại | admin | Tải lại báo cáo | DSH-REQ-20261006-105126549 |
| dsh-analytics-products-rate-limit | Dải "Thao tác quá nhanh" (429) | admin | - | DSH-REQ-20261006-105126549 |

## Ghi chú thiết kế (mặc định, chưa duyệt)
- Ô chọn số dòng chỉ cho 5, 10, 20, 50 để luôn nằm trong 1 tới 50; giá trị khác chỉ tới được bằng gọi API trực tiếp (400).
- Không liên kết sang trang chi tiết sản phẩm: PRD chưa có màn quản trị nhận `product_id` từ DSH, và báo cáo không ghép PRD (DSH-REQ-20261006-105126458 BR6).
- Sản phẩm đã ngừng bán vẫn hiện nếu có bán trong khoảng; không gắn nhãn riêng vì báo cáo không đọc PRD.
- Tiền `1.234.567 đ`, số `tabular-nums`. Hết phiên dùng hộp thoại của AUTH; 403 dùng `access-denied` của AUTH.
