---
screen: sale-order-detail
epic: SAL
status: approved
covers: [SAL-REQ-20261015-092711321]
roles: [sale, admin]
---
# Chi tiết đơn hộ (sale xem đơn mình tạo, admin xem mọi đơn hộ)

Đường dẫn: `/sales/orders/{code}`. Bọc bằng `RequireRole roles=[sale, admin]`. Chỉ đọc: không có nút sửa hay hủy đơn (SAL-REQ-20261015-092711321 BR6).

## Wireframe
Phương án đã chọn: **A** (một cột các khối thông tin xếp dọc: tiêu đề kèm trạng thái, khách và địa chỉ giao, bảng dòng hàng, tổng tiền). **Đây là lựa chọn mặc định** (khuyến nghị theo `U3`, giống `order-detail` của ORD), chưa có người dùng chọn.

| Phương án | Việc chính thấy ở đâu | Đổi gì | Đánh đổi |
|---|---|---|---|
| **A. Một cột các khối xếp dọc (khuyên dùng, đã chọn)** | Mã đơn, trạng thái, nguồn trên cùng; khách và địa chỉ rồi hàng và tổng | Đọc từ trên xuống như phiếu giao; nhất quán với chi tiết đơn của khách | Trang dài khi nhiều dòng hàng |
| B. Hai cột: khách và giao bên trái, hàng bên phải | Thấy khách và hàng cùng lúc | Ít cuộn | Chật dưới `lg`; khác `order-detail` |
| C. Tab Thông tin, Hàng, Ghi chú | Mỗi tab một nhóm | Gọn | Ghi chú đơn và ghi chú dòng bị ẩn sau tab; sale hay cần đọc ngay ghi chú để trả lời khách |

Lý do chọn A: sale mở đơn để kiểm tra khách, địa chỉ và ghi chú có đúng ý khách không trước khi trả lời khách (SAL-REQ-20261015-092711321); ghi chú đơn và ghi chú dòng phải luôn thấy.

```
Thanh header:  ☰  Đơn HD261015-00003                                              🔔  (A)
[ ← Đơn của tôi ]
┌──────────────────────────────────────────────────────────────────────────────┐
│ HD261015-00003   (Đã xác nhận)   Tạo 15/10/2026 10:12 · Nguồn: Facebook      │
│ Người tạo: Lê Hoa (chỉ admin)                                                 │
│ Thanh toán: COD · Chưa thu tiền                                               │
├──────────────────────────────────────────────────────────────────────────────┤
│ Khách: Nguyễn An · 0901234567 · (Đã gắn tài khoản khách)                      │
│ Giao tới: Nguyễn An · 0901234567                                              │
│   45 Nguyễn Huệ, Bến Nghé, Quận 1, Hồ Chí Minh                                │
│ Ghi chú đơn: Giao giờ hành chính                                              │
├──────────────────────────────────────────────────────────────────────────────┤
│ Sản phẩm          SL    Đơn giá      Thành tiền                               │
│ Áo thun cotton     2   150.000 đ    300.000 đ                                 │
│   Ghi chú: size M, màu xanh                                                   │
├──────────────────────────────────────────────────────────────────────────────┤
│ Tạm tính 300.000 đ · Phí vận chuyển 30.000 đ · Tổng cộng 330.000 đ            │
│ (Đã hủy: Lý do hủy hiện ở đây)                                                │
└──────────────────────────────────────────────────────────────────────────────┘
Không cột giá vốn. Không nút Hủy, Sửa.
```

## Trạng thái
| Trạng thái | Trông ra sao | Requirement | testid |
|---|---|---|---|
| có dữ liệu | Đủ các khối: tiêu đề, khách, địa chỉ giao, ghi chú đơn, dòng hàng kèm ghi chú, tổng tiền | SAL-REQ-20261015-092711321 | sal-sale-order-detail-container |
| đang tải | Khung chờ đúng hình các khối | SAL-REQ-20261015-092711321 | sal-sale-order-detail-loading |
| không tìm thấy | "Không tìm thấy đơn này." (404 chung: đơn của sale khác, không tồn tại, mã sai, đơn khách tự đặt) kèm liên kết về Đơn của tôi; không phân biệt các lý do | SAL-REQ-20261015-092711321 | sal-sale-order-detail-not-found |
| lỗi | Banner "Không tải được đơn." kèm Thử lại | SAL-REQ-20261015-092711321 | sal-sale-order-detail-error |
| quá giới hạn tần suất | "Thao tác quá nhanh, tự tải lại sau N giây" (429), nút Thử lại bấm được ngay | SAL-REQ-20261015-092711321 | sal-sale-order-detail-rate-limited |
| hết phiên đăng nhập | "Phiên đăng nhập đã hết hạn" kèm liên kết Đăng nhập (401) | SAL-REQ-20261015-092711321 | sal-sale-order-detail-login-expired |
| không có quyền | Customer hoặc staff mở màn này thấy trang "Không có quyền" của nền (403) | SAL-REQ-20261015-092711321 | - |
| đơn đã hủy | Badge "Đã hủy" kèm lý do hủy bằng nhãn cố định (do admin, hệ thống); vẫn xem được | SAL-REQ-20261015-092711321 | sal-sale-order-detail-cancel-reason |
| không có ghi chú | Dòng "Không có ghi chú" mờ cho ghi chú đơn; dòng hàng không có ghi chú thì không hiện dòng ghi chú | SAL-REQ-20261015-092711321 | sal-sale-order-detail-note-empty |

