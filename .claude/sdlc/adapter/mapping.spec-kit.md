# Mapping: phase của kit → GitHub Spec Kit

Đường dẫn trong dấu backtick ở cột *Đọc* tính từ `root` trong `active.md`. `check-adapter.mjs` kiểm các đường dẫn này còn tồn tại và cột *Skill* trỏ tới skill có thật.

**Cách dùng:** skill đọc các file ở cột *Đọc* để lấy **tiêu chí chất lượng và kỹ thuật** của framework. Skill vẫn ghi đầu ra theo `contract.md` của kit, không theo định dạng file của framework.

| Phase của kit | Đọc | Lấy gì | Kit tự làm (framework không phủ) | Skill |
|---|---|---|---|---|
| discover | (không có) | | Toàn bộ: hỏi người dùng, khảo sát sản phẩm tương tự, roadmap xương cá (bảng `STT, Mã, Epic, Mục con`); bảng kiểm bằng `check-foundation` | sdlc-discover |
| foundation | `templates/constitution-template.md`, `templates/commands/constitution.md` | Cách viết nguyên tắc dự án (constitution) | Domain model, danh sách domain event, kiến trúc nền (ADR), security baseline; kiểm nhất quán chéo bằng `check-foundation` | sdlc-foundation |
| research | `templates/spec-template.md`, `templates/commands/specify.md`, `templates/commands/clarify.md` | User story xếp ưu tiên và kiểm thử độc lập được; Given/When/Then; ca biên; tiêu chí thành công đo được và không nêu công nghệ; đánh dấu `[NEEDS CLARIFICATION]` và hỏi tối đa số câu quy định | Ma trận role/permission, flow mermaid, ID theo thời gian, kiểm xung đột với spec đã duyệt | sdlc-research |
| impact | `templates/commands/analyze.md` | Cách phân tích nhất quán chéo nhiều tài liệu và cách xếp mức nghiêm trọng | Truy vết theo ID (`find-refs.mjs`), phân loại dựng lại / xem lại, báo cáo kiểm bằng `check-impact` | sdlc-impact |
| design | `templates/plan-template.md`, `templates/commands/plan.md` | Cấu trúc kế hoạch kỹ thuật, kiểm tra theo nguyên tắc dự án, ghi nhận độ phức tạp | Thiết kế **kỹ thuật** DB/API, threat model theo epic (STRIDE), ràng buộc kiến trúc giữa module (phụ thuộc, event, khóa ngoại); kiểm bằng `check-tech-design` | sdlc-tech-design |
| ui-ux | (ngoài adapter: luật giao diện lấy từ submodule evondevKit, xem trường ui_reference ở active.md) | | Màn hình, trạng thái giao diện, `testids.md`; quyền theo từng phần tử; kiểm bằng `check-ui` | sdlc-ui-ux |
| test-design | `templates/checklist-template.md`, `templates/commands/checklist.md` | Checklist kiểm chất lượng requirement | Test case phủ từng kịch bản và mối đe dọa SEC, E2E dùng testid theo role; kiểm bằng `check-tests` | sdlc-test-design |
| implement | `templates/tasks-template.md`, `templates/commands/tasks.md`, `templates/commands/implement.md` | Chia task theo phụ thuộc, thứ tự thực thi | Báo cáo truy vết (task, test case, lệch spec) kiểm bằng `check-report`; chưa có hook chạy test | sdlc-implement |
| review | `templates/commands/converge.md`, `templates/commands/analyze.md` | Đối chiếu codebase với spec/plan/tasks, ghi việc còn thiếu | Audit bảo mật, đối chiếu quyền với ma trận, bằng chứng `file:dòng`; kiểm bằng `check-review` | sdlc-review |
| retro | (không có) | | Toàn bộ: bài học có bằng chứng, đề xuất rule chờ duyệt; kiểm bằng `check-lessons` | sdlc-retro |
| improve-kit | (không có) | | Toàn bộ: áp dụng bài học đã duyệt vào kit, thêm ca hồi quy, `selftest` | sdlc-improve-kit |

## Lưu ý khi dùng
- Spec Kit viết **một `spec.md` cho cả tính năng**, kit viết **mỗi requirement một file có ID**. Khác nhau này do kit chủ ý (nhiều người làm song song, truy vết). Khi đọc template của framework, chỉ lấy nội dung cần có, không bê nguyên cấu trúc file.
- Hạn mức câu hỏi của kit và của framework có thể khác nhau. Kit theo `SKILL.md`.
- Phần `Kit tự làm` không phụ thuộc framework. Đổi framework thì cột này giữ nguyên.
- **Phase `design` của kit là thiết kế kỹ thuật** (khớp `plan` của Spec Kit); thiết kế giao diện là phase `ui-ux`, tham chiếu khác (evondevKit), không thuộc adapter này.
- **Không dùng** `templates/commands/taskstoissues.md` (đổi task thành issue GitHub): kit chưa tích hợp bộ theo dõi công việc ngoài; báo cáo task nằm ở `report.md`. Cần thì thêm vào dòng `implement`.
- Cột *Skill* phải trỏ tới thư mục `.claude/skills/<skill>/` có `SKILL.md`; mọi skill `sdlc-*` phải xuất hiện đúng một lần ở cột này (`check-adapter.mjs` kiểm cả hai chiều).
