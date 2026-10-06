---
screen: admin-payment-list
epic: PAY
status: draft
covers: [PAY-REQ-20261006-103111211]
roles: [staff, admin]
---
# Quản lý thanh toán (danh sách mọi thanh toán)

Màn quản trị cho staff và admin: xem, lọc mọi thanh toán, tìm theo mã đơn, và lối tắt "COD chờ thu". Staff chỉ xem; hành động thu COD và hoàn tiền nằm ở màn `admin-payment-detail`.

## Wireframe
Phương án đã chọn: **A** (bảng dữ liệu một trang có thanh lọc phía trên và lối tắt). **Đây là lựa chọn mặc định** (khuyến nghị theo `U3`), chưa có người dùng chọn.

| Phương án | Việc chính thấy ở đâu | Đổi gì | Đánh đổi |
|---|---|---|---|
| **A. Bảng cộng thanh lọc và lối tắt "COD chờ thu" (khuyên dùng, đã chọn)** | Bảng chiếm màn, thanh lọc phía trên | Nhân viên quét nhanh, lọc theo trạng thái, phương thức, mã đơn | Cột nhiều nên cuộn ngang trên màn hẹp |
| B. Tab theo phương thức (VNPay, COD) | Mỗi phương thức một tab | Tách việc đối soát COD | Thêm tab; lọc theo phương thức đã làm được việc này |
| C. Bảng cộng khung chi tiết bên phải | Chi tiết ngay cạnh bảng | Không đổi trang | Chi tiết có hành động tiền nên cần trang riêng có xác nhận |

```
Thanh header:  ☰  Quản trị › Thanh toán                                         🔔  (A)
┌──────────────────────────────────────────────────────────────────────────────────┐
│ Trạng thái [Tất cả ▾]  Phương thức [Tất cả ▾]  Mã đơn [__________] [Lọc]          │
│ [COD chờ thu]                                                                    │  <- đặt method=cod, status=pending
│ ┌───────────────┬──────────┬────────┬───────────┬──────────────┬───────────────┐ │
│ │ Mã đơn         │ Phương thức│ Số tiền │ Trạng thái │ Lượt thử      │ Tạo lúc        │ │
│ │ 7K3M9Q2XH4TB   │ VNPay     │350.000 │ Thất bại   │ 2/3           │ 06/10 09:00    │ │
│ │ A93K...        │ COD       │180.000 │ Chờ thu    │ -             │ 06/10 08:30    │ │
│ └───────────────┴──────────┴────────┴───────────┴──────────────┴───────────────┘ │
│ Tổng 132    Trang 1/7   [Trước] [Sau]                                            │
└──────────────────────────────────────────────────────────────────────────────────┘
```

Mới nhất trước, 20 dòng mỗi trang. Không có ô tìm theo email, tên, điện thoại (SB-08). Bấm một dòng mở `admin-payment-detail`.

## Trạng thái
| Trạng thái | Trông ra sao | Requirement |
|---|---|---|
| đang tải | Khung xám đúng hình thanh lọc và 8 dòng bảng | PAY-REQ-20261006-103111211 |
| có dữ liệu | Bảng 20 dòng mới nhất trước kèm tổng số và phân trang | PAY-REQ-20261006-103111211 |
| rỗng | "Chưa có thanh toán nào" (không có bộ lọc) | PAY-REQ-20261006-103111211 |
| lọc không có kết quả | "Không có thanh toán khớp bộ lọc" kèm nút Xóa bộ lọc, `total` 0 | PAY-REQ-20261006-103111211 |
| lọc COD chờ thu | Lối tắt đang bật, bảng chỉ có Payment COD ở `pending` | PAY-REQ-20261006-103111211 |
| bộ lọc sai | 400: dòng lỗi dưới thanh lọc, giữ nguyên bảng cũ | PAY-REQ-20261006-103111211 |
| không có quyền | 403 (customer mở màn quản trị): "Bạn không có quyền xem trang này" (người thấy là customer, không phải role của màn) | PAY-REQ-20261006-103111211 |
| hết phiên | 401: thông báo "Phiên đã hết hạn" kèm nút Đăng nhập | PAY-REQ-20261006-103111211 |
| lỗi | Banner "Không tải được danh sách thanh toán." kèm Thử lại (lỗi mạng hoặc 5xx) | PAY-REQ-20261006-103111211 |

