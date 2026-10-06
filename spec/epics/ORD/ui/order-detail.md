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
│ │ Tổng cộng                       380.000 đ     │   │ Theo dõi vận chuyển ›     ││  <- liên kết sang màn của SHP, chỉ customer
│ └───────────────────────────────────────────────┘   └───────────────────────────┘│
│ ┌ Lịch sử trạng thái ───────────────────────────┐   ┌ Thanh toán ───────────────┐│
│ │ ○ 06/10 09:00  Chờ xử lý                      │   │ VNPay · Thành công        ││  <- đơn online chờ thanh toán: "Hạn thanh toán 09:15"
│ │ │                                             │   │ Xem thanh toán ›          ││  <- liên kết sang màn của PAY (kết quả hoàn tiền), chỉ customer
│ │ ○ 06/10 09:05  Đã thanh toán                  │   └───────────────────────────┘│
│ │ │                                             │                                │
│ │ ○ 06/10 10:00  Đã hủy · Lý do: đặt nhầm       │                                │
│ └───────────────────────────────────────────────┘                                │
└──────────────────────────────────────────────────────────────────────────────────┘
Đơn giao thất bại: thêm dòng "Giao thất bại · Lý do: khách vắng nhà" sau dòng Đang giao; đơn hoàn về: dòng "Đã hoàn".

