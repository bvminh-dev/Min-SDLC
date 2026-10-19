---
screen: order-source-admin
epic: ORD
status: approved
covers: [ORD-REQ-20261015-092748678]
roles: [admin]
---
# Quản lý nguồn đơn (admin)

## Wireframe
Phương án đã chọn: **A** (bảng dữ liệu một khối, hành động ở cột cuối mỗi dòng, hộp thoại cho thêm và sửa). **Mặc định** của skill, tự chọn theo hướng dẫn "không dừng chờ" của đợt này; nhất quán với màn `admin-user-list` (bảng và hộp thoại) và dùng lại component có sẵn (`Form`, `Pager` không cần vì danh mục tối đa 50 nguồn nên không phân trang).

| Phương án | Việc chính thấy ở đâu | Đổi gì | Đánh đổi |
|---|---|---|---|
| **A. Bảng và hộp thoại (đã chọn)** | Tên, mã, trạng thái, thứ tự trên một hàng | Nút Thêm nguồn ở đầu bảng; hộp thoại cho thêm và sửa; công tắc bật tắt ở cuối dòng | Dày, đủ cho 50 dòng; dưới `sm` thành danh sách thẻ |
| B. Sửa tại chỗ trong bảng | Mọi ô sửa được ngay | Ít bước hơn | Dễ sửa nhầm tên nguồn dùng để tính lương; khó chặn đổi `code` |
| C. Kéo thả sắp thứ tự | Thứ tự là thao tác chính | Trực quan | Thứ tự chỉ ảnh hưởng ô chọn, không đáng kéo thả; chậm trên điện thoại |

```
Thanh header:  ☰  Nguồn đơn                                                🔔  (A)
┌──────────────────────────────────────────────────────────────────────────────────┐
│ Nguồn đơn: nơi đơn hàng đến, dùng để chọn khi tạo đơn hộ và để tính lương marketing │
│                                                         [ + Thêm nguồn ]          │
├──────────────────────────────────────────────────────────────────────────────────┤
│ Tên            Mã          Thứ tự   Trạng thái        Loại           Hành động    │
│ Website        website       0      (Đang bật)        (Hệ thống)     [Sửa]         │
│ Facebook       facebook      1      (Đang bật)                       [Sửa] [Tắt]   │
│ TikTok         tiktok        2      (Đã tắt)                         [Sửa] [Bật]   │
│ Hotline        hotline       3      (Đang bật)                       [Sửa] [Tắt]   │
└──────────────────────────────────────────────────────────────────────────────────┘
Hộp thoại Thêm / Sửa nguồn (không đóng khi bấm ra ngoài vì có ô nhập):
┌ Thêm nguồn ─────────────────────────────────────────┐
│ Mã (chữ thường, số, _; 2 đến 32 ký tự; không đổi    │  <- ô Mã khóa khi sửa
│ được sau khi tạo)        [ zalo                    ] │
│ Tên hiển thị (1 đến 60 ký tự)  [ Zalo OA           ] │
│ Thứ tự hiển thị (0 đến 999)    [ 4                 ] │
│                                   [Hủy]  [Lưu]      │
└─────────────────────────────────────────────────────┘
Nguồn Website (hệ thống) không có nút Tắt. Tắt nguồn: xác nhận "Đơn mới không chọn được nguồn này nữa; đơn cũ giữ nguyên."
```
Dưới `sm`: mỗi nguồn là một thẻ (tên và mã trên, trạng thái và hành động dưới).

## Trạng thái
| Trạng thái | Trông ra sao | Requirement | testid |
|---|---|---|---|
| có dữ liệu | Bảng mọi nguồn kể cả đã tắt, theo thứ tự hiển thị rồi tên; nhãn trạng thái và loại đọc rõ không chỉ bằng màu; nguồn hệ thống không có nút Tắt | ORD-REQ-20261015-092748678 | ord-order-source-admin-table |
| đang tải | Khung chờ đúng hình 4 dòng của bảng | ORD-REQ-20261015-092748678 | ord-order-source-admin-loading |
| lỗi | Banner "Không tải được danh sách nguồn đơn." kèm "Thử lại"; 429 (bậc D) cũng vào đây | ORD-REQ-20261015-092748678 | ord-order-source-admin-error |
| hết phiên | 401: chuyển về đăng nhập | ORD-REQ-20261015-092748678 | - |
| không có quyền | Sale, staff hoặc customer vào màn này (403): chuyển tới màn `access-denied`, không dựng giao diện quản lý | ORD-REQ-20261015-092748678 | - |
| hộp thoại thêm | Ô Mã, Tên, Thứ tự trống (Thứ tự mặc định 0); Lưu khóa tới khi Mã và Tên hợp lệ | ORD-REQ-20261015-092748678 | ord-order-source-admin-dialog |
| hộp thoại sửa | Mã khóa (không đổi được), sửa Tên và Thứ tự; nguồn hệ thống chỉ sửa Tên và Thứ tự | ORD-REQ-20261015-092748678 | ord-order-source-admin-dialog |
| đang lưu | Nút Lưu khóa và có vòng xoay, ô nhập khóa | ORD-REQ-20261015-092748678 | ord-order-source-admin-save |
| lỗi nhập | 400: lỗi dưới ô tương ứng (mã sai khuôn, tên rỗng hoặc quá 60 ký tự, thứ tự ngoài 0 đến 999) | ORD-REQ-20261015-092748678 | ord-order-source-admin-field-error |
| trùng mã | 409 `order-source-code-taken`: lỗi dưới ô Mã "Mã này đã có" | ORD-REQ-20261015-092748678 | ord-order-source-admin-field-error |
| đủ số nguồn | 409 `order-source-limit`: banner trong hộp thoại "Đã đủ 50 nguồn" | ORD-REQ-20261015-092748678 | ord-order-source-admin-dialog-error |
| nguồn được bảo vệ | 409 `order-source-protected`: thông báo "Nguồn Website của hệ thống không tắt được" (nút Tắt không hiện, trạng thái này chỉ gặp khi gọi trực tiếp API) | ORD-REQ-20261015-092748678 | ord-order-source-admin-dialog-error |
| xác nhận tắt | Hộp thoại xác nhận Tắt nguồn nói rõ đơn mới không chọn được nguồn này, đơn cũ giữ nguyên | ORD-REQ-20261015-092748678 | ord-order-source-admin-toggle-confirm |
| lưu thành công | Hộp thoại đóng, bảng cập nhật, thông báo ngắn "Đã lưu nguồn đơn" | ORD-REQ-20261015-092748678 | ord-order-source-admin-saved |

