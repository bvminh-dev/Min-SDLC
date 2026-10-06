---
name: sdlc-review
description: Review mã của một epic đã triển khai: đối chiếu code với thiết kế API, ma trận quyền và security baseline, mỗi kết luận kèm bằng chứng file:dòng, ghi vào spec/epics/<EPIC>/review.md. Dùng sau sdlc-implement của epic, trước khi coi epic là xong.
---

# sdlc-review

Đầu vào: epic đã có code và `spec/epics/<EPIC>/report.md`. Đầu ra theo `.claude/sdlc/contract.md`: `spec/epics/<EPIC>/review.md`. Review này là **đối chiếu với spec**, không phải góp ý phong cách. Khác `sdlc-implement`: ở đó người làm tự báo cáo; ở đây người review **đọc code và chạy test độc lập**, không tin báo cáo.

## Quy tắc cứng
- **Mỗi `đạt` và `lệch` có bằng chứng `file:dòng`** có thật. Không có bằng chứng thì là `chưa làm` hoặc chưa xem, không phải `đạt`.
- **Không sửa code, không sửa spec.** Ghi việc cần làm; sửa là việc của `sdlc-implement` (code) hoặc `sdlc-impact` (spec).
- **Chạy lại test** bằng lệnh theo ADR-002 và so với `test_result` trong `report.md`. Lệch (báo pass mà thật ra fail) là phát hiện nghiêm trọng nhất.
- Không tự đổi `status` sang `approved` (hook chặn).

## Quy trình
0. **Nạp framework tham chiếu.** Đọc `.claude/sdlc/adapter/active.md` và dòng phase `review` trong file mapping; đọc các file ở cột *Đọc* (`converge.md`, `analyze.md`) để lấy cách đối chiếu mã với spec/plan/tasks và cách xếp mức nghiêm trọng. Cột *Kit tự làm* là phần dưới đây (audit bảo mật, đối chiếu quyền với ma trận).
1. **Đọc bối cảnh**: tài liệu spec của epic, `report.md`, `spec/permissions-matrix.md`, `spec/security-baseline.md`, mã nguồn.
2. **Chạy lại test**, ghi kết quả thật. Khác báo cáo thì ghi ngay vào *Đối chiếu spec* kèm bằng chứng.
3. **Đối chiếu API**: từng endpoint ở tài liệu API: route có thật, role chặn đúng, lỗi 401/403/404 như thiết kế, định dạng lỗi theo ADR-006.
4. **Đối chiếu quyền**: từng hành động của epic ở ma trận quyền: role không được phép bị chặn ở server (không chỉ ẩn nút), dữ liệu `own` kiểm sở hữu.
5. **Audit bảo mật**: từng `SB-nn` liên quan epic: đọc code tương ứng (băm mật khẩu, chống IDOR, escape, rate limit, che log...). Chỗ `Kiểm bằng: test` thì có test thật chạy được.
6. **Ghi review** `spec/epics/<EPIC>/review.md` theo `templates/review.md`; xếp *Việc còn thiếu* theo mức nghiêm trọng.
7. **Kiểm cứng** (sửa tới khi qua): `node .claude/skills/sdlc-review/scripts/check-review.mjs spec/ . --epic <EPIC>` (hook cũng tự chạy khi sửa `review.md`).

## Script kiểm (`scripts/check-review.mjs`)
Khuôn ba bảng (Đối chiếu spec, Quyền, Bảo mật) đúng 5 cột; Kết quả hợp lệ; `đạt`/`lệch` có bằng chứng `file:dòng` với file tồn tại và dòng nằm trong file; `lệch`/`chưa làm` có Việc cần làm; **phủ**: mọi endpoint ở tài liệu API của epic, mọi hành động của epic ở ma trận quyền, mọi `SB-nn` có epic liên quan là epic này (hoặc `*`) đều có dòng. Script không đánh giá code đúng hay sai. Tự kiểm: `node .claude/skills/sdlc-review/scripts/check-review.test.mjs`.

## Chưa làm
- Chưa chạy trên code thật; chưa có eval.
- Chưa bắt buộc review bởi một agent khác với agent đã triển khai (nên làm khi chạy thật để tránh tự chấm bài mình).
