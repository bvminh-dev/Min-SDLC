---
status: approved
---

# Nguyên tắc dự án

| Mã  | Nguyên tắc                                                                                       | Kiểm bằng |
| --- | ------------------------------------------------------------------------------------------------ | --------- |
| P1  | Spec của epic được duyệt trước khi viết code của epic đó                                         | hook      |
| P2  | Mọi thay đổi spec đã duyệt đi qua phân tích tác động                                             | review    |
| P3  | Mỗi requirement có test truy ngược được về ID                                                    | script    |
| P4  | Quyết định công nghệ/kiến trúc chưa có người quyết thì ghi ADR proposed, không đoán              | script    |
| P5  | Mọi thay đổi trạng thái entity tuân theo vòng đời trong spec/domain/entities.md                  | test      |
| P6  | Mỗi yêu cầu trong security-baseline có cách kiểm chạy được và được chạy trong CI                 | script    |
| P7  | Mỗi event có đúng một bên phát; module chỉ giao tiếp qua phụ thuộc đã khai trong architecture.md. Phụ thuộc cắt ngang của `platform` (guard, audit, outbox, job nền...) không cần khai; bảng giao diện module trong architecture.md là hợp đồng gọi đồng bộ; event khai Consumer thì consumer phải có handler | review |
| P8  | Epic không được `approved` khi còn mục câu hỏi mở (OPEN) trỏ vào nền chưa sửa | script |

## Nhật ký thay đổi nền

- 2026-10-06 | C-01, K-15 | Bổ sung P7: phụ thuộc cắt ngang của `platform` không cần khai, bảng giao diện module (A-02) là hợp đồng, event khai Consumer phải có handler | lý do: epic khai thừa hoặc thiếu phụ thuộc (PRM khai PRD, NTF khai USR, guard AUTH và platform không khai được), consumer khai không có handler | giải pháp: mở rộng một nguyên tắc có sẵn thay vì thêm mới; loại phương án bắt mọi epic khai PRJ, AUTH vì check-tech-design báo lỗi và vô nghĩa
- 2026-10-06 | C-02, KT-06 | Thêm P8: epic không được `approved` khi còn mục câu hỏi mở (OPEN) trỏ vào nền chưa sửa (kiểm bằng script) | lý do: 14 epic cùng ghi mục câu hỏi mở (OPEN) giống nhau về nền mà không có cổng chặn | giải pháp: nguyên tắc kiểm bằng script đếm OPEN (KT-10, việc của kit, chưa có script thực hiện); loại chỉ nhắc ở review vì không chặn được
