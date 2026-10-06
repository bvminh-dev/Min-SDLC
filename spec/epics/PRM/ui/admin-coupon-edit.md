---
screen: admin-coupon-edit
epic: PRM
status: draft
covers: [PRM-REQ-20261006-101036201, PRM-REQ-20261006-101036227, PRM-REQ-20261006-101036299]
roles: [admin]
---
# Tạo và sửa coupon

## Wireframe
Phương án đã chọn: **A** (một trang biểu mẫu một cột, nhóm trường: Mã và loại; Giá trị và điều kiện; Hạn và lượt; khi sửa có khung "Đã dùng" ở đầu trang). **Đây là lựa chọn mặc định** của skill, chưa có người dùng chọn (các cổng không hỏi được ở lần chạy này).

| Phương án | Việc chính thấy ở đâu | Đổi gì | Đánh đổi |
|---|---|---|---|
| **A. Trang biểu mẫu một cột (khuyên dùng, đã chọn)** | Mọi trường và lỗi trên một trang, chế độ tạo và sửa dùng chung | Khi sửa, Mã và Loại khóa; khung Đã dùng ở đầu | Trang dài hơn trên điện thoại nhưng không có bước phụ |
| B. Hộp thoại từ danh sách | Không rời danh sách | Nhanh với sửa một trường | Biểu mẫu 8 trường và lỗi từng trường chật trong hộp thoại; khó thấy khung Đã dùng |
| C. Trình hướng dẫn ba bước | Loại, rồi giá trị, rồi hạn và lượt | Dẫn từng bước cho người mới | Chậm cho admin quen việc; sửa một trường vẫn phải đi cả ba bước |

Lý do chọn A: coupon chỉ có tám trường, quan hệ giữa chúng (loại quyết định trường nào hiện, lượt không nhỏ hơn số đã dùng) cần nhìn cùng lúc.

```
Header:  ‹ Coupon   /   Tạo coupon (hoặc SALE10)                    (Đang chạy)  [badge, chỉ khi sửa]
Khung "Đã dùng" (chỉ khi sửa):  Đã dùng 30  ·  Đang giữ 5  ·  Còn lại 65 / 100
┌──────────────────────────────────────────────────────────────────────┐
│ Mã *            [ SALE10________ ]   (khóa khi sửa)   4 đến 20 ký tự │
│ Loại *          (•) Phần trăm   ( ) Số tiền cố định   (khóa khi sửa) │
│ Giá trị *       [ 10 ] %  (hoặc đ khi cố định)                        │
│ Giảm tối đa     [ 50.000 ] đ   (chỉ hiện với Phần trăm; trống = không) │
│ Đơn tối thiểu   [ 200.000 ] đ  (0 = không đòi)                        │
│ Hết hạn *       [ 13/10/2026 ] [ 23:59 ]  (giờ Việt Nam)              │
│ Số lượt dùng *  [ 100 ]  (không nhỏ hơn đã dùng + đang giữ)           │
│ Lượt mỗi người  [ 1 ]    (trống = không giới hạn mỗi người)           │
│                                                    (Hủy) (Lưu)        │
└──────────────────────────────────────────────────────────────────────┘
Chữ lỗi đỏ dưới từng ô. Khi coupon Hết hạn hoặc Hết lượt: banner "Không sửa được coupon này" và mọi ô khóa, ẩn nút Lưu.
Dưới sm: các ô xếp một cột đầy bề rộng, nút Lưu dính đáy màn hình.
```