## Phần tử
| testid | Phần tử | Role | Hành động | Requirement |
|---|---|---|---|---|
| ord-order-source-admin-table | Bảng nguồn đơn (mọi nguồn kể cả đã tắt) | admin | - | ORD-REQ-20261015-092748678 |
| ord-order-source-admin-row | Một dòng nguồn | admin | - | ORD-REQ-20261015-092748678 |
| ord-order-source-admin-code | Mã nguồn (font-mono) | admin | - | ORD-REQ-20261015-092748678 |
| ord-order-source-admin-name | Tên hiển thị (luôn escape, văn bản thuần) | admin | - | ORD-REQ-20261015-092748678 |
| ord-order-source-admin-position | Thứ tự hiển thị | admin | - | ORD-REQ-20261015-092748678 |
| ord-order-source-admin-status-badge | Nhãn Đang bật hoặc Đã tắt | admin | - | ORD-REQ-20261015-092748678 |
| ord-order-source-admin-system-badge | Nhãn Hệ thống (chỉ nguồn `website`) | admin | - | ORD-REQ-20261015-092748678 |
| ord-order-source-admin-add | Nút Thêm nguồn | admin | Mở hộp thoại thêm | ORD-REQ-20261015-092748678 |
| ord-order-source-admin-edit | Nút Sửa của một dòng | admin | Mở hộp thoại sửa | ORD-REQ-20261015-092748678 |
| ord-order-source-admin-toggle | Nút Tắt hoặc Bật của một dòng (không có ở nguồn hệ thống) | admin | Mở xác nhận tắt hoặc bật ngay | ORD-REQ-20261015-092748678 |
| ord-order-source-admin-toggle-confirm | Hộp thoại xác nhận Tắt nguồn | admin | Xác nhận hoặc Giữ nguồn | ORD-REQ-20261015-092748678 |
| ord-order-source-admin-dialog | Hộp thoại thêm hoặc sửa | admin | - | ORD-REQ-20261015-092748678 |
| ord-order-source-admin-field-code | Ô Mã (khóa khi sửa) | admin | Nhập mã | ORD-REQ-20261015-092748678 |
| ord-order-source-admin-field-name | Ô Tên hiển thị | admin | Nhập tên | ORD-REQ-20261015-092748678 |
| ord-order-source-admin-field-position | Ô Thứ tự hiển thị | admin | Nhập số | ORD-REQ-20261015-092748678 |
| ord-order-source-admin-field-error | Lỗi dưới ô nhập (400, trùng mã) | admin | - | ORD-REQ-20261015-092748678 |
| ord-order-source-admin-dialog-error | Banner lỗi trong hộp thoại (đủ số nguồn, nguồn được bảo vệ, 403, 429) | admin | - | ORD-REQ-20261015-092748678 |
| ord-order-source-admin-save | Nút Lưu | admin | Gửi thêm hoặc sửa | ORD-REQ-20261015-092748678 |
| ord-order-source-admin-cancel | Nút Hủy trong hộp thoại | admin | Đóng hộp thoại, không lưu | ORD-REQ-20261015-092748678 |
| ord-order-source-admin-saved | Thông báo Đã lưu nguồn đơn | admin | - | ORD-REQ-20261015-092748678 |
| ord-order-source-admin-loading | Khung chờ | admin | - | ORD-REQ-20261015-092748678 |
| ord-order-source-admin-error | Banner lỗi tải danh sách | admin | - | ORD-REQ-20261015-092748678 |
| ord-order-source-admin-retry | Nút Thử lại | admin | Tải lại danh sách | ORD-REQ-20261015-092748678 |

## Ghi chú thiết kế (mặc định, chưa duyệt)
- Tự chọn phương án A theo hướng dẫn của đợt này (không có người chọn); lý do: thao tác hiếm, dữ liệu nhỏ (tối đa 50), cần xác nhận vì đổi nguồn ảnh hưởng số tính lương; giống `admin-user-list` nên dùng lại mẫu bảng, hộp thoại và `RequireRole` (chỉ admin).
- Không có nút Xóa: nguồn đã gắn đơn không xóa được, v1 chỉ tắt (ORD-REQ-20261015-092748678 BR3).
- Ô Mã khóa khi sửa vì `code` không đổi sau khi tạo (BR6); nguồn `website` không có nút Tắt (BR2).
- Tên nguồn là văn bản thuần, luôn escape (BR7, SB-45); không viết code giao diện ở phase này.
- Thông báo tắt nguồn nói rõ hệ quả (BR5): đơn mới không chọn được, đơn cũ vẫn hiện nguồn, báo cáo vẫn tính.
