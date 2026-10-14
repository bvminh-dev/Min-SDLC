# Tác động của trần tạm tính 10.000.000.000 của giỏ CRT (REV-CRT-13)

- **Thay đổi:** CRT chặn giỏ có tạm tính vượt 10.000.000.000 (trần `subtotal` của SHP) bằng 409 `cart-limit-exceeded` (kèm `max_subtotal`) khi thêm hàng, tăng số lượng và chọn vận chuyển; giỏ vượt trần do giá tăng sau khi thêm vẫn xem được: `shipping.error` = `cart_limit_exceeded` (thay cho `service_unavailable` mãi), `checkout_blockers` có `cart_limit_exceeded`, SHP không được gọi; `CartApi.lockForCheckout` ném cùng lỗi (CHK trả nguyên 409), `snapshotForCheckout` chỉ đọc trả `can_checkout` = false. PRM chỉ nhận 1 đến 1.000.000.000 nên mã không áp dụng được trên giỏ lớn hơn (`invalid_subtotal` đổi thành `no_discount`, đã có từ trước). Mã đã cài ở `apps/api/src/modules/cart` và web (`lib/cart.ts`, `CartSummary.tsx`, `AddToCart.tsx`), test `apps/api/test/cart/limit.spec.ts`, đột biến ở `apps/api/scripts/mutations-crt.json`.
- **Lý do:** review CRT REV-CRT-13 (giỏ 11 sản phẩm giá 1.000.000.000 chọn vận chuyển trả 503 và phí báo `service_unavailable` mãi dù SHP khỏe) và bài học L114 (miền số của giao diện module không có trong spec); người dùng chốt: CRT chặn ở nguồn, đã cài.
- **Người yêu cầu:** người dùng ("chạy tiếp đi"; quyết định chốt trần 1e10 ở CRT, trần PRM 1e9 và SHP 1e10 ghi ở spec); phân tích do Claude

Tài liệu bị đổi: CRT-API-20261006-103824592

Đã sửa (CRT-REQ-20261006-103226537 BR3, BR9, hai kịch bản mới; CRT-REQ-20261006-103226562 BR5, BR6, BR10, hai kịch bản; CRT-API mục lỗi, bảng Endpoint, hợp đồng, Giao tiếp giữa module; CRT-DB; SHP-REQ-20261006-101103806 BR1; `spec/architecture.md` đoạn Hành vi lỗi của giao diện SHP) và duyệt lại một lần. Báo cáo cùng đợt: `spec/changes/crt-dong-bo-spec-20261013.md`, `spec/changes/chk-dong-bo-spec-20261013.md`.

| ID bị ảnh hưởng | Loại | Mức | Lý do | Việc cần làm |
|---|---|---|---|---|
| CRT-API-20261006-103824592 | không đổi | - | Đã sửa cùng đợt: mã `cart-limit-exceeded` 409 kèm `max_subtotal`, `shipping.error` `cart_limit_exceeded`, `checkout_blockers` thêm `cart_limit_exceeded`, mục SHP nêu CRT bảo đảm miền, `CartApi` ném 409 | Đã sửa và duyệt lại |
| CRT-DB-20261006-103824563 | không đổi | - | Đã sửa cùng đợt: trần tạm tính không biểu diễn được bằng CHECK, kiểm mềm ngoài khóa, `lockForCheckout` ném 409 | Đã sửa và duyệt lại |
| CRT-SEC-20261006-103824617 | không đổi | - | Không có mối đe dọa mới: trần là quy tắc nghiệp vụ, không phải mô hình đe dọa; T7, T14 đã sửa ở báo cáo `crt-dong-bo-spec-20261013` | - |
| CRT-FLOW-20261006-103226640 | cần xem lại | LOW | Flow chọn vận chuyển chưa có nhánh "giỏ vượt trần: 409 `cart-limit-exceeded`" (flow ngoài danh sách tệp được ủy quyền, không sửa trong đợt này) | Thêm nhánh vào flow giỏ khi có lượt sdlc-research kế tiếp |
| CRT-TC-20261006-104453603 | không đổi | - | Phí đổi theo ngưỡng miễn phí với tạm tính hàng trăm nghìn: dưới trần | - |
| CRT-TC-20261006-104453658 | không đổi | - | Phương thức tắt hay không có: hành vi không đổi | - |
| CRT-TC-20261006-104453717 | không đổi | - | Giỏ trống hay đầu vào sai không gọi SHP: không đổi; trần chỉ chặn giỏ có hàng | - |
| CRT-TC-20261006-104453780 | không đổi | - | Ngưỡng miễn phí 500000: dưới trần | - |
| CRT-TC-20261006-104453829 | không đổi | - | So khớp thành phố: không đổi | - |
| CRT-TC-20261006-104453875 | không đổi | - | Phương thức bị tắt sau khi chọn: không đổi | - |
| CRT-TC-20261013-205743594 | không đổi | - | TC mới (draft rồi duyệt): thêm hay tăng vượt trần bị 409, đúng trần thì được, giảm hay giữ luôn được | Đã duyệt; test `apps/api/test/cart/limit.spec.ts` |
| CRT-TC-20261013-205743712 | không đổi | - | TC mới: giá tăng làm giỏ vượt trần, xem giỏ báo `cart_limit_exceeded`, chọn vận chuyển 409, SHP không bị gọi | Đã duyệt; test `apps/api/test/cart/limit.spec.ts` |
| CRT-E2E-20261006-104523405 | không đổi | - | E2E áp mã, chọn vận chuyển rồi thấy tổng với giỏ nhỏ: không chạm trần | - |
| spec/epics/CRT/ui/cart-summary.md | cần xem lại | LOW | Màn tóm tắt nay hiện câu lỗi phí "Giỏ hàng vượt giá trị tối đa, hãy bớt sản phẩm" ở `crt-cart-summary-shipping-error` và khóa nút thanh toán khi có blocker `cart_limit_exceeded` (testid không đổi); tài liệu màn ngoài danh sách tệp được ủy quyền | Thêm trạng thái "giỏ vượt trần" vào cart-summary.md (không thêm testid) ở lượt sdlc-ui-ux kế tiếp |
| SHP-REQ-20261006-101103755 | không đổi | - | Quản lý phương thức: không chạm `subtotal` của giỏ | - |
| SHP-REQ-20261006-101103782 | không đổi | - | Danh sách phương thức: không chạm `subtotal` | - |
| SHP-REQ-20261006-101103806 | không đổi | - | Đã sửa cùng đợt: BR1 chốt trần 10.000.000.000 và nêu CRT bảo đảm miền | Đã sửa và duyệt lại |
| CHK-REQ-20261006-105051242 | không đổi | - | CHK đã cắt `subtotal` về 10.000.000.000 khi hỏi phí SHP (`SHIP_SUBTOTAL_MAX`, report CHK mục 13) nên `GET shipping-options` và chọn vận chuyển ở CHK không 503 với giỏ vượt trần; chỉ đường đặt hàng (`lockForCheckout`) nay trả 409 `cart-limit-exceeded` | - |
