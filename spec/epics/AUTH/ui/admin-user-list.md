---
screen: admin-user-list
epic: AUTH
status: draft
covers: [AUTH-REQ-20261006-095515956, AUTH-REQ-20261006-095515994]
roles: [admin]
---
# Quản lý người dùng (admin)

## Wireframe
Phương án đã chọn: **A** (bảng dữ liệu nhiều cột, ô tìm email và lọc ở trên, hành động trong menu "..." mỗi dòng, hộp thoại xác nhận cho đổi role và khóa). **Mặc định** của skill, chưa có người chọn. Phương án khác: B danh sách hai cột bên trái và panel chi tiết người dùng bên phải (nhiều việc hơn một màn cần), C thẻ (card) mỗi người (kém khi so sánh role và trạng thái giữa nhiều người). Chọn A vì admin so sánh role, trạng thái, ngày tạo giữa nhiều người và cần quét nhanh.

```
Quản lý người dùng                                     [ Tìm theo email (từ 3 ký tự)  ]
[Role: Tất cả ▾]  [Trạng thái: Tất cả ▾]
┌─────────────────────────────────────────────────────────────────────────────────┐
│ Email            Họ tên     Role        Trạng thái   Xác minh   Ngày tạo     ⋯   │
├─────────────────────────────────────────────────────────────────────────────────┤
│ an@shop.vn       An         (Khách)     (Hoạt động)  Đã xác minh  06/10/2026  ⋯  │
│ ha@shop.vn       Hà         (Nhân viên) (Hoạt động)  Đã xác minh  05/10/2026  ⋯  │
│ bo@shop.vn       Bo         (Khách)     (Đã khóa)    Chưa         03/10/2026  ⋯  │
├─────────────────────────────────────────────────────────────────────────────────┤
│ 1 tới 20 trong 45 người                                            ‹ 1 2 3 ›    │
└─────────────────────────────────────────────────────────────────────────────────┘
Menu ⋯: Đổi role... | Khóa tài khoản... | Mở khóa
Hộp thoại Đổi role: chọn role mới (Khách, Nhân viên, Quản trị) + [Hủy] [Lưu]
Hộp thoại Khóa: lý do (tùy chọn, tối đa 200 ký tự) + [Hủy] [Khóa]
```
Dưới `sm`: bảng thành danh sách thẻ hai tầng (email trên, role và trạng thái dưới), menu `⋯` giữ nguyên.

## Trạng thái
| Trạng thái | Trông ra sao | Requirement |
|---|---|---|
| có dữ liệu | 20 dòng mới nhất trước, tổng số ở chân, phân trang từ hai trang; nhãn role và trạng thái đọc rõ không chỉ bằng màu | AUTH-REQ-20261006-095515956 |
| đang tải | Khung chờ đúng hình 5 dòng; đổi trang hay lọc thì giữ dữ liệu cũ mờ đi | AUTH-REQ-20261006-095515956 |
| rỗng | "Chưa có người dùng nào." (không có trong thực tế vì admin luôn có mình) | AUTH-REQ-20261006-095515956 |
| rỗng do lọc | "Không có người dùng khớp." kèm nút Xóa lọc; cũng là trang quá cuối | AUTH-REQ-20261006-095515956 |
| lỗi | Banner "Không tải được danh sách." kèm nút Thử lại; lỗi lọc không hợp lệ (400, ví dụ ô tìm dưới 3 ký tự) hiện nhắc dưới ô tìm | AUTH-REQ-20261006-095515956 |
| hết phiên | 401: chuyển về đăng nhập | AUTH-REQ-20261006-095515956 |
| không có quyền | Staff hay customer vào màn này: chuyển tới màn `access-denied` (không dựng giao diện quản lý) | AUTH-REQ-20261006-095515956 |
| đang đổi role | Hộp thoại khóa nút Lưu, "Đang lưu..." | AUTH-REQ-20261006-095515956 |
| đổi role xong | Đóng hộp thoại, dòng cập nhật role mới, toast "Đã đổi role" | AUTH-REQ-20261006-095515956 |
| đổi role bị từ chối | Lỗi trong hộp thoại: "Bạn không thể đổi role của chính mình" (403), "Role không thay đổi" (409 role_unchanged), "Phải còn ít nhất một quản trị đang hoạt động" (409 last_admin) | AUTH-REQ-20261006-095515956 |
| đang khóa | Hộp thoại khóa nút Khóa, "Đang khóa..." | AUTH-REQ-20261006-095515994 |
| khóa xong | Đóng hộp thoại, dòng thành "Đã khóa", toast "Đã khóa tài khoản" | AUTH-REQ-20261006-095515994 |
| khóa bị từ chối | Lỗi trong hộp thoại: "Bạn không thể khóa chính mình" (403), "Tài khoản đã bị khóa" (409 already_locked), "Phải còn ít nhất một quản trị đang hoạt động" (409 last_admin); lý do quá dài chặn nút Khóa ngay ở ô (200 ký tự) | AUTH-REQ-20261006-095515994 |
| mở khóa xong | Dòng thành "Hoạt động", toast "Đã mở khóa" (không cần xác nhận vì có thể khóa lại) | AUTH-REQ-20261006-095515994 |
| mở khóa bị từ chối | Toast lỗi "Tài khoản không ở trạng thái khóa" (409 not_locked) và làm mới dòng | AUTH-REQ-20261006-095515994 |

