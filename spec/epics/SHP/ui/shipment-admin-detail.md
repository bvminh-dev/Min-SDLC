---
screen: shipment-admin-detail
epic: SHP
status: draft
covers: [SHP-REQ-20261006-101103855, SHP-REQ-20261006-101103880, SHP-REQ-20261006-101103903, SHP-REQ-20261006-101103927, SHP-REQ-20261006-101103972]
roles: [staff, admin]
---
# Chi tiết vận đơn (bàn giao, sửa mã, cập nhật kết quả giao, lịch sử)

## Wireframe
Phương án đã chọn: **A** (trang chi tiết bản ghi: đầu trang có mã đơn, badge trạng thái và nút hành động theo trạng thái; cột chính là lịch sử vận đơn; cột phải là người nhận và thông tin vận chuyển). **Đây là lựa chọn mặc định** (khuyến nghị theo `U3`), chưa có người dùng chọn: các cổng "duyệt brief", "xác nhận danh sách màn" và "chọn wireframe" không hỏi được ở lần chạy này.

| Phương án | Việc chính thấy ở đâu | Đổi gì | Đánh đổi |
|---|---|---|---|
| **A. Hai khối cột chính và cột phải (khuyên dùng, đã chọn)** | Trạng thái và nút hành động ở đầu trang; lịch sử ngay dưới; người nhận bên phải | Mọi thao tác nhập liệu mở trong hộp thoại, lịch sử luôn hiện | Cần khung nội dung từ 70rem để mở cột phải; hẹp hơn thì một cột |
| B. Chia tab Thông tin / Lịch sử | Một khối tại một lúc | Trang ngắn | Nhân viên đang bàn giao phải qua lại giữa địa chỉ và lịch sử |
| C. Thao tác ngay trong trang (form cố định bên dưới) | Ô nhập mã vận đơn nằm sẵn trên trang | Bàn giao một bước | Ô nhập và nút hành động luôn hiện kể cả khi trạng thái không cho phép; dễ nhập nhầm vận đơn |

Lý do chọn A: nhân viên mở một vận đơn để làm đúng một việc ở trạng thái hiện tại (bàn giao khi chờ, báo kết quả khi đang giao), cần thấy địa chỉ để đọc cho hãng vận chuyển và thấy lịch sử để biết đã xảy ra gì. Nút hành động chỉ hiện khi trạng thái cho phép, nên không có ô nhập thừa.

```
Thanh header:  ☰  Vận chuyển › Vận đơn › #7K3M9Q2XH4TB                      🔔  (T)
┌──────────────────────────────────────────────────────────────────────────────────┐
│ ← Quay lại danh sách                                                             │
│ Vận đơn đơn #7K3M9Q2XH4TB   (Đang giao)                                          │
│ [Giao xong] [Giao thất bại] [Sửa mã vận đơn]            <- theo trạng thái, xem dưới │
│                                                                                  │
│ ┌ Hành trình ───────────────────────────────────┐   ┌ Người nhận ───────────────┐│
│ │ ○ 06/10 09:05  Đã tạo vận đơn (chờ bàn giao)   │   │ Nguyễn Văn An             ││  <- staff chỉ khi chờ bàn giao, đang giao, thất bại; admin luôn
│ │ │                                             │   │ 0901 234 567              ││
│ │ ○ 06/10 10:00  Đã bàn giao · GHN12345678       │   │ 12 Lê Lợi, P. Bến Nghé,   ││
│ │ │                                             │   │ TP.HCM                    ││
│ │ ○ 06/10 10:20  Đổi mã vận đơn · GHN12345679    │   └───────────────────────────┘│
│ └───────────────────────────────────────────────┘   ┌ Vận chuyển ───────────────┐│
│                                                     │ Giao tiêu chuẩn           ││
│                                                     │ Mã vận đơn GHN12345679    ││
│                                                     │ Thu hộ (COD) 380.000 đ    ││
│                                                     │ Bàn giao 06/10 10:00      ││
│                                                     └───────────────────────────┘│
└──────────────────────────────────────────────────────────────────────────────────┘

Nút hành động theo trạng thái (chỉ hiện nút hợp lệ):
  Chờ bàn giao: [Bàn giao]          Đang giao: [Giao xong] [Giao thất bại] [Sửa mã vận đơn]
  Giao thất bại: [Hàng đã về kho]   Đã giao, Đã hoàn, Đã hủy: không nút

Hộp thoại Bàn giao (có ô nhập nên bấm ra ngoài không đóng, luật I20 của evon):
┌ Bàn giao vận đơn #7K3M9Q2XH4TB ──────────────────────────┐
│ Mã vận đơn  [ GHN12345678                               ] │  8 tới 30 ký tự: chữ, số, gạch nối; tự đổi sang chữ hoa
│                                        [Hủy]  [Bàn giao]  │
└────────────────────────────────────────────────────────────┘
Hộp thoại Sửa mã: cùng khuôn, nhãn "Mã vận đơn mới", nút "Lưu mã".
Hộp thoại Giao thất bại: Lý do [Không liên lạc được ▾ | Từ chối nhận | Sai địa chỉ | Hàng hỏng | Khác]  Ghi chú [..] (tối đa 300)  [Hủy] [Xác nhận thất bại]
Hộp xác nhận Giao xong: "Xác nhận đơn đã giao thành công? Không thể hoàn tác." [Hủy] [Xác nhận]
Hộp xác nhận Hàng về kho: "Xác nhận hàng đã hoàn về kho? Không thể hoàn tác." [Hủy] [Xác nhận]   (hàng nhập lại kho trừ khi lý do thất bại là Hàng hỏng, V-08)
```

