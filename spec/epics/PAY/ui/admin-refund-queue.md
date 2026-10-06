---
screen: admin-refund-queue
epic: PAY
status: draft
covers: [PAY-REQ-20261006-103111211, PAY-REQ-20261006-103111034]
roles: [staff, admin]
---
# Hàng đợi hoàn tiền (hoàn tiền thất bại cần xử lý)

Staff và admin xem mọi hoàn tiền; mặc định `failed` đứng trước để xử lý. Chỉ admin có nút Thử lại.

## Wireframe
Phương án đã chọn: **A** (bảng một trang, hoàn tiền thất bại đứng đầu, nút thử lại ngay trên dòng). **Đây là lựa chọn mặc định** (khuyến nghị theo `U3`), chưa có người dùng chọn.

| Phương án | Việc chính thấy ở đâu | Đổi gì | Đánh đổi |
|---|---|---|---|
| **A. Bảng, thất bại đứng đầu, nút thử lại trên dòng (khuyên dùng, đã chọn)** | Việc cần làm (thất bại) ngay đầu bảng | Admin xử lý nhanh không phải mở từng thanh toán | Nút tiền trên dòng cần xác nhận rõ |
| B. Thẻ Kanban theo trạng thái | Ba cột requested, succeeded, failed | Nhìn tổng quan | Không cần ở v1; danh sách lọc theo trạng thái đã đủ |
| C. Chỉ hiện trong chi tiết thanh toán | Không có màn riêng | Ít màn | Không có chỗ nhìn mọi hoàn tiền thất bại cùng lúc |

```
Thanh header:  ☰  Quản trị › Hoàn tiền                                          🔔  (A)
┌──────────────────────────────────────────────────────────────────────────────────┐
│ Trạng thái [Thất bại ▾]  [Lọc]                                                   │
│ ┌──────────────┬────────┬───────────────┬──────────┬───────────┬────────────────┐ │
│ │ Mã đơn        │ Số tiền │ Lý do           │ Trạng thái │ Lần tự thử │                │ │
│ │ 7K3M9Q2XH4TB  │350.000 │ Hủy đơn         │ Thất bại   │ 3/3        │ [Thử lại]      │ │  <- Thử lại chỉ admin
│ │ A93K...       │180.000 │ Thanh toán muộn │ Thành công │ 1/3        │                │ │
│ └──────────────┴────────┴───────────────┴──────────┴───────────┴────────────────┘ │
│ Tổng 14    Trang 1/1                                                             │
└──────────────────────────────────────────────────────────────────────────────────┘
```

Bấm mã đơn mở `admin-payment-detail`. Thử lại mở hộp thoại xác nhận ngắn (không có ô nhập).

## Trạng thái
| Trạng thái | Trông ra sao | Requirement |
|---|---|---|
| đang tải | Khung xám đúng hình thanh lọc và 6 dòng bảng | PAY-REQ-20261006-103111211 |
| có dữ liệu | Bảng mới nhất trước, `failed` đứng đầu kèm tổng số và phân trang | PAY-REQ-20261006-103111211 |
| rỗng | "Chưa có hoàn tiền nào" | PAY-REQ-20261006-103111211 |
| không có hoàn tiền thất bại | Lọc `failed` ra rỗng hiện "Không có hoàn tiền thất bại cần xử lý" | PAY-REQ-20261006-103111211 |
| bộ lọc sai | 400: dòng lỗi dưới thanh lọc, giữ bảng cũ | PAY-REQ-20261006-103111211 |
| không có quyền | 403 (customer mở màn quản trị): "Bạn không có quyền xem trang này" | PAY-REQ-20261006-103111211 |
| hết phiên | 401: "Phiên đã hết hạn" kèm nút Đăng nhập | PAY-REQ-20261006-103111211 |
| lỗi | Banner "Không tải được danh sách hoàn tiền." kèm Thử lại (lỗi mạng hoặc 5xx) | PAY-REQ-20261006-103111211 |
| nút thử lại ẩn | Nút Thử lại chỉ có với admin và chỉ trên Refund `failed` của Payment còn `succeeded`; staff không thấy | PAY-REQ-20261006-103111034 |
| hộp thoại thử lại | Hộp thoại "Thử lại hoàn tiền 350.000 đ cho đơn ...?" nêu không hoàn tác; nút Hủy và Xác nhận | PAY-REQ-20261006-103111034 |
| đang thử lại | Nút Xác nhận khóa với vòng xoay | PAY-REQ-20261006-103111034 |
| thử lại thành công | Hộp thoại đóng, chính dòng Refund đó chuyển sang `requested` hoặc `succeeded` (không thêm dòng mới), thông báo ngắn | PAY-REQ-20261006-103111034 |
| thử lại bị từ chối | Lỗi trong hộp thoại: 409 đang có hoàn tiền xử lý, 409 không thử lại được ở trạng thái này, 403 hoặc 401 khi hết quyền hoặc phiên, 429 quá nhanh | PAY-REQ-20261006-103111034 |

