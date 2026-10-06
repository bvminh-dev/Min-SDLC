---
id: ORD-E2E-00000000-000000000
title: Khách hủy đơn đang chờ thanh toán
epic: ORD
status: draft            # draft | approved | superseded
covers: [ORD-REQ-...]    # các requirement mà luồng này đi qua (có thể nhiều epic)
role: customer           # role thực hiện luồng, phải nằm trong ma trận quyền
---

Mỗi bước thao tác giao diện dùng testid trong dấu backtick, lấy từ `spec/testids.md`. Phần tử phải dùng được cho `role` ở trên.

1. Đăng nhập là customer có một đơn `pending`.
2. Mở `ord-order-list-row` của đơn, bấm `ord-order-detail-cancel`.
3. Xác nhận ở `ord-order-detail-cancel-confirm`.
4. Kỳ vọng: `ord-order-detail-status` hiện "Đã hủy".
