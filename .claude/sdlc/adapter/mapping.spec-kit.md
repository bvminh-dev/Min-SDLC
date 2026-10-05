# Mapping: phase của kit → GitHub Spec Kit

Đường dẫn trong dấu backtick tính từ `root` trong `active.md`. `check-adapter.mjs` kiểm các đường dẫn này còn tồn tại.

**Cách dùng:** skill đọc các file ở cột *Đọc* để lấy **tiêu chí chất lượng và kỹ thuật** của framework. Skill vẫn ghi đầu ra theo `contract.md` của kit, không theo định dạng file của framework.

| Phase của kit | Đọc | Lấy gì | Kit tự làm (framework không phủ) |
|---|---|---|---|
| discover | (không có) | | Toàn bộ: khảo sát sản phẩm, roadmap xương cá |
| foundation | `templates/constitution-template.md`, `templates/commands/constitution.md` | Cách viết nguyên tắc dự án (constitution) | Domain model, danh sách domain event, kiến trúc nền, security baseline |
| research | `templates/spec-template.md`, `templates/commands/specify.md`, `templates/commands/clarify.md` | User story xếp ưu tiên và kiểm thử độc lập được; Given/When/Then; ca biên; tiêu chí thành công đo được và không nêu công nghệ; đánh dấu `[NEEDS CLARIFICATION]` và hỏi tối đa số câu quy định | Ma trận role/permission, flow mermaid, ID theo thời gian, kiểm xung đột với spec đã duyệt |
| impact | `templates/commands/analyze.md` | Cách phân tích nhất quán chéo nhiều tài liệu và cách xếp mức nghiêm trọng | Truy vết theo ID (`find-refs.mjs`), phân loại dựng lại / xem lại |
| design | `templates/plan-template.md`, `templates/commands/plan.md` | Cấu trúc kế hoạch kỹ thuật, kiểm tra theo nguyên tắc dự án, ghi nhận độ phức tạp | Threat model theo epic, thiết kế DB/API tăng thêm |
| ui-ux | (không có) | | Toàn bộ: màn hình, `testids.md` |
| test-design | `templates/checklist-template.md`, `templates/commands/checklist.md` | Checklist kiểm chất lượng requirement | Acceptance test, e2e sinh từ `testids.md` |
| implement | `templates/tasks-template.md`, `templates/commands/tasks.md`, `templates/commands/implement.md` | Chia task theo phụ thuộc, thứ tự thực thi | Hook chạy test, báo cáo lệch spec |
| review | `templates/commands/converge.md`, `templates/commands/analyze.md` | Đối chiếu codebase với spec/plan/tasks, ghi việc còn thiếu | Audit bảo mật, đối chiếu quyền với ma trận |
| retro | (không có) | | Toàn bộ: bài học, đề xuất rule |

## Lưu ý khi dùng
- Spec Kit viết **một `spec.md` cho cả tính năng**, kit viết **mỗi requirement một file có ID**. Khác nhau này do kit chủ ý (nhiều người làm song song, truy vết). Khi đọc template của framework, chỉ lấy nội dung cần có, không bê nguyên cấu trúc file.
- Hạn mức câu hỏi của kit và của framework có thể khác nhau. Kit theo `SKILL.md`.
- Phần `Kit tự làm` không phụ thuộc framework. Đổi framework thì cột này giữ nguyên.