## Phần tử
| testid | Phần tử | Role | Hành động | Requirement |
|---|---|---|---|---|
| pay-admin-refund-queue-filter-status | Chọn lọc theo trạng thái hoàn tiền | staff, admin | Chọn requested, succeeded hoặc failed | PAY-REQ-20261006-103111211 |
| pay-admin-refund-queue-filter-apply | Nút Lọc | staff, admin | Áp dụng bộ lọc | PAY-REQ-20261006-103111211 |
| pay-admin-refund-queue-filter-error | Dòng lỗi bộ lọc sai | staff, admin | - | PAY-REQ-20261006-103111211 |
| pay-admin-refund-queue-table | Bảng hoàn tiền | staff, admin | - | PAY-REQ-20261006-103111211 |
| pay-admin-refund-queue-row | Một dòng hoàn tiền | staff, admin | - | PAY-REQ-20261006-103111211 |
| pay-admin-refund-queue-row-status | Nhãn trạng thái của dòng | staff, admin | - | PAY-REQ-20261006-103111211 |
| pay-admin-refund-queue-order-link | Mã đơn của dòng | staff, admin | Mở chi tiết thanh toán | PAY-REQ-20261006-103111211 |
| pay-admin-refund-queue-pagination | Điều khiển phân trang | staff, admin | Đổi trang | PAY-REQ-20261006-103111211 |
| pay-admin-refund-queue-total | Tổng số hoàn tiền | staff, admin | - | PAY-REQ-20261006-103111211 |
| pay-admin-refund-queue-empty | Trạng thái rỗng | staff, admin | - | PAY-REQ-20261006-103111211 |
| pay-admin-refund-queue-no-failed | Trạng thái không có hoàn tiền thất bại | staff, admin | - | PAY-REQ-20261006-103111211 |
| pay-admin-refund-queue-loading | Khung chờ | staff, admin | - | PAY-REQ-20261006-103111211 |
| pay-admin-refund-queue-error | Banner lỗi toàn màn | staff, admin | - | PAY-REQ-20261006-103111211 |
| pay-admin-refund-queue-retry | Nút Thử lại tải danh sách | staff, admin | Tải lại danh sách | PAY-REQ-20261006-103111211 |
| pay-admin-refund-queue-forbidden | Thông báo không có quyền (403) | staff, admin | - | PAY-REQ-20261006-103111211 |
| pay-admin-refund-queue-session-expired | Thông báo hết phiên (401) | staff, admin | Đi tới đăng nhập | PAY-REQ-20261006-103111211 |
| pay-admin-refund-queue-refund-retry | Nút Thử lại của dòng Refund thất bại | admin | Mở hộp thoại thử lại | PAY-REQ-20261006-103111034 |
| pay-admin-refund-queue-retry-dialog | Hộp thoại xác nhận thử lại | admin | - | PAY-REQ-20261006-103111034 |
| pay-admin-refund-queue-retry-confirm | Nút Xác nhận thử lại | admin | Gọi thử lại hoàn tiền | PAY-REQ-20261006-103111034 |
| pay-admin-refund-queue-retry-dismiss | Nút Hủy trong hộp thoại | admin | Đóng hộp thoại | PAY-REQ-20261006-103111034 |
| pay-admin-refund-queue-retry-error | Vùng lỗi trong hộp thoại thử lại | admin | - | PAY-REQ-20261006-103111034 |
| pay-admin-refund-queue-retry-success | Thông báo thử lại đã gửi | admin | - | PAY-REQ-20261006-103111034 |

## Ghi chú thiết kế (mặc định, chưa duyệt)
- Nút Thử lại chỉ có với admin (PAY-REQ-20261006-103111034 BR1); staff chỉ xem. API trả 403 cho staff dù giao diện đã ẩn.
- Lý do hiển thị bằng chữ từ mã cố định (`order_cancelled`, `order_expired`, `late_payment`, `duplicate_payment`, `admin_manual`); không hiển thị mã lỗi gốc của cổng (chỉ có ở chi tiết).
- Cột "Lần tự thử" cho admin biết khi nào hết 3 lần tự động (PAY-REQ-20261006-103110946 BR5) và cần thử tay.
- Không viết code giao diện; dựng thật là việc của `implement`.
