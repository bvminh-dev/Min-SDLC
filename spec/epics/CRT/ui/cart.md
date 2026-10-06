---
screen: cart
epic: CRT
status: draft
covers: [CRT-REQ-20261006-103226406, CRT-REQ-20261006-103226434, CRT-REQ-20261006-103226460, CRT-REQ-20261006-103226486, CRT-REQ-20261006-103226588]
roles: [customer]
---
# Giỏ hàng: danh sách dòng, số lượng, xóa, làm trống, cảnh báo giá và tồn

## Wireframe
Phương án đã chọn: **A** (hai cột: cột trái là danh sách dòng, cột phải là khối tóm tắt đơn ở màn `cart-summary`). **Đây là lựa chọn mặc định** (khuyến nghị theo `U3`), chưa có người dùng chọn.

| Phương án | Việc chính thấy ở đâu | Đổi gì | Đánh đổi |
|---|---|---|---|
| **A. Hai cột: dòng bên trái, tóm tắt bên phải cố định (khuyên dùng, đã chọn)** | Sửa dòng và thấy tổng đổi cùng lúc | Tổng, mã, vận chuyển luôn trong tầm mắt | Dưới `lg` xếp một cột, tóm tắt xuống cuối |
| B. Một cột, tóm tắt ở cuối trang | Cuộn dọc | Đơn giản nhất | Giỏ dài thì tổng và nút thanh toán ở rất dưới |
| C. Bảng có cột (ảnh, tên, đơn giá, số lượng, thành tiền) | Mọi dòng thẳng cột | Dễ so sánh trên máy tính | Hẹp màn thì tràn ngang; ảnh nhỏ |

Lý do chọn A: giỏ là nơi khách sửa số lượng rồi nhìn tổng; việc chính (sửa dòng, xem tổng) phải cùng một khung nhìn (CRT-REQ-20261006-103226406, CRT-REQ-20261006-103226486). Cảnh báo giá và tồn nằm ngay trên dòng liên quan.

```
Giỏ hàng (5 sản phẩm)                                                  [ Làm trống giỏ ]
┌ Giá một số sản phẩm đã đổi từ lúc bạn thêm.            [ Cập nhật giá ] ┐   <- chỉ khi price_changed
┌ Cần xử lý 2 sản phẩm trước khi thanh toán. ───────────────────────────────┐   <- chỉ khi có blocker
┌─────────────────────────────────────────────────────┐ ┌ Tóm tắt đơn (cart-summary) ┐
│ [ảnh] Áo thun cotton                  [ - ] 2 [ + ] │ │  Tạm tính        450.000   │
│       150.000 đ  (cũ 140.000 đ)           300.000 đ │ │  Mã giảm giá  [......][Áp] │
│       [Xóa]                                         │ │  Vận chuyển   [chọn ▾]     │
│ ─────────────────────────────────────────────────── │ │  Tổng cộng        435.000  │
│ [ảnh] Tất cổ cao                      [ - ] 3 [ + ] │ │  [ Tiến hành thanh toán ]  │
│       50.000 đ                            150.000 đ │ └────────────────────────────┘
│       ⚠ Chỉ còn 2 sản phẩm.   [Xóa]                │
│ ─────────────────────────────────────────────────── │
│ [ảnh] Quần short   (Ngừng bán)         số lượng 1   │   <- không tính vào tạm tính
│       Sản phẩm không còn bán.   [Xóa]               │
└─────────────────────────────────────────────────────┘

Hộp thoại Làm trống giỏ (không đóng khi bấm ra ngoài vì hành động không hoàn tác):
┌ Làm trống giỏ hàng? ────────────────────────────────────┐
│ Mọi sản phẩm, mã giảm giá và lựa chọn vận chuyển sẽ bị   │
│ xóa. Không thể hoàn tác.                                 │
│                                  [Giữ giỏ]  [Làm trống]  │
└──────────────────────────────────────────────────────────┘
```

Thứ tự dòng: dòng thêm sớm nhất ở trên, cố định khi sửa số lượng (CRT-REQ-20261006-103226486 BR3).