## Phần tử
| testid | Phần tử | Role | Hành động | Requirement |
|---|---|---|---|---|
| auth-admin-user-list-search | Ô tìm theo email (tiền tố, từ 3 ký tự) | admin | Nhập để tìm | AUTH-REQ-20261006-095515956 |
| auth-admin-user-list-role-filter | Lọc role | admin | Chọn role hoặc Tất cả | AUTH-REQ-20261006-095515956 |
| auth-admin-user-list-status-filter | Lọc trạng thái | admin | Chọn trạng thái hoặc Tất cả | AUTH-REQ-20261006-095515956 |
| auth-admin-user-list-clear-filter | Nút Xóa lọc | admin | Về Tất cả | AUTH-REQ-20261006-095515956 |
| auth-admin-user-list-row | Dòng người dùng | admin | - | AUTH-REQ-20261006-095515956 |
| auth-admin-user-list-email | Email | admin | - | AUTH-REQ-20261006-095515956 |
| auth-admin-user-list-role | Nhãn role | admin | - | AUTH-REQ-20261006-095515956 |
| auth-admin-user-list-status | Nhãn trạng thái | admin | - | AUTH-REQ-20261006-095515956 |
| auth-admin-user-list-summary | Dòng "1 tới 20 trong 45 người" | admin | - | AUTH-REQ-20261006-095515956 |
| auth-admin-user-list-pagination | Phân trang (ẩn khi một trang) | admin | Sang trang khác | AUTH-REQ-20261006-095515956 |
| auth-admin-user-list-loading | Khung chờ | admin | - | AUTH-REQ-20261006-095515956 |
| auth-admin-user-list-empty | Vùng rỗng | admin | - | AUTH-REQ-20261006-095515956 |
| auth-admin-user-list-empty-filtered | Vùng rỗng do lọc | admin | - | AUTH-REQ-20261006-095515956 |
| auth-admin-user-list-error | Banner lỗi | admin | - | AUTH-REQ-20261006-095515956 |
| auth-admin-user-list-retry | Nút Thử lại | admin | Tải lại danh sách | AUTH-REQ-20261006-095515956 |
| auth-admin-user-list-row-menu | Nút menu ⋯ của dòng | admin | Mở menu hành động | AUTH-REQ-20261006-095515956 |
| auth-admin-user-list-change-role | Mục Đổi role | admin | Mở hộp thoại đổi role | AUTH-REQ-20261006-095515956 |
| auth-admin-user-list-role-select | Chọn role mới trong hộp thoại | admin | Chọn role | AUTH-REQ-20261006-095515956 |
| auth-admin-user-list-role-save | Nút Lưu đổi role | admin | Xác nhận đổi role | AUTH-REQ-20261006-095515956 |
| auth-admin-user-list-role-cancel | Nút Hủy đổi role | admin | Đóng hộp thoại | AUTH-REQ-20261006-095515956 |
| auth-admin-user-list-role-error | Lỗi đổi role trong hộp thoại | admin | - | AUTH-REQ-20261006-095515956 |
| auth-admin-user-list-lock | Mục Khóa tài khoản | admin | Mở hộp thoại khóa | AUTH-REQ-20261006-095515994 |
| auth-admin-user-list-lock-reason | Ô lý do khóa (tối đa 200 ký tự) | admin | Nhập | AUTH-REQ-20261006-095515994 |
| auth-admin-user-list-lock-confirm | Nút Khóa trong hộp thoại | admin | Xác nhận khóa | AUTH-REQ-20261006-095515994 |
| auth-admin-user-list-lock-cancel | Nút Hủy khóa | admin | Đóng hộp thoại | AUTH-REQ-20261006-095515994 |
| auth-admin-user-list-lock-error | Lỗi khóa trong hộp thoại | admin | - | AUTH-REQ-20261006-095515994 |
| auth-admin-user-list-unlock | Mục Mở khóa | admin | Mở khóa ngay | AUTH-REQ-20261006-095515994 |
| auth-admin-user-list-toast-role | Toast kết quả đổi role (thành công hoặc lỗi) | admin | - | AUTH-REQ-20261006-095515956 |
| auth-admin-user-list-toast-lock | Toast kết quả khóa hoặc mở khóa (thành công hoặc lỗi) | admin | - | AUTH-REQ-20261006-095515994 |

## Ghi chú thiết kế (mặc định, chưa duyệt)
- Brief, audit và danh sách màn xem ở `register.md`. Đây là màn quản trị trong app (khác phía người mua), nên theo mẫu "Bảng có bộ lọc" và hộp thoại xác nhận của evon.
- Đổi role và khóa có hộp thoại vì tác động lớn (đổi quyền, chặn đăng nhập, thu hồi mọi phiên); mở khóa không có hộp thoại vì dễ hoàn tác.
- Mục menu của chính dòng admin đăng nhập: "Đổi role" và "Khóa" bị tắt (server cũng chặn: BR6 của yêu cầu đổi role, BR5 của yêu cầu khóa); giao diện không thay kiểm ở server.
- Sắp xếp mới nhất trước và 20 dòng mỗi trang cố định. Không hiện băm mật khẩu hay token ở bất cứ đâu.
- Email, tên là dữ liệu cá nhân, chỉ admin thấy (SB-08); hiển thị luôn được escape (SB-12), lý do khóa nhập từ admin không render HTML.
- Staff không có màn này; staff "xem khách" nằm ở USR (tra cứu khách bản che, R-02, SB-08 (a)).
- Không viết code giao diện; dựng thật là việc của `implement`.
