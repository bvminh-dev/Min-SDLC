---
screen: profile
epic: USR
status: draft
covers: [USR-REQ-20261006-101003419, USR-REQ-20261006-101003504, USR-REQ-20261006-101003679]
roles: [customer, staff, admin]
---
# Hồ sơ cá nhân (xem, sửa, ảnh đại diện)

## Wireframe
Phương án đã chọn: **A** (một cột `max-w-xl`: khối ảnh đại diện ở đầu, form hai ô sửa được, các dòng chỉ-đọc, hai liên kết sang màn khác). **Đây là lựa chọn mặc định** theo khuyến nghị của skill, chưa có người chọn: các cổng "duyệt brief", "xác nhận danh sách màn" và "chọn wireframe" không hỏi được người dùng khi chạy tự động.

| Phương án | Bố cục | Đánh đổi |
|---|---|---|
| **A. Một cột, xem và sửa cùng một form (khuyên dùng, đã chọn)** | Ảnh, họ tên, điện thoại là ô nhập sẵn; email chỉ đọc; nút Lưu | Ít bấm nhất cho hai trường; đọc tốt ở 375px |
| B. Chế độ xem rồi bấm "Sửa" để mở form | Trang xem dạng danh sách nhãn và giá trị, nút Sửa mở hộp thoại | Rõ ràng chế độ xem; thêm một lần bấm cho việc chỉ có hai trường |
| C. Chia tab Hồ sơ, Bảo mật, Địa chỉ | Một trang có ba tab | Gom mọi việc tài khoản; mật khẩu và địa chỉ là hai màn riêng đã có, thêm tab chỉ nhân đôi đường vào |

Lý do chọn A: hồ sơ chỉ có ảnh, họ tên, điện thoại là sửa được; form tại chỗ nhanh hơn xem-rồi-sửa. Email không sửa được nên là dòng chỉ-đọc kèm nhãn xác minh.

```
Hồ sơ của tôi
┌────────────────────────────────────────────────────────┐
│  ╭─────╮   Ảnh đại diện                                │
│  │  A  │   JPG, PNG hoặc WebP, tối đa 2 MB              │   <- không có ảnh: chữ cái đầu trên nền pastel
│  ╰─────╯   [ Tải ảnh lên ]   Xóa ảnh                     │
│            (vùng báo lỗi ảnh)                           │
│                                                        │
│  Họ tên                                                │
│  [ Nguyễn An                                  ]        │
│  Điện thoại                                            │
│  [ 0901234567                                 ]        │
│  Email                                                 │
│  an@shop.vn   (Đã xác minh)                            │   <- chỉ đọc; "Chưa xác minh" khi email_verified = false
│                                                        │
│  (vùng báo lỗi chung)                                  │
│  [ Lưu thay đổi ]                                      │
└────────────────────────────────────────────────────────┘
Đổi mật khẩu  ›
Sổ địa chỉ  ›                                                <- chỉ customer
```

## Trạng thái
| Trạng thái | Trông ra sao | Requirement |
|---|---|---|
| đang tải | Khung chờ đúng hình: tròn ảnh và hai ô nhập xám; nút Lưu khóa | USR-REQ-20261006-101003419 |
| có dữ liệu | Ô họ tên và điện thoại điền sẵn; email chỉ đọc kèm nhãn xác minh; nút Lưu tắt cho tới khi có thay đổi | USR-REQ-20261006-101003419 |
| chưa xác minh email | Nhãn "Chưa xác minh" cạnh email kèm gợi ý; không chặn sửa hồ sơ | USR-REQ-20261006-101003419 |
| đang lưu | Nút Lưu khóa, chữ "Đang lưu..."; hai ô khóa | USR-REQ-20261006-101003504 |
| lỗi kiểm dữ liệu | Thông báo dưới từng ô: họ tên trống hoặc quá 100 ký tự, điện thoại không phải số di động Việt Nam (10 chữ số, đầu 03, 05, 07, 08, 09); giữ nguyên nội dung đã nhập | USR-REQ-20261006-101003504 |
| đã lưu | Toast "Đã lưu hồ sơ"; ô hiện giá trị chuẩn hóa từ server (ví dụ điện thoại `0901234567`); nút Lưu tắt lại | USR-REQ-20261006-101003504 |
| đang tải ảnh | Vòng ảnh mờ kèm vòng quay, nút "Tải ảnh lên" khóa | USR-REQ-20261006-101003679 |
| ảnh xong | Ảnh mới hiện trong vòng tròn, toast "Đã đổi ảnh đại diện" | USR-REQ-20261006-101003679 |
| ảnh bị từ chối | Dòng lỗi dưới khu ảnh theo `reason`: "Chỉ nhận JPG, PNG hoặc WebP" (unsupported_type), "Ảnh quá 2 MB" (too_large), "Ảnh bị hỏng hoặc quá lớn về kích thước" (corrupt, dimensions_exceeded); ảnh cũ giữ nguyên | USR-REQ-20261006-101003679 |
| ảnh bị giới hạn | Dòng lỗi "Bạn tải ảnh quá nhiều lần, thử lại sau N phút" (từ `Retry-After`), nút "Tải ảnh lên" khóa tới hết giờ | USR-REQ-20261006-101003679 |
| ảnh đã xóa | Vòng tròn về chữ cái đầu; nút "Xóa ảnh" ẩn; toast "Đã xóa ảnh đại diện" | USR-REQ-20261006-101003679 |
| lỗi | Banner "Không tải được hồ sơ" kèm nút Thử lại (tải); hoặc "Không lưu được. Thử lại." (lưu, lỗi mạng hay 5xx), ô giữ nguyên | USR-REQ-20261006-101003419 |
| hết phiên | 401: chuyển về đăng nhập, kèm banner phiên hết hạn ở màn đăng nhập (màn của AUTH) | USR-REQ-20261006-101003419 |

