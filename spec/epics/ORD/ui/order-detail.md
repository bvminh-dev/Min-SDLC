---
screen: order-detail
epic: ORD
status: draft
covers: [ORD-REQ-20261006-092320768, ORD-REQ-20261006-092320790, ORD-REQ-20261006-092320812, ORD-REQ-20261006-092320834]
roles: [customer, staff, admin]
---
# Chi tiết đơn hàng (kèm lịch sử trạng thái và hủy đơn)

## Wireframe
Phương án đã chọn: **A** (trang chi tiết bản ghi: cột chính gồm sản phẩm và lịch sử trạng thái, cột phải gồm giao hàng và thanh toán). **Đây là lựa chọn mặc định** (khuyến nghị theo `U3`), chưa có người dùng chọn.

| Phương án | Việc chính thấy ở đâu | Đổi gì | Đánh đổi |
|---|---|---|---|
| **A. Hai khối cột chính và cột phải (khuyên dùng, đã chọn)** | Trạng thái ở đầu trang, lịch sử trạng thái nằm ngay dưới danh sách sản phẩm | Lịch sử luôn hiện, không phải mở tab | Cần khung nội dung từ 70rem để mở cột phải; hẹp hơn thì một cột |
| B. Chia tab Sản phẩm / Lịch sử | Một khối tại một lúc | Trang ngắn | Lịch sử (việc chính của ORD-REQ-20261006-092320812) bị ẩn sau một lần bấm |
| C. Một cột xếp chồng | Mọi khối nối nhau | Đơn giản nhất | Cột giao hàng và thanh toán bị đẩy xuống rất dưới trên màn rộng |

Lý do chọn A: người mở đơn muốn biết "giờ đơn ở đâu và đã đi qua những bước nào"; trạng thái và lịch sử phải thấy cùng lúc. Hành động của cả bản ghi (Hủy đơn) nằm ở đầu trang.

```
Thanh header:  ☰  Đơn hàng › #7K3M9Q2XH4TB                                🔔  (T)
┌──────────────────────────────────────────────────────────────────────────────────┐
│ ← Quay lại danh sách                                                             │
│ Đơn #7K3M9Q2XH4TB   (Đã thanh toán)   06/10/2026 09:00            [Hủy đơn]      │  <- Hủy đơn chỉ customer, admin; chỉ khi pending, confirmed, paid
│                                                                                  │
│ ┌ Sản phẩm ─────────────────────────────────────┐   ┌ Giao hàng ────────────────┐│
│ │ Áo thun cổ tròn   100.000 đ × 2     200.000 đ │   │ Người nhận, điện thoại,   ││  <- customer, admin; staff thấy dòng "ẩn theo chính sách dữ liệu"
│ │ Tất cổ cao         50.000 đ × 3     150.000 đ │   │ địa chỉ                   ││
│ │ Tạm tính 350.000 · Giảm 0 · Phí giao 30.000   │   │ Mã vận đơn VN123456       ││  <- khi đã giao cho vận chuyển
│ │ Tổng cộng                       380.000 đ     │   └───────────────────────────┘│
│ └───────────────────────────────────────────────┘   ┌ Thanh toán ───────────────┐│
│ ┌ Lịch sử trạng thái ───────────────────────────┐   │ VNPay · Thành công        ││
│ │ ○ 06/10 09:00  Chờ xử lý                      │   └───────────────────────────┘│
│ │ │                                             │                                │
│ │ ○ 06/10 09:05  Đã thanh toán                  │                                │
│ │ │                                             │                                │
│ │ ○ 06/10 10:00  Đã hủy · Lý do: đặt nhầm       │                                │
│ └───────────────────────────────────────────────┘                                │
└──────────────────────────────────────────────────────────────────────────────────┘

Hộp thoại Hủy đơn (không đóng khi bấm ra ngoài vì có ô nhập, luật I20 của evon):
┌ Hủy đơn #7K3M9Q2XH4TB? ────────────────────────────────┐
│ Đơn đã thanh toán: hủy sẽ gửi yêu cầu hoàn tiền (xử lý  │  <- chỉ khi trạng thái paid; chỉ thông báo, không dựng màn hoàn tiền
│ riêng). Không thể hoàn tác.                              │
│ Lý do (không bắt buộc)  [                              ] │  tối đa 500 ký tự
│                                  [Giữ đơn]  [Xác nhận hủy]│
└──────────────────────────────────────────────────────────┘
```

Thứ tự lịch sử: cũ nhất trước theo ORD-REQ-20261006-092320812 BR7 (mặc định chưa được xác nhận). **Lưu ý khác biệt với evon:** mẫu `timeline.md` đặt mới nhất ở trên. Màn này theo requirement; nếu người dùng chọn mới nhất trước thì đổi cả requirement lẫn màn.

