---
screen: admin-coupon-list
epic: PRM
status: draft
covers: [PRM-REQ-20261006-101036299, PRM-REQ-20261006-101036275, PRM-REQ-20261006-101036252, PRM-REQ-20261006-101036201]
roles: [admin]
---
# Quản lý coupon (danh sách quản trị)

## Wireframe
Phương án đã chọn: **A** (bảng nhiều cột, hàng tab trạng thái phía trên, ô tìm theo tiền tố mã, thao tác Sửa, Tắt hoặc Bật, Xóa ngay trên dòng). **Đây là lựa chọn mặc định** của skill, chưa có người dùng chọn (các cổng không hỏi được ở lần chạy này).

| Phương án | Việc chính thấy ở đâu | Đổi gì | Đánh đổi |
|---|---|---|---|
| **A. Bảng nhiều cột (khuyên dùng, đã chọn)** | Mã, giảm gì, hạn, lượt đã dùng, trạng thái trên cùng một hàng | Tab trạng thái là bộ lọc chính; Tắt hoặc Bật làm ngay trên dòng | Dưới `sm` bảng thành danh sách hai tầng |
| B. Thẻ coupon (giống phiếu giảm giá) | Phiếu hiển thị giá trị giảm nổi bật | Dễ nhận mặt từng mã | Khó so hạn và lượt giữa nhiều mã, nhiều cuộn khi hàng trăm mã |
| C. Bảng hai cột: danh sách trái, chi tiết phải | Chọn một mã rồi xem và sửa ở bên phải | Một màn cho mọi việc | Màn hẹp khó dùng điện thoại, phải dựng thêm vùng chi tiết lớn |

Lý do chọn A: admin theo dõi nhiều coupon cùng lúc, cần so hạn dùng, số lượt còn lại và trạng thái; thao tác Tắt hoặc Bật là việc thường làm khi cần dừng khuyến mãi gấp nên đặt trên dòng.

```
Header:  ☰  Coupon                                                  [ + Tạo coupon ]
┌────────────────────────────────────────────────────────────────────────────────────────────────┐
│ [Tất cả] Đang chạy  Đã tắt  Hết hạn  Hết lượt            [ Tìm mã bắt đầu bằng... ]            │
├────────────────────────────────────────────────────────────────────────────────────────────────┤
│ Mã       Giảm                          Hết hạn            Lượt dùng        Trạng thái   Thao tác │
│ SALE10   10% tối đa 50.000 đ, từ 200k  13/10/2026 23:59   35/100 (còn 65)  (Đang chạy)  Sửa Tắt Xóa│
│ FIX50K   50.000 đ                      20/10/2026 23:59   0/1 (còn 1)      (Đã tắt)     Sửa Bật Xóa│
│ OLD20    20%                           01/10/2026 23:59   12/50 (còn 38)   (Hết hạn)    Xem Xóa    │
├────────────────────────────────────────────────────────────────────────────────────────────────┤
│ 1 tới 20 trong 24 coupon                                                       ‹ 1 2 ›           │
└────────────────────────────────────────────────────────────────────────────────────────────────┘
"Lượt dùng" = đã dùng + đang giữ trên tổng lượt; (còn N) là chỗ trống. Coupon Hết hạn và Hết lượt chỉ có "Xem" và "Xóa", không có Tắt, Bật.
Hộp thoại Xóa:  "Xóa coupon SALE10? Mã không còn dùng được và không thể khôi phục."    (Hủy) (Xóa)
Dưới sm: tab thành nút "Trạng thái: Tất cả · 24"; mỗi hàng hai tầng, thao tác trong menu "...".
```

