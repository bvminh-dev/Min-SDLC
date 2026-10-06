---
screen: shipment-tracking
epic: SHP
status: draft
covers: [SHP-REQ-20261006-101103927, SHP-REQ-20261006-101103972]
roles: [customer]
---
# Theo dõi vận chuyển (customer xem vận đơn của đơn mình)

## Wireframe
Phương án đã chọn: **A** (một trang theo dõi: thanh tiến trình ba bước ở trên, thông tin mã vận đơn và phương thức, rồi hành trình chi tiết). **Đây là lựa chọn mặc định** (khuyến nghị theo `U3`), chưa có người dùng chọn: các cổng "duyệt brief", "xác nhận danh sách màn" và "chọn wireframe" không hỏi được ở lần chạy này.

| Phương án | Việc chính thấy ở đâu | Đổi gì | Đánh đổi |
|---|---|---|---|
| **A. Trang riêng có thanh tiến trình và hành trình (khuyên dùng, đã chọn)** | Bước hiện tại trên thanh tiến trình, mã vận đơn ngay dưới | Khách thấy "đang ở đâu" trước, chi tiết sau | Thêm một trang nối từ chi tiết đơn của ORD (link ở `ord-order-detail-tracking`, ORD cần thêm liên kết) |
| B. Khối thu gọn ngay trong trang chi tiết đơn | Một thẻ nhỏ trong trang đơn | Không thêm trang | Màn ORD là của epic khác (không sửa ở đây); thẻ nhỏ khó chứa hành trình đầy đủ |
| C. Chỉ hiện mã vận đơn và nút sang trang hãng | Mã và liên kết ngoài | Đơn giản nhất | Phải tin vào trang hãng; không có hành trình do shop ghi, không biết giao thất bại |

Lý do chọn A: khách vào màn này chỉ để biết hàng đã đi chưa, mã vận đơn là gì và đã giao chưa; ba bước (Đã tạo, Đang giao, Đã giao) là đủ, hành trình chi tiết đọc sau nếu cần.

```
Thanh header:  ☰  Đơn hàng của tôi › #7K3M9Q2XH4TB › Vận chuyển            🔔  (C)
┌──────────────────────────────────────────────────────────────────────────┐
│ ← Quay lại đơn hàng                                                      │
│ Vận chuyển đơn #7K3M9Q2XH4TB                         (Đang giao)         │
│                                                                          │
│  ● Đã tạo ───────── ● Đang giao ───────── ○ Đã giao                      │  <- thanh tiến trình
│                                                                          │
│ ┌ Thông tin ──────────────────────────────────────────────────────────┐ │
│ │ Phương thức   Giao tiêu chuẩn                                       │ │
│ │ Mã vận đơn    GHN12345678  [Sao chép]                               │ │
│ │ Bàn giao      06/10/2026 10:00                                      │ │
│ └─────────────────────────────────────────────────────────────────────┘ │
│ ┌ Hành trình ─────────────────────────────────────────────────────────┐ │
│ │ ○ 06/10 09:05  Đã tạo vận đơn                                       │ │
│ │ │                                                                   │ │
│ │ ○ 06/10 10:00  Đã bàn giao cho đơn vị vận chuyển · GHN12345678      │ │
│ └─────────────────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────────────┘
Đơn chưa có vận đơn: thay phần trên bằng một dòng "Đơn chưa được bàn giao cho vận chuyển."
Giao thất bại: dòng báo "Giao hàng chưa thành công. Shop sẽ liên hệ với bạn." (không nêu lý do nội bộ)
```

Thứ tự hành trình: cũ nhất trước theo SHP-REQ-20261006-101103972 BR5 (mặc định chưa được xác nhận). **Lưu ý khác biệt với evon:** mẫu `timeline.md` đặt mới nhất ở trên; màn này theo requirement (requirement thắng), nếu người dùng chọn mới nhất trước thì đổi cả requirement lẫn màn. Thanh tiến trình ba bước mượn khuôn các bước của `layouts/form.md`. Mã vận đơn `font-mono`; giờ `tabular-nums`.