## Trạng thái
| Trạng thái | Trông ra sao | Requirement |
|---|---|---|
| có dữ liệu | Đầu trang có mã, badge trạng thái, ngày tạo; khối sản phẩm, giao hàng, thanh toán, lịch sử đủ | ORD-REQ-20261006-092320768 |
| đang tải | Khung chờ đúng hình các khối (dòng sản phẩm, vòng và đường nối của lịch sử) | ORD-REQ-20261006-092320768 |
| lỗi | Banner "Không tải được đơn hàng." kèm "Thử lại" (lỗi mạng hay 5xx); chưa đăng nhập (401) về đăng nhập | ORD-REQ-20261006-092320768 |
| không tìm thấy | Khối căn giữa: "404" mờ, "Không tìm thấy đơn hàng", một câu vì sao, nút đặc "Về danh sách đơn hàng". Cùng một giao diện cho đơn của người khác, đơn không tồn tại và mã sai định dạng, không để lộ khác biệt (customer) | ORD-REQ-20261006-092320768 |
| staff không thấy địa chỉ | Khối Giao hàng của staff hiện dòng "Thông tin người nhận được ẩn theo chính sách dữ liệu", không có người nhận, điện thoại, địa chỉ | ORD-REQ-20261006-092320768 |
| đơn chưa giao | Không có mã vận đơn (chỉ hiện từ khi đơn đã giao cho vận chuyển) | ORD-REQ-20261006-092320768 |
| đơn COD chưa thu tiền | Khối Thanh toán ghi "COD · Chưa thu tiền", không có chữ "đã thanh toán" | ORD-REQ-20261006-092320768 |
| trạng thái đơn | Badge theo trạng thái hiện tại của đơn, nhãn đọc rõ không chỉ bằng màu | ORD-REQ-20261006-092320790 |
| lịch sử một dòng | Đơn mới tạo chỉ có một dòng "Chờ xử lý" lúc tạo, không có đường nối | ORD-REQ-20261006-092320812 |
| lịch sử có lý do hủy | Dòng "Đã hủy" kèm "Lý do: ..."; đơn hủy không lý do thì không có phần lý do | ORD-REQ-20261006-092320812 |
| lịch sử lỗi | Khối lịch sử báo "Không tải được lịch sử." kèm "Thử lại", các khối khác vẫn hiện | ORD-REQ-20261006-092320812 |
| nút hủy ẩn | Không có nút Hủy đơn khi đơn ở shipped, delivered, cancelled, expired, và không bao giờ có với staff | ORD-REQ-20261006-092320834 |
| hộp thoại hủy | Hộp thoại có ô lý do tùy chọn, nút Giữ đơn và Xác nhận hủy; đơn paid có thêm dòng thông báo hoàn tiền xử lý riêng | ORD-REQ-20261006-092320834 |
| đang hủy | Nút Xác nhận hủy khóa và có vòng xoay; ô lý do khóa | ORD-REQ-20261006-092320834 |
| hủy thành công | Hộp thoại đóng, badge thành "Đã hủy", lịch sử có thêm dòng hủy, thông báo ngắn "Đã hủy đơn" | ORD-REQ-20261006-092320834 |
| hủy không được | Báo lỗi trong hộp thoại: "Đơn không thể hủy ở trạng thái hiện tại" (409, ví dụ đơn vừa chuyển sang đang giao), có nút Tải lại đơn; lý do quá dài thì lỗi dưới ô nhập (400); staff hay hết phiên thì 403 hoặc 401 | ORD-REQ-20261006-092320834 |