## Trạng thái
| Trạng thái | Trông ra sao | Requirement | testid |
|---|---|---|---|
| đang tải | Khung chờ đúng hình (ba dòng sản phẩm, khối tóm tắt) | CRT-REQ-20261006-103226486 | crt-cart-loading |
| có dữ liệu | Danh sách dòng, mỗi dòng có ảnh, tên, đơn giá hiện hành, bước số lượng, thành tiền, nút Xóa | CRT-REQ-20261006-103226486 | crt-cart-list |
| rỗng | "Giỏ hàng trống" kèm nút đặc "Tiếp tục mua sắm"; không hiện nút Làm trống | CRT-REQ-20261006-103226486 | crt-cart-empty |
| lỗi | Banner "Không tải được giỏ hàng." kèm Thử lại (503 `service-unavailable` hoặc lỗi mạng) | CRT-REQ-20261006-103226486 | crt-cart-error |
| hết phiên | "Phiên đã hết hạn" kèm liên kết Đăng nhập (401) | CRT-REQ-20261006-103226486 | crt-cart-session-expired |
| giá đã đổi | Banner phía trên và ở dòng đổi giá hiện giá cũ gạch ngang cạnh giá mới; nút Cập nhật giá | CRT-REQ-20261006-103226486 | crt-cart-price-changed-banner |
| đang cập nhật giá | Nút Cập nhật giá khóa và có vòng xoay | CRT-REQ-20261006-103226486 | crt-cart-refresh-prices |
| dòng thiếu hàng | Dòng có biểu tượng cảnh báo và chữ "Chỉ còn N sản phẩm" hoặc "Hết hàng" (N <= 99); số lượng không bị tự giảm | CRT-REQ-20261006-103226588 | crt-cart-line-stock-warning |
| dòng không còn bán | Dòng mờ có nhãn "Ngừng bán", không tính vào tạm tính, chỉ còn nút giảm và Xóa | CRT-REQ-20261006-103226588 | crt-cart-line-unavailable |
| cần xử lý trước thanh toán | Banner "Cần xử lý N sản phẩm trước khi thanh toán" khi `checkout_blockers` không rỗng | CRT-REQ-20261006-103226588 | crt-cart-blockers-notice |
| chưa kiểm được tồn | Dòng ghi nhỏ "Chưa kiểm được tồn kho" (INV không trả lời), không chặn thanh toán | CRT-REQ-20261006-103226588 | crt-cart-stock-unknown |
| đang đổi số lượng | Dòng đó khóa nút số lượng, có vòng xoay nhỏ; các dòng khác thao tác được | CRT-REQ-20261006-103226406 | crt-cart-line-updating |
| đổi số lượng bị từ chối | Lỗi dưới dòng: "Chỉ còn N sản phẩm" (409 hết hàng), "Sản phẩm không còn bán" (409), hoặc "Dòng này đã bị xóa" (404, kèm tự tải lại giỏ); số lượng về giá trị cũ | CRT-REQ-20261006-103226406 | crt-cart-line-error |
| đang xóa dòng | Nút Xóa của dòng khóa, dòng mờ đi | CRT-REQ-20261006-103226434 | crt-cart-line-remove |
| hộp thoại làm trống | Hộp thoại xác nhận có nút Giữ giỏ và Làm trống | CRT-REQ-20261006-103226460 | crt-cart-clear-dialog |
| đang làm trống | Nút Làm trống khóa và có vòng xoay | CRT-REQ-20261006-103226460 | crt-cart-clear-confirm |
| làm trống xong | Hộp thoại đóng, chuyển sang trạng thái rỗng, thông báo ngắn "Đã làm trống giỏ" | CRT-REQ-20261006-103226460 | crt-cart-empty |
| làm trống lỗi | Báo trong hộp thoại "Không làm trống được giỏ." kèm Thử lại; giỏ giữ nguyên | CRT-REQ-20261006-103226460 | crt-cart-clear-error |

