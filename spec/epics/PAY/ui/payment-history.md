---
screen: payment-history
epic: PAY
status: draft
covers: [PAY-REQ-20261006-103111122]
roles: [customer]
---
# Lịch sử thanh toán của tôi

Danh sách và chi tiết thanh toán của customer (own). Dùng cùng API với màn `order-payment` nhưng khác việc: ở đây khách tra cứu lại, không thanh toán.

## Wireframe
Phương án đã chọn: **A** (danh sách một cột có bộ lọc, bấm một dòng mở khung chi tiết bên phải). **Đây là lựa chọn mặc định** (khuyến nghị theo `U3`), chưa có người dùng chọn.

| Phương án | Việc chính thấy ở đâu | Đổi gì | Đánh đổi |
|---|---|---|---|
| **A. Danh sách cộng khung chi tiết bên phải (khuyên dùng, đã chọn)** | Dòng thanh toán ở trái, chi tiết (lượt thử, hoàn tiền) ở phải | Không rời trang khi xem nhiều thanh toán | Cần khung từ 70rem, hẹp hơn thì chi tiết thành trang riêng |
| B. Danh sách rồi trang chi tiết riêng | Mỗi lần xem một trang | Đơn giản, hợp màn hẹp | Mất bối cảnh danh sách mỗi lần quay lại |
| C. Dòng mở rộng tại chỗ (accordion) | Chi tiết ngay dưới dòng | Không có khung phụ | Danh sách dài và nhảy vị trí khi mở nhiều dòng |

```
Thanh header:  ☰  Tài khoản › Lịch sử thanh toán                              🔔  (T)
┌──────────────────────────────────────────────────────────────────────────────────┐
│ Trạng thái [Tất cả ▾]   Mã đơn [____________] [Lọc]                              │
│ ┌ Danh sách ────────────────────────────────────┐ ┌ Chi tiết thanh toán ────────┐│
│ │ Đơn #7K3M9Q2XH4TB  VNPay  350.000 đ  Thất bại │ │ Đơn #7K3M9Q2XH4TB          ││
│ │ Đơn #A93K...      COD    180.000 đ  Chờ thu  │ │ 350.000 đ · VNPay · Thất bại ││
│ │ Đơn #B71Q...      VNPay  920.000 đ  Đã hoàn  │ │ Các lượt thử                 ││
│ │ ...                                           │ │  Lượt 1 Thất bại (bị từ chối)││
│ │ Trang 1/2   [Trước] [Sau]                     │ │ Hoàn tiền                    ││
│ └───────────────────────────────────────────────┘ │  Chưa có                     ││
│                                                    │ [Thử thanh toán lại]         ││  <- chỉ khi can_retry
│                                                    └──────────────────────────────┘│
└──────────────────────────────────────────────────────────────────────────────────┘
```

Mới nhất trước, 20 dòng mỗi trang (ADR-006). Nút Thử thanh toán lại chỉ là liên kết sang màn `order-payment` của đơn đó (hành động tiền ở đúng một màn).

## Trạng thái
| Trạng thái | Trông ra sao | Requirement |
|---|---|---|
| đang tải | Khung xám 5 dòng danh sách và khung chi tiết | PAY-REQ-20261006-103111122 |
| có dữ liệu | Tối đa 20 dòng mới nhất trước: mã đơn, phương thức, số tiền, trạng thái, ngày; tổng số và phân trang | PAY-REQ-20261006-103111122 |
| rỗng | "Bạn chưa có thanh toán nào" kèm nút Mua sắm | PAY-REQ-20261006-103111122 |
| lọc không có kết quả | "Không có thanh toán khớp bộ lọc" kèm nút Xóa bộ lọc; gồm cả lọc theo mã đơn của người khác (rỗng, không báo lỗi quyền) | PAY-REQ-20261006-103111122 |
| trang vượt quá | Trang vượt tổng số trang hiện danh sách rỗng và nút Về trang 1 | PAY-REQ-20261006-103111122 |
| chi tiết đã chọn | Khung phải hiện lượt thử (số thứ tự, trạng thái, lý do bằng câu dễ hiểu) và hoàn tiền theo thời gian; không có mã giao dịch cổng | PAY-REQ-20261006-103111122 |
| chi tiết có thể thử lại | Có liên kết "Thử thanh toán lại" sang màn thanh toán khi `can_retry` hoặc `can_initiate` | PAY-REQ-20261006-103111122 |
| chi tiết không tìm thấy | Khung phải báo "Không tìm thấy thanh toán" (404, giống nhau cho của người khác và không tồn tại) | PAY-REQ-20261006-103111122 |
| bộ lọc sai | 400: dòng lỗi dưới ô lọc, giữ nguyên danh sách hiện có | PAY-REQ-20261006-103111122 |
| hết phiên | 401: thông báo "Phiên đã hết hạn" kèm nút Đăng nhập | PAY-REQ-20261006-103111122 |
| lỗi | Banner "Không tải được lịch sử thanh toán." kèm Thử lại (lỗi mạng hoặc 5xx) | PAY-REQ-20261006-103111122 |