## Phần tử
| testid | Phần tử | Role | Hành động | Requirement |
|---|---|---|---|---|
| ord-order-detail-back-link | Liên kết Quay lại danh sách | customer, staff, admin | Về danh sách đơn của role đó | ORD-REQ-20261006-092320768 |
| ord-order-detail-code | Mã đơn trong đầu trang (font-mono) | customer, staff, admin | - | ORD-REQ-20261006-092320768 |
| ord-order-detail-created-at | Thời điểm tạo đơn | customer, staff, admin | - | ORD-REQ-20261006-092320768 |
| ord-order-detail-status-badge | Badge trạng thái đơn | customer, staff, admin | - | ORD-REQ-20261006-092320790 |
| ord-order-detail-items | Bảng sản phẩm (tên, đơn giá, số lượng, thành tiền theo snapshot) | customer, staff, admin | - | ORD-REQ-20261006-092320768 |
| ord-order-detail-totals | Tạm tính, giảm giá, phí giao hàng, tổng cộng | customer, staff, admin | - | ORD-REQ-20261006-092320768 |
| ord-order-detail-payment | Khối thanh toán (phương thức, trạng thái thanh toán) | customer, staff, admin | - | ORD-REQ-20261006-092320768 |
| ord-order-detail-address | Khối người nhận, điện thoại, địa chỉ giao | customer, admin | - | ORD-REQ-20261006-092320768 |
| ord-order-detail-address-hidden | Dòng "ẩn theo chính sách dữ liệu" thay khối địa chỉ | staff | - | ORD-REQ-20261006-092320768 |
| ord-order-detail-tracking | Mã vận đơn (khi đã giao cho vận chuyển) | customer, staff, admin | - | ORD-REQ-20261006-092320768 |
| ord-order-detail-history | Khối lịch sử trạng thái (timeline) | customer, staff, admin | - | ORD-REQ-20261006-092320812 |
| ord-order-detail-history-item | Một dòng lịch sử: thời điểm và trạng thái | customer, staff, admin | - | ORD-REQ-20261006-092320812 |
| ord-order-detail-history-reason | Lý do hủy trong dòng lịch sử (chỉ khi có) | customer, staff, admin | - | ORD-REQ-20261006-092320812 |
| ord-order-detail-history-error | Banner lỗi riêng của khối lịch sử | customer, staff, admin | - | ORD-REQ-20261006-092320812 |
| ord-order-detail-history-retry | Nút Thử lại của lịch sử | customer, staff, admin | Tải lại lịch sử | ORD-REQ-20261006-092320812 |
| ord-order-detail-cancel-button | Nút Hủy đơn (ẩn khi không hủy được) | customer, admin | Mở hộp thoại hủy | ORD-REQ-20261006-092320834 |
| ord-order-detail-cancel-dialog | Hộp thoại xác nhận hủy | customer, admin | - | ORD-REQ-20261006-092320834 |
| ord-order-detail-cancel-refund-notice | Dòng thông báo hoàn tiền xử lý riêng (chỉ đơn paid) | customer, admin | - | ORD-REQ-20261006-092320834 |
| ord-order-detail-cancel-reason | Ô nhập lý do hủy (tùy chọn, tối đa 500 ký tự) | customer, admin | Nhập lý do | ORD-REQ-20261006-092320834 |
| ord-order-detail-cancel-confirm | Nút Xác nhận hủy | customer, admin | Gửi yêu cầu hủy | ORD-REQ-20261006-092320834 |
| ord-order-detail-cancel-dismiss | Nút Giữ đơn | customer, admin | Đóng hộp thoại, không hủy | ORD-REQ-20261006-092320834 |
| ord-order-detail-cancel-error | Vùng lỗi trong hộp thoại (409, 400, 403, 401) | customer, admin | - | ORD-REQ-20261006-092320834 |
| ord-order-detail-cancel-reload | Nút Tải lại đơn trong lỗi 409 | customer, admin | Tải lại đơn | ORD-REQ-20261006-092320834 |
| ord-order-detail-cancel-success | Thông báo "Đã hủy đơn" | customer, admin | - | ORD-REQ-20261006-092320834 |
| ord-order-detail-loading | Khung chờ | customer, staff, admin | - | ORD-REQ-20261006-092320768 |
| ord-order-detail-error | Banner lỗi toàn trang | customer, staff, admin | - | ORD-REQ-20261006-092320768 |
| ord-order-detail-retry | Nút Thử lại toàn trang | customer, staff, admin | Tải lại đơn | ORD-REQ-20261006-092320768 |
| ord-order-detail-notfound | Khối "Không tìm thấy đơn hàng" (404) | customer, staff, admin | - | ORD-REQ-20261006-092320768 |
| ord-order-detail-notfound-back | Nút đặc Về danh sách đơn hàng | customer, staff, admin | Về danh sách | ORD-REQ-20261006-092320768 |

## Ghi chú thiết kế (mặc định, chưa duyệt)
- **Báo trước theo skill evon:** skill giao diện chưa được dạy cho cửa hàng online phía người mua; phần dành cho customer vẫn làm theo mẫu "Trang chi tiết bản ghi" và `timeline.md`, kết quả có thể chưa đẹp bằng màn trong app.
- Màn dùng chung ba role nên phần tử chỉ dành cho một số role ghi đúng role đó: Hủy đơn chỉ customer và admin (không có cho staff, ORD-REQ-20261006-092320834 BR1); khối địa chỉ chỉ customer và admin, staff có dòng ẩn (SB-08, và là [OPEN] chờ quyết định ở nền, xem ORD-REQ-20261006-092320768 Xung đột).
- Nút Hủy đơn hiện theo `can_cancel` của API (ORD-API); việc kiểm quyền thật nằm ở server, giao diện chỉ phản ánh.
- Hộp thoại hủy có ô nhập nên bấm ra ngoài không đóng (luật `I20` của evon). Hủy là thao tác không hoàn tác nên có bước xác nhận.
- Đơn paid bị hủy chỉ có thông báo "hoàn tiền xử lý riêng"; **không dựng màn hay trạng thái hoàn tiền** vì epic PAY chưa có spec. Chữ chính xác trong thông báo phải chờ PAY.
- Mã vận đơn: nguồn dữ liệu còn [NEEDS CLARIFICATION] (ORD-REQ-20261006-092320768 BR5); phần tử chỉ hiện khi có giá trị.
- Lý do hủy hiển thị là văn bản thường, luôn được escape (SB-12), không hiển thị người thực hiện hủy (ORD-REQ-20261006-092320812 BR8).
- Không viết code giao diện; dựng thật là việc của `implement`.