## Trạng thái
| Trạng thái | Trông ra sao | Requirement | testid |
|---|---|---|---|
| tạo mới | Biểu mẫu trống, Loại mặc định Phần trăm, Đơn tối thiểu 0, không có khung Đã dùng | PRM-REQ-20261006-101036201 | prm-admin-coupon-edit-code |
| sửa có dữ liệu | Biểu mẫu điền sẵn, Mã và Loại khóa, khung Đã dùng hiện số đã dùng, đang giữ, còn lại | PRM-REQ-20261006-101036299 | prm-admin-coupon-edit-usage-summary |
| đang tải | Khung chờ hình biểu mẫu khi mở coupon để sửa | PRM-REQ-20261006-101036299 | prm-admin-coupon-edit-loading |
| lỗi | Banner "Không tải được coupon." kèm nút "Thử lại"; hết phiên (401) chuyển về đăng nhập; không có quyền (403) hiện "Bạn không có quyền" và không hiện biểu mẫu | PRM-REQ-20261006-101036299 | prm-admin-coupon-edit-error |
| không tìm thấy | Coupon đã xóa hoặc không tồn tại (404): "Coupon không còn tồn tại" kèm link về danh sách | PRM-REQ-20261006-101036299 | prm-admin-coupon-edit-not-found |
| mã trùng | Chữ đỏ dưới ô Mã: "Mã này đã được dùng (kể cả mã đã xóa)" (409 code_taken) | PRM-REQ-20261006-101036201 | prm-admin-coupon-edit-code-error |
| mã không hợp lệ | Chữ đỏ dưới ô Mã: "4 đến 20 ký tự gồm chữ, số, gạch dưới, gạch ngang" (400) | PRM-REQ-20261006-101036201 | prm-admin-coupon-edit-code-error |
| giá trị không hợp lệ | Chữ đỏ dưới ô Giá trị: "Phần trăm từ 1 đến 100" hoặc "Số tiền từ 1 đến 1.000.000.000" (400) | PRM-REQ-20261006-101036201 | prm-admin-coupon-edit-value-error |
| giảm tối đa không hợp lệ | Chữ đỏ dưới ô Giảm tối đa: ngoài khoảng 1 đến 1.000.000.000 (400); ô ẩn với loại Số tiền cố định | PRM-REQ-20261006-101036201 | prm-admin-coupon-edit-max-discount-error |
| đơn tối thiểu không hợp lệ | Chữ đỏ dưới ô Đơn tối thiểu: "Từ 0 đến 1.000.000.000" (400) | PRM-REQ-20261006-101036201 | prm-admin-coupon-edit-min-order-error |
| hạn không hợp lệ | Chữ đỏ dưới ô Hết hạn: "Hạn phải sau thời điểm hiện tại" hoặc thiếu hạn (400) | PRM-REQ-20261006-101036201 | prm-admin-coupon-edit-expires-at-error |
| số lượt không hợp lệ | Chữ đỏ dưới ô Số lượt: "Từ 1 đến 1.000.000" (400); khi sửa nhỏ hơn đã dùng: "Không nhỏ hơn 35 (đã dùng cộng đang giữ)" (409 usage_limit_below_used) | PRM-REQ-20261006-101036227 | prm-admin-coupon-edit-usage-limit-error |
| lượt mỗi người không hợp lệ | Chữ đỏ dưới ô Lượt mỗi người: "Từ 1 đến 1.000.000, hoặc để trống nếu không giới hạn" (400) | PRM-REQ-20261006-101036201 | prm-admin-coupon-edit-per-user-limit-error |
| xung đột phiên bản | Banner "Coupon vừa được người khác sửa. Tải lại để xem bản mới." kèm nút Tải lại (409 version_mismatch); dữ liệu đang gõ không bị ghi | PRM-REQ-20261006-101036227 | prm-admin-coupon-edit-conflict-error |
| không sửa được | Banner "Không sửa được coupon đã hết hạn hoặc hết lượt" (409 coupon_not_editable); mọi ô khóa, ẩn nút Lưu | PRM-REQ-20261006-101036227 | prm-admin-coupon-edit-not-editable |
| đang lưu | Nút Lưu hiện đang xoay và tắt để không gửi hai lần | PRM-REQ-20261006-101036227 | prm-admin-coupon-edit-save |