## Trạng thái
| Trạng thái | Trông ra sao | Requirement |
|---|---|---|
| có dữ liệu | Thanh tiến trình, thẻ Thông tin, thẻ Hành trình đủ | SHP-REQ-20261006-101103927 |
| đang tải | Khung chờ đúng hình thanh tiến trình, thẻ thông tin và hành trình | SHP-REQ-20261006-101103927 |
| lỗi | Banner "Không tải được thông tin vận chuyển." kèm "Thử lại" (lỗi mạng hay 5xx) | SHP-REQ-20261006-101103927 |
| hết phiên | 401: hộp thoại phiên đã hết hạn, nút về đăng nhập | SHP-REQ-20261006-101103927 |
| không tìm thấy | Khối căn giữa "404", "Không tìm thấy đơn hàng", nút "Về danh sách đơn hàng"; cùng giao diện cho đơn của người khác, đơn không tồn tại và mã sai định dạng | SHP-REQ-20261006-101103927 |
| chưa có vận đơn | Đơn là của mình nhưng chưa có vận đơn: "Đơn chưa được bàn giao cho vận chuyển." không có mã vận đơn | SHP-REQ-20261006-101103927 |
| trạng thái vận đơn | Badge trạng thái (Chờ bàn giao, Đang giao, Đã giao, Giao thất bại, Đã hoàn, Đã hủy); nhãn đọc rõ không chỉ bằng màu | SHP-REQ-20261006-101103927 |
| chờ bàn giao | Thanh tiến trình dừng ở "Đã tạo"; chưa có mã vận đơn | SHP-REQ-20261006-101103927 |
| đang giao | Thanh dừng ở "Đang giao"; có mã vận đơn và nút Sao chép | SHP-REQ-20261006-101103927 |
| đã giao | Cả ba bước hoàn thành, có thời điểm giao | SHP-REQ-20261006-101103927 |
| giao thất bại | Dòng báo "Giao hàng chưa thành công. Shop sẽ liên hệ với bạn." không nêu lý do hay ghi chú nội bộ | SHP-REQ-20261006-101103927 |
| đã hủy hoặc đã hoàn | Dòng báo "Vận đơn đã bị hủy." hoặc "Hàng đã hoàn về kho."; không có mã vận đơn cho vận đơn đã hủy | SHP-REQ-20261006-101103927 |
| sao chép mã | Bấm Sao chép thì chữ nút đổi thành "Đã chép" trong 2 giây; không có hộp thoại | SHP-REQ-20261006-101103927 |
| hành trình có dữ liệu | Một dòng mỗi lần chuyển trạng thái hoặc đổi mã, cũ nhất trước, có giờ; không có người thực hiện | SHP-REQ-20261006-101103972 |
| hành trình một dòng | Vận đơn mới tạo chỉ có "Đã tạo vận đơn", không có đường nối | SHP-REQ-20261006-101103972 |
| hành trình rỗng | Khi chưa có vận đơn: "Chưa có hành trình." | SHP-REQ-20261006-101103972 |
| hành trình lỗi | Thẻ hành trình báo "Không tải được hành trình." kèm "Thử lại", các khối khác vẫn hiện | SHP-REQ-20261006-101103972 |

