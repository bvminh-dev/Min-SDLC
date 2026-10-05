---
name: sdlc-foundation
description: Dựng nền một lần cho dự án từ spec/roadmap.md: constitution, vai trò, domain model (entity, domain event), kiến trúc nền (ADR, ánh xạ epic → module, mối quan tâm cắt ngang) và security baseline. Dùng sau khi có roadmap và trước khi chạy sdlc-research cho epic đầu tiên.
---

# sdlc-foundation

Chạy **một lần cho mỗi dự án** (và khi có quyết định nền mới). Các skill sau (research, design, test-design) đọc đầu ra của skill này làm nền, nên sai ở đây là sai lan rộng.

## Quy tắc cứng
- Mọi file đầu ra `status: draft`. **Chỉ người được duyệt** (hook chặn việc tự đổi sang approved).
- **Không tự chọn công nghệ hay kiến trúc.** Quyết định chưa có người trả lời thì ghi ADR `Trạng thái: proposed` kèm `[OPEN]`, không đoán.
- Kiểm cứng do script: `node .claude/skills/sdlc-foundation/scripts/check-foundation.mjs spec/` (hook cũng tự chạy). Skill này không lặp lại những gì script đã kiểm.

## Quy trình
0. **Nạp framework tham chiếu.** Đọc `.claude/sdlc/adapter/active.md` và dòng phase `foundation` trong file mapping; lấy cách viết nguyên tắc dự án (constitution) từ cột *Đọc*. Cột *Kit tự làm* là phần dưới đây. Đầu ra theo `.claude/sdlc/contract.md`.
1. **Đọc `spec/roadmap.md`.** Thiếu thì dừng và báo người dùng cần có roadmap theo `.claude/sdlc/contract.md` (skill `sdlc-discover` chưa được xây). Lấy danh sách epic (cột *Mã*) và mục con.
2. **Hỏi người dùng** (tối đa 5 câu, dạng lựa chọn, có khuyến nghị) những quyết định nền chưa thể suy ra: stack, kiểu triển khai (modular monolith hay tách dịch vụ), cách xác thực (session hay token), cơ sở dữ liệu, cổng thanh toán và yêu cầu tuân thủ. Không hỏi được thì ghi thành ADR `proposed` + `[OPEN]`.
3. **Viết theo thứ tự phụ thuộc** (cái sau tham chiếu cái trước), mỗi file theo `templates/`:
   1. `spec/domain/roles.md`: các role và ai đăng nhập được.
   2. `spec/domain/entities.md`: entity, epic sở hữu, khóa, quan hệ, vòng đời. Cột Vòng đời chỉ là đường chính; **bảng "Vòng đời chi tiết" phải có đủ nhánh lỗi, hủy, hết hạn**.
   3. `spec/domain/events.md`: domain event, bên phát, bên nhận, và cột **Phát khi** (`Entity:trạng_thái`). Event "Failed/Cancelled/Released/Expired" bắt buộc có trạng thái tương ứng trong vòng đời chi tiết; script sẽ báo nếu thiếu.
   4. `spec/architecture.md`: ADR, ánh xạ epic → module, mối quan tâm cắt ngang.
   5. `spec/security-baseline.md`: yêu cầu bảo mật nền, mỗi dòng có cách kiểm.
   6. `spec/constitution.md`: nguyên tắc dự án, mỗi nguyên tắc có cách kiểm.
4. **Chạy kiểm cứng**, sửa đến khi qua. Hook làm việc này sau mỗi lần sửa; nếu hook báo lỗi thì sửa theo thông báo.
5. **Báo cáo**: quyết định đang chờ người (`[OPEN]`), điểm suy ra từ roadmap mà người nên xác nhận, epic nào rủi ro nhất cho thiết kế (nhiều phụ thuộc chéo).

