---
screen: shipping-method-admin
epic: SHP
status: draft
covers: [SHP-REQ-20261006-101103755]
roles: [admin]
---
# Phương thức vận chuyển (admin tạo, sửa, bật, tắt)

## Wireframe
Phương án đã chọn: **A** (bảng một khối: mỗi phương thức một dòng, nút "Thêm phương thức" ở đầu trang, hộp thoại cho tạo và sửa, menu `⋯` mỗi dòng cho Sửa, Bật hoặc Tắt). **Đây là lựa chọn mặc định** (khuyến nghị theo `U3`), chưa có người dùng chọn: các cổng "duyệt brief", "xác nhận danh sách màn" và "chọn wireframe" không hỏi được ở lần chạy này.

| Phương án | Việc chính thấy ở đâu | Đổi gì | Đánh đổi |
|---|---|---|---|
| **A. Bảng và hộp thoại (khuyên dùng, đã chọn)** | Tên, phí cơ bản, ngưỡng miễn phí, phụ thu, trạng thái cùng một dòng | Tạo và sửa trong hộp thoại, bật hoặc tắt từ menu dòng | Tối đa 20 dòng nên không cần phân trang; sửa phải mở hộp thoại |
| B. Thẻ (card) mỗi phương thức | Mỗi phương thức một thẻ có công tắc bật tắt | Công tắc ngay trên thẻ | So sánh phí giữa các phương thức khó; công tắc dễ bấm nhầm khi tắt ảnh hưởng checkout |
| C. Sửa ngay trong dòng (inline) | Ô nhập nằm trong bảng | Không mở hộp thoại | Ba ô tiền cộng danh sách thành phố làm dòng quá cao; khóa lạc quan (`version`) khó thể hiện |

Lý do chọn A: admin so sánh phí giữa vài phương thức và thỉnh thoảng sửa; thứ để so sánh là phí cơ bản, ngưỡng miễn phí và trạng thái bật. Bảng đọc được ở 20 dòng, hộp thoại gom bốn trường và danh sách thành phố ở một chỗ.

```
Thanh header:  ☰  Vận chuyển › Phương thức                                🔔  (A)
┌──────────────────────────────────────────────────────────────────────────────────┐
│ Phương thức vận chuyển                                    [ + Thêm phương thức ]   │
│ 3 trên 20 phương thức tối đa                                                       │
├──────────────────────────────────────────────────────────────────────────────────┤
│ Tên               Phí cơ bản   Miễn phí từ    Phụ thu            Trạng thái      ⋯   │
│ Giao nhanh          50.000 đ    —              —                  (Đang bật)      ⋯  │
│ Giao tiêu chuẩn     30.000 đ    500.000 đ      +20.000 đ · 2 TP   (Đang bật)      ⋯  │
│ Giao hỏa tốc        90.000 đ    —              —                  (Đã tắt)        ⋯  │
└──────────────────────────────────────────────────────────────────────────────────┘
Menu ⋯: Sửa... | Tắt phương thức... (hoặc Bật phương thức khi đang tắt)

Hộp thoại Thêm hoặc Sửa phương thức (không đóng khi bấm ra ngoài vì có ô nhập, luật I20 của evon):
┌ Thêm phương thức vận chuyển ───────────────────────────────┐
│ Tên                  [ Giao tiêu chuẩn                    ] │  2 tới 80 ký tự
│ Phí cơ bản (đ)       [ 30000                              ] │  0 tới 1.000.000
│ Miễn phí từ (đ)      [ 500000      ]  để trống = không miễn  │  0 tới 10.000.000.000
│ Phụ thu vùng xa (đ)  [ 20000       ]                        │  0 tới 500.000
│ Thành phố phụ thu    [ Hà Giang ✕ ] [ Cao Bằng ✕ ] [ thêm ] │  tối đa 63, bắt buộc khi phụ thu > 0
│                                          [Hủy]  [Lưu]        │
└──────────────────────────────────────────────────────────────┘
Hộp xác nhận Tắt: "Tắt Giao nhanh? Khách sẽ không chọn được phương thức này; đơn đã tạo không đổi." [Giữ bật] [Tắt]
```
Bật lại không cần xác nhận (có thể tắt lại ngay). Dưới `sm`: bảng thành danh sách thẻ hai tầng (tên và trạng thái trên, phí dưới), menu `⋯` giữ nguyên. Số tiền dùng `tabular-nums`, căn phải; giá trị trống là `—` theo evon.

