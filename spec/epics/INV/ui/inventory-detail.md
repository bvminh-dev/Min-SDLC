---
screen: inventory-detail
epic: INV
status: draft
covers: [INV-REQ-20261006-101122435, INV-REQ-20261006-101122463, INV-REQ-20261006-101122487, INV-REQ-20261006-101122512, INV-REQ-20261006-101122611, INV-REQ-20261006-101122637]
roles: [staff, admin]
---
# Chi tiết tồn kho (nhập, xuất, điều chỉnh, đổi ngưỡng)

## Wireframe
Phương án đã chọn: **A** (trang chi tiết bản ghi: khối số liệu ở đầu, nhóm nút thao tác ngay dưới, mỗi thao tác mở một hộp thoại). **Đây là lựa chọn mặc định** (khuyến nghị theo `U3`), chưa có người dùng chọn. Không dựng HTML hay chạy probe ở phase này.

| Phương án | Việc chính thấy ở đâu | Đổi gì | Đánh đổi |
|---|---|---|---|
| **A. Số liệu cộng ba nút và hộp thoại (khuyên dùng, đã chọn)** | Ba con số Đang có, Đang giữ, Còn bán nằm trên cùng; nút Nhập kho, Xuất kho, Điều chỉnh ngay dưới | Mỗi thao tác một hộp thoại có ô nhập và lý do | Thêm một cú bấm, đổi lại không nhập nhầm khi đang đọc số |
| B. Biểu mẫu tại chỗ (ba form xếp dọc) | Cả ba thao tác luôn hiện | Không phải mở hộp thoại | Nhiều ô nhập luôn hiện, dễ bấm nhầm form; số liệu bị đẩy lên cao khi báo lỗi |
| C. Chia tab Số liệu / Thao tác | Một khối tại một lúc | Trang ngắn | Số liệu (căn cứ của mọi thao tác) bị ẩn sau một lần bấm |

Lý do chọn A: người mở trang cần thấy số hiện tại trước khi nhập, xuất hay điều chỉnh, và cần biết `Đang giữ` để hiểu vì sao không xuất hết được (INV-REQ-20261006-101122487 BR3). Hộp thoại có ô nhập nên không đóng khi bấm ra ngoài (luật I20 của evon); Esc và nút Hủy đóng được.

```
Thanh header:  ☰  Tồn kho › Áo thun cotton                                         🔔  (T)
┌──────────────────────────────────────────────────────────────────────────────────┐
│ ← Quay lại danh sách                                                             │
│ Áo thun cotton   AT-001   (Tồn thấp)  (Ngừng bán)                                │
│                                                                                  │
│  Đang có      Đang giữ      Còn bán được       Ngưỡng tồn thấp                   │
│    50           8              42                5     [Đổi ngưỡng]              │
│                                                                                  │
│ [Nhập kho]  [Xuất kho]  [Điều chỉnh theo kiểm kê]            Xem lịch sử →       │
└──────────────────────────────────────────────────────────────────────────────────┘

Hộp thoại Nhập kho:                          Hộp thoại Điều chỉnh theo kiểm kê:
┌ Nhập kho: Áo thun cotton ───────────┐     ┌ Điều chỉnh: Áo thun cotton ─────────────┐
│ Số lượng      [ 40        ]  (1-100000)│   │ Đang có 18, đang giữ 4                   │
│ Lý do         [Nhập từ NCC ▾]          │   │ Số đếm thực   [ 15 ]   Chênh lệch -3     │
│ Ghi chú       [                      ] │   │ Ghi chú (bắt buộc, 5-200 ký tự) [      ] │
│ (lỗi hiển thị ở đây)                   │   │ (lỗi hiển thị ở đây)                      │
│                    [Hủy]  [Nhập kho]   │   │                     [Hủy]  [Xác nhận]    │
└────────────────────────────────────────┘   └───────────────────────────────────────────┘
Hộp thoại Xuất kho giống Nhập kho (lý do: Hỏng, Mất, Dùng nội bộ, Khác), có dòng "Tối đa xuất được: 40".
Hộp thoại Đổi ngưỡng: một ô số (0-1000000) và nút Lưu.
```

## Trạng thái
Testid của vùng trạng thái nằm trong bảng Phần tử bên dưới (nêu trong ngoặc).