Thứ tự lịch sử: cũ nhất trước theo SHP-REQ-20261006-101103972 BR5 (mặc định chưa được xác nhận). **Lưu ý khác biệt với evon:** mẫu `timeline.md` đặt mới nhất ở trên. Theo luật "requirement thắng" khi giao diện mâu thuẫn requirement, màn này theo requirement; nếu người dùng chọn mới nhất trước thì đổi cả requirement lẫn màn. Số tiền dùng `tabular-nums`; mã đơn và mã vận đơn `font-mono`.

## Trạng thái
| Trạng thái | Trông ra sao | Requirement |
|---|---|---|
| có dữ liệu | Đầu trang có mã đơn, badge trạng thái; cột chính là lịch sử; cột phải là người nhận (theo quyền) và thông tin vận chuyển | SHP-REQ-20261006-101103927 |
| đang tải | Khung chờ đúng hình các khối (vòng và đường nối của lịch sử, hai thẻ bên phải) | SHP-REQ-20261006-101103927 |
| lỗi | Banner "Không tải được vận đơn." kèm "Thử lại" (lỗi mạng hay 5xx) | SHP-REQ-20261006-101103927 |
| hết phiên | 401: hộp thoại phiên đã hết hạn, nút về đăng nhập | SHP-REQ-20261006-101103927 |
| không có quyền | Customer mở màn này (403): trang lỗi "Bạn không có quyền xem trang này" kèm nút về trang chủ | SHP-REQ-20261006-101103927 |
| không tìm thấy | Khối căn giữa "404", "Không tìm thấy đơn hàng", nút "Về danh sách vận đơn" (mã đơn không tồn tại hoặc sai định dạng, cùng một giao diện) | SHP-REQ-20261006-101103927 |
| chưa có vận đơn | Đơn có thật nhưng chưa có vận đơn (ví dụ chưa thanh toán, hoặc đang đồng bộ): "Đơn này chưa có vận đơn." không có nút hành động | SHP-REQ-20261006-101103927 |
| trạng thái vận đơn | Badge trạng thái hiện tại; nhãn đọc rõ không chỉ bằng màu | SHP-REQ-20261006-101103927 |
| staff không thấy địa chỉ | Khi vận đơn ở delivered, returned hay cancelled, khối Người nhận của staff hiện "Thông tin người nhận được ẩn theo chính sách dữ liệu" và không có tên, điện thoại, địa chỉ; admin vẫn thấy đầy đủ | SHP-REQ-20261006-101103927 |
| thu hộ COD | Khối Vận chuyển ghi "Thu hộ (COD) 380.000 đ" khi `cod_amount` lớn hơn 0; đơn đã thanh toán online không có dòng này | SHP-REQ-20261006-101103927 |
| nút hành động theo trạng thái | Chỉ nút hợp lệ với trạng thái hiện tại hiện ra (bảng ở wireframe); delivered, returned, cancelled không nút | SHP-REQ-20261006-101103903 |
| hộp thoại bàn giao | Hộp thoại có ô mã vận đơn, nút Hủy và Bàn giao; nút Bàn giao khóa khi ô rỗng | SHP-REQ-20261006-101103855 |
| đang bàn giao | Nút Bàn giao khóa và có vòng xoay; ô nhập khóa | SHP-REQ-20261006-101103855 |
| bàn giao xong | Hộp thoại đóng, badge thành "Đang giao", mã vận đơn hiện, lịch sử có dòng mới, toast "Đã bàn giao" | SHP-REQ-20261006-101103855 |
| mã vận đơn sai định dạng | Lỗi dưới ô: "Mã gồm 8 tới 30 ký tự chữ, số hoặc gạch nối" (400); ô tự đổi sang chữ hoa khi gõ | SHP-REQ-20261006-101103855 |
| mã vận đơn trùng | Lỗi dưới ô: "Mã này đã được dùng cho vận đơn khác" (409 `tracking-number-taken`), không nêu vận đơn nào | SHP-REQ-20261006-101103855 |
| không bàn giao được | Lỗi trong hộp thoại: "Đơn đã bị hủy hoặc không còn sẵn sàng giao" (409 `order-not-shippable`) hoặc "Vận đơn đã đổi trạng thái" (409 `shipment-invalid-transition`) kèm nút Tải lại vận đơn | SHP-REQ-20261006-101103855 |
| hộp thoại sửa mã | Hộp thoại cùng khuôn, ô điền sẵn mã hiện tại; nút Lưu mã khóa khi mã chưa đổi | SHP-REQ-20261006-101103880 |
| sửa mã xong | Hộp thoại đóng, mã mới hiện, lịch sử có dòng "Đổi mã vận đơn", toast "Đã lưu mã vận đơn" | SHP-REQ-20261006-101103880 |
| sửa mã bị từ chối | Lỗi trong hộp thoại: mã sai định dạng (400), "Mã này đã được dùng" (409 `tracking-number-taken`), "Mã không thay đổi" (409 `tracking-number-unchanged`), "Vận đơn đã được người khác cập nhật" (409 `version-conflict`) kèm nút Tải lại, hoặc vận đơn không còn ở trạng thái đang giao (409 `shipment-invalid-transition`) | SHP-REQ-20261006-101103880 |
| xác nhận giao xong | Hộp xác nhận nêu không thể hoàn tác, nút Hủy và Xác nhận | SHP-REQ-20261006-101103903 |
| hộp thoại giao thất bại | Hộp thoại có chọn lý do bắt buộc (5 lý do) và ghi chú tùy chọn tối đa 300 ký tự có bộ đếm; nút xác nhận khóa khi chưa chọn lý do | SHP-REQ-20261006-101103903 |
| hộp xác nhận hàng về kho | Hộp xác nhận nêu không thể hoàn tác (chỉ hiện khi vận đơn thất bại) | SHP-REQ-20261006-101103903 |
| đang cập nhật kết quả | Nút xác nhận khóa và có vòng xoay | SHP-REQ-20261006-101103903 |
| cập nhật kết quả xong | Hộp thoại đóng, badge đổi sang trạng thái mới, nút hành động đổi theo, lịch sử có dòng mới, toast ngắn "Đã cập nhật vận đơn" | SHP-REQ-20261006-101103903 |
| cập nhật kết quả bị từ chối | Lỗi trong hộp thoại: lý do thiếu hoặc ghi chú quá 300 ký tự (400), "Vận đơn đã đổi trạng thái" (409 `shipment-invalid-transition`, ví dụ người khác vừa báo giao xong) kèm nút Tải lại; customer 403 hay hết phiên 401 | SHP-REQ-20261006-101103903 |
| lịch sử có dữ liệu | Một dòng mỗi lần chuyển trạng thái hoặc đổi mã, cũ nhất trước, có giờ; dòng thất bại kèm lý do và ghi chú (nhân viên thấy) | SHP-REQ-20261006-101103972 |
| lịch sử một dòng | Vận đơn mới tạo chỉ có "Đã tạo vận đơn", không có đường nối | SHP-REQ-20261006-101103972 |
| lịch sử rỗng | Khi chưa có vận đơn: "Chưa có lịch sử." | SHP-REQ-20261006-101103972 |
| lịch sử lỗi | Khối lịch sử báo "Không tải được lịch sử." kèm "Thử lại", các khối khác vẫn hiện | SHP-REQ-20261006-101103972 |

