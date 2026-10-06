---
name: sdlc-test-design
description: Thiết kế test cho một epic: test case (TC) phủ từng kịch bản Given/When/Then của requirement và từng mối đe dọa SEC cần kiểm bằng test, cùng luồng E2E dùng testid từ spec/testids.md; kèm checklist chất lượng requirement. Dùng sau sdlc-research, sdlc-tech-design và sdlc-ui-ux của epic, trước implement.
---

# sdlc-test-design

Đầu vào: epic đã có requirement `approved`, thiết kế kỹ thuật (đặc biệt SEC) và `spec/testids.md` (từ `sdlc-ui-ux`). Đầu ra theo `.claude/sdlc/contract.md`: `spec/epics/<EPIC>/tests/<ID>.md` với ID loại `TC` và `E2E`. **Không viết code test** ở phase này; code test là việc của `implement`.

Phần phủ và tham chiếu do script bảo đảm. Skill lo phần phán đoán: kịch bản nào đáng test, dữ liệu mồi, giá trị biên, assert đủ cụ thể chưa.

## Quy tắc cứng
- **ID do script sinh**: `node .claude/skills/sdlc-research/scripts/new-id.mjs <EPIC> <TC|E2E> spec/`.
- **Không sửa file `approved`, không tự đổi sang `approved`** (hook chặn). Test sai vì requirement sai thì chạy `sdlc-impact`, không sửa requirement.
- Mỗi test case phủ **đúng một requirement** và một mục kịch bản (`kind: chính | lỗi | biên`) có thật trong requirement đó. Không bịa hành vi mới trong test.
- E2E chỉ thao tác giao diện qua **testid có trong `spec/testids.md` và dành cho role của luồng**. Testid chưa có thì quay lại `sdlc-ui-ux`, không tự đặt.

## Quy trình
0. **Nạp framework tham chiếu.** Đọc `.claude/sdlc/adapter/active.md` và dòng phase `test-design` trong file mapping; đọc các file ở cột *Đọc* (`checklist-template.md`, `checklist.md`) để lấy cách kiểm chất lượng requirement. Cột *Kit tự làm* là phần dưới đây.
1. **Đọc bối cảnh**: requirement của epic, `spec/epics/<EPIC>/design/` (nhất là bảng SEC và API), `spec/testids.md`, `permissions-matrix.md`, `spec/security-baseline.md`. Thiếu requirement `approved`, SEC hoặc `testids.md` thì dừng và nói cần chạy skill nào.
2. **Checklist chất lượng requirement** (từ framework tham chiếu, chỉ báo cáo, không ghi file): mỗi quy tắc nghiệp vụ có kiểm được không, có con số/điều kiện cụ thể chưa, kịch bản lỗi và biên có đủ không, có từ mơ hồ không. Chỗ yếu thì ghi vào báo cáo và đề xuất quay lại `sdlc-research`; không tự sửa requirement.
3. **Viết test case** (`templates/tc.md`): mỗi requirement × mỗi mục kịch bản (`chính`, `lỗi`, `biên`) có ít nhất một TC. Given/When/Then cụ thể đến mức viết được assert. Test case của mối đe dọa SEC có `Kiểm bằng test` thì ghi `threats: [<SEC-ID>:<mã>]`.
4. **Viết E2E** (`templates/e2e.md`): luồng đi qua nhiều màn hoặc nhiều requirement (ví dụ khách đặt hàng rồi hủy). Mỗi bước giao diện có testid trong dấu backtick; `role` là role thực hiện luồng.
5. **Kiểm cứng** (sửa tới khi qua): `node .claude/skills/sdlc-test-design/scripts/check-tests.mjs spec/ --epic <EPIC> --strict`. Hook kiểm hình thức chung và file vừa sửa tự chạy.
6. **Báo cáo**: tài liệu đã tạo, chỗ yếu của requirement (bước 2), testid còn thiếu (chuyển `sdlc-ui-ux`), mối đe dọa SEC chưa kiểm được bằng test.

## Script kiểm (`scripts/check-tests.mjs`)
`covers` trỏ tới requirement có thật; TC phủ đúng một requirement, `kind` đúng một trong ba mục và mục đó **có thật** trong requirement; đủ Given/When/Then; `threats` trỏ tới mối đe dọa có thật; E2E có `role` hợp lệ, mọi testid trong backtick **có trong `spec/testids.md` và dành cho role đó**, có ít nhất một testid. Với `--strict`: thiếu TC cho mục kịch bản nào của requirement nào, hoặc mối đe dọa `Kiểm bằng test` chưa có TC, đều là lỗi. Tự kiểm: `node .claude/skills/sdlc-test-design/scripts/check-tests.test.mjs`.

## Chưa làm
- Chưa kiểm được chất lượng assert hay dữ liệu mồi (cần người đọc).
- Chưa có eval với dữ liệu thật; eval có dữ liệu mẫu ở `evals/`.
