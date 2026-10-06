# Test ID

Sinh tự động bởi `.claude/skills/sdlc-ui-ux/scripts/check-ui.mjs` từ `spec/epics/*/ui/*.md`. **Không sửa tay.**

| testid | Màn | Epic | Phần tử | Role | Requirement |
|---|---|---|---|---|---|
| ord-order-admin-list-clear-filter | order-admin-list | ORD | Nút Xoá lọc (chỉ khi đang lọc hoặc tìm) | staff, admin | ORD-REQ-20261006-092320743 |
| ord-order-admin-list-code | order-admin-list | ORD | Mã đơn (font-mono) | staff, admin | ORD-REQ-20261006-092320743 |
| ord-order-admin-list-created-at | order-admin-list | ORD | Ngày tạo | staff, admin | ORD-REQ-20261006-092320743 |
| ord-order-admin-list-empty | order-admin-list | ORD | Vùng rỗng, chưa có đơn | staff, admin | ORD-REQ-20261006-092320743 |
| ord-order-admin-list-empty-filtered | order-admin-list | ORD | Vùng rỗng do tìm hoặc lọc | staff, admin | ORD-REQ-20261006-092320743 |
| ord-order-admin-list-error | order-admin-list | ORD | Banner lỗi | staff, admin | ORD-REQ-20261006-092320743 |
| ord-order-admin-list-item-count | order-admin-list | ORD | Số mặt hàng | staff, admin | ORD-REQ-20261006-092320743 |
| ord-order-admin-list-loading | order-admin-list | ORD | Khung chờ | staff, admin | ORD-REQ-20261006-092320743 |
| ord-order-admin-list-pagination | order-admin-list | ORD | Phân trang ‹ 1 2 3 › (ẩn khi một trang) | staff, admin | ORD-REQ-20261006-092320743 |
| ord-order-admin-list-payment | order-admin-list | ORD | Phương thức và trạng thái thanh toán | staff, admin | ORD-REQ-20261006-092320743 |
| ord-order-admin-list-retry | order-admin-list | ORD | Nút Thử lại | staff, admin | ORD-REQ-20261006-092320743 |
| ord-order-admin-list-row | order-admin-list | ORD | Hàng đơn | staff, admin | ORD-REQ-20261006-092320743 |
| ord-order-admin-list-search | order-admin-list | ORD | Ô tìm theo mã đơn (placeholder nói rõ mã đơn, không nhắc email) | staff, admin | ORD-REQ-20261006-092320743 |
| ord-order-admin-list-status-badge | order-admin-list | ORD | Badge trạng thái đơn | staff, admin | ORD-REQ-20261006-092320790 |
| ord-order-admin-list-status-filter | order-admin-list | ORD | Hàng tab lọc trạng thái | staff, admin | ORD-REQ-20261006-092320743 |
| ord-order-admin-list-summary | order-admin-list | ORD | Dòng "1 tới 20 trong 45 đơn" | staff, admin | ORD-REQ-20261006-092320743 |
| ord-order-admin-list-total | order-admin-list | ORD | Tổng tiền, căn phải | staff, admin | ORD-REQ-20261006-092320743 |
| ord-order-detail-address | order-detail | ORD | Khối người nhận, điện thoại, địa chỉ giao | customer, admin | ORD-REQ-20261006-092320768 |
| ord-order-detail-address-hidden | order-detail | ORD | Dòng "ẩn theo chính sách dữ liệu" thay khối địa chỉ | staff | ORD-REQ-20261006-092320768 |
| ord-order-detail-back-link | order-detail | ORD | Liên kết Quay lại danh sách | customer, staff, admin | ORD-REQ-20261006-092320768 |
| ord-order-detail-cancel-button | order-detail | ORD | Nút Hủy đơn (ẩn khi không hủy được) | customer, admin | ORD-REQ-20261006-092320834 |
| ord-order-detail-cancel-confirm | order-detail | ORD | Nút Xác nhận hủy | customer, admin | ORD-REQ-20261006-092320834 |
| ord-order-detail-cancel-dialog | order-detail | ORD | Hộp thoại xác nhận hủy | customer, admin | ORD-REQ-20261006-092320834 |
| ord-order-detail-cancel-dismiss | order-detail | ORD | Nút Giữ đơn | customer, admin | ORD-REQ-20261006-092320834 |
| ord-order-detail-cancel-error | order-detail | ORD | Vùng lỗi trong hộp thoại (409, 400, 403, 401) | customer, admin | ORD-REQ-20261006-092320834 |
| ord-order-detail-cancel-reason | order-detail | ORD | Ô nhập lý do hủy (tùy chọn, tối đa 500 ký tự) | customer, admin | ORD-REQ-20261006-092320834 |
| ord-order-detail-cancel-refund-notice | order-detail | ORD | Dòng thông báo hoàn tiền xử lý riêng (chỉ đơn paid) | customer, admin | ORD-REQ-20261006-092320834 |
| ord-order-detail-cancel-reload | order-detail | ORD | Nút Tải lại đơn trong lỗi 409 | customer, admin | ORD-REQ-20261006-092320834 |
| ord-order-detail-cancel-success | order-detail | ORD | Thông báo "Đã hủy đơn" | customer, admin | ORD-REQ-20261006-092320834 |
| ord-order-detail-code | order-detail | ORD | Mã đơn trong đầu trang (font-mono) | customer, staff, admin | ORD-REQ-20261006-092320768 |
| ord-order-detail-created-at | order-detail | ORD | Thời điểm tạo đơn | customer, staff, admin | ORD-REQ-20261006-092320768 |
| ord-order-detail-error | order-detail | ORD | Banner lỗi toàn trang | customer, staff, admin | ORD-REQ-20261006-092320768 |
| ord-order-detail-history | order-detail | ORD | Khối lịch sử trạng thái (timeline) | customer, staff, admin | ORD-REQ-20261006-092320812 |
| ord-order-detail-history-error | order-detail | ORD | Banner lỗi riêng của khối lịch sử | customer, staff, admin | ORD-REQ-20261006-092320812 |
| ord-order-detail-history-item | order-detail | ORD | Một dòng lịch sử: thời điểm và trạng thái | customer, staff, admin | ORD-REQ-20261006-092320812 |
| ord-order-detail-history-reason | order-detail | ORD | Lý do hủy trong dòng lịch sử (chỉ khi có) | customer, staff, admin | ORD-REQ-20261006-092320812 |
| ord-order-detail-history-retry | order-detail | ORD | Nút Thử lại của lịch sử | customer, staff, admin | ORD-REQ-20261006-092320812 |
| ord-order-detail-items | order-detail | ORD | Bảng sản phẩm (tên, đơn giá, số lượng, thành tiền theo snapshot) | customer, staff, admin | ORD-REQ-20261006-092320768 |
| ord-order-detail-loading | order-detail | ORD | Khung chờ | customer, staff, admin | ORD-REQ-20261006-092320768 |
| ord-order-detail-notfound | order-detail | ORD | Khối "Không tìm thấy đơn hàng" (404) | customer, staff, admin | ORD-REQ-20261006-092320768 |
| ord-order-detail-notfound-back | order-detail | ORD | Nút đặc Về danh sách đơn hàng | customer, staff, admin | ORD-REQ-20261006-092320768 |
| ord-order-detail-payment | order-detail | ORD | Khối thanh toán (phương thức, trạng thái thanh toán) | customer, staff, admin | ORD-REQ-20261006-092320768 |
| ord-order-detail-retry | order-detail | ORD | Nút Thử lại toàn trang | customer, staff, admin | ORD-REQ-20261006-092320768 |
| ord-order-detail-status-badge | order-detail | ORD | Badge trạng thái đơn | customer, staff, admin | ORD-REQ-20261006-092320790 |
| ord-order-detail-totals | order-detail | ORD | Tạm tính, giảm giá, phí giao hàng, tổng cộng | customer, staff, admin | ORD-REQ-20261006-092320768 |
| ord-order-detail-tracking | order-detail | ORD | Mã vận đơn (khi đã giao cho vận chuyển) | customer, staff, admin | ORD-REQ-20261006-092320768 |
| ord-order-list-clear-filter | order-list | ORD | Nút Xoá lọc (chỉ khi đang lọc) | customer | ORD-REQ-20261006-092320716 |
| ord-order-list-code | order-list | ORD | Mã đơn trên dòng (font-mono) | customer | ORD-REQ-20261006-092320716 |
| ord-order-list-created-at | order-list | ORD | Thời điểm tạo đơn | customer | ORD-REQ-20261006-092320716 |
| ord-order-list-empty | order-list | ORD | Vùng rỗng, chưa có đơn | customer | ORD-REQ-20261006-092320716 |
| ord-order-list-empty-filtered | order-list | ORD | Vùng rỗng do lọc | customer | ORD-REQ-20261006-092320716 |
| ord-order-list-error | order-list | ORD | Banner lỗi | customer | ORD-REQ-20261006-092320716 |
| ord-order-list-item-count | order-list | ORD | Số mặt hàng | customer | ORD-REQ-20261006-092320716 |
| ord-order-list-loading | order-list | ORD | Khung chờ | customer | ORD-REQ-20261006-092320716 |
| ord-order-list-pagination | order-list | ORD | Phân trang ‹ 1 2 › (ẩn khi một trang) | customer | ORD-REQ-20261006-092320716 |
| ord-order-list-retry | order-list | ORD | Nút Thử lại | customer | ORD-REQ-20261006-092320716 |
| ord-order-list-row | order-list | ORD | Dòng đơn | customer | ORD-REQ-20261006-092320716 |
| ord-order-list-status-badge | order-list | ORD | Badge trạng thái đơn | customer | ORD-REQ-20261006-092320790 |
| ord-order-list-status-filter | order-list | ORD | Hàng tab lọc trạng thái (dropdown dưới sm) | customer | ORD-REQ-20261006-092320716 |
| ord-order-list-summary | order-list | ORD | Dòng "1 tới 20 trong 25 đơn" | customer | ORD-REQ-20261006-092320716 |
| ord-order-list-total | order-list | ORD | Tổng tiền, căn phải | customer | ORD-REQ-20261006-092320716 |