## Phần tử
| testid | Phần tử | Role | Hành động | Requirement |
|---|---|---|---|---|
| pay-admin-payment-list-filter-status | Chọn lọc theo trạng thái | staff, admin | Chọn trạng thái | PAY-REQ-20261006-103111211 |
| pay-admin-payment-list-filter-method | Chọn lọc theo phương thức | staff, admin | Chọn vnpay hoặc cod | PAY-REQ-20261006-103111211 |
| pay-admin-payment-list-filter-order-code | Ô nhập mã đơn (khớp chính xác) | staff, admin | Nhập mã đơn | PAY-REQ-20261006-103111211 |
| pay-admin-payment-list-filter-apply | Nút Lọc | staff, admin | Áp dụng bộ lọc | PAY-REQ-20261006-103111211 |
| pay-admin-payment-list-filter-clear | Nút Xóa bộ lọc | staff, admin | Xóa bộ lọc | PAY-REQ-20261006-103111211 |
| pay-admin-payment-list-filter-cod-pending | Lối tắt COD chờ thu | staff, admin | Lọc method cod và status pending | PAY-REQ-20261006-103111211 |
| pay-admin-payment-list-filter-error | Dòng lỗi bộ lọc sai | staff, admin | - | PAY-REQ-20261006-103111211 |
| pay-admin-payment-list-table | Bảng thanh toán | staff, admin | - | PAY-REQ-20261006-103111211 |
| pay-admin-payment-list-row | Một dòng thanh toán | staff, admin | Bấm để mở chi tiết | PAY-REQ-20261006-103111211 |
| pay-admin-payment-list-row-status | Nhãn trạng thái của dòng | staff, admin | - | PAY-REQ-20261006-103111211 |
| pay-admin-payment-list-pagination | Điều khiển phân trang | staff, admin | Đổi trang | PAY-REQ-20261006-103111211 |
| pay-admin-payment-list-total | Tổng số thanh toán | staff, admin | - | PAY-REQ-20261006-103111211 |
| pay-admin-payment-list-empty | Trạng thái rỗng | staff, admin | - | PAY-REQ-20261006-103111211 |
| pay-admin-payment-list-no-match | Trạng thái lọc không có kết quả | staff, admin | - | PAY-REQ-20261006-103111211 |
| pay-admin-payment-list-loading | Khung chờ | staff, admin | - | PAY-REQ-20261006-103111211 |
| pay-admin-payment-list-error | Banner lỗi toàn màn | staff, admin | - | PAY-REQ-20261006-103111211 |
| pay-admin-payment-list-retry | Nút Thử lại | staff, admin | Tải lại danh sách | PAY-REQ-20261006-103111211 |
| pay-admin-payment-list-forbidden | Thông báo không có quyền (403) | staff, admin | - | PAY-REQ-20261006-103111211 |
| pay-admin-payment-list-session-expired | Thông báo hết phiên (401) | staff, admin | Đi tới đăng nhập | PAY-REQ-20261006-103111211 |

## Ghi chú thiết kế (mặc định, chưa duyệt)
- Testid `pay-admin-payment-list-forbidden` ghi role của màn (staff, admin) dù người thấy nó là customer: giới hạn của `check-ui` (phần tử chỉ khai role nằm trong `roles` của màn); xem questions.md, mục lỗi của kit. E2E kiểm 403 bằng API hơn là bằng testid này.
- Điều hướng quản trị (menu) chỉ hiện mục Thanh toán cho staff và admin; việc ẩn menu chỉ là tiện lợi, quyền thật nằm ở server (SB-05).
- Lối tắt "COD chờ thu" liệt kê Payment COD `pending`: phần lớn là đơn chưa giao (PAY tự thu khi đơn giao xong, PAY-REQ-20261006-103110597 BR3); dòng của đơn đã `delivered` mà vẫn `pending` là ca bất thường cần ghi nhận tay ở màn chi tiết.
- Không có cột hay bộ lọc theo dữ liệu cá nhân (SB-08). Nhãn trạng thái bằng chữ, không chỉ màu.
- Không viết code giao diện; dựng thật là việc của `implement`.