## Phần tử
| testid | Phần tử | Role | Hành động | Requirement |
|---|---|---|---|---|
| shp-shipment-admin-detail-back-link | Liên kết Quay lại danh sách | staff, admin | Về danh sách vận đơn | SHP-REQ-20261006-101103927 |
| shp-shipment-admin-detail-order-code | Mã đơn trong đầu trang (font-mono) | staff, admin | - | SHP-REQ-20261006-101103927 |
| shp-shipment-admin-detail-status-badge | Badge trạng thái vận đơn | staff, admin | - | SHP-REQ-20261006-101103927 |
| shp-shipment-admin-detail-method | Tên phương thức vận chuyển | staff, admin | - | SHP-REQ-20261006-101103927 |
| shp-shipment-admin-detail-tracking | Mã vận đơn (khi đã bàn giao) | staff, admin | - | SHP-REQ-20261006-101103927 |
| shp-shipment-admin-detail-cod | Dòng thu hộ COD | staff, admin | - | SHP-REQ-20261006-101103927 |
| shp-shipment-admin-detail-shipped-at | Thời điểm bàn giao | staff, admin | - | SHP-REQ-20261006-101103927 |
| shp-shipment-admin-detail-delivered-at | Thời điểm giao xong | staff, admin | - | SHP-REQ-20261006-101103927 |
| shp-shipment-admin-detail-recipient | Khối người nhận (tên, điện thoại, địa chỉ) | staff, admin | - | SHP-REQ-20261006-101103927 |
| shp-shipment-admin-detail-recipient-hidden | Dòng thông tin người nhận được ẩn | staff | - | SHP-REQ-20261006-101103927 |
| shp-shipment-admin-detail-no-shipment | Vùng chưa có vận đơn | staff, admin | - | SHP-REQ-20261006-101103927 |
| shp-shipment-admin-detail-ship | Nút Bàn giao (chỉ khi chờ bàn giao) | staff, admin | Mở hộp thoại bàn giao | SHP-REQ-20261006-101103855 |
| shp-shipment-admin-detail-ship-form | Hộp thoại bàn giao | staff, admin | - | SHP-REQ-20261006-101103855 |
| shp-shipment-admin-detail-ship-tracking-input | Ô mã vận đơn khi bàn giao | staff, admin | Nhập mã vận đơn | SHP-REQ-20261006-101103855 |
| shp-shipment-admin-detail-ship-confirm | Nút Bàn giao trong hộp thoại | staff, admin | Gửi bàn giao | SHP-REQ-20261006-101103855 |
| shp-shipment-admin-detail-ship-cancel | Nút Hủy trong hộp thoại bàn giao | staff, admin | Đóng không gửi | SHP-REQ-20261006-101103855 |
| shp-shipment-admin-detail-ship-loading | Trạng thái đang bàn giao | staff, admin | - | SHP-REQ-20261006-101103855 |
| shp-shipment-admin-detail-ship-error | Lỗi mã sai định dạng hoặc mã trùng dưới ô | staff, admin | - | SHP-REQ-20261006-101103855 |
| shp-shipment-admin-detail-ship-blocked | Lỗi không bàn giao được (đơn không sẵn sàng, đổi trạng thái) | staff, admin | - | SHP-REQ-20261006-101103855 |
| shp-shipment-admin-detail-toast-shipped | Toast Đã bàn giao | staff, admin | - | SHP-REQ-20261006-101103855 |
| shp-shipment-admin-detail-edit-tracking | Nút Sửa mã vận đơn (chỉ khi đang giao) | staff, admin | Mở hộp thoại sửa mã | SHP-REQ-20261006-101103880 |
| shp-shipment-admin-detail-edit-form | Hộp thoại sửa mã | staff, admin | - | SHP-REQ-20261006-101103880 |
| shp-shipment-admin-detail-edit-input | Ô mã vận đơn mới | staff, admin | Nhập mã mới | SHP-REQ-20261006-101103880 |
| shp-shipment-admin-detail-edit-save | Nút Lưu mã | staff, admin | Gửi sửa mã | SHP-REQ-20261006-101103880 |
| shp-shipment-admin-detail-edit-cancel | Nút Hủy trong hộp thoại sửa mã | staff, admin | Đóng không lưu | SHP-REQ-20261006-101103880 |
| shp-shipment-admin-detail-edit-error | Lỗi sửa mã (định dạng, trùng, không đổi, xung đột) | staff, admin | - | SHP-REQ-20261006-101103880 |
| shp-shipment-admin-detail-edit-reload | Nút Tải lại vận đơn khi xung đột phiên bản | staff, admin | Nạp lại vận đơn | SHP-REQ-20261006-101103880 |
| shp-shipment-admin-detail-toast-tracking | Toast Đã lưu mã vận đơn | staff, admin | - | SHP-REQ-20261006-101103880 |
| shp-shipment-admin-detail-deliver | Nút Giao xong (chỉ khi đang giao) | staff, admin | Mở hộp xác nhận giao xong | SHP-REQ-20261006-101103903 |
| shp-shipment-admin-detail-deliver-confirm | Nút Xác nhận trong hộp giao xong | staff, admin | Gửi giao xong | SHP-REQ-20261006-101103903 |
| shp-shipment-admin-detail-fail | Nút Giao thất bại (chỉ khi đang giao) | staff, admin | Mở hộp thoại thất bại | SHP-REQ-20261006-101103903 |
| shp-shipment-admin-detail-fail-reason | Chọn lý do thất bại | staff, admin | Chọn một trong năm lý do | SHP-REQ-20261006-101103903 |
| shp-shipment-admin-detail-fail-note | Ô ghi chú thất bại (tối đa 300 ký tự) | staff, admin | Nhập ghi chú | SHP-REQ-20261006-101103903 |
| shp-shipment-admin-detail-fail-confirm | Nút Xác nhận thất bại | staff, admin | Gửi báo thất bại | SHP-REQ-20261006-101103903 |
| shp-shipment-admin-detail-return | Nút Hàng đã về kho (chỉ khi thất bại) | staff, admin | Mở hộp xác nhận hoàn hàng | SHP-REQ-20261006-101103903 |
| shp-shipment-admin-detail-return-confirm | Nút Xác nhận trong hộp hoàn hàng | staff, admin | Gửi hoàn hàng | SHP-REQ-20261006-101103903 |
| shp-shipment-admin-detail-result-cancel | Nút Hủy trong các hộp xác nhận kết quả | staff, admin | Đóng không gửi | SHP-REQ-20261006-101103903 |
| shp-shipment-admin-detail-result-loading | Trạng thái đang cập nhật kết quả | staff, admin | - | SHP-REQ-20261006-101103903 |
| shp-shipment-admin-detail-result-error | Lỗi cập nhật kết quả trong hộp thoại | staff, admin | - | SHP-REQ-20261006-101103903 |
| shp-shipment-admin-detail-result-reload | Nút Tải lại vận đơn khi đổi trạng thái | staff, admin | Nạp lại vận đơn | SHP-REQ-20261006-101103903 |
| shp-shipment-admin-detail-toast-result | Toast Đã cập nhật vận đơn | staff, admin | - | SHP-REQ-20261006-101103903 |
| shp-shipment-admin-detail-history | Khối lịch sử vận đơn | staff, admin | - | SHP-REQ-20261006-101103972 |
| shp-shipment-admin-detail-history-item | Một dòng lịch sử | staff, admin | - | SHP-REQ-20261006-101103972 |
| shp-shipment-admin-detail-history-time | Giờ của dòng lịch sử | staff, admin | - | SHP-REQ-20261006-101103972 |
| shp-shipment-admin-detail-history-reason | Lý do và ghi chú ở dòng thất bại | staff, admin | - | SHP-REQ-20261006-101103972 |
| shp-shipment-admin-detail-history-empty | Vùng lịch sử rỗng | staff, admin | - | SHP-REQ-20261006-101103972 |
| shp-shipment-admin-detail-history-error | Banner lỗi tải lịch sử | staff, admin | - | SHP-REQ-20261006-101103972 |
| shp-shipment-admin-detail-history-retry | Nút Thử lại tải lịch sử | staff, admin | Tải lại lịch sử | SHP-REQ-20261006-101103972 |
| shp-shipment-admin-detail-loading | Khung chờ | staff, admin | - | SHP-REQ-20261006-101103927 |
| shp-shipment-admin-detail-error | Banner lỗi tải vận đơn | staff, admin | - | SHP-REQ-20261006-101103927 |
| shp-shipment-admin-detail-retry | Nút Thử lại | staff, admin | Tải lại vận đơn | SHP-REQ-20261006-101103927 |
| shp-shipment-admin-detail-not-found | Vùng không tìm thấy | staff, admin | - | SHP-REQ-20261006-101103927 |
| shp-shipment-admin-detail-not-found-back | Nút Về danh sách vận đơn | staff, admin | Về danh sách | SHP-REQ-20261006-101103927 |
| shp-shipment-admin-detail-session-expired | Hộp thoại phiên đã hết hạn | staff, admin | - | SHP-REQ-20261006-101103927 |
| shp-shipment-admin-detail-forbidden | Trang không có quyền (customer) | staff, admin | - | SHP-REQ-20261006-101103927 |

