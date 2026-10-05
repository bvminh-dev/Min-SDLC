# Golden: điểm kỳ vọng cho Checkout

## MUST
- G1. Có requirement cho **mỗi mục** trong epic (9 mục), mỗi cái có luồng chính, luồng lỗi, ca biên.
- G2. **Validate price**: nêu rõ hành vi khi giá hiện tại khác giá đã chụp trong giỏ (báo khách và yêu cầu xác nhận, hoặc quy tắc khác nhưng phải *được nêu*).
- G3. **Validate stock / Reserve stock**: xử lý hết hàng ở bước cuối; reserve và create order phải **atomic** hoặc có bù trừ (rollback reserve nếu tạo đơn lỗi).
- G4. Flow có **nhánh lỗi**: hết hàng, coupon hết hiệu lực giữa chừng, thanh toán thất bại, hết hạn reserve.
- G5. Ma trận quyền có dòng **Đặt hàng** gắn với ID requirement; role khớp với bẫy T2 (không tự đổi quyền guest).
- G6. `links` trỏ tới requirement của **Cart, Promotion, Inventory** (đã có) và ghi **Payment, Shipping, Order** là epic bị chạm nhưng chưa có spec.
- G7. Nêu domain event phát ra (ví dụ `OrderCreated`) để Notification dùng sau này.

## SHOULD
- G8. Xử lý bấm "Đặt hàng" hai lần (idempotency).
- G9. Địa chỉ giao hàng không hợp lệ / ngoài vùng giao.
- G10. Tính tổng tiền: thứ tự áp coupon, phí ship, làm tròn.
- G11. Tối đa 5 câu hỏi cho người dùng, đều là câu hỏi nghiệp vụ thật (không hỏi thứ đã có trong fixture).
