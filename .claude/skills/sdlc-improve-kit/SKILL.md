---
name: sdlc-improve-kit
description: Áp dụng các bài học đã được người duyệt (spec/lessons/*.md có status approved) vào chính bộ kit: sửa script, hook, skill hoặc eval theo "Nơi sửa", thêm ca hồi quy, chạy toàn bộ kiểm tự động, ghi nhật ký vào .claude/sdlc/improvements.md. Dùng sau sdlc-retro khi người đã duyệt bài học.
---

# sdlc-improve-kit

Đầu vào: một file `spec/lessons/<ngày>-<EPIC>.md` có `status: approved`. Đầu ra: thay đổi trong `.claude/` (script, hook, skill, eval), kèm một dòng nhật ký ở `.claude/sdlc/improvements.md`. **Không động tới `spec/` của dự án** (sửa nền đi qua `sdlc-foundation` hoặc `sdlc-impact`).

## Quy tắc cứng
- **Chỉ áp dụng bài học ở file `approved`.** File `draft` thì dừng và nói cần người duyệt. Chỉ áp dụng các dòng còn trong bảng (người duyệt đã xóa dòng không đồng ý).
- **Thay đổi nhỏ nhất đủ chặn lỗi đã quan sát.** Không dọn dẹp hay đổi cấu trúc nhân tiện.
- **Mỗi bài học thành một ca hồi quy** (nguyên tắc ở `sdlc-research/evals/README.md`): thêm một dòng vào `golden.md` hoặc `traps.md` của skill liên quan, hoặc một `assert` vào `*.test.mjs` của script bị sửa. Không xóa ca cũ. Bài học loại `script`/`hook` bắt buộc có `assert` thất bại trước khi sửa và qua sau khi sửa.
- **Loại `spec`**: không tự sửa. Ghi vào nhật ký là "chuyển cho sdlc-foundation/sdlc-impact".
- **Không làm yếu kiểm cứng** để cho qua test. Kiểm cứng chặn nhầm thì sửa điều kiện kiểm cho đúng và thêm ca hồi quy cho cả hai phía.
- Giữ nguyên thư mục `references/evon-ui-ux` và `framework/spec-kit` (submodule, không sửa).

## Quy trình
0. **Nạp bối cảnh.** Đọc `.claude/sdlc/contract.md`, `.claude/sdlc/adapter/active.md`; đọc file bài học và từng `Nơi sửa` / `Bằng chứng`. Chạy `node .claude/sdlc/scripts/selftest.mjs` để biết trạng thái xuất phát (phải qua hết; không thì dừng và báo).
1. **Với từng bài học**, theo thứ tự `script`/`hook`, rồi `skill`, rồi `eval`:
   1. Viết ca hồi quy tái hiện lỗi (assert hoặc dòng golden/traps); xác nhận nó **fail** trên mã hiện tại (với `script`/`hook`).
   2. Sửa đúng `Nơi sửa`.
   3. Chạy lại: ca hồi quy qua; `selftest.mjs` qua hết.
2. **Ghi nhật ký** vào `.claude/sdlc/improvements.md` (thêm cuối file): ngày, file bài học, mã bài học, file đã đổi, ca hồi quy đã thêm, kết quả `selftest`.
3. **Báo cáo**: bài học đã áp dụng, bài học bỏ qua (kèm lý do), việc cần người (loại `spec`, hoặc cần chạy lại eval).

## Chưa làm
- Chưa chạy trên bài học thật (cần một epic đã qua `sdlc-retro` và được duyệt); chưa có eval.
- Chưa có cơ chế tự chạy lại eval có đối chứng sau mỗi thay đổi skill (tốn nhiều lượt chạy agent): hiện báo người dùng để quyết định.