## Trạng thái
| Trạng thái | Trông ra sao | Requirement | testid |
|---|---|---|---|
| có dữ liệu | 20 hàng mới tạo trước, tab đang chọn gạch chân, tổng ở chân, phân trang khi từ 2 trang | PRM-REQ-20261006-101036299 | prm-admin-coupon-list-row |
| đang tải | Khung chờ đúng hình 6 hàng; đổi tab hay trang thì giữ dữ liệu cũ | PRM-REQ-20261006-101036299 | prm-admin-coupon-list-loading |
| rỗng | "Chưa có coupon nào." kèm nút Tạo coupon | PRM-REQ-20261006-101036299 | prm-admin-coupon-list-empty |
| rỗng do lọc | "Không có coupon phù hợp." kèm nút "Xóa bộ lọc"; cũng là trang trống khi đúng 20 coupon mà vào trang 2 | PRM-REQ-20261006-101036299 | prm-admin-coupon-list-empty-filtered |
| lỗi | Banner "Không tải được danh sách coupon." kèm nút "Thử lại"; tham số lọc không hợp lệ (400) cũng vào đây | PRM-REQ-20261006-101036299 | prm-admin-coupon-list-error |
| hết phiên hoặc không có quyền | 401 chuyển về đăng nhập; staff hoặc customer vào trang (403) hiện "Bạn không có quyền xem trang này" và không hiện coupon nào | PRM-REQ-20261006-101036299 | prm-admin-coupon-list-error |
| badge trạng thái | Nhãn "Đang chạy", "Đã tắt", "Hết hạn", "Hết lượt", đọc rõ không chỉ bằng màu; coupon Đang chạy hoặc Đã tắt đã quá hạn nhưng job chưa chạy hiện thêm chú thích "quá hạn" (job chuyển cả hai sang Hết hạn mỗi phút) | PRM-REQ-20261006-101036299 | prm-admin-coupon-list-status-badge |
| bật hoặc tắt thất bại | Dòng chữ đỏ trên bảng nêu lý do: "Coupon đã hết hạn" (409 coupon_expired), "Coupon đã hết lượt" (coupon_exhausted), hoặc "Trạng thái đã đổi, đã tải lại" (invalid_transition); dòng được tải lại | PRM-REQ-20261006-101036275 | prm-admin-coupon-list-toggle-error |
| xóa thất bại | Hộp thoại xóa hiện "Coupon không còn tồn tại" (404, đã bị xóa ở nơi khác) rồi tải lại danh sách; xóa coupon Hết hạn hoặc Hết lượt thành công như mọi coupon (204) | PRM-REQ-20261006-101036252 | prm-admin-coupon-list-delete-error |