| Trạng thái | Trông ra sao | Requirement |
|---|---|---|
| có dữ liệu | Tên, sku, ba số và ngưỡng, ba nút thao tác và liên kết lịch sử; Còn bán = Đang có trừ Đang giữ, không âm (`inv-inventory-detail-available`) | INV-REQ-20261006-101122435 |
| đang tải | Khung chờ đúng hình khối số liệu; nút thao tác tắt cho tới khi có số liệu | INV-REQ-20261006-101122435 |
| lỗi | Banner "Không tải được tồn kho." kèm "Thử lại" (lỗi mạng hay 5xx); quá giới hạn tần suất (429) hiện "Thao tác quá nhanh, thử lại sau N giây" theo `Retry-After` ở banner này hoặc ở vùng lỗi của hộp thoại đang mở; chưa đăng nhập (401) về đăng nhập (`inv-inventory-detail-error`) | INV-REQ-20261006-101122435 |
| không tìm thấy | Khối căn giữa: "404" mờ, "Không tìm thấy bản ghi kho", một câu vì sao (sản phẩm chưa công bố hoặc không tồn tại), nút "Về danh sách tồn kho"; cùng một giao diện cho mọi nguyên nhân (`inv-inventory-detail-not-found`) | INV-REQ-20261006-101122435 |
| không có quyền | Customer mở màn này (403) thấy trang lỗi chung của web (khung ứng dụng chung, epic PRJ), không có testid ở đây | INV-REQ-20261006-101122435 |
| ngừng bán | Badge "Ngừng bán" và dải thông báo "Sản phẩm đã ngừng bán: không nhập thêm được"; nút Nhập kho tắt kèm lý do, nút Xuất kho và Điều chỉnh vẫn dùng được (`inv-inventory-detail-archived-notice`) | INV-REQ-20261006-101122463 |
| tồn thấp | Badge "Tồn thấp" cạnh tên khi Còn bán nhỏ hơn hoặc bằng ngưỡng, chữ và biểu tượng (`inv-inventory-detail-low-badge`) | INV-REQ-20261006-101122611 |
| đang gửi | Nút xác nhận của hộp thoại tắt kèm vòng quay; ô nhập tắt; Esc và Hủy bị tạm vô hiệu cho tới khi có kết quả | INV-REQ-20261006-101122463 |
| nhập kho thành công | Hộp thoại đóng, thông báo nổi "Đã nhập 40 đơn vị", ba số cập nhật theo phản hồi (`inv-inventory-detail-toast`) | INV-REQ-20261006-101122463 |
| nhập kho lỗi | Trong hộp thoại, dưới ô lỗi: 400 chỉ rõ ô sai (số lượng ngoài 1 đến 100000, thiếu ghi chú khi lý do Khác); 409 "Sản phẩm đã ngừng bán" hoặc "Vượt giới hạn 10.000.000" (`inv-inventory-detail-stock-in-error`) | INV-REQ-20261006-101122463 |
| xuất kho lỗi | Trong hộp thoại: 409 "Chỉ còn 40 có thể xuất" (dòng số `available` từ phản hồi), ô số lượng giữ nguyên giá trị; 400 như trên (`inv-inventory-detail-stock-out-error`) | INV-REQ-20261006-101122487 |
| điều chỉnh xung đột | Trong hộp thoại: 409 `stock-version-conflict` thì hiện "Số liệu đã thay đổi, tải lại để tiếp tục" kèm nút "Tải lại số liệu"; 409 `below-reserved` thì "Số đếm không thể thấp hơn số đang giữ (4)" (`inv-inventory-detail-adjust-error`) | INV-REQ-20261006-101122512 |
| đổi ngưỡng lỗi | Trong hộp thoại: 400 "Ngưỡng từ 0 đến 1.000.000" (`inv-inventory-detail-threshold-error`) | INV-REQ-20261006-101122611 |