## Phần tử
| testid | Phần tử | Role | Hành động | Requirement |
|---|---|---|---|---|
| sal-sale-order-detail-container | Vùng nội dung đơn | sale, admin | - | SAL-REQ-20261015-092711321 |
| sal-sale-order-detail-back | Liên kết về Đơn của tôi | sale, admin | Quay lại danh sách | SAL-REQ-20261015-092711321 |
| sal-sale-order-detail-code | Mã đơn (font-mono) | sale, admin | - | SAL-REQ-20261015-092711321 |
| sal-sale-order-detail-status | Badge trạng thái đơn | sale, admin | - | SAL-REQ-20261015-092711321 |
| sal-sale-order-detail-created-at | Thời điểm tạo (giờ Việt Nam) | sale, admin | - | SAL-REQ-20261015-092711321 |
| sal-sale-order-detail-source | Nguồn đơn | sale, admin | - | SAL-REQ-20261015-092711321 |
| sal-sale-order-detail-created-by | Người tạo | admin | - | SAL-REQ-20261015-092711321 |
| sal-sale-order-detail-payment | Phương thức và trạng thái thanh toán | sale, admin | - | SAL-REQ-20261015-092711321 |
| sal-sale-order-detail-customer | Họ tên và điện thoại khách | sale, admin | - | SAL-REQ-20261015-092711321 |
| sal-sale-order-detail-has-account | Nhãn "Đã gắn tài khoản khách" | sale, admin | - | SAL-REQ-20261015-092711321 |
| sal-sale-order-detail-address | Địa chỉ giao (người nhận, điện thoại, địa chỉ) | sale, admin | - | SAL-REQ-20261015-092711321 |
| sal-sale-order-detail-note | Ghi chú đơn (văn bản thuần, đã thoát) | sale, admin | - | SAL-REQ-20261015-092711321 |
| sal-sale-order-detail-note-empty | Dòng "Không có ghi chú" | sale, admin | - | SAL-REQ-20261015-092711321 |
| sal-sale-order-detail-item | Dòng hàng | sale, admin | - | SAL-REQ-20261015-092711321 |
| sal-sale-order-detail-item-note | Ghi chú của dòng hàng (văn bản thuần, đã thoát) | sale, admin | - | SAL-REQ-20261015-092711321 |
| sal-sale-order-detail-items-total | Tạm tính | sale, admin | - | SAL-REQ-20261015-092711321 |
| sal-sale-order-detail-shipping-fee | Phí vận chuyển | sale, admin | - | SAL-REQ-20261015-092711321 |
| sal-sale-order-detail-grand-total | Tổng cộng | sale, admin | - | SAL-REQ-20261015-092711321 |
| sal-sale-order-detail-cancel-reason | Lý do hủy (chỉ khi đã hủy) | sale, admin | - | SAL-REQ-20261015-092711321 |
| sal-sale-order-detail-loading | Khung chờ | sale, admin | - | SAL-REQ-20261015-092711321 |
| sal-sale-order-detail-not-found | Vùng không tìm thấy đơn | sale, admin | - | SAL-REQ-20261015-092711321 |
| sal-sale-order-detail-error | Banner lỗi | sale, admin | - | SAL-REQ-20261015-092711321 |
| sal-sale-order-detail-retry | Nút Thử lại | sale, admin | Tải lại đơn | SAL-REQ-20261015-092711321 |
| sal-sale-order-detail-rate-limited | Thông báo quá giới hạn tần suất | sale, admin | - | SAL-REQ-20261015-092711321 |
| sal-sale-order-detail-login-expired | Thông báo hết phiên kèm liên kết Đăng nhập | sale, admin | Đăng nhập lại | SAL-REQ-20261015-092711321 |

## Ghi chú thiết kế (mặc định, chưa duyệt)
- **Dùng lại** khung và định dạng của `app/orders/[code]/page.tsx` và `lib/order.ts` (`ORDER_STATUS_LABEL`, `formatOrderTime`, `reasonText` cho lý do hủy, `formatPrice`): thêm trang `app/sales/orders/[code]` gọi `GET /sales/orders/{code}`. Không dùng khối lịch sử trạng thái, thanh toán VNPay hay nút hủy của khách.
- Ghi chú đơn và ghi chú dòng hiển thị bằng chữ thường (React thoát mặc định; không `dangerouslySetInnerHTML`; giữ xuống dòng bằng `white-space: pre-wrap`), đúng SB-12, SB-45.
- Không có cột hay ô giá vốn (SB-42). Không hiện `user_id`, email khách.
- Nhãn thanh toán: "COD", "Tiền mặt", "Chuyển khoản" kèm "Chưa thu tiền" khi `payment_status` chưa thành công.
