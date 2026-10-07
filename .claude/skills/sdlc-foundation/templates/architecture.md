---
status: draft
---
# Kiến trúc nền

## Quyết định (ADR)

### ADR-001 Kiểu triển khai
- Trạng thái: proposed
- Bối cảnh: ...
- Phương án: A (...), B (...), loại vì ... Có thể ghi "Khuyến nghị tạm: A" nếu chưa có người quyết.
- Quyết định: ... (nếu chưa có người quyết: "chưa chọn, chờ người quyết định. [OPEN] <câu hỏi>")
- Hệ quả: ... (đánh đổi)

## Phiên bản công nghệ

Bắt buộc khi ADR về stack (tiêu đề có "Stack") nêu framework hoặc công cụ test ở dòng Quyết định: mỗi công nghệ đó một dòng. Bảng này là nguồn duy nhất cho `package.json`; epic sau không chọn lại phiên bản. Lý do ghim nêu khi bỏ qua bản mới nhất.

| Công nghệ | Phiên bản | Lý do ghim |
|---|---|---|
| ... | ... | ... |

## Ánh xạ epic → module

Cột Phụ thuộc: mã epic mà module này gọi trực tiếp, cách nhau bởi dấu phẩy, hoặc `-`. Không được có vòng phụ thuộc.

| Epic | Module | Phụ thuộc |
|---|---|---|
| AUTH | auth | - |

## Mối quan tâm cắt ngang

Mỗi dòng trỏ về một ADR đã viết ở trên.

| Mối quan tâm | ADR |
|---|---|
| Project setup | ADR-001 |
| Database | ADR-001 |
| API structure | ADR-001 |
| Environment configuration | ADR-001 |
| Error handling | ADR-001 |
| Logging | ADR-001 |