## Phần tử
| testid | Phần tử | Role | Hành động | Requirement |
|---|---|---|---|---|
| inv-inventory-detail-back | Liên kết Quay lại danh sách | staff, admin | Về danh sách tồn kho | INV-REQ-20261006-101122435 |
| inv-inventory-detail-name | Tên sản phẩm | staff, admin | - | INV-REQ-20261006-101122435 |
| inv-inventory-detail-sku | Sku (font-mono) | staff, admin | - | INV-REQ-20261006-101122435 |
| inv-inventory-detail-on-hand | Số đang có | staff, admin | - | INV-REQ-20261006-101122435 |
| inv-inventory-detail-reserved | Số đang giữ | staff, admin | - | INV-REQ-20261006-101122435 |
| inv-inventory-detail-available | Số còn bán được | staff, admin | - | INV-REQ-20261006-101122435 |
| inv-inventory-detail-threshold | Ngưỡng tồn thấp hiện tại | staff, admin | - | INV-REQ-20261006-101122611 |
| inv-inventory-detail-low-badge | Badge Tồn thấp | staff, admin | - | INV-REQ-20261006-101122611 |
| inv-inventory-detail-archived-notice | Dải thông báo ngừng bán | staff, admin | - | INV-REQ-20261006-101122463 |
| inv-inventory-detail-loading | Khung chờ | staff, admin | - | INV-REQ-20261006-101122435 |
| inv-inventory-detail-error | Banner lỗi tải | staff, admin | - | INV-REQ-20261006-101122435 |
| inv-inventory-detail-retry | Nút Thử lại | staff, admin | Tải lại số liệu | INV-REQ-20261006-101122435 |
| inv-inventory-detail-not-found | Khối không tìm thấy | staff, admin | - | INV-REQ-20261006-101122435 |
| inv-inventory-detail-toast | Thông báo thành công sau thao tác | staff, admin | - | INV-REQ-20261006-101122463 |
| inv-inventory-detail-history-link | Liên kết Xem lịch sử | staff, admin | Mở lịch sử biến động kho | INV-REQ-20261006-101122637 |
| inv-inventory-detail-stock-in | Nút Nhập kho | staff, admin | Mở hộp thoại nhập kho | INV-REQ-20261006-101122463 |
| inv-inventory-detail-stock-in-quantity | Ô số lượng nhập | staff, admin | Nhập số nguyên 1 đến 100000 | INV-REQ-20261006-101122463 |
| inv-inventory-detail-stock-in-reason | Chọn lý do nhập | staff, admin | Chọn Nhập từ NCC, Chuyển kho đến hoặc Khác | INV-REQ-20261006-101122463 |
| inv-inventory-detail-stock-in-note | Ô ghi chú nhập | staff, admin | Nhập tối đa 200 ký tự (bắt buộc khi lý do Khác) | INV-REQ-20261006-101122463 |
| inv-inventory-detail-stock-in-submit | Nút xác nhận nhập kho | staff, admin | Gửi yêu cầu nhập | INV-REQ-20261006-101122463 |
| inv-inventory-detail-stock-in-cancel | Nút Hủy hộp thoại nhập | staff, admin | Đóng hộp thoại | INV-REQ-20261006-101122463 |
| inv-inventory-detail-stock-in-error | Vùng lỗi của hộp thoại nhập | staff, admin | - | INV-REQ-20261006-101122463 |
| inv-inventory-detail-stock-out | Nút Xuất kho | staff, admin | Mở hộp thoại xuất kho | INV-REQ-20261006-101122487 |
| inv-inventory-detail-stock-out-quantity | Ô số lượng xuất | staff, admin | Nhập số nguyên 1 đến 100000 | INV-REQ-20261006-101122487 |
| inv-inventory-detail-stock-out-reason | Chọn lý do xuất | staff, admin | Chọn Hỏng, Mất, Dùng nội bộ hoặc Khác | INV-REQ-20261006-101122487 |
| inv-inventory-detail-stock-out-note | Ô ghi chú xuất | staff, admin | Nhập tối đa 200 ký tự (bắt buộc khi lý do Khác) | INV-REQ-20261006-101122487 |
| inv-inventory-detail-stock-out-max | Dòng "Tối đa xuất được" | staff, admin | - | INV-REQ-20261006-101122487 |
| inv-inventory-detail-stock-out-submit | Nút xác nhận xuất kho | staff, admin | Gửi yêu cầu xuất | INV-REQ-20261006-101122487 |
| inv-inventory-detail-stock-out-cancel | Nút Hủy hộp thoại xuất | staff, admin | Đóng hộp thoại | INV-REQ-20261006-101122487 |
| inv-inventory-detail-stock-out-error | Vùng lỗi của hộp thoại xuất | staff, admin | - | INV-REQ-20261006-101122487 |
| inv-inventory-detail-adjust | Nút Điều chỉnh theo kiểm kê | staff, admin | Mở hộp thoại điều chỉnh | INV-REQ-20261006-101122512 |
| inv-inventory-detail-adjust-new-on-hand | Ô số đếm thực | staff, admin | Nhập số nguyên 0 đến 10000000 | INV-REQ-20261006-101122512 |
| inv-inventory-detail-adjust-delta | Dòng Chênh lệch tính sẵn | staff, admin | - | INV-REQ-20261006-101122512 |
| inv-inventory-detail-adjust-note | Ô ghi chú kiểm kê (bắt buộc) | staff, admin | Nhập 5 đến 200 ký tự | INV-REQ-20261006-101122512 |
| inv-inventory-detail-adjust-submit | Nút xác nhận điều chỉnh | staff, admin | Gửi yêu cầu điều chỉnh | INV-REQ-20261006-101122512 |
| inv-inventory-detail-adjust-cancel | Nút Hủy hộp thoại điều chỉnh | staff, admin | Đóng hộp thoại | INV-REQ-20261006-101122512 |
| inv-inventory-detail-adjust-error | Vùng lỗi của hộp thoại điều chỉnh | staff, admin | - | INV-REQ-20261006-101122512 |
| inv-inventory-detail-adjust-reload | Nút Tải lại số liệu (khi xung đột phiên bản) | staff, admin | Lấy lại số liệu và version mới | INV-REQ-20261006-101122512 |
| inv-inventory-detail-edit-threshold | Nút Đổi ngưỡng | staff, admin | Mở hộp thoại đổi ngưỡng | INV-REQ-20261006-101122611 |
| inv-inventory-detail-threshold-input | Ô ngưỡng mới | staff, admin | Nhập số nguyên 0 đến 1000000 | INV-REQ-20261006-101122611 |
| inv-inventory-detail-threshold-submit | Nút Lưu ngưỡng | staff, admin | Gửi yêu cầu đổi ngưỡng | INV-REQ-20261006-101122611 |
| inv-inventory-detail-threshold-error | Vùng lỗi của hộp thoại ngưỡng | staff, admin | - | INV-REQ-20261006-101122611 |