## Trạng thái
| Trạng thái | Trông ra sao | Requirement |
|---|---|---|
| có dữ liệu | Các dòng mới tạo trước, dòng đã tắt có badge "Đã tắt" nhãn đọc rõ không chỉ bằng màu; dòng "n trên 20 phương thức tối đa" ở đầu bảng | SHP-REQ-20261006-101103755 |
| đang tải | Khung chờ đúng hình 3 dòng bảng | SHP-REQ-20261006-101103755 |
| rỗng | "Chưa có phương thức vận chuyển nào. Khách chưa thể đặt hàng." kèm nút Thêm phương thức | SHP-REQ-20261006-101103755 |
| lỗi | Banner "Không tải được danh sách." kèm nút Thử lại | SHP-REQ-20261006-101103755 |
| hết phiên | 401: chuyển về đăng nhập | SHP-REQ-20261006-101103755 |
| không có quyền | Staff hoặc customer mở màn này (403): trang lỗi "Bạn không có quyền xem trang này" kèm nút về trang chủ | SHP-REQ-20261006-101103755 |
| đạt trần 20 | Nút Thêm phương thức bị tắt kèm chú thích "Đã đủ 20 phương thức, tắt hoặc sửa phương thức có sẵn"; nếu server vẫn trả 409 `too-many-methods` thì hiện lỗi trong hộp thoại | SHP-REQ-20261006-101103755 |
| hộp thoại tạo hoặc sửa | Hộp thoại với năm trường như wireframe; Lưu khóa khi tên rỗng hay tiền ngoài miền | SHP-REQ-20261006-101103755 |
| lỗi trường | Lỗi dưới từng ô: tên rỗng hoặc dài hơn 80, tiền âm hay có số lẻ, phụ thu lớn hơn 0 mà thiếu thành phố (400) | SHP-REQ-20261006-101103755 |
| tên đã dùng | Lỗi dưới ô tên "Tên này đã được dùng" (409, không phân biệt hoa thường) | SHP-REQ-20261006-101103755 |
| xung đột phiên bản | Banner trong hộp thoại "Phương thức đã được người khác sửa" kèm nút Tải lại dữ liệu (409 `version-conflict`); giữ giá trị đang nhập | SHP-REQ-20261006-101103755 |
| đang lưu | Nút Lưu khóa và có vòng xoay, các ô khóa | SHP-REQ-20261006-101103755 |
| lưu xong | Hộp thoại đóng, dòng cập nhật hoặc thêm vào bảng, toast "Đã lưu phương thức" | SHP-REQ-20261006-101103755 |
| hộp thoại tắt | Hộp xác nhận nêu tên phương thức và hậu quả (khách không chọn được, đơn cũ không đổi) | SHP-REQ-20261006-101103755 |
| tắt hoặc bật xong | Badge của dòng đổi, toast "Đã tắt phương thức" hoặc "Đã bật phương thức" | SHP-REQ-20261006-101103755 |
| trạng thái không đổi | Toast lỗi "Phương thức đã ở trạng thái này" (409 `method-state-unchanged`) và làm mới dòng | SHP-REQ-20261006-101103755 |
| bật tắt bị từ chối | Staff hay hết phiên khi đang thao tác: 403 hoặc 401, toast lỗi chung hoặc chuyển về đăng nhập | SHP-REQ-20261006-101103755 |

