---
status: approved
---

# Vai trò

| Role     | Mô tả                                                                                                                                                               | Đăng nhập |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| guest    | Khách chưa đăng nhập: xem sản phẩm, đăng ký, đăng nhập, quên mật khẩu                                                                                               | không     |
| customer | Khách đã có tài khoản: giỏ hàng, checkout, đơn hàng, đánh giá, hồ sơ                                                                                                | có        |
| staff    | Nhân viên kho và chăm sóc khách hàng (dùng chung một role): xem và cập nhật đơn, cập nhật kho, xem khách. Không có doanh thu dashboard, coupon, hoàn tiền, đổi role | có        |
| admin    | Quản trị: sản phẩm, kho, coupon, đơn, hoàn tiền, đổi role, kiểm duyệt đánh giá, dashboard                                                                           | có        |

Quy tắc: role trong `spec/permissions-matrix.md` và `roles:` của requirement phải nằm trong bảng này.
Tác nhân hệ thống (cổng thanh toán gọi webhook, job hết hạn) không phải role đăng nhập; xác thực của chúng nằm ở `spec/security-baseline.md`.
