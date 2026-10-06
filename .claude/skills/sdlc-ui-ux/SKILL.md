---
name: sdlc-ui-ux
description: Biến requirement đã duyệt của một epic thành tài liệu màn hình (wireframe đã chọn, các trạng thái giao diện, danh sách phần tử có testid) và sinh spec/testids.md. Luật thiết kế giao diện lấy từ bản sao của skill evon:ui-ux trong `references/evon-ui-ux/`. Dùng sau sdlc-research của epic và trước sdlc-test-design.
---

# sdlc-ui-ux

Đầu vào: một epic đã có requirement `approved`. Đầu ra theo `.claude/sdlc/contract.md`: `spec/epics/<EPIC>/ui/<màn>.md` và `spec/testids.md`.

**Phân vai.** Luật giao diện (bố cục, style, token, trạng thái nhìn ra sao) nằm ở `references/evon-ui-ux/skills/ui-ux/` (git submodule của repo evondevKit, ghim tag v0.3.18, giấy phép MIT); skill này **không viết lại** luật đó và không cần plugin evon cài trên máy. Skill này lo phần nối với spec: màn nào phủ requirement nào, role nào thấy, testid là gì. Phần nối do script bảo đảm.

## Quy tắc cứng
- **Không bịa nghiệp vụ.** Màn chỉ phục vụ role nằm trong `roles` của requirement mà nó phủ (`check-ui.mjs` kiểm). Cần hành động hay role mới thì quay lại `sdlc-research`.
- **Không sửa file `approved`, không tự đổi sang `approved`** (hook chặn). Việc duyệt do người.
- **testid không tự đặt tay vào `spec/testids.md`.** File đó do `check-ui.mjs` sinh từ các tài liệu màn hình.
- Không viết code giao diện ở phase này. Dựng thật là việc của `implement`.

## Quy trình
0. **Nạp bối cảnh.** Đọc `.claude/sdlc/contract.md` (dòng `ui-ux`). Framework tham chiếu không có phần cho phase này (xem `mapping.*.md`). Mở `references/evon-ui-ux/skills/ui-ux/SKILL.md` làm luật giao diện (xem bước 3). Thư mục rỗng nghĩa là chưa nạp submodule: chạy `git submodule update --init` rồi tiếp tục.
1. **Đọc spec của epic**: `spec/epics/<EPIC>/requirements/`, `flows/`, `spec/permissions-matrix.md`, `spec/domain/roles.md`, và ADR-002 trong `spec/architecture.md` (stack frontend). Thiếu requirement `approved` thì dừng, chạy `sdlc-research` trước.
2. **Lập danh sách màn**: bảng `màn | requirement phủ | role`. Gom requirement theo việc người dùng làm trên một màn, không theo từng requirement một file. Requirement thuần hệ thống (job, webhook) không có màn, ghi một dòng "không có UI" trong báo cáo. Đưa bảng này cho người dùng xác nhận (một cổng).
3. **Với từng màn, đi theo `references/evon-ui-ux/skills/ui-ux/SKILL.md`** (đường dẫn `references/...` trong file đó tính từ `references/evon-ui-ux/skills/ui-ux/`), đầu vào: mục đích màn, role, các Given/When/Then của requirement phủ (đây là nguồn trạng thái giao diện), stack từ ADR-002. **Chỉ đi tới hết bước chọn wireframe (`U3`), không đi `U4` (dựng code)**; audit câu 2 của file đó bỏ qua nếu chưa có codebase. Hai cổng của nó (duyệt brief, chọn wireframe) là cổng của người dùng: không tự trả lời thay.
4. **Ghi tài liệu màn** theo `templates/screen.md`: wireframe đã chọn và lý do; bảng *Trạng thái* lấy từ Given/When/Then (bắt buộc có `lỗi`; thêm `đang tải`, `rỗng`... khi requirement nói tới); bảng *Phần tử* với testid cho mọi phần tử người dùng thao tác và mọi vùng trạng thái.
5. **Chạy kiểm cứng và sinh testid** (sửa tới khi qua):
   `node .claude/skills/sdlc-ui-ux/scripts/check-ui.mjs spec/ --epic <EPIC>`
   Thêm `--strict` khi muốn requirement chưa có màn cũng là lỗi.
6. **Báo cáo**: màn đã tạo, requirement chưa có màn (và vì sao), trạng thái giao diện nào không truy ngược được về Given/When/Then (nghi thiếu requirement), việc phải chuyển cho `sdlc-research`.

## Script kiểm (`scripts/check-ui.mjs`)
`screen` trùng tên file, `epic` trùng thư mục, `covers` trỏ tới requirement có thật và cùng epic, `roles` ⊆ roles của requirement được phủ và ⊆ ma trận quyền, đủ ba mục, có trạng thái `lỗi`, testid đúng dạng `<epic>-<màn>-<phần-tử>` và duy nhất toàn `spec/`, mọi cột Requirement nằm trong `covers`, và **role của từng phần tử** ⊆ roles của màn ⊆ roles của requirement phục vụ phần tử (màn dùng chung nhiều role: nút chỉ cho một role phải ghi đúng role đó). Chạy `node .claude/skills/sdlc-ui-ux/scripts/check-ui.test.mjs` để tự kiểm script.

## Chưa làm
- Eval mới chạy một lần, chưa có đối chứng prompt trần.
- Hook Stop và hook sau mỗi lần sửa đã chạy `check-ui.mjs --check`; bước 5 vẫn cần để sinh `spec/testids.md`.