## Gợi ý chất lượng (phần script không kiểm được)
- **Entity**: mỗi danh từ chính trong mục con của roadmap có entity hoặc là thuộc tính của một entity; mỗi entity chỉ **một epic sở hữu**. Entity có vòng đời (ví dụ đơn hàng, thanh toán, vận đơn, giữ hàng, coupon) phải liệt kê trạng thái và chuyển trạng thái hợp lệ.
- **Liên kết với đơn**: giữ hàng, thanh toán, vận đơn gắn với đơn nên cần quan hệ tới entity đơn. Nếu thứ tự mục con trong roadmap trái với phụ thuộc đó (ví dụ "Reserve stock" đứng trước "Create order"), giải bằng trạng thái đầu của đơn (tạo đơn ở trạng thái chờ rồi mới giữ hàng) và ghi vào ADR hoặc vòng đời.
- **Event**: các mục con dạng "X created / X successful / X shipped" thường là event của epic khác mà Notification chỉ **nhận**. Mỗi event có đúng một bên phát.
- **Kiến trúc**: mỗi quyết định có phương án đã loại và hệ quả (đánh đổi), không chỉ kết luận. Epic 01 trong roadmap (cấu trúc API, lỗi, log, cấu hình, DB) thành mục cắt ngang, mỗi mục trỏ về một ADR.
- **Security baseline**: bám các nhóm trong template; chú ý epic có tiền và định danh (Auth, Payment, Checkout) cần dòng riêng. "Kiểm bằng" phải là thứ chạy được (test, hook, script, config) hoặc review có người chịu trách nhiệm.

## Kiểm thử skill
`evals/README.md`. Fixture là roadmap ecommerce thật (14 epic).

## Lưu ý về script
- Nhóm bảo mật "Thanh toán và dữ liệu tài chính" chỉ bắt buộc khi tên một epic trong roadmap khớp `payment` hoặc `thanh toán`.
- `[OPEN]` được phép ở file `draft` (đó là cách chuyển câu hỏi cho người); chỉ chặn khi file `approved`.
- Constitution của kit là bảng `Mã | Nguyên tắc | Kiểm bằng`, khác định dạng template của framework tham chiếu; lấy tinh thần (nguyên tắc kiểm được), không bê định dạng.

## Quy ước mà script áp dụng (viết đúng để qua kiểm)
- **ADR**: mỗi mục `- Trạng thái / Bối cảnh / Phương án / Quyết định / Hệ quả:` nằm trên **một dòng**. Mỗi quyết định một ADR; các mối quan tâm cắt ngang có thể chung ADR nếu thật sự cùng một quyết định. "Loại vì" với ADR chưa quyết có thể ghi "loại tạm" hoặc "chưa loại".
- **Kiểm bằng**: dùng đúng một trong các từ số ít `test`, `hook`, `script`, `config`, `review` (`tests`, `scripts` không khớp).
- **Phụ thuộc module** chỉ tính lời gọi trực tiếp. **Event không tính là phụ thuộc**: bên phát không phụ thuộc bên nhận; đó là cách phá vòng phụ thuộc giữa các epic.
- **Phát khi**: với event tạo mới (ví dụ `OrderCreated`) dùng trạng thái đầu của entity (`Order:pending`). Event không đổi trạng thái thì `-`.
- **Vòng đời chi tiết** có thể có nhiều trạng thái hơn đường chính (nhánh lỗi, hủy, hết hạn, thử lại); script chỉ kiểm chiều đường chính ⊆ bảng chi tiết và event ⊆ bảng chi tiết.
- **Tác nhân hệ thống** (webhook, tác vụ nền): bảng `roles.md` chỉ nhận "có" hoặc "không" ở cột Đăng nhập, nên ghi tác nhân hệ thống bằng chú thích dưới bảng, không thêm làm role.
- **Role**: nếu mục con cần quyền khác nhau rõ rệt (kho, chăm sóc khách hàng, quản trị), tách role hoặc nêu rõ vì sao gộp và đánh `[OPEN]`.