## Phần tử
| testid | Phần tử | Role | Hành động | Requirement |
|---|---|---|---|---|
| prm-admin-coupon-list-status-filter | Hàng tab lọc trạng thái (dropdown dưới sm) | admin | Chọn Tất cả, Đang chạy, Đã tắt, Hết hạn, Hết lượt | PRM-REQ-20261006-101036299 |
| prm-admin-coupon-list-search | Ô tìm coupon theo tiền tố mã (tối đa 20 ký tự) | admin | Gõ tiền tố | PRM-REQ-20261006-101036299 |
| prm-admin-coupon-list-clear-filter | Nút Xóa bộ lọc (chỉ khi đang lọc hoặc tìm) | admin | Về Tất cả | PRM-REQ-20261006-101036299 |
| prm-admin-coupon-list-create | Nút Tạo coupon | admin | Mở màn tạo coupon | PRM-REQ-20261006-101036201 |
| prm-admin-coupon-list-row | Hàng coupon | admin | Bấm để mở màn xem hoặc sửa | PRM-REQ-20261006-101036299 |
| prm-admin-coupon-list-code | Mã coupon (đã escape) | admin | - | PRM-REQ-20261006-101036299 |
| prm-admin-coupon-list-discount | Mô tả giảm: loại, giá trị, trần, tối thiểu | admin | - | PRM-REQ-20261006-101036299 |
| prm-admin-coupon-list-expires-at | Hạn dùng theo giờ Việt Nam | admin | - | PRM-REQ-20261006-101036299 |
| prm-admin-coupon-list-usage | Lượt dùng: đã dùng cộng đang giữ trên tổng, và số còn lại | admin | - | PRM-REQ-20261006-101036299 |
| prm-admin-coupon-list-status-badge | Badge trạng thái | admin | - | PRM-REQ-20261006-101036299 |
| prm-admin-coupon-list-edit | Nút Sửa (đổi thành Xem với Hết hạn và Hết lượt) | admin | Mở màn sửa | PRM-REQ-20261006-101036299 |
| prm-admin-coupon-list-toggle | Nút Tắt (coupon Đang chạy) hoặc Bật (coupon Đã tắt); ẩn với Hết hạn, Hết lượt | admin | Đổi trạng thái đang chạy và đã tắt | PRM-REQ-20261006-101036275 |
| prm-admin-coupon-list-toggle-error | Dòng lỗi bật hoặc tắt | admin | - | PRM-REQ-20261006-101036275 |
| prm-admin-coupon-list-delete | Nút Xóa (đỏ nền mờ; hiện với Đang chạy, Đã tắt, Hết hạn, Hết lượt) | admin | Mở hộp thoại xác nhận | PRM-REQ-20261006-101036252 |
| prm-admin-coupon-list-delete-confirm | Nút xác nhận Xóa (đỏ nền mờ, nói rõ không khôi phục) | admin | Xóa mềm coupon | PRM-REQ-20261006-101036252 |
| prm-admin-coupon-list-delete-cancel | Nút Hủy trong hộp thoại xóa | admin | Đóng hộp thoại | PRM-REQ-20261006-101036252 |
| prm-admin-coupon-list-delete-error | Vùng lý do không xóa được (coupon không còn tồn tại) | admin | - | PRM-REQ-20261006-101036252 |
| prm-admin-coupon-list-summary | Dòng "1 tới 20 trong 24 coupon" | admin | - | PRM-REQ-20261006-101036299 |
| prm-admin-coupon-list-pagination | Phân trang ‹ 1 2 › (ẩn khi một trang) | admin | Sang trang khác | PRM-REQ-20261006-101036299 |
| prm-admin-coupon-list-loading | Khung chờ | admin | - | PRM-REQ-20261006-101036299 |
| prm-admin-coupon-list-empty | Vùng rỗng, chưa có coupon | admin | - | PRM-REQ-20261006-101036299 |
| prm-admin-coupon-list-empty-filtered | Vùng rỗng do lọc | admin | - | PRM-REQ-20261006-101036299 |
| prm-admin-coupon-list-error | Banner lỗi (lỗi tải, hết phiên, không có quyền) | admin | - | PRM-REQ-20261006-101036299 |
| prm-admin-coupon-list-retry | Nút Thử lại | admin | Tải lại danh sách | PRM-REQ-20261006-101036299 |

## Ghi chú thiết kế (mặc định, chưa duyệt)
- **Audit (câu 2 của evon):** chưa có codebase; theo mặc định evon (flat, Tailwind, `references/tokens.css`), thư viện UI chưa chốt (xem questions.md câu 10 của PRD). Bảng theo mẫu danh sách, hộp thoại theo `layouts/overlay.md`.
- Xóa là việc nguy hiểm (mất dữ liệu, không khôi phục trên giao diện): nút và hộp xác nhận đỏ nền mờ theo luật chủ dự án số 1, 2, 3. **Tắt** không đỏ vì lấy lại được (bấm Bật), đúng câu "lấy lại được thì hết đỏ" của `rules-color.md`.
- Giao diện ẩn Tắt, Bật với coupon Hết hạn và Hết lượt vì server từ chối (409); Xóa vẫn hiện để admin dọn danh sách (E-23); server vẫn kiểm lại. Coupon `deleted` không bao giờ hiện (server không trả).
- Cột "Lượt dùng" gộp lượt đã dùng và đang giữ (khớp `remaining` ở PRM-REQ-20261006-101036299 BR5), để admin thấy coupon "hết chỗ" dù chưa Hết lượt.
- Giờ hiển thị theo Asia/Ho_Chi_Minh (mặc định, xem questions.md câu 8); API trả UTC.
- Không có cột hay màn liệt kê từng đơn đã dùng coupon (không có endpoint ở v1, PRM-REQ-20261006-101036299 BR8).
- Không viết code giao diện; dựng thật là việc của `implement`.
