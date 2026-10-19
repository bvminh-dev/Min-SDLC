---
screen: sale-order-list
epic: SAL
status: approved
covers: [SAL-REQ-20261015-092711222, SAL-REQ-20261015-092710847]
roles: [sale, admin]
---
# Đơn của tôi: danh sách đơn hộ (sale thấy đơn mình tạo, admin thấy mọi đơn hộ)

Đường dẫn: `/sales/orders`. Bọc bằng `RequireRole roles=[sale, admin]`. Bộ lọc và trang nằm trên URL (`?status=&source=&code=&created_by=&page=`).

## Wireframe
Phương án đã chọn: **A** (bảng dữ liệu một khối với hàng tab trạng thái, ô chọn nguồn và ô tìm mã đơn). **Đây là lựa chọn mặc định** (khuyến nghị theo `U3`, giống `order-admin-list` của ORD), chưa có người dùng chọn.

| Phương án | Việc chính thấy ở đâu | Đổi gì | Đánh đổi |
|---|---|---|---|
| **A. Bảng dữ liệu: mã đơn, khách, nguồn, trạng thái, tổng trên một hàng (khuyên dùng, đã chọn)** | Sale tìm đơn theo mã hoặc trạng thái rồi mở xem | Tab trạng thái, chọn nguồn, tìm mã đứng trên bảng; tái dùng khung của `OrderList` | Bố cục dày, hợp màn làm việc cả ngày; dưới `sm` thành danh sách dòng |
| B. Thẻ đơn (card) mỗi đơn một thẻ | Xem nhanh ghi chú, khách | Ít cột hơn | Mỗi thẻ cao, ít đơn trên một màn; sale có nhiều đơn mỗi ngày |
| C. Danh sách hai cột kèm panel chi tiết | Chọn đơn trái, xem phải | Không rời trang | Cần gọi chi tiết từng dòng; chật khi có sidebar |

Lý do chọn A: việc chính là tìm lại đơn mình đã tạo (theo mã, theo trạng thái, theo nguồn) để trả lời khách (SAL-REQ-20261015-092711222); khách (họ tên, điện thoại) phải nhìn thấy ngay trên hàng vì sale nhớ đơn theo khách.

```
Thanh header:  ☰  Đơn của tôi                         [ + Tạo đơn hộ ]              🔔  (A)
┌──────────────────────────────────────────────────────────────────────────────────────────┐
│ [Tất cả] Đã xác nhận  Đang giao  Đã giao  Đã hoàn  Đã hủy  ...                          │
│ [ Nguồn: Tất cả ▾ ]  [ Người tạo: Tất cả ▾ ] (chỉ admin)  [ Tìm theo mã đơn      ]      │
├──────────────────────────────────────────────────────────────────────────────────────────┤
│ Mã đơn           Ngày tạo     Khách              Nguồn     Trạng thái  Thanh toán   Tổng │
│ HD261015-00003   15/10 10:12  Nguyễn An 0901234567 Facebook (Đã xác nhận) COD · Chưa thu 330.000 đ │
│ HD261014-00021   14/10 16:40  Trần Bình 0912345678 TikTok   (Đã hủy)     CK · Chưa thu  90.000 đ │
├──────────────────────────────────────────────────────────────────────────────────────────┤
│ 1 tới 20 trong 25 đơn                                                    ‹ 1 2 ›         │
└──────────────────────────────────────────────────────────────────────────────────────────┘
Hàng bấm được mở chi tiết đơn hộ. Admin thêm cột "Người tạo". Không nút sửa, hủy ở màn này.
```

## Trạng thái
| Trạng thái | Trông ra sao | Requirement | testid |
|---|---|---|---|
| có dữ liệu | 20 dòng mới nhất trước, tổng số đơn ở chân, tab, nguồn và ô tìm giữ giá trị đang dùng | SAL-REQ-20261015-092711222 | sal-sale-order-list-summary |
| đang tải | Khung chờ đúng hình hàng bảng; đổi lọc hay trang thì giữ dữ liệu cũ | SAL-REQ-20261015-092711222 | sal-sale-order-list-loading |
| rỗng | "Bạn chưa tạo đơn hộ nào." kèm nút Tạo đơn hộ (admin: "Chưa có đơn hộ nào.") | SAL-REQ-20261015-092711222 | sal-sale-order-list-empty |
| rỗng do tìm hoặc lọc | "Không có đơn nào khớp." kèm nút Xoá lọc; tìm mã đơn của người khác, đơn khách tự đặt hay mã không tồn tại cùng vào đây (không phân biệt, SB-44); trang 2 khi đúng 20 đơn cũng rỗng | SAL-REQ-20261015-092711222 | sal-sale-order-list-empty-filtered |
| lỗi | Banner "Không tải được danh sách đơn." kèm Thử lại; bộ lọc không hợp lệ (400) cũng vào đây | SAL-REQ-20261015-092711222 | sal-sale-order-list-error |
| quá giới hạn tần suất | "Thao tác quá nhanh, tự tải lại sau N giây" (429), nút Thử lại bấm được ngay | SAL-REQ-20261015-092711222 | sal-sale-order-list-rate-limited |
| hết phiên đăng nhập | "Phiên đăng nhập đã hết hạn" kèm liên kết Đăng nhập (401) | SAL-REQ-20261015-092711222 | sal-sale-order-list-login-expired |
| không có quyền | Customer hoặc staff mở màn này thấy trang "Không có quyền" của nền (403) | SAL-REQ-20261015-092711222 | - |
| trạng thái đơn | Badge trạng thái (tám trạng thái), nhãn đọc rõ không chỉ bằng màu | SAL-REQ-20261015-092711222 | sal-sale-order-list-status-badge |

