# Session: Xây dựng bộ kit SDLC cho Claude Code
- Level: intermediate (biết SDLC, Agile/DevOps, CI/CD, template; đã dùng CLAUDE.md, skills, subagents, hooks, MCP)
- Started: 2026-10-05

## Concepts
1. ✅ Chọn cơ chế đúng: advisory (CLAUDE.md/skill) vs deterministic (hooks/permissions)
2. ✅ Ánh xạ SDLC → thành phần kit (spec/ có ID liên kết làm nguồn sự thật; adapter cho A-SDLC/B-SDLC)
3. ✅ CLAUDE.md: ngữ cảnh dự án cô đọng (rule theo phase đưa vào skill)
4. ✅ Skills cho từng phase (requirements, design, implement, review, release)
5. ✅ Subagents: tách vai trò & ngữ cảnh (reviewer, tester, security)
6. ✅ Hooks & permissions: quality gates tự động
7. ✅ MCP: kết nối Jira/GitHub/CI
8. ✅ Đóng gói & phân phối (plugin/repo template), versioning
9. ✅ Đánh giá & vòng lặp cải tiến kit

## Misconceptions
- Concept 1: chọn CLAUDE.md để "ép luôn chạy lint" → likely root cause: coi chỉ dẫn trong ngữ cảnh là bảo đảm thực thi (advisory vs deterministic)

## Log
- 2026-10-05 Diagnosed: intermediate; mục tiêu = kit cho Claude Code
- Concept 1: started; also thought subagent tester is harness-enforced (same root cause). Resolved after hint: hook=deterministic, skill/subagent=judgment; practice passed → mastered
- Learner's own plan (8 skills: Khai phá, Nghiên cứu, Thiết kế HT, Bảo mật, Test case, UI/UX+testid→e2e, AI-code+báo cáo+bài học, cập nhật roadmap) + external A-SDLC as swappable reference + feedback loop to spec rules. Roadmap dạng xương cá (ảnh chưa nhận được).
- Concept 2-3: answered correctly (spec/ IDs, adapter layer, SKILL.md ngắn + templates/references, eval bằng checklist trên tính năng mẫu)
- Concept 4: in progress
- 2026-10-05 Concepts 5-9 answered correctly; session ended, notes generated
