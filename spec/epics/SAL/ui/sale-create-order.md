---
screen: sale-create-order
epic: SAL
status: approved
covers: [SAL-REQ-20261015-092710847, SAL-REQ-20261015-092710942, SAL-REQ-20261015-092711037, SAL-REQ-20261015-092711128]
roles: [sale, admin]
---
# Tạo đơn hộ: nguồn, khách, sản phẩm, giao hàng, thanh toán, ghi chú

Đường dẫn: `/sales/orders/new`. Bọc bằng `RequireRole roles=[sale, admin]` (chặn ở giao diện chỉ để tiện; server vẫn kiểm quyền, SB-05).

## Wireframe
Phương án đã chọn: **A** (một trang hai cột: bên trái năm khối nhập xếp dọc, bên phải khối tóm tắt cố định kèm nút Tạo đơn). **Đây là lựa chọn mặc định** (khuyến nghị theo `U3`, nhất quán với `checkout` của CHK), chưa có người dùng chọn.

| Phương án | Việc chính thấy ở đâu | Đổi gì | Đánh đổi |
|---|---|---|---|
| **A. Một trang hai cột: khối nhập bên trái, tóm tắt và nút Tạo đơn bên phải (khuyên dùng, đã chọn)** | Sale vừa nghe khách vừa gõ, tổng đổi ngay bên cạnh; lỗi hết hàng hiện cạnh nút bấm | Sale thấy tổng, phí, thiếu gì ở một chỗ; không chuyển bước khi khách đang chờ trên điện thoại | Dưới `lg` xếp một cột, tóm tắt xuống cuối; trang dài khi nhiều dòng hàng |
| B. Từng bước (nguồn và khách, rồi hàng, rồi giao, rồi xem lại) | Mỗi bước một màn | Rõ quy trình cho nhân viên mới | Sale đang nói chuyện với khách, mỗi lần quay lại bước trước là chậm; lỗi hết hàng phát hiện muộn ở bước cuối |
| C. Bảng nhập nhanh kiểu bảng tính (mỗi dòng hàng một hàng, mọi ô trên một hàng) | Nhập nhiều dòng bằng bàn phím | Nhanh với sale thạo | Khó đọc trên màn nhỏ; khó hiện lỗi từng ô; khác phong cách các màn còn lại |

Lý do chọn A: việc chính của sale là điền một phiếu đơn trong lúc khách đang nói (SAL-REQ-20261015-092710847); thứ phải thấy cùng lúc là khách, hàng, phí vận chuyển và tổng, trước khi bấm một nút tạo đơn xác nhận ngay và giữ hàng.

```
Thanh header:  ☰  Tạo đơn hộ                                                    🔔  (A)
┌ (banner khi có) ⚠ Tổng đã đổi: cũ 300.000 đ → mới 330.000 đ  [ Xác nhận tổng mới và tạo đơn ] ┐
│ (banner khi có) ⚠ Hết hàng: Tất cổ cao (cần 5, còn 3) · Ngừng bán: Áo polo                    │
├──────────────────────────────────────────────────────────┬─────────────────────────────────┤
│ 1. Nguồn đơn *                                            │ Tóm tắt                           │
│  [ Facebook                         ▾ ]  (nguồn đang bật) │  Áo thun cotton x2    300.000 đ   │
├──────────────────────────────────────────────────────────┤  Tất cổ cao    x1      50.000 đ   │
│ 2. Khách                                                  │ ───────────────────────────────── │
│  Tra khách có tài khoản: [ 0901234567 hoặc email ] [Tra]  │  Tạm tính             350.000 đ   │
│   ( ) Nguyễn An · 090****567 · an***@shop.vn   [ Chọn ]   │  Phí vận chuyển        30.000 đ   │
│   Không thấy khách có tài khoản. Nhập khách mới bên dưới. │  Tổng cộng            380.000 đ   │
│  ✓ Đang gắn tài khoản: Nguyễn An            [ Bỏ chọn ]   │ ───────────────────────────────── │
│  Họ tên *  [ Nguyễn An        ]  Điện thoại * [ 0901234567]│  Thanh toán: COD                  │
│  Người nhận [x] giống khách                                │  Giao tới: Nguyễn An, Quận 1 ...  │
│  Người nhận [        ] SĐT người nhận [        ]           │                                   │
│  Địa chỉ * [ 45 Nguyễn Huệ ]  Phường * [ Bến Nghé ]        │  [ Tạo đơn ]  ← khóa kèm lý do     │
│  Quận [ Quận 1 ]  Thành phố * [ Hồ Chí Minh ]             │  Còn thiếu: nguồn đơn, sản phẩm   │
├──────────────────────────────────────────────────────────┤                                   │
│ 3. Sản phẩm                                               │                                   │
│  Tìm [ áo thun        ]  (tên hoặc mã hàng)               │                                   │
│   Áo thun cotton · AT-001 · 150.000 đ · Còn hàng  [ Thêm ] │                                   │
│  ┌ Áo thun cotton   SL [ 2 ]  Ghi chú [ size M, màu xanh ] [Xóa] ┐                           │
│  │ ⚠ Hết hàng / Ngừng bán (đánh dấu dòng lỗi)                   │                           │
│  └──────────────────────────────────────────────────────────┘                              │
├──────────────────────────────────────────────────────────┤                                   │
│ 4. Giao hàng                                              │                                   │
│  (•) Giao tiêu chuẩn  30.000 đ   ( ) Giao nhanh  50.000 đ │                                   │
│  Nhập thành phố và thêm hàng để xem phí                   │                                   │
├──────────────────────────────────────────────────────────┤                                   │
│ 5. Thanh toán và ghi chú                                  │                                   │
│  (•) COD  ( ) Tiền mặt  ( ) Chuyển khoản                  │                                   │
│  Ghi chú đơn [                                    ] 12/1000│                                   │
└──────────────────────────────────────────────────────────┴─────────────────────────────────┘
Sau khi tạo: khối "Đã tạo đơn HD261015-00003" kèm [ Xem đơn ] [ Tạo đơn khác ]; biểu mẫu khóa.
```