Hộp thoại Hủy đơn (không đóng khi bấm ra ngoài vì có ô nhập, luật I20 của evon):
┌ Hủy đơn #7K3M9Q2XH4TB? ────────────────────────────────┐
│ Đơn đã thanh toán: hủy sẽ hoàn tiền tự động toàn phần;  │  <- chỉ khi trạng thái paid; kết quả hoàn tiền xem ở "Xem thanh toán" (PAY)
│ xem kết quả ở màn thanh toán. Không thể hoàn tác.        │
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
| lỗi | Banner "Không tải được đơn hàng." kèm "Thử lại" (lỗi mạng, 5xx hay 429 quá giới hạn tần suất); chưa đăng nhập (401) về đăng nhập | ORD-REQ-20261006-092320768 |
| không tìm thấy | Khối căn giữa: "404" mờ, "Không tìm thấy đơn hàng", một câu vì sao, nút đặc "Về danh sách đơn hàng". Cùng một giao diện cho đơn của người khác, đơn không tồn tại và mã sai định dạng, không để lộ khác biệt (customer) | ORD-REQ-20261006-092320768 |
| staff không thấy địa chỉ | Khối Giao hàng của staff hiện dòng "Thông tin người nhận được ẩn theo chính sách dữ liệu", không có người nhận, điện thoại, địa chỉ | ORD-REQ-20261006-092320768 |
| đơn chưa giao | Không có mã vận đơn (chỉ hiện từ khi đơn đã giao cho vận chuyển) | ORD-REQ-20261006-092320768 |
| đơn online chờ thanh toán | Khối Thanh toán hiện "Hạn thanh toán" (từ `payment_expires_at`); đơn COD và đơn đã rời "Chờ xử lý" không có dòng này | ORD-REQ-20261006-092320768 |
| customer có liên kết | Customer thấy "Xem thanh toán" (màn của PAY) và, khi có mã vận đơn, "Theo dõi vận chuyển" (màn của SHP); staff, admin không thấy hai liên kết này | ORD-REQ-20261006-092320768 |
| đơn COD chưa thu tiền | Khối Thanh toán ghi "COD · Chưa thu tiền" (đơn còn trước giao, hoặc ngay sau giao tới khi PAY thu tự động), không có chữ "đã thanh toán" | ORD-REQ-20261006-092320768 |
| đơn COD đã thu tiền | Khối Thanh toán ghi "COD · Đã thu tiền"; trạng thái đơn vẫn "Đã giao" | ORD-REQ-20261006-092320768 |
| trạng thái đơn | Badge theo trạng thái hiện tại của đơn (tám trạng thái, gồm "Đã hoàn" cho `returned`), nhãn đọc rõ không chỉ bằng màu | ORD-REQ-20261006-092320790 |
| lịch sử một dòng | Đơn mới tạo chỉ có một dòng "Chờ xử lý" lúc tạo, không có đường nối | ORD-REQ-20261006-092320812 |
| lịch sử có lý do hủy | Dòng "Đã hủy" kèm "Lý do: ..."; đơn hủy không lý do thì không có phần lý do; lý do của hệ thống hiện nhãn cố định: `payment_failed` "Thanh toán thất bại", `stock_commit_failed` "Hết hàng giữ chỗ, đã hoàn tiền" (M-04) | ORD-REQ-20261006-092320812 |
| lịch sử giao thất bại | Sau dòng "Đang giao" có thêm dòng "Giao thất bại" kèm nhãn cố định của mã lý do (khách vắng nhà, từ chối nhận, sai địa chỉ, hàng hư hỏng, khác); badge đơn vẫn "Đang giao" | ORD-REQ-20261006-092320812 |
| đơn hoàn về | Đơn `returned`: badge "Đã hoàn", dòng "Đã hoàn" cuối lịch sử, không có nút Hủy đơn | ORD-REQ-20261006-092320812 |
| lịch sử lỗi | Khối lịch sử báo "Không tải được lịch sử." kèm "Thử lại", các khối khác vẫn hiện | ORD-REQ-20261006-092320812 |
| nút hủy ẩn | Không có nút Hủy đơn khi đơn ở shipped, delivered, cancelled, expired, và không bao giờ có với staff | ORD-REQ-20261006-092320834 |
| hộp thoại hủy | Hộp thoại có ô lý do tùy chọn, nút Giữ đơn và Xác nhận hủy; đơn paid có thêm dòng thông báo hoàn tiền tự động toàn phần (kết quả xem ở "Xem thanh toán") | ORD-REQ-20261006-092320834 |
| đang hủy | Nút Xác nhận hủy khóa và có vòng xoay; ô lý do khóa | ORD-REQ-20261006-092320834 |
| hủy thành công | Hộp thoại đóng, badge thành "Đã hủy", lịch sử có thêm dòng hủy, thông báo ngắn "Đã hủy đơn" | ORD-REQ-20261006-092320834 |
| hủy không được | Báo lỗi trong hộp thoại: "Đơn không thể hủy ở trạng thái hiện tại" (409, ví dụ đơn vừa chuyển sang đang giao), có nút Tải lại đơn; lý do quá dài thì lỗi dưới ô nhập (400); staff, Origin lạ (CSRF) thì 403; hết phiên thì 401; quá giới hạn tần suất thì 429 "Thử lại sau ít giây" | ORD-REQ-20261006-092320834 |

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
| ord-order-detail-tracking-link | Liên kết Theo dõi vận chuyển (khi có mã vận đơn) | customer | Mở màn theo dõi vận chuyển của SHP | ORD-REQ-20261006-092320768 |
| ord-order-detail-payment-expires | Dòng Hạn thanh toán (đơn online ở Chờ xử lý) | customer, staff, admin | - | ORD-REQ-20261006-092320768 |
| ord-order-detail-payment-link | Liên kết Xem thanh toán | customer | Mở màn thanh toán của PAY | ORD-REQ-20261006-092320768 |
| ord-order-detail-history | Khối lịch sử trạng thái (timeline) | customer, staff, admin | - | ORD-REQ-20261006-092320812 |
| ord-order-detail-history-item | Một dòng lịch sử: thời điểm và trạng thái (gồm dòng giao thất bại) | customer, staff, admin | - | ORD-REQ-20261006-092320812 |
| ord-order-detail-history-reason | Lý do trong dòng lịch sử (lý do hủy hoặc lý do giao thất bại, chỉ khi có) | customer, staff, admin | - | ORD-REQ-20261006-092320812 |
| ord-order-detail-history-error | Banner lỗi riêng của khối lịch sử | customer, staff, admin | - | ORD-REQ-20261006-092320812 |
| ord-order-detail-history-retry | Nút Thử lại của lịch sử | customer, staff, admin | Tải lại lịch sử | ORD-REQ-20261006-092320812 |
| ord-order-detail-cancel-button | Nút Hủy đơn (ẩn khi không hủy được) | customer, admin | Mở hộp thoại hủy | ORD-REQ-20261006-092320834 |
| ord-order-detail-cancel-dialog | Hộp thoại xác nhận hủy | customer, admin | - | ORD-REQ-20261006-092320834 |
| ord-order-detail-cancel-refund-notice | Dòng thông báo hoàn tiền tự động toàn phần (chỉ đơn paid) | customer, admin | - | ORD-REQ-20261006-092320834 |
| ord-order-detail-cancel-reason | Ô nhập lý do hủy (tùy chọn, tối đa 500 ký tự) | customer, admin | Nhập lý do | ORD-REQ-20261006-092320834 |
| ord-order-detail-cancel-confirm | Nút Xác nhận hủy | customer, admin | Gửi yêu cầu hủy | ORD-REQ-20261006-092320834 |
| ord-order-detail-cancel-dismiss | Nút Giữ đơn | customer, admin | Đóng hộp thoại, không hủy | ORD-REQ-20261006-092320834 |
| ord-order-detail-cancel-error | Vùng lỗi trong hộp thoại (409, 400, 403, 401, 429) | customer, admin | - | ORD-REQ-20261006-092320834 |
| ord-order-detail-cancel-reload | Nút Tải lại đơn trong lỗi 409 | customer, admin | Tải lại đơn | ORD-REQ-20261006-092320834 |
| ord-order-detail-cancel-success | Thông báo "Đã hủy đơn" | customer, admin | - | ORD-REQ-20261006-092320834 |
| ord-order-detail-loading | Khung chờ | customer, staff, admin | - | ORD-REQ-20261006-092320768 |
| ord-order-detail-error | Banner lỗi toàn trang | customer, staff, admin | - | ORD-REQ-20261006-092320768 |
| ord-order-detail-retry | Nút Thử lại toàn trang | customer, staff, admin | Tải lại đơn | ORD-REQ-20261006-092320768 |
| ord-order-detail-notfound | Khối "Không tìm thấy đơn hàng" (404) | customer, staff, admin | - | ORD-REQ-20261006-092320768 |
| ord-order-detail-notfound-back | Nút đặc Về danh sách đơn hàng | customer, staff, admin | Về danh sách | ORD-REQ-20261006-092320768 |

