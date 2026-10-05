# Bộ kit SDLC cho Claude Code: ghi chú cốt lõi

## 1. Chọn đúng cơ chế: chỉ dẫn vs cưỡng chế
* **Tóm tắt**: CLAUDE.md, skill, subagent là *chỉ dẫn* để model cân nhắc. Hook và permission là *cưỡng chế* do harness thực thi.
* **Chi tiết**: Subagent cũng do model tự quyết định gọi (qua description), nên không bảo đảm chạy. Việc phải luôn xảy ra (test, lint, chặn sửa file) thì dùng hook. Việc cần phán đoán (viết báo cáo, ghi bài học) thì dùng skill/subagent.
* **Đánh đổi**: Hook cứng, không hiểu ngữ cảnh. Skill linh hoạt nhưng có thể bị bỏ sót.

---

## 2. Spec làm nguồn sự thật chung
* **Tóm tắt**: Các skill chạy ở phiên khác nhau, không chia sẻ trí nhớ. File trong `spec/` là bộ nhớ chung.
* **Chi tiết**: Mỗi skill ghi đầu ra thành file có ID liên kết (FEAT → REQ → TC). Khi đổi một tính năng, tra ID để tìm luồng bị ảnh hưởng và dựng lại flow.

```
spec/ roadmap.md · features/FEAT-01.md · requirements/REQ-01.md
      permissions-matrix.md · design/ · security/ · tests/TC-01.md
```

---

## 3. Lớp adapter cho A-SDLC / B-SDLC
* **Tóm tắt**: Skill của bạn không gọi thẳng framework ngoài, chỉ gọi qua bảng mapping.
* **Chi tiết**: `adapter/mapping.md` ánh xạ phase → tài liệu trong framework tham chiếu. Đổi framework thì chỉ sửa mapping và thay thư mục ref.

---

## 4. CLAUDE.md gọn, rule theo phase nằm trong skill
* **Chi tiết**: CLAUDE.md chỉ chứa thứ phục vụ mọi tác vụ (cấu trúc repo, lệnh build/test, quy ước). Rule chỉ cần ở một phase (ví dụ checklist OWASP) đặt trong skill tương ứng, chỉ nạp khi gọi.

---

## 5. Cấu trúc một skill và cách kiểm thử
* **Chi tiết**: `SKILL.md` ngắn (quy trình) + `templates/` + `references/` đọc khi cần.
* **Kiểm thử**: Chạy trên tính năng mẫu có đáp án kỳ vọng, chấm bằng checklist (ID đủ, ma trận quyền không mâu thuẫn, có liên kết).

Các skill dự kiến: Khai phá → Nghiên cứu → Thiết kế hệ thống → Bảo mật → Test case → UI/UX + data-testid → e2e → AI-code (kèm báo cáo, bài học) → Cập nhật roadmap.

---

## 6. Subagent: ngữ cảnh riêng, góc nhìn độc lập
* **Chi tiết**: Dùng khi cần đánh giá độc lập hoặc việc đọc nhiều làm phình ngữ cảnh (reviewer, security audit, so spec-vs-code). Agent vừa viết code dễ thiên vị với lời giải của mình.

---

## 7. Hook làm quality gate
| Mục tiêu | Sự kiện |
|---|---|
| Chạy test/lint sau mỗi lần sửa | PostToolUse (Edit/Write) |
| Chặn sửa `spec/` đã duyệt | PreToolUse (Edit/Write) |
| Chặn kết thúc khi e2e còn đỏ | Stop |

---

## 8. MCP / CLI cho hệ thống ngoài
* **Chi tiết**: Roadmap và ticket trên Jira/GitHub Projects thì skill gọi qua MCP server hoặc CLI (như `gh`), không nhờ model "tự biết".

---

## 9. Đóng gói và vòng cải tiến
* **Đóng gói**: Plugin/repo có version (skills, agents, hooks, adapter). Dự án cài và ghim version, cập nhật một lần cho mọi dự án.
* **Cải tiến**: Bài học từ bug → đề xuất rule → người duyệt → merge vào skill/spec → chạy test hồi quy cho skill.
* **Đánh đổi**: Cổng duyệt làm chậm, nhưng tránh rule sai lan sang mọi dự án.