## Trạng thái
Mỗi dòng: một trạng thái giao diện lấy từ Given/When/Then của requirement; cột testid trỏ tới phần tử đánh dấu trạng thái.

| Trạng thái | Trông ra sao | Requirement | testid |
|---|---|---|---|
| đang tải | Khung chờ đúng hình hai cột khi tải danh sách nguồn đơn | SAL-REQ-20261015-092710847 | sal-sale-create-order-loading |
| có dữ liệu, đủ điều kiện | Có nguồn, khách, ít nhất một dòng hàng, địa chỉ đủ, phương thức vận chuyển và thanh toán: nút Tạo đơn bật | SAL-REQ-20261015-092710847 | sal-sale-create-order-submit |
| thiếu thông tin | Nút Tạo đơn khóa, dòng "Còn thiếu: ..." liệt kê nguồn, khách, địa chỉ, sản phẩm, vận chuyển, thanh toán | SAL-REQ-20261015-092710847 | sal-sale-create-order-submit-missing |
| lỗi | Banner "Không tải được dữ liệu lập đơn." kèm Thử lại (lỗi tải nguồn đơn, hay 503 khi tạo); biểu mẫu giữ nguyên | SAL-REQ-20261015-092711128 | sal-sale-create-order-error |
| hết phiên đăng nhập | "Phiên đăng nhập đã hết hạn" kèm liên kết Đăng nhập (401); dữ liệu đã nhập không mất khi quay lại | SAL-REQ-20261015-092710847 | sal-sale-create-order-login-expired |
| không có quyền | Customer hoặc staff mở màn này thấy trang "Không có quyền" của nền (403), không có biểu mẫu | SAL-REQ-20261015-092710847 | - |
| không có nguồn đơn | Danh sách nguồn rỗng: "Chưa có nguồn đơn nào đang bật, nhờ admin bật nguồn." và nút Tạo đơn khóa | SAL-REQ-20261015-092711128 | sal-sale-create-order-source-empty |
| tra khách: có kết quả | Danh sách tối đa 5 khách bản che (họ tên, điện thoại che, email che), mỗi dòng nút Chọn | SAL-REQ-20261015-092710942 | sal-sale-create-order-lookup-results |
| tra khách: không có | "Không thấy khách có tài khoản. Nhập khách mới bên dưới." (200 với danh sách rỗng) | SAL-REQ-20261015-092710942 | sal-sale-create-order-lookup-empty |
| tra khách: lỗi | "Không tra được khách." kèm Thử lại; 400 (khóa không hợp lệ) hiện lỗi dưới ô tra | SAL-REQ-20261015-092710942 | sal-sale-create-order-lookup-error |
| tra khách: quá giới hạn | "Tra quá nhanh, thử lại sau N giây." (429) | SAL-REQ-20261015-092710942 | sal-sale-create-order-lookup-limited |
| đã gắn khách có tài khoản | Chip "Đang gắn tài khoản: tên khách" kèm Bỏ chọn | SAL-REQ-20261015-092710942 | sal-sale-create-order-customer-selected |
| không tìm thấy sản phẩm | "Không có sản phẩm nào khớp." (kết quả rỗng) | SAL-REQ-20261015-092710847 | sal-sale-create-order-product-empty |
| chưa có dòng hàng | "Chưa có sản phẩm trong đơn." | SAL-REQ-20261015-092710847 | sal-sale-create-order-lines-empty |
| hàng hết (cảnh báo sớm) | Nhãn "Hết hàng" cạnh kết quả tìm và dòng hàng (từ endpoint `availability`, chỉ còn hay hết); vẫn thêm được, server quyết khi tạo | SAL-REQ-20261015-092711128 | sal-sale-create-order-line-stock |
| chưa có phí vận chuyển | Chưa đủ thành phố hoặc chưa có dòng hàng: "Nhập thành phố và thêm hàng để xem phí" | SAL-REQ-20261015-092711037 | sal-sale-create-order-shipping-prompt |
| không có phương thức vận chuyển | "Chưa có phương thức vận chuyển nào đang bật" (409 `no-shipping-methods`); Tạo đơn khóa | SAL-REQ-20261015-092711037 | sal-sale-create-order-shipping-empty |
| lỗi nhập liệu | Lỗi dưới từng ô (400 `validation-failed` theo `errors`), ví dụ điện thoại sai định dạng; ô đầu tiên lỗi được focus | SAL-REQ-20261015-092710847 | sal-sale-create-order-form-error |
| tổng đã đổi | Banner "Tổng đã đổi: cũ → mới" kèm nút xác nhận tổng mới rồi gửi lại (409 `price-changed`) | SAL-REQ-20261015-092710847 | sal-sale-create-order-price-changed |
| nguồn đã tắt | Banner "Nguồn đơn này vừa bị tắt, chọn nguồn khác." (409 `order-source-unavailable`), nguồn đã chọn bị bỏ chọn | SAL-REQ-20261015-092711128 | sal-sale-create-order-source-unavailable |
| sản phẩm không còn bán | Banner "Có sản phẩm không còn bán" và đánh dấu các dòng trong `items` (409 `product-unavailable`) | SAL-REQ-20261015-092711128 | sal-sale-create-order-product-unavailable |
| hết hàng khi tạo | Banner "Không đủ hàng" liệt kê dòng thiếu kèm số còn (409 `insufficient-stock`); dòng đó đánh dấu, số lượng sửa được | SAL-REQ-20261015-092711128 | sal-sale-create-order-insufficient-stock |
| phương thức vận chuyển đã tắt | Banner "Phương thức vận chuyển vừa bị tắt, chọn lại." (409 `shipping-method-unavailable`) | SAL-REQ-20261015-092711037 | sal-sale-create-order-shipping-unavailable |
| khách gắn không hợp lệ | Banner "Tài khoản khách không hợp lệ" và bỏ gắn (422 `customer-not-found`) | SAL-REQ-20261015-092710942 | sal-sale-create-order-customer-not-found |
| tổng quá lớn | "Tổng tiền vượt giới hạn 10.000.000.000 đ" (422 `order-total-out-of-range`) | SAL-REQ-20261015-092710847 | sal-sale-create-order-total-out-of-range |
| đang gửi | Nút Tạo đơn khóa kèm vòng quay; hai lần bấm chỉ gửi một yêu cầu (cùng `Idempotency-Key`) | SAL-REQ-20261015-092710847 | sal-sale-create-order-submitting |
| quá giới hạn tạo đơn | Banner "Tạo đơn quá nhanh, thử lại sau N giây" (429), tự mở lại khi hết `Retry-After` | SAL-REQ-20261015-092710847 | sal-sale-create-order-rate-limited |
| đã tạo | Khối "Đã tạo đơn HD..." kèm mã đơn, nút Xem đơn, Tạo đơn khác; biểu mẫu khóa | SAL-REQ-20261015-092710847 | sal-sale-create-order-done |