## Ghi chú thiết kế (mặc định, chưa duyệt)
- **Báo trước theo skill evon:** skill giao diện chưa được dạy cho cửa hàng online phía người mua; phần dành cho customer vẫn làm theo mẫu "Trang chi tiết bản ghi" và `timeline.md`, kết quả có thể chưa đẹp bằng màn trong app.
- Màn dùng chung ba role nên phần tử chỉ dành cho một số role ghi đúng role đó: Hủy đơn chỉ customer và admin (không có cho staff, ORD-REQ-20261006-092320834 BR1); khối địa chỉ chỉ customer và admin, staff có dòng ẩn (SB-08 ngoại lệ (c), K-13; staff xem người nhận ở màn bàn giao của SHP). Hai liên kết Xem thanh toán và Theo dõi vận chuyển chỉ cho customer vì màn đích của PAY, SHP dành cho customer.
- Nút Hủy đơn hiện theo `can_cancel` của API (ORD-API); việc kiểm quyền thật nằm ở server, giao diện chỉ phản ánh.
- Hộp thoại hủy có ô nhập nên bấm ra ngoài không đóng (luật `I20` của evon). Hủy là thao tác không hoàn tác nên có bước xác nhận.
- Đơn paid bị hủy có thông báo "hoàn tiền tự động toàn phần" (K-03d, SB-24); **ORD không dựng màn hay trạng thái hoàn tiền**: kết quả hoàn tiền hiện ở khối Hoàn tiền của màn thanh toán của PAY (PAY-REQ-20261006-103111122), customer vào qua liên kết `ord-order-detail-payment-link`.
- Mã vận đơn: bản sao ORD lưu từ ShipmentShipped và ShipmentTrackingChanged (ORD-REQ-20261006-092320768 BR5, E-12); phần tử chỉ hiện khi có giá trị. Liên kết "Theo dõi vận chuyển" dẫn sang màn `shipment-tracking` của SHP.
- Hạn thanh toán: hiện từ `payment_expires_at` của đơn online ở Chờ xử lý (K-01); dữ liệu chỉ đọc, đường dẫn thanh toán và đếm ngược chính thức thuộc màn của PAY.
- Dòng giao thất bại và dòng "Đã hoàn": lý do giao thất bại là mã cố định đổi thành nhãn cố định, không là văn bản người nhập.
- Lý do hủy hiển thị là văn bản thường, luôn được escape (SB-12), không hiển thị người thực hiện hủy (ORD-REQ-20261006-092320812 BR8).
- Không viết code giao diện; dựng thật là việc của `implement`.