## Ghi chú thiết kế (mặc định, chưa duyệt)
- Hai role dùng chung màn vì cùng quyền thao tác trong ma trận (staff và admin đều bàn giao, sửa mã, báo kết quả). Chỉ một phần tử khác nhau theo role: `recipient-hidden` chỉ staff (khi vận đơn đã xong); admin luôn thấy khối người nhận đầy đủ.
- Khối Người nhận của staff theo SHP-REQ-20261006-101103927 BR5 (hiện khi đang xử lý, ẩn khi đã xong) là ngoại lệ (b) của SB-08 sau khi sửa nền (S-04, K-13), khác với màn đơn của ORD (staff không thấy địa chỉ, ngoại lệ (c)). Mỗi lần khối này được tải, server ghi audit `shipment.view_recipient` (SB-19); giao diện không cần thêm phần tử. Địa chỉ gồm tên, điện thoại, số nhà và đường, phường, thành phố (bản chụp địa chỉ của đơn, E-06, E-12).
- Nút hành động theo trạng thái là quy tắc giao diện (server vẫn kiểm lại và trả 409). Khi 409, giao diện nêu "Vận đơn đã đổi trạng thái" và cho tải lại thay vì tự đoán trạng thái mới.
- Mọi hộp thoại có ô nhập (bàn giao, sửa mã, thất bại) không đóng khi bấm ra ngoài (luật `I20`); hộp xác nhận không có ô nhập đóng được khi bấm ra ngoài.
- Lý do thất bại hiển thị bằng nhãn tiếng Việt (Không liên lạc được, Từ chối nhận, Sai địa chỉ, Hàng hỏng, Khác); ghi chú luôn escape khi hiển thị (SB-12).
- "Không có quyền" ghi role `staff, admin` vì check-ui chỉ nhận role của màn; người thấy trạng thái này thật ra là customer (ghi ở questions.md, mục D).
- Mã đơn (`code`) trên đầu trang lấy từ địa chỉ trang; vận đơn được địa chỉ hóa theo mã đơn (một vận đơn còn hiệu lực mỗi đơn), không có mã vận đơn nội bộ nào lộ ra URL.
