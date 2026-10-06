---
name: sdlc-tech-design
description: Thiết kế kỹ thuật cho một epic đã có requirement duyệt: lược đồ DB, API, mô hình mối đe dọa bảo mật (SEC) và ràng buộc kiến trúc giữa module, bám ADR và domain model đã chốt. Dùng sau sdlc-research của epic và trước sdlc-ui-ux và sdlc-test-design.
---

# sdlc-tech-design

Đây là phase `design` trong `contract.md`: **thiết kế kỹ thuật** (DB, API, SEC, kiến trúc). Thiết kế giao diện là skill `sdlc-ui-ux`.

Đầu vào: một epic đã có requirement `approved`, và nền đã duyệt (`spec/domain/`, `spec/architecture.md`, `spec/security-baseline.md`). Đầu ra theo `.claude/sdlc/contract.md`: `spec/epics/<EPIC>/design/<ID>.md` với ID loại `DB`, `API`, `SEC`.

Phần cần phán đoán (chọn cách thiết kế) do skill làm. Phần phải đúng thì do script: thiết kế không được lệch domain model, kiến trúc đã chốt, hay baseline bảo mật.

## Quy tắc cứng
- **ID do script sinh**: `node .claude/skills/sdlc-research/scripts/new-id.mjs <EPIC> <DB|API|SEC>`.
- **Bám ADR đã `accepted`.** Không đổi stack, kiểu API, CSDL, xác thực... trong tài liệu thiết kế. Cần quyết định nền mới thì ghi `[OPEN]` trong tài liệu và chuyển người dùng sang `sdlc-foundation` để thêm ADR; không tự quyết.
- **Kiến trúc là ràng buộc cứng.** API chỉ gọi trực tiếp module có trong cột *Phụ thuộc* của epic ở `architecture.md` (`depends_on`); liên lạc ngược chiều đi bằng event (`emits`, `consumes`, theo `events.md`). Cần phụ thuộc mới thì phải có ADR mới, không thêm lặng lẽ.
- **Không sửa file `approved`, không tự đổi sang `approved`** (hook chặn). Thiết kế đổi sau khi duyệt thì chạy `sdlc-impact`.
- Không bịa nghiệp vụ: endpoint nào cũng truy về một requirement trong `links`, role của endpoint nằm trong `roles` của requirement đó.

## Quy trình
0. **Nạp framework tham chiếu.** Đọc `.claude/sdlc/adapter/active.md` và dòng phase `design` trong file mapping; đọc các file ở cột *Đọc* (`plan-template.md`, `plan.md`) để lấy cấu trúc kế hoạch kỹ thuật và cách kiểm theo nguyên tắc dự án. Cột *Kit tự làm* là phần dưới đây (threat model, DB/API). Đầu ra theo `contract.md`.
1. **Đọc bối cảnh**: requirement và flow của epic, `permissions-matrix.md`, `domain/entities.md` (entity thuộc epic, vòng đời), `domain/events.md`, mục ADR và bảng Phụ thuộc ở `architecture.md`, `security-baseline.md`, `constitution.md`. Thiếu nền hoặc requirement `approved` thì dừng và nói chạy skill nào trước.
2. **Chốt các điểm chưa có ADR.** Điểm nào ADR chưa quyết (ví dụ cách khóa khi giữ hàng, phân trang riêng, idempotency key): nêu 2 phương án với đánh đổi, hỏi người dùng (tối đa 3 câu, dạng lựa chọn, có khuyến nghị). Không hỏi được thì chọn phương án khuyến nghị, đánh `[OPEN]`.
3. **Viết DB** (`templates/db.md`): bảng cho từng entity thuộc epic, khóa, ràng buộc, chỉ mục; bảng *Trạng thái hợp lệ* **đúng bằng** tập trạng thái trong vòng đời chi tiết; giao dịch và khóa; migration.
4. **Viết API** (`templates/api.md`): endpoint theo ADR-006; mỗi dòng nêu role, requirement, lỗi (role cần đăng nhập khai 401 và 403); hợp đồng dữ liệu; mục giao tiếp giữa module khớp `depends_on`, `emits`, `consumes`.
5. **Viết SEC** (`templates/sec.md`): STRIDE cho tài sản của epic (tiền, định danh, dữ liệu cá nhân, quyền sở hữu), mỗi mối đe dọa có biện pháp, SB tương ứng và cách kiểm. Biện pháp mới chưa có trong baseline thì SB là `-` và báo người dùng thêm qua `sdlc-foundation`.
6. **Kiểm cứng** (sửa tới khi qua): `node .claude/skills/sdlc-tech-design/scripts/check-tech-design.mjs spec/ --epic <EPIC>` (thêm `--strict` để thiếu DB hoặc SEC cũng là lỗi). Hook kiểm hình thức chung (`check-spec.mjs`) tự chạy sau mỗi lần sửa.
7. **Báo cáo**: tài liệu đã tạo, điểm `[OPEN]` còn lại, biện pháp SEC cần thêm vào baseline, kiểm tra theo nguyên tắc dự án (P1-P7) và chỗ nào chưa đạt.

## Script kiểm (`scripts/check-tech-design.mjs`)
- **DB**: entity thuộc đúng epic; trạng thái khớp vòng đời; **khóa ngoại chỉ trỏ vào bảng của chính epic hoặc module trong Phụ thuộc** (`FK x`, `-> x.id`, `REFERENCES x`; còn lại dùng cột tham chiếu không FK + `[OPEN]`); entity của epic chưa có DB (cảnh báo/lỗi).
- **API**: path `/api/v1/`, method hợp lệ, endpoint không trùng, role ⊆ requirement ⊆ ma trận, 401/403 cho endpoint cần đăng nhập, `depends_on`/`emits`/`consumes` khớp kiến trúc và event.
- **SEC**: STRIDE hợp lệ, SB tồn tại, có cách kiểm, epic có API mà thiếu SEC.
Tự kiểm script: `node .claude/skills/sdlc-tech-design/scripts/check-tech-design.test.mjs`.

## Chưa làm
- Hook Stop và hook sau mỗi lần sửa đã chạy `check-tech-design.mjs` (chỉ báo lỗi của file vừa sửa); bước 6 để chạy theo epic hoặc `--strict`.
- Chưa kiểm được kiểu dữ liệu cột hay khớp request/response với requirement (cần người đọc).
- Eval mới chạy một lần (ORD, INV), chưa có đối chứng prompt trần; xem `evals/RESULTS.md`. Chưa chạy trên epic thật.
