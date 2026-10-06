# Điểm kỳ vọng

## MUST
| # | Điểm |
|---|---|
| G1 | Có màn cho ORD-01 (customer), ORD-02 (staff, admin), ORD-03 (hủy đơn), INV-05 (staff, admin); `covers` đúng |
| G2 | Màn của customer chỉ `roles: [customer]`; màn quản lý chỉ staff/admin (script kiểm role ⊆ requirement) |
| G3 | Trạng thái lấy từ Given/When/Then: ORD-01 rỗng và 404 đơn người khác; ORD-02 từ chối đơn pending, đơn đã shipped do thao tác đồng thời; INV-05 từ chối điều chỉnh thấp hơn lượng đang giữ, thiếu lý do |
| G4 | Mọi phần tử thao tác có testid đúng dạng; `spec/testids.md` do script sinh, không viết tay |
| G5 | Ghi rõ phương án wireframe đã chọn và lý do (theo evon U3), hoặc nói rõ đã lấy mặc định khi không hỏi được |
| G6 | INV-04 (giữ hàng) báo "không có UI", không dựng màn |
| G7 | (L3, L12) Bảng Trạng thái có cột `testid`; trạng thái hết phiên, không có quyền có testid trỏ tới phần tử ở bảng Phần tử (script kiểm) |
| G8 | (L4, L5, L19) Wireframe ASCII trong tài liệu màn, không dựng HTML hay probe; chỗ luật evon lệch requirement thì theo requirement và ghi chú lệch trong tài liệu màn |

## SHOULD
| # | Điểm |
|---|---|
| S1 | Hủy đơn đã thanh toán: chỉ thông báo "yêu cầu hoàn tiền đang xử lý", không dựng màn hoàn tiền (PAY chưa có spec) |
| S2 | Báo trước rằng skill evon chưa được dạy cho màn cửa hàng phía người mua (màn customer) |
