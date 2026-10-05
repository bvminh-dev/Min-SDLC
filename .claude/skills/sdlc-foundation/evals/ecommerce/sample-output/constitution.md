---
status: draft
---
# Nguyên tắc dự án

| Mã | Nguyên tắc | Kiểm bằng |
|---|---|---|
| P1 | Spec của epic được duyệt trước khi viết code của epic đó | hook |
| P2 | Mọi thay đổi spec đã duyệt đi qua phân tích tác động | review |
| P3 | Mỗi requirement có test truy ngược được về ID | script |
| P4 | Quyết định công nghệ/kiến trúc chưa có người quyết thì ghi ADR proposed, không đoán | script |
| P5 | Mọi thay đổi trạng thái entity tuân theo vòng đời trong spec/domain/entities.md | test |
| P6 | Mỗi yêu cầu trong security-baseline có cách kiểm chạy được và được chạy trong CI | script |
| P7 | Mỗi event có đúng một bên phát; module chỉ giao tiếp qua phụ thuộc đã khai trong architecture.md | review |