## Phần tử
| testid | Phần tử | Role | Hành động | Requirement |
|---|---|---|---|---|
| pay-payment-history-filter-status | Chọn lọc theo trạng thái | customer | Chọn trạng thái | PAY-REQ-20261006-103111122 |
| pay-payment-history-filter-order-code | Ô nhập mã đơn (khớp chính xác) | customer | Nhập mã đơn | PAY-REQ-20261006-103111122 |
| pay-payment-history-filter-apply | Nút Lọc | customer | Áp dụng bộ lọc | PAY-REQ-20261006-103111122 |
| pay-payment-history-filter-clear | Nút Xóa bộ lọc | customer | Xóa bộ lọc | PAY-REQ-20261006-103111122 |
| pay-payment-history-filter-error | Dòng lỗi bộ lọc sai | customer | - | PAY-REQ-20261006-103111122 |
| pay-payment-history-list | Danh sách thanh toán | customer | - | PAY-REQ-20261006-103111122 |
| pay-payment-history-row | Một dòng thanh toán | customer | Bấm để mở chi tiết | PAY-REQ-20261006-103111122 |
| pay-payment-history-row-status | Nhãn trạng thái của dòng | customer | - | PAY-REQ-20261006-103111122 |
| pay-payment-history-pagination | Điều khiển phân trang | customer | Đổi trang | PAY-REQ-20261006-103111122 |
| pay-payment-history-total | Tổng số thanh toán | customer | - | PAY-REQ-20261006-103111122 |
| pay-payment-history-detail | Khung chi tiết | customer | - | PAY-REQ-20261006-103111122 |
| pay-payment-history-detail-attempt | Một lượt thử trong chi tiết | customer | - | PAY-REQ-20261006-103111122 |
| pay-payment-history-detail-refund | Một hoàn tiền trong chi tiết | customer | - | PAY-REQ-20261006-103111122 |
| pay-payment-history-detail-pay-link | Liên kết Thử thanh toán lại sang màn thanh toán | customer | Mở màn `order-payment` | PAY-REQ-20261006-103111122 |
| pay-payment-history-detail-notfound | Khung chi tiết không tìm thấy | customer | - | PAY-REQ-20261006-103111122 |
| pay-payment-history-empty | Trạng thái rỗng | customer | - | PAY-REQ-20261006-103111122 |
| pay-payment-history-empty-shop | Nút Mua sắm trong trạng thái rỗng | customer | Về trang sản phẩm | PAY-REQ-20261006-103111122 |
| pay-payment-history-no-match | Trạng thái lọc không có kết quả | customer | - | PAY-REQ-20261006-103111122 |
| pay-payment-history-page-reset | Nút Về trang 1 khi trang vượt quá | customer | Về trang 1 | PAY-REQ-20261006-103111122 |
| pay-payment-history-loading | Khung chờ | customer | - | PAY-REQ-20261006-103111122 |
| pay-payment-history-error | Banner lỗi toàn màn | customer | - | PAY-REQ-20261006-103111122 |
| pay-payment-history-retry | Nút Thử lại | customer | Tải lại danh sách | PAY-REQ-20261006-103111122 |
| pay-payment-history-session-expired | Thông báo hết phiên (401) | customer | Đi tới đăng nhập | PAY-REQ-20261006-103111122 |

## Ghi chú thiết kế (mặc định, chưa duyệt)
- **Báo trước theo skill evon:** màn phía người mua trong cửa hàng online chưa được skill dạy; phần danh sách và bộ lọc theo mẫu bảng đã duyệt của evon.
- Không có hành động tiền ở màn này (chỉ liên kết sang `order-payment`) để chỉ một chỗ chứa nút gây tiền.
- Không hiển thị mã giao dịch của cổng hay mã lỗi gốc (PAY-REQ-20261006-103111122 BR4); khách cần hỗ trợ thì đọc mã đơn cho nhân viên.
- Nhãn trạng thái bằng chữ, không chỉ màu. Phân trang theo `page`, `limit` (ADR-006).
- Không viết code giao diện; dựng thật là việc của `implement`.