## Phần tử
testid dạng `sal-sale-create-order-<phần-tử>` (chữ thường, nối bằng `-`), duy nhất trong cả `spec/`. Mọi phần tử dành cho `sale` và `admin`.

| testid | Phần tử | Role | Hành động | Requirement |
|---|---|---|---|---|
| sal-sale-create-order-loading | Khung chờ | sale, admin | - | SAL-REQ-20261015-092710847 |
| sal-sale-create-order-error | Banner lỗi tải hoặc 503 | sale, admin | - | SAL-REQ-20261015-092711128 |
| sal-sale-create-order-retry | Nút Thử lại | sale, admin | Tải lại nguồn đơn hoặc gửi lại | SAL-REQ-20261015-092711128 |
| sal-sale-create-order-login-expired | Thông báo hết phiên kèm liên kết Đăng nhập | sale, admin | Đăng nhập lại | SAL-REQ-20261015-092710847 |
| sal-sale-create-order-source | Ô chọn nguồn đơn (select, bắt buộc, chỉ nguồn đang bật) | sale, admin | Chọn nguồn đơn | SAL-REQ-20261015-092710847 |
| sal-sale-create-order-source-empty | Vùng "Chưa có nguồn đơn nào đang bật" | sale, admin | - | SAL-REQ-20261015-092711128 |
| sal-sale-create-order-lookup-key | Ô nhập điện thoại hoặc email để tra khách | sale, admin | Nhập khóa tra | SAL-REQ-20261015-092710942 |
| sal-sale-create-order-lookup-submit | Nút Tra | sale, admin | Gọi tra khách | SAL-REQ-20261015-092710942 |
| sal-sale-create-order-lookup-results | Danh sách kết quả bản che | sale, admin | - | SAL-REQ-20261015-092710942 |
| sal-sale-create-order-lookup-result | Một dòng kết quả (họ tên, điện thoại che, email che, trạng thái) | sale, admin | - | SAL-REQ-20261015-092710942 |
| sal-sale-create-order-lookup-pick | Nút Chọn ở dòng kết quả | sale, admin | Gắn khách có tài khoản vào đơn, điền họ tên | SAL-REQ-20261015-092710942 |
| sal-sale-create-order-lookup-empty | Vùng "Không thấy khách có tài khoản" | sale, admin | - | SAL-REQ-20261015-092710942 |
| sal-sale-create-order-lookup-error | Vùng lỗi tra khách | sale, admin | - | SAL-REQ-20261015-092710942 |
| sal-sale-create-order-lookup-limited | Thông báo tra quá nhanh (429) | sale, admin | - | SAL-REQ-20261015-092710942 |
| sal-sale-create-order-customer-selected | Chip khách đã gắn | sale, admin | - | SAL-REQ-20261015-092710942 |
| sal-sale-create-order-customer-clear | Nút Bỏ chọn khách đã gắn | sale, admin | Gỡ liên kết tài khoản khỏi đơn | SAL-REQ-20261015-092710942 |
| sal-sale-create-order-customer-name | Ô họ tên khách (1 đến 100) | sale, admin | Nhập họ tên | SAL-REQ-20261015-092710847 |
| sal-sale-create-order-customer-phone | Ô điện thoại khách | sale, admin | Nhập điện thoại | SAL-REQ-20261015-092710847 |
| sal-sale-create-order-same-as-customer | Hộp "Người nhận giống khách" | sale, admin | Bật, tắt chép họ tên và điện thoại sang người nhận | SAL-REQ-20261015-092710847 |
| sal-sale-create-order-receiver | Ô người nhận | sale, admin | Nhập tên người nhận | SAL-REQ-20261015-092710847 |
| sal-sale-create-order-receiver-phone | Ô điện thoại người nhận | sale, admin | Nhập điện thoại người nhận | SAL-REQ-20261015-092710847 |
| sal-sale-create-order-line1 | Ô địa chỉ (số nhà, đường, 1 đến 200) | sale, admin | Nhập địa chỉ | SAL-REQ-20261015-092710847 |
| sal-sale-create-order-ward | Ô phường, xã | sale, admin | Nhập phường, xã | SAL-REQ-20261015-092710847 |
| sal-sale-create-order-district | Ô quận, huyện (tùy chọn) | sale, admin | Nhập quận, huyện | SAL-REQ-20261015-092710847 |
| sal-sale-create-order-city | Ô thành phố | sale, admin | Nhập thành phố (quyết định phí vận chuyển) | SAL-REQ-20261015-092710847 |
| sal-sale-create-order-product-search | Ô tìm sản phẩm theo tên hoặc mã hàng | sale, admin | Gõ rồi chờ 300 ms hoặc Enter | SAL-REQ-20261015-092710847 |
| sal-sale-create-order-product-results | Danh sách sản phẩm tìm được (chỉ đang bán) | sale, admin | - | SAL-REQ-20261015-092710847 |
| sal-sale-create-order-product-add | Nút Thêm ở dòng kết quả | sale, admin | Thêm sản phẩm vào đơn (số lượng 1) | SAL-REQ-20261015-092710847 |
| sal-sale-create-order-product-empty | Vùng "Không có sản phẩm nào khớp" | sale, admin | - | SAL-REQ-20261015-092710847 |
| sal-sale-create-order-lines-empty | Vùng "Chưa có sản phẩm trong đơn" | sale, admin | - | SAL-REQ-20261015-092710847 |
| sal-sale-create-order-line | Một dòng hàng của đơn | sale, admin | - | SAL-REQ-20261015-092710847 |
| sal-sale-create-order-line-qty | Ô số lượng (1 đến 100000) | sale, admin | Nhập số lượng | SAL-REQ-20261015-092710847 |
| sal-sale-create-order-line-note | Ô ghi chú dòng hàng (tối đa 500) | sale, admin | Nhập ghi chú | SAL-REQ-20261015-092710847 |
| sal-sale-create-order-line-remove | Nút Xóa dòng | sale, admin | Gỡ dòng khỏi đơn | SAL-REQ-20261015-092710847 |
| sal-sale-create-order-line-stock | Nhãn Còn hàng hoặc Hết hàng của dòng | sale, admin | - | SAL-REQ-20261015-092711128 |
| sal-sale-create-order-shipping-prompt | Dòng nhắc nhập thành phố và thêm hàng | sale, admin | - | SAL-REQ-20261015-092711037 |
| sal-sale-create-order-shipping-options | Nhóm chọn phương thức vận chuyển | sale, admin | - | SAL-REQ-20261015-092711037 |
| sal-sale-create-order-shipping-option | Một phương thức kèm phí | sale, admin | Chọn phương thức vận chuyển | SAL-REQ-20261015-092711037 |
| sal-sale-create-order-shipping-empty | Vùng "Chưa có phương thức vận chuyển nào đang bật" | sale, admin | - | SAL-REQ-20261015-092711037 |
| sal-sale-create-order-shipping-unavailable | Banner phương thức đã tắt | sale, admin | - | SAL-REQ-20261015-092711037 |
| sal-sale-create-order-payment-cod | Lựa chọn COD | sale, admin | Chọn COD | SAL-REQ-20261015-092710847 |
| sal-sale-create-order-payment-cash | Lựa chọn Tiền mặt | sale, admin | Chọn tiền mặt | SAL-REQ-20261015-092710847 |
| sal-sale-create-order-payment-bank-transfer | Lựa chọn Chuyển khoản | sale, admin | Chọn chuyển khoản | SAL-REQ-20261015-092710847 |
| sal-sale-create-order-note | Ô ghi chú đơn (tối đa 1000, văn bản thuần) | sale, admin | Nhập ghi chú đơn | SAL-REQ-20261015-092710847 |
| sal-sale-create-order-note-counter | Bộ đếm ký tự "N/1000" | sale, admin | - | SAL-REQ-20261015-092710847 |
| sal-sale-create-order-summary | Khối tóm tắt đơn | sale, admin | - | SAL-REQ-20261015-092710847 |
| sal-sale-create-order-items-total | Tạm tính | sale, admin | - | SAL-REQ-20261015-092710847 |
| sal-sale-create-order-shipping-fee | Phí vận chuyển | sale, admin | - | SAL-REQ-20261015-092711037 |
| sal-sale-create-order-grand-total | Tổng cộng | sale, admin | - | SAL-REQ-20261015-092710847 |
| sal-sale-create-order-submit | Nút Tạo đơn | sale, admin | Gửi tạo đơn hộ | SAL-REQ-20261015-092710847 |
| sal-sale-create-order-submit-missing | Dòng "Còn thiếu: ..." cạnh nút khóa | sale, admin | - | SAL-REQ-20261015-092710847 |
| sal-sale-create-order-submitting | Trạng thái đang gửi (vòng quay trên nút) | sale, admin | - | SAL-REQ-20261015-092710847 |
| sal-sale-create-order-form-error | Vùng lỗi nhập liệu (tóm tắt các ô sai) | sale, admin | - | SAL-REQ-20261015-092710847 |
| sal-sale-create-order-price-changed | Banner tổng đã đổi | sale, admin | - | SAL-REQ-20261015-092710847 |
| sal-sale-create-order-price-changed-confirm | Nút Xác nhận tổng mới và tạo đơn | sale, admin | Gửi lại với tổng mới | SAL-REQ-20261015-092710847 |
| sal-sale-create-order-source-unavailable | Banner nguồn đã tắt | sale, admin | - | SAL-REQ-20261015-092711128 |
| sal-sale-create-order-product-unavailable | Banner có sản phẩm không còn bán | sale, admin | - | SAL-REQ-20261015-092711128 |
| sal-sale-create-order-insufficient-stock | Banner hết hàng kèm dòng thiếu | sale, admin | - | SAL-REQ-20261015-092711128 |
| sal-sale-create-order-customer-not-found | Banner khách gắn không hợp lệ | sale, admin | - | SAL-REQ-20261015-092710942 |
| sal-sale-create-order-total-out-of-range | Thông báo tổng vượt giới hạn | sale, admin | - | SAL-REQ-20261015-092710847 |
| sal-sale-create-order-rate-limited | Banner quá giới hạn tạo đơn | sale, admin | - | SAL-REQ-20261015-092710847 |
| sal-sale-create-order-done | Khối đã tạo đơn | sale, admin | - | SAL-REQ-20261015-092710847 |
| sal-sale-create-order-done-code | Mã đơn vừa tạo (font-mono) | sale, admin | - | SAL-REQ-20261015-092710847 |
| sal-sale-create-order-done-open | Nút Xem đơn | sale, admin | Mở chi tiết đơn hộ | SAL-REQ-20261015-092710847 |
| sal-sale-create-order-done-new | Nút Tạo đơn khác | sale, admin | Xóa biểu mẫu, bắt đầu đơn mới | SAL-REQ-20261015-092710847 |