## Phần tử
| testid | Phần tử | Role | Hành động | Requirement |
|---|---|---|---|---|
| shp-shipping-method-admin-add | Nút Thêm phương thức | admin | Mở hộp thoại tạo | SHP-REQ-20261006-101103755 |
| shp-shipping-method-admin-limit-note | Chú thích đã đủ 20 phương thức | admin | - | SHP-REQ-20261006-101103755 |
| shp-shipping-method-admin-count | Dòng "n trên 20 phương thức tối đa" | admin | - | SHP-REQ-20261006-101103755 |
| shp-shipping-method-admin-table | Bảng phương thức | admin | - | SHP-REQ-20261006-101103755 |
| shp-shipping-method-admin-row | Dòng phương thức | admin | - | SHP-REQ-20261006-101103755 |
| shp-shipping-method-admin-name | Tên phương thức | admin | - | SHP-REQ-20261006-101103755 |
| shp-shipping-method-admin-base-fee | Phí cơ bản, căn phải | admin | - | SHP-REQ-20261006-101103755 |
| shp-shipping-method-admin-free-over | Ngưỡng miễn phí hoặc `—` | admin | - | SHP-REQ-20261006-101103755 |
| shp-shipping-method-admin-surcharge | Phụ thu và số thành phố hoặc `—` | admin | - | SHP-REQ-20261006-101103755 |
| shp-shipping-method-admin-status | Badge Đang bật hoặc Đã tắt | admin | - | SHP-REQ-20261006-101103755 |
| shp-shipping-method-admin-row-menu | Nút menu `⋯` của dòng | admin | Mở menu Sửa, Bật, Tắt | SHP-REQ-20261006-101103755 |
| shp-shipping-method-admin-edit | Mục Sửa trong menu | admin | Mở hộp thoại sửa | SHP-REQ-20261006-101103755 |
| shp-shipping-method-admin-disable | Mục Tắt phương thức (chỉ dòng đang bật) | admin | Mở hộp xác nhận tắt | SHP-REQ-20261006-101103755 |
| shp-shipping-method-admin-enable | Mục Bật phương thức (chỉ dòng đã tắt) | admin | Bật ngay | SHP-REQ-20261006-101103755 |
| shp-shipping-method-admin-form | Hộp thoại tạo hoặc sửa | admin | - | SHP-REQ-20261006-101103755 |
| shp-shipping-method-admin-name-input | Ô tên | admin | Nhập tên | SHP-REQ-20261006-101103755 |
| shp-shipping-method-admin-base-fee-input | Ô phí cơ bản | admin | Nhập số tiền | SHP-REQ-20261006-101103755 |
| shp-shipping-method-admin-free-over-input | Ô miễn phí từ (để trống là không miễn) | admin | Nhập số tiền | SHP-REQ-20261006-101103755 |
| shp-shipping-method-admin-surcharge-input | Ô phụ thu vùng xa | admin | Nhập số tiền | SHP-REQ-20261006-101103755 |
| shp-shipping-method-admin-cities-input | Ô thêm thành phố phụ thu (thẻ có nút ✕) | admin | Thêm hoặc bỏ thành phố | SHP-REQ-20261006-101103755 |
| shp-shipping-method-admin-field-error | Lỗi dưới ô (`data-field` nêu ô) | admin | - | SHP-REQ-20261006-101103755 |
| shp-shipping-method-admin-name-taken | Lỗi tên đã được dùng | admin | - | SHP-REQ-20261006-101103755 |
| shp-shipping-method-admin-conflict | Banner xung đột phiên bản | admin | - | SHP-REQ-20261006-101103755 |
| shp-shipping-method-admin-conflict-reload | Nút Tải lại dữ liệu | admin | Nạp lại phương thức mới nhất | SHP-REQ-20261006-101103755 |
| shp-shipping-method-admin-form-error | Lỗi chung trong hộp thoại (đạt trần 20, lỗi mạng) | admin | - | SHP-REQ-20261006-101103755 |
| shp-shipping-method-admin-save | Nút Lưu | admin | Gửi tạo hoặc sửa | SHP-REQ-20261006-101103755 |
| shp-shipping-method-admin-cancel | Nút Hủy trong hộp thoại | admin | Đóng không lưu | SHP-REQ-20261006-101103755 |
| shp-shipping-method-admin-saving | Trạng thái đang lưu | admin | - | SHP-REQ-20261006-101103755 |
| shp-shipping-method-admin-toast-saved | Toast Đã lưu phương thức | admin | - | SHP-REQ-20261006-101103755 |
| shp-shipping-method-admin-disable-confirm | Hộp xác nhận tắt | admin | - | SHP-REQ-20261006-101103755 |
| shp-shipping-method-admin-disable-confirm-yes | Nút Tắt trong hộp xác nhận | admin | Xác nhận tắt | SHP-REQ-20261006-101103755 |
| shp-shipping-method-admin-disable-confirm-no | Nút Giữ bật | admin | Đóng hộp xác nhận | SHP-REQ-20261006-101103755 |
| shp-shipping-method-admin-toast-state | Toast Đã tắt hoặc Đã bật phương thức | admin | - | SHP-REQ-20261006-101103755 |
| shp-shipping-method-admin-toast-unchanged | Toast lỗi phương thức đã ở trạng thái này | admin | - | SHP-REQ-20261006-101103755 |
| shp-shipping-method-admin-loading | Khung chờ | admin | - | SHP-REQ-20261006-101103755 |
| shp-shipping-method-admin-empty | Vùng rỗng, chưa có phương thức | admin | - | SHP-REQ-20261006-101103755 |
| shp-shipping-method-admin-error | Banner lỗi tải danh sách | admin | - | SHP-REQ-20261006-101103755 |
| shp-shipping-method-admin-retry | Nút Thử lại | admin | Tải lại danh sách | SHP-REQ-20261006-101103755 |
| shp-shipping-method-admin-session-expired | Hộp thoại phiên đã hết hạn | admin | - | SHP-REQ-20261006-101103755 |
| shp-shipping-method-admin-forbidden | Trang không có quyền (staff, customer) | admin | - | SHP-REQ-20261006-101103755 |

## Ghi chú thiết kế (mặc định, chưa duyệt)
- Màn này chỉ dành cho admin; role `staff` và `customer` mở được địa chỉ này sẽ thấy trạng thái "không có quyền". Phần tử "không có quyền" ghi role `admin` vì check-ui chỉ nhận role của màn; người thật thấy nó là staff hoặc customer (đã nêu trong questions.md, mục D).
- Danh sách không phân trang vì tối đa 20 phương thức bằng `limit` mặc định 20 (SHP-REQ-20261006-101103755 BR3, BR10); nếu sau này tăng trần thì thêm phân trang.
- Hộp thoại có ô nhập nên bấm ra ngoài không đóng (luật `I20`); hộp xác nhận tắt không có ô nhập nên đóng được khi bấm ra ngoài.
- `version` của phương thức nằm trong dữ liệu hộp thoại (không hiện ra); khi 409 `version-conflict` giữ giá trị đang nhập, người dùng tải lại để thấy giá trị mới.
- "Ô nhập đang để trơn, không có icon trái" (mặc định của evon).
