# Đồng bộ spec CRT với mã đã chạy và review (REV-CRT-14 đến 18, bài học L114, L115, L121)

- **Thay đổi:** `CartService` thành `CartApi` (CRT-API, CRT-REQ-20261006-103226562 BR5 và BR6, CRT-TC-20261006-104453980, CRT-DB); `product-unavailable` ghi hai status (404 khi thêm, 409 khi PATCH tăng dòng ngừng bán, một mã hai status, ADR-023); 429 vào cột Lỗi của mọi endpoint CRT-API (L121); thứ tự guard trỏ ADR-016; job `cart.abandon` ghi chu kỳ từ lúc khởi động và TC của nó; `user_id` ghi theo SB-18 (CRT-SEC T14, CRT-REQ-20261006-103226376 BR11, CRT-REQ-20261006-103226511 BR10); CRT-SEC T7 "bỏ kết quả và trả 503" thay "hủy lời gọi"; `ui/cart.md` nút tăng chỉ khóa ở 99 hoặc dòng ngừng bán (khớp CRT-E2E-20261006-104523460 bước 3); trần tạm tính ở báo cáo `crt-tran-tam-tinh-20261013`.
- **Lý do:** review CRT (REV-CRT-14 `product-unavailable`, REV-CRT-15 SB-18, REV-CRT-16 tên lớp, REV-CRT-17 hủy lời gọi, REV-CRT-18 ui mâu thuẫn E2E), nền đã đồng bộ ở `spec/changes/nen-dong-bo-20261013.md` (ADR-016, ADR-023, SB-18, bảng Giao diện module); mã CRT đúng, spec lệch.
- **Người yêu cầu:** người dùng ("chạy tiếp đi"); phân tích do Claude

Tài liệu bị đổi: CRT-API-20261006-103824592

| ID bị ảnh hưởng | Loại | Mức | Lý do | Việc cần làm |
|---|---|---|---|---|
| CRT-REQ-20261006-103226562 | không đổi | - | Đã sửa: BR5, BR6 `CartApi`, BR6 và BR10 nêu `cart-limit-exceeded`, hai kịch bản | Đã sửa và duyệt lại |
| CRT-REQ-20261006-103226376 | không đổi | - | Đã sửa: BR11 `user_id` theo SB-18 | Đã sửa và duyệt lại |
| CRT-REQ-20261006-103226511 | không đổi | - | Đã sửa: BR10 `user_id` theo SB-18 | Đã sửa và duyệt lại |
| CRT-REQ-20261006-103226537 | không đổi | - | Đã sửa: BR3, BR9, hai kịch bản (trần tạm tính), báo cáo `crt-tran-tam-tinh-20261013` | Đã sửa và duyệt lại |
| CRT-DB-20261006-103824563 | không đổi | - | Đã sửa: `CartService` thay bằng tên lớp thật, mục 8 tên `CartApi` và ghi hai kết nối của `lockForCheckout` (ADR-012), trần tạm tính | Đã sửa và duyệt lại |
| CRT-SEC-20261006-103824617 | không đổi | - | Đã sửa: T7 "bỏ kết quả và trả 503", T14 "ghi theo SB-18" | Đã sửa và duyệt lại |
| CRT-TC-20261006-104453980 | không đổi | - | Đã sửa: bước When `CartApi.snapshotForCheckout` | Đã sửa và duyệt lại |
| spec/epics/CRT/ui/cart.md | không đổi | - | Đã sửa: nút tăng chỉ khóa ở 99 hoặc dòng ngừng bán, câu lỗi trần giỏ | Đã sửa và duyệt lại |
| CRT-E2E-20261006-104523460 | không đổi | - | Bước 3 bấm tăng ở dòng thiếu hàng để thấy lỗi từ máy chủ: nay khớp ui/cart.md; mã đã theo E2E từ trước | - |
| CRT-TC-20261006-104451291 | không đổi | - | Test quét sổ mã lỗi đọc dòng "Mã lỗi riêng" của CRT-API: nay 18 mã (thêm `cart-limit-exceeded`), test đổi từ 17 lên 18 | - |
| CRT-TC-20261006-113000330 | không đổi | - | Mốc 30 ngày của job bỏ dở: không đổi; hạn thời gian, tín hiệu hủy, giới hạn lô có TC riêng mới | - |
| CRT-TC-20261013-211638383 | không đổi | - | TC mới (L61): job `cart.abandon` tôn trọng hạn thời gian, tín hiệu hủy, giới hạn lô, idempotent; gắn vào test sẵn có ở `test/cart/lifecycle.spec.ts` | Đã duyệt |
| CRT-TC-20261013-205743812 | không đổi | - | TC mới: `CartApi.lockForCheckout` ném `cart-limit-exceeded`; `snapshotForCheckout` trả `can_checkout` = false | Đã duyệt |
| CHK-API-20261006-105800712 | không đổi | - | Hai hàng CRT của bảng Giao tiếp giữa module đã đổi `CartApi`, ghi `lockForCheckout` ném `cart-limit-exceeded`: xem `chk-dong-bo-spec-20261013` | Đã sửa và duyệt lại |

## Chưa chắc / rủi ro
- Kiểm trần ở thao tác thêm hay tăng số lượng là kiểm mềm ngoài khóa (giá PRD gọi trước khi mở giao dịch, ADR-012): hai thao tác đồng thời có thể cùng qua; khi đó xem giỏ báo `cart_limit_exceeded` và `lockForCheckout` ném 409, không có số sai.
- CRT vẫn băm `user_id` ở log của mình (SB-18 cho phép cả hai); dòng `request` của nền ghi nguyên văn.