## Ghi chú thiết kế (mặc định, chưa duyệt)
- **Dùng lại**: `Field` (`components/Form.tsx`) cho từng ô kèm lỗi; `RequireRole` bọc trang; `useCountdown` cho 429 và tự mở lại; `StockLabel` cho "Còn hàng, Hết hàng"; `formatPrice` (lib `format.ts`) cho tiền; `api()` của `lib/api.ts`. Dữ liệu: `GET /order-sources` (nguồn), `GET /products/search` (tìm hàng), `GET /inventory/availability` (còn hay hết), bốn endpoint của SAL.
- Giá hiển thị ở màn chỉ để tham khảo: server tính lại và so với `expected_grand_total` (SAL-REQ-20261015-092710847 BR10); sale thấy "Giá bán", KHÔNG có ô hay cột giá vốn ở màn này (SB-42).
- **Idempotency-Key**: sinh một khóa ngẫu nhiên khi mở màn (hoặc sau "Tạo đơn khác" và sau mỗi lần lỗi 4xx đã xử lý); bấm lại khi đang gửi hoặc sau lỗi mạng dùng CÙNG khóa với CÙNG nội dung; sửa nội dung thì sinh khóa mới (tránh 422 `idempotency-key-reused`).
- **Phí vận chuyển** gọi lại khi đổi thành phố hay tạm tính (chờ 300 ms); nếu phương thức đã chọn không còn trong danh sách mới thì bỏ chọn và nhắc chọn lại.
- **Lỗi hết hàng** giữ nguyên biểu mẫu, đánh dấu dòng và đặt focus vào ô số lượng của dòng đầu tiên thiếu; không xóa dòng nào (SAL-REQ-20261015-092711128 BR7).
- **Ghi chú** là văn bản thuần: ô `textarea`, hiển thị sau này bằng chữ (không HTML, SB-12, SB-45).
- Tra khách bắt đầu bằng nút Tra hoặc Enter (không tra khi gõ, tiết kiệm hạn mức 30 mỗi phút); `phone` có số 0 đầu hoặc `+84`, ô có chứa `@` thì gửi `email`, còn lại gửi `phone`.
- Dưới `lg` các khối xếp một cột, tóm tắt xuống cuối; nút Tạo đơn là hàng dính cuối màn trên di động.
