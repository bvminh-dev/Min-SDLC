# Min-SDLC

Bộ kit biến các giai đoạn SDLC thành **skill + hook + script** cho Claude Code.
Nguyên tắc: phần cần phán đoán thì để skill; phần phải được bảo đảm thì để hook/script.

> Đang xây dựng. Xem [HANDOFF.md](HANDOFF.md) để biết đã làm gì, đang chờ gì, làm tiếp từ đâu.

## Cài đặt trên máy mới

```bash
git clone --recurse-submodules https://github.com/bvminh-dev/Min-SDLC.git
cd Min-SDLC
# nếu quên --recurse-submodules:
git submodule update --init
node .claude/sdlc/scripts/check-adapter.mjs   # phải in "OK: adapter spec-kit@v1.1.0 khớp."
```

Yêu cầu: Node.js 20 trở lên (các script và hook là `.mjs`, không cần cài thêm gói), Git, Claude Code.
Hook đọc biến `CLAUDE_PROJECT_DIR` do Claude Code đặt. Nếu hook không chạy ngay sau khi mở dự án, mở `/hooks` một lần để nạp lại cấu hình.

## Cấu trúc

```
.claude/
  settings.json            hook: chặn sửa spec đã duyệt, kiểm hình thức, chặn kết thúc khi spec lỗi
  sdlc/
    contract.md            hợp đồng đầu ra mỗi phase (không đổi khi đổi framework)
    adapter/               active.md (framework đang dùng) + mapping.<framework>.md
    framework/spec-kit/    git submodule: GitHub Spec Kit, ghim v1.1.0
    hooks/                 guard-approved, check-spec-file, stop-check-spec
    scripts/               check-adapter.mjs
  skills/
    sdlc-foundation/       nền dự án: vai trò, entity, event, kiến trúc, bảo mật, nguyên tắc
    sdlc-research/         requirement, flow, ma trận quyền cho một epic
    sdlc-impact/           phân tích tác động theo ID khi spec đổi
```

Mỗi skill có `SKILL.md` (mỏng), `templates/`, `scripts/` và `evals/` (ca kiểm thử kèm kết quả).

## Cách hoạt động

- **Spec là nguồn sự thật chung**, ghi vào `spec/` của dự án dùng kit. Mỗi tài liệu có ID theo thời gian
  (`CHK-REQ-20261005-143012123`) do script sinh, nên nhiều người làm song song không đụng nhau.
- **Adapter**: skill không gọi thẳng framework ngoài. Đổi framework thì thêm submodule + viết mapping mới
  (xem `.claude/sdlc/adapter/active.md`), không sửa skill.
- **Duyệt là việc của người**: hook chặn Claude sửa file `status: approved` và chặn việc tự đổi sang approved.

## Kiểm tra nhanh

```bash
node .claude/sdlc/scripts/check-adapter.mjs
node .claude/skills/sdlc-research/scripts/check-spec.mjs .claude/skills/sdlc-research/evals/checkout/fixture/spec
```
