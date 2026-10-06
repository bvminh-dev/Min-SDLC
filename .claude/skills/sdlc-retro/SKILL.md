---
name: sdlc-retro
description: Sau khi một epic chạy xong (đã review), rút bài học từ dữ liệu thật (báo cáo triển khai, review, báo cáo tác động, lỗi hook) thành đề xuất rule có bằng chứng, ghi spec/lessons/<ngày>-<epic>.md chờ người duyệt. Dùng khi kết thúc một epic.
---

# sdlc-retro

Đầu vào: một epic đã qua `sdlc-review`. Đầu ra theo `.claude/sdlc/contract.md`: `spec/lessons/<YYYY-MM-DD>-<EPIC>.md`, **đề xuất rule chờ duyệt**. Skill này chỉ đề xuất; áp dụng là việc của `sdlc-improve-kit` sau khi người duyệt.

## Quy tắc cứng
- **Chỉ rút bài học từ bằng chứng có thật trong repo**: dòng `lệch`/`chưa làm` trong `review.md`, mục *Lệch spec* trong `report.md`, báo cáo ở `spec/changes/`, câu hỏi `[OPEN]` còn lại, thông báo lỗi hook mà người dùng gặp. Không có bằng chứng thì không ghi.
- **Mỗi bài học trỏ tới nơi sửa cụ thể** (file có thật trong `.claude/`) và một loại. **Ưu tiên `script`/`hook`** hơn `skill`: nếu một lỗi lặp lại mà script kiểm được thì đề xuất thêm kiểm cứng, đừng thêm lời dặn vào SKILL.md.
- Không đề xuất đổi mà không nêu lỗi nó ngăn được. Không đề xuất xóa kiểm cứng chỉ vì nó phiền.
- Ghi `status: draft`. Không tự đổi `approved` (hook chặn).

## Quy trình
0. **Nạp framework tham chiếu.** Đọc `.claude/sdlc/adapter/active.md` và dòng phase `retro` trong file mapping. Phase này framework không phủ; toàn bộ do skill.
1. **Thu thập dữ liệu** của epic: `report.md`, `review.md`, `spec/changes/*.md`, mọi `[OPEN]` và `NEEDS CLARIFICATION`, ghi chú lỗi hook trong phiên (hỏi người dùng nếu cần), `git log` của epic.
2. **Tìm mẫu lặp lại và lỗi đắt**: lỗi lọt qua phase trước tới `review` mới thấy (nghĩa là phase trước thiếu kiểm cứng), việc người phải sửa tay nhiều lần, kiểm cứng chặn nhầm.
3. **Viết bài học** theo `templates/lesson.md`: Quan sát, Bằng chứng (file thật), Đề xuất rule, Nơi sửa (file thật), Loại.
4. **Kiểm cứng**: `node .claude/skills/sdlc-retro/scripts/check-lessons.mjs spec/` (hook không tự chạy cho phase này; chạy tay).
5. **Báo cáo**: số bài học theo loại, bài học nào đáng làm trước (lỗi lọt xa nhất), cái gì cần người quyết. Người duyệt xóa dòng không đồng ý rồi đổi `status: approved`, sau đó mới chạy `sdlc-improve-kit`.

## Script kiểm (`scripts/check-lessons.mjs`)
Tên file `<YYYY-MM-DD>-<EPIC>.md` với epic có trong roadmap, `status` hợp lệ, bảng đúng cột, mã `L<n>` duy nhất, Loại hợp lệ, **Bằng chứng và Nơi sửa là đường dẫn có thật**. Không đánh giá bài học hay hay dở. Tự kiểm: `node .claude/skills/sdlc-retro/scripts/check-lessons.test.mjs`.

## Chưa làm
- Chưa chạy trên dữ liệu thật (cần một epic đã qua review); chưa có eval.
- Hook chưa chạy `check-lessons.mjs`.
