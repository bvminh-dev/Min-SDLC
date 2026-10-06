# Điểm kỳ vọng

## MUST
| # | Điểm |
|---|---|
| G1 | Mỗi requirement (5) có TC cho cả ba mục kịch bản chính/lỗi/biên (script `--strict`) |
| G2 | Mỗi mối đe dọa SEC `Kiểm bằng test` có ít nhất một TC với `threats` trỏ tới nó (script `--strict`) |
| G3 | Có ít nhất một E2E đi qua nhiều màn (ví dụ customer mở đơn rồi hủy; staff/admin quản lý đơn), mọi testid có trong `testids.md` và đúng role |
| G4 | TC cụ thể, assert viết được: INV-04 có test hai đơn tranh món cuối (đúng một đơn giữ được) và biên hết hạn đúng 15 phút; ORD-01 đơn người khác trả 404 không lộ sự tồn tại; INV-05 điều chỉnh thấp hơn lượng đang giữ bị từ chối |
| G5 | Báo cáo có checklist chất lượng requirement: nêu ít nhất một chỗ yếu thật (ví dụ INV-04 `roles: [customer]` nhưng là hành vi hệ thống; hoàn tiền ở ORD-03 chưa có spec; ORD-02 staff đánh dấu giao vs SHP) |

## SHOULD
| # | Điểm |
|---|---|
| S1 | TC của ORD-03 hủy đơn đã thanh toán chỉ kiểm "yêu cầu hoàn tiền được tạo", không assert chi tiết hoàn tiền của PAY |
| S2 | Test đua (hai staff cùng đánh dấu giao, hủy và thanh toán đồng thời) có mô tả cách dựng đồng thời |
| S3 | Báo cáo nêu testid còn thiếu cho `sdlc-ui-ux` nếu có |