## Phần tử
| testid | Phần tử | Role | Hành động | Requirement |
|---|---|---|---|---|
| crt-cart-loading | Khung chờ | customer | - | CRT-REQ-20261006-103226486 |
| crt-cart-error | Banner lỗi tải giỏ | customer | - | CRT-REQ-20261006-103226486 |
| crt-cart-retry | Nút Thử lại | customer | Tải lại giỏ | CRT-REQ-20261006-103226486 |
| crt-cart-session-expired | Thông báo hết phiên kèm liên kết Đăng nhập | customer | Mở màn đăng nhập | CRT-REQ-20261006-103226486 |
| crt-cart-empty | Vùng giỏ trống | customer | - | CRT-REQ-20261006-103226486 |
| crt-cart-empty-shop-link | Nút Tiếp tục mua sắm | customer | Về danh sách sản phẩm | CRT-REQ-20261006-103226486 |
| crt-cart-list | Danh sách dòng | customer | - | CRT-REQ-20261006-103226486 |
| crt-cart-line | Một dòng sản phẩm | customer | - | CRT-REQ-20261006-103226486 |
| crt-cart-line-image | Ảnh sản phẩm của dòng | customer | - | CRT-REQ-20261006-103226486 |
| crt-cart-line-name | Tên sản phẩm (đã escape) | customer | Bấm để mở trang sản phẩm | CRT-REQ-20261006-103226486 |
| crt-cart-line-unit-price | Đơn giá hiện hành | customer | - | CRT-REQ-20261006-103226486 |
| crt-cart-line-previous-price | Giá lúc thêm (gạch ngang, chỉ khi giá đã đổi) | customer | - | CRT-REQ-20261006-103226486 |
| crt-cart-line-total | Thành tiền của dòng | customer | - | CRT-REQ-20261006-103226486 |
| crt-cart-line-quantity | Số lượng hiện tại của dòng | customer | Nhập số lượng mới (1 đến 99) | CRT-REQ-20261006-103226406 |
| crt-cart-line-quantity-decrease | Nút giảm số lượng | customer | Giảm 1, không dưới 1 | CRT-REQ-20261006-103226406 |
| crt-cart-line-quantity-increase | Nút tăng số lượng | customer | Tăng 1, không quá 99 | CRT-REQ-20261006-103226406 |
| crt-cart-line-updating | Vòng xoay khi đang đổi số lượng | customer | - | CRT-REQ-20261006-103226406 |
| crt-cart-line-error | Lỗi dưới dòng khi đổi số lượng bị từ chối | customer | - | CRT-REQ-20261006-103226406 |
| crt-cart-line-remove | Nút Xóa dòng | customer | Xóa dòng khỏi giỏ | CRT-REQ-20261006-103226434 |
| crt-cart-line-stock-warning | Cảnh báo thiếu hàng của dòng | customer | - | CRT-REQ-20261006-103226588 |
| crt-cart-line-unavailable | Nhãn "Ngừng bán" của dòng | customer | - | CRT-REQ-20261006-103226588 |
| crt-cart-stock-unknown | Ghi chú chưa kiểm được tồn | customer | - | CRT-REQ-20261006-103226588 |
| crt-cart-blockers-notice | Banner cần xử lý trước thanh toán | customer | - | CRT-REQ-20261006-103226588 |
| crt-cart-price-changed-banner | Banner giá đã đổi | customer | - | CRT-REQ-20261006-103226486 |
| crt-cart-refresh-prices | Nút Cập nhật giá | customer | Gửi cập nhật giá | CRT-REQ-20261006-103226486 |
| crt-cart-clear | Nút Làm trống giỏ | customer | Mở hộp thoại xác nhận | CRT-REQ-20261006-103226460 |
| crt-cart-clear-dialog | Hộp thoại xác nhận làm trống | customer | - | CRT-REQ-20261006-103226460 |
| crt-cart-clear-confirm | Nút Làm trống trong hộp thoại | customer | Gửi làm trống giỏ | CRT-REQ-20261006-103226460 |
| crt-cart-clear-dismiss | Nút Giữ giỏ | customer | Đóng hộp thoại, không xóa | CRT-REQ-20261006-103226460 |
| crt-cart-clear-error | Vùng lỗi trong hộp thoại | customer | - | CRT-REQ-20261006-103226460 |
| crt-cart-clear-success | Thông báo "Đã làm trống giỏ" | customer | - | CRT-REQ-20261006-103226460 |

## Ghi chú thiết kế (mặc định, chưa duyệt)
- **Báo trước theo skill evon:** cửa hàng online phía người mua (giỏ hàng) chưa được dạy; màn dựng theo mẫu danh sách có hàng thao tác và khối tóm tắt, kết quả có thể chưa đẹp bằng màn trong app.
- Màn chỉ dành cho customer: staff và admin không có giỏ (403), nên không có trạng thái "không có quyền" của role khác để gắn testid (cùng hạn chế `check-ui` đã gặp ở SHP: phần tử chỉ khai role của màn).
- Giá hiển thị là **giá hiện hành**; giá lúc thêm chỉ hiện (gạch ngang) khi khác, đúng CRT-REQ-20261006-103226486 BR5. Không có chữ "giá chốt" vì không giữ giá lúc thêm.
- Số lượng không tự giảm khi thiếu hàng (CRT-REQ-20261006-103226588 BR4): cảnh báo ở dòng và banner, khách tự quyết. Nút tăng khóa khi đã bằng số còn lại hoặc 99, nhưng server vẫn kiểm (UI chỉ phản ánh).
- Số lượng nhập tay chỉ nhận số nguyên 1 đến 99; ô sai thì khôi phục giá trị cũ và báo ở `crt-cart-line-error`. Không có nhập 0 để xóa (CRT-REQ-20261006-103226406 BR2): muốn bỏ thì bấm Xóa.
- Hộp thoại làm trống có hành động không hoàn tác nên có bước xác nhận và không đóng khi bấm ra ngoài. Xóa một dòng không có bước xác nhận vì dễ thêm lại (CRT-REQ-20261006-103226434 BR5); không có hoàn tác ở v1.
- Tên, SKU hiển thị dạng văn bản thường đã escape (SB-12). Dòng không còn bán không phục vụ CRT-REQ-20261006-103226614 trực tiếp ở màn (requirement đó là hệ thống, không có màn); màn chỉ thể hiện kết quả của nó qua `crt-cart-line-unavailable`.
- Không viết code giao diện; dựng thật là việc của `implement`.