## Phần tử
| testid | Phần tử | Role | Hành động | Requirement |
|---|---|---|---|---|
| prm-admin-coupon-edit-code | Ô mã (4 đến 20 ký tự, tự đổi chữ hoa; khóa khi sửa) | admin | Nhập mã khi tạo | PRM-REQ-20261006-101036201 |
| prm-admin-coupon-edit-type | Nhóm chọn Loại: Phần trăm, Số tiền cố định (khóa khi sửa) | admin | Chọn loại khi tạo | PRM-REQ-20261006-101036201 |
| prm-admin-coupon-edit-value | Ô Giá trị (đơn vị % hoặc đ theo loại) | admin | Nhập giá trị | PRM-REQ-20261006-101036201 |
| prm-admin-coupon-edit-max-discount | Ô Giảm tối đa (chỉ hiện với Phần trăm; để trống là không trần) | admin | Nhập trần giảm | PRM-REQ-20261006-101036201 |
| prm-admin-coupon-edit-min-order | Ô Đơn tối thiểu (0 là không đòi) | admin | Nhập giá trị đơn tối thiểu | PRM-REQ-20261006-101036201 |
| prm-admin-coupon-edit-expires-at | Ô ngày giờ hết hạn (giờ Việt Nam) | admin | Chọn ngày giờ | PRM-REQ-20261006-101036201 |
| prm-admin-coupon-edit-usage-limit | Ô Số lượt dùng | admin | Nhập tổng lượt | PRM-REQ-20261006-101036201 |
| prm-admin-coupon-edit-per-user-limit | Ô Lượt mỗi người (số nguyên 1 đến 1.000.000; để trống là không giới hạn mỗi người; sửa được cả khi sửa coupon) | admin | Nhập số lượt tối đa mỗi người | PRM-REQ-20261006-101036201 |
| prm-admin-coupon-edit-save | Nút Lưu (tạo hoặc cập nhật theo chế độ) | admin | Gửi tạo hoặc sửa | PRM-REQ-20261006-101036227 |
| prm-admin-coupon-edit-cancel | Nút Hủy | admin | Về danh sách, bỏ thay đổi | PRM-REQ-20261006-101036227 |
| prm-admin-coupon-edit-status-badge | Badge trạng thái (chỉ khi sửa) | admin | - | PRM-REQ-20261006-101036299 |
| prm-admin-coupon-edit-usage-summary | Khung Đã dùng, Đang giữ, Còn lại trên tổng (chỉ khi sửa) | admin | - | PRM-REQ-20261006-101036299 |
| prm-admin-coupon-edit-code-error | Chữ lỗi dưới ô mã | admin | - | PRM-REQ-20261006-101036201 |
| prm-admin-coupon-edit-value-error | Chữ lỗi dưới ô giá trị | admin | - | PRM-REQ-20261006-101036201 |
| prm-admin-coupon-edit-max-discount-error | Chữ lỗi dưới ô giảm tối đa | admin | - | PRM-REQ-20261006-101036201 |
| prm-admin-coupon-edit-min-order-error | Chữ lỗi dưới ô đơn tối thiểu | admin | - | PRM-REQ-20261006-101036201 |
| prm-admin-coupon-edit-expires-at-error | Chữ lỗi dưới ô hết hạn | admin | - | PRM-REQ-20261006-101036201 |
| prm-admin-coupon-edit-usage-limit-error | Chữ lỗi dưới ô số lượt (gồm usage_limit_below_used) | admin | - | PRM-REQ-20261006-101036227 |
| prm-admin-coupon-edit-per-user-limit-error | Chữ lỗi dưới ô lượt mỗi người | admin | - | PRM-REQ-20261006-101036201 |
| prm-admin-coupon-edit-conflict-error | Banner xung đột phiên bản kèm nút Tải lại | admin | Tải lại coupon mới nhất | PRM-REQ-20261006-101036227 |
| prm-admin-coupon-edit-not-editable | Banner không sửa được (đã hết hạn hoặc hết lượt) | admin | - | PRM-REQ-20261006-101036227 |
| prm-admin-coupon-edit-loading | Khung chờ | admin | - | PRM-REQ-20261006-101036299 |
| prm-admin-coupon-edit-error | Banner lỗi (lỗi tải, hết phiên, không có quyền) | admin | - | PRM-REQ-20261006-101036299 |
| prm-admin-coupon-edit-retry | Nút Thử lại | admin | Tải lại coupon | PRM-REQ-20261006-101036299 |
| prm-admin-coupon-edit-not-found | Vùng coupon không còn tồn tại kèm link về danh sách | admin | - | PRM-REQ-20261006-101036299 |

## Ghi chú thiết kế (mặc định, chưa duyệt)
- **Audit (câu 2 của evon):** chưa có codebase; theo mặc định evon (flat, Tailwind, `references/tokens.css`), thư viện UI chưa chốt. Biểu mẫu theo `rules-form.md`: nhãn trên ô, lỗi ngay dưới ô, ô giữ viền.
- Trường nào hiện phụ thuộc Loại: Giảm tối đa chỉ hiện với Phần trăm (server từ chối nếu gửi với Số tiền cố định, PRM-REQ-20261006-101036201 BR6).
- Khi sửa, Mã và Loại hiện nhưng khóa (server trả 400 `field_immutable` nếu đổi, PRM-REQ-20261006-101036227 BR3). Muốn đổi mã hay loại thì tạo coupon mới.
- Giao diện gửi `version` đã đọc kèm lúc Lưu; 409 `version_mismatch` hiện banner, không tự ghi đè.
- Giờ nhập theo Asia/Ho_Chi_Minh, gửi lên UTC (mặc định, xem questions.md câu 8).
- Ô Lượt mỗi người (M-07, R-01) là tùy chọn; hạ thấp khi sửa không thu hồi lượt đã có nên không có lỗi 409 riêng (PRM-REQ-20261006-101036227 BR7); `null` gửi lên khi để trống.
- Khung "Đã dùng" lấy `consumed_count`, `reserved_count`, `remaining` của chi tiết (PRM-REQ-20261006-101036299 BR5, BR6) để admin biết giới hạn tối thiểu của Số lượt.
- Trạng thái "đang lưu" và "tạo mới" không phải trạng thái từ Given/When/Then riêng; "tạo mới" lấy từ luồng chính của PRM-REQ-20261006-101036201; "đang lưu" là chống bấm hai lần (không phải yêu cầu nghiệp vụ, ghi để dựng).
- Không viết code giao diện; dựng thật là việc của `implement`.
