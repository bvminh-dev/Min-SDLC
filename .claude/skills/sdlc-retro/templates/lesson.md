---
epic: ORD
date: 2026-10-06
status: draft          # draft | approved (người duyệt; chỉ bài học đã approved mới được sdlc-improve-kit áp dụng)
---
# Bài học: ORD

Chỉ ghi quan sát **có bằng chứng** trong repo. Người duyệt xóa dòng không đồng ý rồi đổi `status: approved`.
Loại: `script` (kiểm cứng mới/mạnh hơn), `hook`, `skill` (sửa SKILL.md hoặc template), `eval` (thêm ca hồi quy), `spec` (sửa nền, qua sdlc-foundation/sdlc-impact).
Ưu tiên `script` và `hook` hơn `skill`: phần bảo đảm đặt ở phần cứng.

| Mã | Quan sát | Bằng chứng | Đề xuất rule | Nơi sửa | Loại |
|---|---|---|---|---|---|
| L1 | Hook báo lỗi nhưng thông báo không nêu dòng sai | spec/epics/ORD/review.md | Thông báo lỗi của check-review phải nêu dòng bảng | .claude/skills/sdlc-review/scripts/check-review.mjs | script |
