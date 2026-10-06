# Câu hỏi còn mở của epic <EPIC>

Dùng khi chạy tự động và không hỏi trực tiếp được người dùng. Mặc định đã chọn đánh `[OPEN]`; mục nền đã quyết đánh `[RESOLVED]` kèm mã.

## A. Cần người quyết ở phạm vi epic
1. [OPEN] <câu hỏi>: <mặc định đã áp>

## Nền cần sửa
Mỗi dòng đúng bốn trường cách nhau bằng dấu chấm phẩy: `file nền; thay đổi; ưu tiên (cao|trung bình|thấp); epic`. Một dòng một đề nghị, không văn xuôi. `collect-foundation-requests.mjs` gom và khử trùng lặp giữa các epic.

- spec/domain/entities.md; Thêm entity <Tên> (khóa, quan hệ, vòng đời); cao; <EPIC>