## Phần tử
| testid | Phần tử | Role | Hành động | Requirement |
|---|---|---|---|---|
| shp-shipment-tracking-back-link | Liên kết Quay lại đơn hàng | customer | Về chi tiết đơn | SHP-REQ-20261006-101103927 |
| shp-shipment-tracking-order-code | Mã đơn trong đầu trang (font-mono) | customer | - | SHP-REQ-20261006-101103927 |
| shp-shipment-tracking-status-badge | Badge trạng thái vận đơn | customer | - | SHP-REQ-20261006-101103927 |
| shp-shipment-tracking-stepper | Thanh tiến trình ba bước | customer | - | SHP-REQ-20261006-101103927 |
| shp-shipment-tracking-method | Tên phương thức vận chuyển | customer | - | SHP-REQ-20261006-101103927 |
| shp-shipment-tracking-number | Mã vận đơn (khi có) | customer | - | SHP-REQ-20261006-101103927 |
| shp-shipment-tracking-copy | Nút Sao chép mã vận đơn | customer | Chép mã vào clipboard | SHP-REQ-20261006-101103927 |
| shp-shipment-tracking-shipped-at | Thời điểm bàn giao | customer | - | SHP-REQ-20261006-101103927 |
| shp-shipment-tracking-delivered-at | Thời điểm giao xong | customer | - | SHP-REQ-20261006-101103927 |
| shp-shipment-tracking-no-shipment | Vùng chưa có vận đơn | customer | - | SHP-REQ-20261006-101103927 |
| shp-shipment-tracking-failed-notice | Dòng báo giao chưa thành công | customer | - | SHP-REQ-20261006-101103927 |
| shp-shipment-tracking-closed-notice | Dòng báo vận đơn đã hủy hoặc đã hoàn | customer | - | SHP-REQ-20261006-101103927 |
| shp-shipment-tracking-loading | Khung chờ | customer | - | SHP-REQ-20261006-101103927 |
| shp-shipment-tracking-error | Banner lỗi tải vận đơn | customer | - | SHP-REQ-20261006-101103927 |
| shp-shipment-tracking-retry | Nút Thử lại | customer | Tải lại vận đơn | SHP-REQ-20261006-101103927 |
| shp-shipment-tracking-not-found | Vùng không tìm thấy | customer | - | SHP-REQ-20261006-101103927 |
| shp-shipment-tracking-not-found-back | Nút Về danh sách đơn hàng | customer | Về danh sách đơn | SHP-REQ-20261006-101103927 |
| shp-shipment-tracking-session-expired | Hộp thoại phiên đã hết hạn | customer | - | SHP-REQ-20261006-101103927 |
| shp-shipment-tracking-history | Thẻ hành trình | customer | - | SHP-REQ-20261006-101103972 |
| shp-shipment-tracking-history-item | Một dòng hành trình | customer | - | SHP-REQ-20261006-101103972 |
| shp-shipment-tracking-history-time | Giờ của dòng hành trình | customer | - | SHP-REQ-20261006-101103972 |
| shp-shipment-tracking-history-empty | Vùng hành trình rỗng | customer | - | SHP-REQ-20261006-101103972 |
| shp-shipment-tracking-history-error | Banner lỗi tải hành trình | customer | - | SHP-REQ-20261006-101103972 |
| shp-shipment-tracking-history-retry | Nút Thử lại tải hành trình | customer | Tải lại hành trình | SHP-REQ-20261006-101103972 |

## Ghi chú thiết kế (mặc định, chưa duyệt)
- Màn này chỉ có customer; staff và admin xem vận đơn ở `shipment-admin-detail` (nhiều dữ liệu và thao tác hơn). Customer không thấy lý do, ghi chú, số tiền thu hộ hay người nhận (SHP-REQ-20261006-101103927 BR4, SHP-REQ-20261006-101103972 BR4).
- Màn thuộc luồng "đơn hàng của tôi" của ORD nhưng nội dung là của SHP. Liên kết "Theo dõi vận chuyển" ở trang chi tiết đơn thuộc màn `order-detail` của ORD (không sửa ở epic này): ghi ở questions.md để ORD thêm khi cần. [OPEN]
- Phần chọn phương thức vận chuyển và phí khi đặt hàng nằm ở màn của CHK và CRT (chưa có spec), SHP chỉ cung cấp dữ liệu qua SHP-REQ-20261006-101103782 và SHP-REQ-20261006-101103806 nên không có màn ở đây.
- Nhãn lý do thất bại không hiển thị cho khách (chỉ lời trấn an chung), tránh lộ ghi chú nội bộ của nhân viên.