## Phần tử
| testid | Phần tử | Role | Hành động | Requirement |
|---|---|---|---|---|
| sal-sale-order-list-new | Nút Tạo đơn hộ | sale, admin | Mở màn tạo đơn hộ | SAL-REQ-20261015-092710847 |
| sal-sale-order-list-status-filter | Hàng tab lọc trạng thái | sale, admin | Chọn một trạng thái hoặc Tất cả | SAL-REQ-20261015-092711222 |
| sal-sale-order-list-source-filter | Ô chọn nguồn đơn (gồm nguồn đã tắt) | sale, admin | Lọc theo nguồn | SAL-REQ-20261015-092711222 |
| sal-sale-order-list-created-by-filter | Ô chọn người tạo (sale) | admin | Lọc theo sale | SAL-REQ-20261015-092711222 |
| sal-sale-order-list-search | Ô tìm theo mã đơn (chấp nhận `-`) | sale, admin | Nhập mã đơn rồi tìm | SAL-REQ-20261015-092711222 |
| sal-sale-order-list-clear-filter | Nút Xoá lọc (chỉ khi đang lọc hoặc tìm) | sale, admin | Gỡ lọc và từ khoá | SAL-REQ-20261015-092711222 |
| sal-sale-order-list-row | Hàng đơn | sale, admin | Bấm để mở chi tiết | SAL-REQ-20261015-092711222 |
| sal-sale-order-list-code | Mã đơn (font-mono) | sale, admin | - | SAL-REQ-20261015-092711222 |
| sal-sale-order-list-created-at | Ngày tạo | sale, admin | - | SAL-REQ-20261015-092711222 |
| sal-sale-order-list-customer | Họ tên và điện thoại khách | sale, admin | - | SAL-REQ-20261015-092711222 |
| sal-sale-order-list-source | Nguồn đơn | sale, admin | - | SAL-REQ-20261015-092711222 |
| sal-sale-order-list-created-by | Người tạo | admin | - | SAL-REQ-20261015-092711222 |
| sal-sale-order-list-status-badge | Badge trạng thái đơn | sale, admin | - | SAL-REQ-20261015-092711222 |
| sal-sale-order-list-payment | Phương thức và trạng thái thanh toán (COD, Tiền mặt, Chuyển khoản) | sale, admin | - | SAL-REQ-20261015-092711222 |
| sal-sale-order-list-total | Tổng tiền, căn phải | sale, admin | - | SAL-REQ-20261015-092711222 |
| sal-sale-order-list-summary | Dòng "1 tới 20 trong 25 đơn" | sale, admin | - | SAL-REQ-20261015-092711222 |
| sal-sale-order-list-pagination | Phân trang ‹ 1 2 3 › (ẩn khi một trang) | sale, admin | Sang trang khác | SAL-REQ-20261015-092711222 |
| sal-sale-order-list-loading | Khung chờ | sale, admin | - | SAL-REQ-20261015-092711222 |
| sal-sale-order-list-empty | Vùng rỗng, chưa có đơn hộ | sale, admin | - | SAL-REQ-20261015-092711222 |
| sal-sale-order-list-empty-filtered | Vùng rỗng do tìm hoặc lọc | sale, admin | - | SAL-REQ-20261015-092711222 |
| sal-sale-order-list-error | Banner lỗi | sale, admin | - | SAL-REQ-20261015-092711222 |
| sal-sale-order-list-retry | Nút Thử lại | sale, admin | Tải lại danh sách | SAL-REQ-20261015-092711222 |
| sal-sale-order-list-rate-limited | Thông báo quá giới hạn tần suất | sale, admin | - | SAL-REQ-20261015-092711222 |
| sal-sale-order-list-login-expired | Thông báo hết phiên kèm liên kết Đăng nhập | sale, admin | Đăng nhập lại | SAL-REQ-20261015-092711222 |

## Ghi chú thiết kế (mặc định, chưa duyệt)
- **Dùng lại** khung của `components/OrderList.tsx` (bộ lọc và trang trên URL bằng `useQueryGo`, ô tìm chờ 300 ms, `useCountdown` cho 429, `Pager`, nhãn `ORDER_STATUS_LABEL`, `formatOrderTime`, `formatPrice`): thêm biến thể `sales` (đường dẫn gọi `GET /sales/orders`, hàng mở `/sales/orders/{code}`, cột Khách, Nguồn, và Người tạo cho admin, khóa test tiền tố `sal-sale-order-list`). Danh sách nguồn cho ô chọn lấy từ `GET /order-sources` cộng các nguồn đã có trong kết quả; danh sách người tạo (admin) lấy từ cột người tạo của trang hiện có (không có endpoint liệt kê sale ở v1).
- Ô tìm đổi mã sang chữ hoa, tối đa 32 ký tự, giữ `-` (SAL-REQ-20261015-092711222 BR2). Nhãn thanh toán: "COD", "Tiền mặt", "Chuyển khoản" kèm "Chưa thu" hay trạng thái do `payment_status`; không bao giờ chữ "đã thanh toán" cho đơn chưa có Payment thành công.
- Sale không thấy cột Người tạo và ô chọn người tạo (chỉ admin); sale gửi `created_by` là 400 nên giao diện không gửi tham số đó cho sale.
- Cột tiền dùng `tabular-nums`, trống là `—`. Dưới `@4xl` ẩn cột Ngày tạo và Thanh toán, dưới `sm` thành danh sách dòng theo `list-row.md`.