## Ghi chú thiết kế (mặc định, chưa duyệt)
- Mỗi lần mở hộp thoại nhập, xuất hoặc điều chỉnh, giao diện sinh một `Idempotency-Key` mới và giữ nguyên khi bấm gửi lại sau lỗi mạng; đóng rồi mở lại sinh key khác (INV-REQ-20261006-101122463 BR3; khóa giữ 24 giờ ở platform, ADR-017). Không hiện key cho người dùng. Nếu nhận 422 `idempotency-key-reused` (chỉ xảy ra khi client dùng lại key cho nội dung khác) thì hộp thoại hiện "Yêu cầu không hợp lệ, hãy mở lại hộp thoại" trong vùng lỗi của hộp thoại đó và sinh key mới ở lần mở sau.
- Ô Chênh lệch của hộp thoại điều chỉnh chỉ để đọc (tính từ số đếm thực trừ Đang có) và không gửi lên; server tự tính (INV-REQ-20261006-101122512 BR6). Gửi kèm `version` đã tải; nếu xung đột thì không giữ số cũ lặng lẽ.
- Màn không có thao tác nào ngoài ba hành động kho và đổi ngưỡng; không có giữ hàng, nhả hàng thủ công (đó là việc của hệ thống, INV-REQ-20261006-101122538 và INV-REQ-20261006-101122562 không có UI).
- Hai role dùng chung vì cùng quyền trong ma trận; không phần tử nào chỉ dành cho một role. Điều chỉnh cho cả staff lẫn admin là mặc định (INV-REQ-20261006-101122512 [OPEN]).
- Trang nhận `product_id` trên đường dẫn; id sai định dạng hiện cùng khối "không tìm thấy" (INV-REQ-20261006-101122435 BR5).