## Phần tử
| testid | Phần tử | Role | Hành động | Requirement |
|---|---|---|---|---|
| usr-profile-loading | Khung chờ khi tải hồ sơ | customer, staff, admin | - | USR-REQ-20261006-101003419 |
| usr-profile-email | Dòng email chỉ đọc | customer, staff, admin | - | USR-REQ-20261006-101003419 |
| usr-profile-email-verified | Nhãn Đã xác minh hoặc Chưa xác minh | customer, staff, admin | - | USR-REQ-20261006-101003419 |
| usr-profile-error | Banner lỗi tải hoặc lưu chung | customer, staff, admin | - | USR-REQ-20261006-101003419 |
| usr-profile-retry | Nút Thử lại | customer, staff, admin | Tải lại | USR-REQ-20261006-101003419 |
| usr-profile-session-expired | Điểm đánh dấu chuyển về đăng nhập khi 401 (route đích mang banner phiên hết hạn) | customer, staff, admin | - | USR-REQ-20261006-101003419 |
| usr-profile-password-link | Liên kết Đổi mật khẩu | customer, staff, admin | Sang màn đổi mật khẩu | USR-REQ-20261006-101003419 |
| usr-profile-addresses-link | Liên kết Sổ địa chỉ | customer | Sang màn danh sách địa chỉ | USR-REQ-20261006-101003419 |
| usr-profile-form | Biểu mẫu hồ sơ | customer, staff, admin | Gửi | USR-REQ-20261006-101003504 |
| usr-profile-full-name | Ô họ tên | customer, staff, admin | Nhập | USR-REQ-20261006-101003504 |
| usr-profile-phone | Ô điện thoại | customer, staff, admin | Nhập | USR-REQ-20261006-101003504 |
| usr-profile-field-error | Lỗi dưới từng ô (một vùng cho mỗi ô, có `data-field`) | customer, staff, admin | - | USR-REQ-20261006-101003504 |
| usr-profile-save | Nút Lưu thay đổi | customer, staff, admin | Gửi sửa hồ sơ | USR-REQ-20261006-101003504 |
| usr-profile-saved | Toast Đã lưu hồ sơ | customer, staff, admin | - | USR-REQ-20261006-101003504 |
| usr-profile-avatar-image | Ảnh đại diện (hoặc chữ cái đầu) | customer, staff, admin | - | USR-REQ-20261006-101003679 |
| usr-profile-avatar-upload | Ô chọn tệp ảnh (nút Tải ảnh lên) | customer, staff, admin | Chọn tệp để tải | USR-REQ-20261006-101003679 |
| usr-profile-avatar-remove | Nút Xóa ảnh (chỉ khi có ảnh) | customer, staff, admin | Xóa ảnh | USR-REQ-20261006-101003679 |
| usr-profile-avatar-uploading | Trạng thái đang tải ảnh | customer, staff, admin | - | USR-REQ-20261006-101003679 |
| usr-profile-avatar-error | Dòng lỗi ảnh (có `data-reason`) | customer, staff, admin | - | USR-REQ-20261006-101003679 |
| usr-profile-avatar-rate-limited | Dòng bị giới hạn tải ảnh kèm số phút chờ | customer, staff, admin | - | USR-REQ-20261006-101003679 |

## Ghi chú thiết kế (mặc định, chưa duyệt)
- **Báo trước theo skill evon:** màn thuộc phía người mua của cửa hàng online, skill chưa được dạy loại này; vẫn làm theo mẫu form một cột nên có thể chưa đẹp bằng màn trong app.
- **Audit (câu 2 của evon):** chưa có codebase; stack web theo ADR-002 (Next.js), thư viện UI và CSS chưa có ADR. Mặc định: flat, Tailwind, `references/tokens.css`, tiếng Việt; avatar theo `components/avatar.md` (chữ cái đầu trên nền pastel khi không có ảnh). Khu tải ảnh chỉ một tệp nên dùng nút "Tải ảnh lên" thay khung kéo thả đầy đủ của `components/file-upload.md`.
- **Brief (U1, nguồn: đọc spec):** cửa hàng online; người dùng customer, staff, admin đã đăng nhập; việc chính: kiểm tra và sửa họ tên, điện thoại, ảnh; nền tảng: điện thoại và máy tính.
- **Danh sách màn (U2, mặc định đã xác nhận thay người dùng):** `profile` (customer, staff, admin; hồ sơ, sửa hồ sơ, ảnh), `change-password` (customer, staff, admin), `address-list` (customer; xem, đặt mặc định, xóa), `address-form` (customer; thêm, sửa), `customer-lookup` (staff, admin).
- Không có ô sửa email (đổi email ngoài roadmap, xem USR-REQ-20261006-101003504 Xung đột). Nút Lưu chỉ bật khi có thay đổi.
- **Lệch/ghi chú:** ảnh đổi ngay khi chọn tệp (không cần bấm Lưu) vì có endpoint riêng; hồ sơ họ tên và điện thoại cần bấm Lưu.
- Không viết code giao diện; dựng thật là việc của `implement`.
