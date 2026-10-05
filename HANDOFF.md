# Bàn giao: làm tiếp ở máy khác

Cập nhật: 2026-10-05. Đọc file này trước, rồi xem [README.md](README.md) để cài đặt.

## Trạng thái

| Phần | Trạng thái |
|---|---|
| Adapter + Spec Kit v1.1.0 (submodule) | xong, `check-adapter.mjs` qua; đã thử clone sạch |
| Hook (guard-approved, check-spec-file, stop-check-spec) | xong, đã pipe-test; hook chạy thật ở phiên chính |
| Skill `sdlc-research` | xong, đã eval 2 vòng (xem Kết quả eval) |
| Skill `sdlc-impact` | viết xong, **chưa eval** |
| Skill `sdlc-foundation` | xong, đã chạy 2 lần trên roadmap ecommerce 14 epic |
| `discover`, `design`, `ui-ux`, `test-design`, `implement`, `review`, `retro`, `improve-kit` | **chưa làm** |

## Việc đang chờ NGƯỜI quyết định (chặn việc duyệt foundation)

Mẫu đầu ra ở `.claude/skills/sdlc-foundation/evals/ecommerce/sample-output/`. Mười ADR đều `proposed`, chưa có quyết định nào:

1. ADR-001 Kiểu triển khai: modular monolith hay tách dịch vụ? (khuyến nghị tạm: modular monolith)
2. ADR-002 Stack và cấu trúc dự án: ngôn ngữ, framework, có frontend tách riêng không?
3. ADR-003 Cơ sở dữ liệu và cách migration.
4. ADR-004 Xác thực: session hay token, có app di động không?
5. ADR-005 Cổng thanh toán, phương thức (có COD không), tuân thủ (PCI DSS, thuế, hóa đơn).
6. ADR-006 REST hay GraphQL, định dạng lỗi, phân trang.
7. ADR-007 Môi trường (dev/staging/prod) và nơi giữ bí mật.
8. ADR-008 Nơi tập trung log, thời gian lưu.
9. ADR-009 Xác nhận tạo đơn `pending` trước rồi giữ hàng; thời hạn giữ hàng bao lâu.
10. ADR-010 Dịch vụ lưu tệp và gửi email; giới hạn kích thước, định dạng tệp.

Ngoài ADR:
- **Role staff**: kho / chăm sóc khách hàng có role riêng không, hay gộp vào admin? (hiện gộp, đánh `[OPEN]`)
- Có xác minh email khi đăng ký không?
- Tập trạng thái cuối cùng của Order, Payment, Shipment.

## Việc nên làm tiếp (đề xuất thứ tự)

1. Trả lời các ADR ở trên, rồi chạy lại `sdlc-foundation` trên dự án thật và duyệt (đổi `status: approved` bằng tay trong editor; Claude bị hook chặn không tự làm được).
2. Skill `design` → `ui-ux` (sinh `spec/testids.md`) → `test-design`. Giữ skill mỏng: phần bảo đảm đưa vào script/hook.
3. Eval cho `sdlc-impact`.
4. Sau khi có dữ liệu từ một epic chạy thật: `retro`, `improve-kit`.

## Kết quả eval (chi tiết ở `evals/RESULTS.md` của từng skill)

- **research**: 3 lần có skill vs 2 lần prompt trần: **cả hai đều phát hiện đủ xung đột**, kể cả bẫy ẩn. Skill chưa chứng minh được lợi thế ở khâu phát hiện.
  Khác biệt đo được chỉ ở hợp đồng đầu ra (ID do script sinh, định dạng `[OPEN]`).
  Hạn chế: fixture có sẵn 7 requirement mẫu nên prompt trần bắt chước được định dạng; chưa thử epic đầu tiên không có mẫu; chấm bằng grep.
- **foundation**: lần 2 (sau khi thêm cột `Phát khi` + bảng chuyển trạng thái kiểm cứng) đã sửa lỗ hổng "event không khớp vòng đời" của lần 1. Chưa có đối chứng prompt trần.
- **Bài học chung**: model hiện tại phát hiện mâu thuẫn tốt nếu được bảo đọc spec; giá trị nằm ở phần cứng (script, hook, hợp đồng), nên đưa việc bảo đảm vào đó.

## Vấn đề đã biết

- Chưa kiểm được hook có kích hoạt cho **subagent** hay không (agent báo không thấy). Ở phiên chính hook chạy thật.
- Spec Kit đổi version nhanh; sau mỗi lần cập nhật phải chạy `check-adapter.mjs` và có thể phải sửa `mapping.spec-kit.md`.
- `new-id.mjs` chỉ tránh ID đã có trong `spec/`; hai nhánh git cùng sinh cùng mili giây vẫn có thể trùng, `check-spec.mjs` sẽ báo khi merge.
- Khi vá file bằng script Node/heredoc, ký tự escape (`\n`, `\[`) dễ bị mất; dùng công cụ Edit và chạy `node --check` sau mỗi lần sửa.
- Trên Windows + Git Bash, đường dẫn `/tmp/...` bị Node hiểu khác; khi test hook hãy dùng đường dẫn Windows (`cygpath -w`).

## Phiên học (teach-me)

Skill `teach-me` và ghi chép học nằm trong `.claude/skills/teach-me/` (do bạn chọn đưa vào repo công khai này).
Để xem lại tiến độ học: `/teach-me xây dựng 1 bộ kit cho sdlc --resume`. Trạng thái ở
`.claude/skills/teach-me/records/sdlc-kit-claude-code/session.md`, ghi chú ôn tập ở `sdlc-kit-claude-code-notes.md`.
Lưu ý: file `session.md` dừng ở thời điểm 9/9 khái niệm; phần xây dựng kit sau đó không được ghi vào đó mà ghi ở file này.
