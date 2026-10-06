# Bàn giao: làm tiếp ở máy khác

Cập nhật: 2026-10-06. Đọc file này trước, rồi xem [README.md](README.md) để cài đặt.

## Trạng thái

### Hạ tầng
| Phần | Trạng thái |
|---|---|
| Adapter + Spec Kit v1.1.0 (submodule) | xong, `check-adapter.mjs` qua; đã thử clone sạch |
| `evondevKit` v0.3.18 (submodule, luật giao diện cho `sdlc-ui-ux`) | xong, ở `.claude/skills/sdlc-ui-ux/references/evon-ui-ux` |
| Hook `guard-approved` (chặn sửa/duyệt spec) | xong, chạy thật ở phiên chính |
| Hook `check-spec-file` + `stop-check-spec` | xong; kiểm hình thức, nền, màn hình (`check-ui`), thiết kế kỹ thuật (`check-tech-design`); đã pipe-test |

### Các phase theo thứ tự trong `contract.md`
| # | Phase | Skill | Trạng thái | Bằng chứng |
|---|---|---|---|---|
| 1 | discover | `sdlc-discover` | viết xong (chỉ SKILL.md + template; roadmap kiểm bằng `check-foundation`) | chưa chạy, chưa eval |
| 2 | foundation | `sdlc-foundation` | xong | chạy 3 lần; `spec/` thật đã duyệt |
| 3 | research | `sdlc-research` | xong | eval 2 vòng (3 skill vs 2 trần) |
| 4 | impact | `sdlc-impact` | xong | eval 2 vòng; script `check-impact` |
| 5 | design (kỹ thuật) | `sdlc-tech-design` | xong | eval vòng 2 (3+2, chấm độc lập); script bắt FK chéo module |
| 6 | ui-ux | `sdlc-ui-ux` | xong | eval vòng 2 (3+2, chấm độc lập); script kiểm role từng phần tử |
| 7 | test-design | `sdlc-test-design` | xong | eval 1 vòng (3+2, chấm độc lập) |
| 8 | implement | `sdlc-implement` | viết xong (SKILL.md + script `check-report` có test) | chưa chạy trên code thật, chưa eval |
| 9 | review | `sdlc-review` | viết xong (SKILL.md + script `check-review` có test) | chưa chạy trên code thật, chưa eval |
| 10 | retro | `sdlc-retro` | viết xong (SKILL.md + script `check-lessons` có test) | chưa chạy trên dữ liệu thật |
| - | improve-kit | `sdlc-improve-kit` | viết xong (SKILL.md + `selftest.mjs`) | chưa chạy trên bài học thật |

**Cả 10 phase đã có skill.** Skill 1-7 có eval; skill 8-10 và improve-kit mới có script + test đơn vị, **chưa chạy trên dữ liệu thật** (cần code thật, nên cần dựng khung dự án theo ADR-002 trước).
Chạy mọi kiểm tự động của kit: `node .claude/sdlc/scripts/selftest.mjs`.
**Mapping spec-kit** (`.claude/sdlc/adapter/mapping.spec-kit.md`) đã đủ 11 dòng (thêm `improve-kit`, cột *Skill*, ghi `ui-ux` dùng tham chiếu ngoài adapter, ghi `taskstoissues.md` cố ý không dùng); `check-adapter.mjs` kiểm thêm: mỗi skill `sdlc-*` có đúng một dòng, cột Skill trỏ tới skill có thật, submodule evon đứng đúng tag (`ui_reference` ở `active.md`).

## Việc đang chờ NGƯỜI

1. **Nền cần bổ sung cho ORD** (bài học L8 trong `spec/lessons/2026-10-06-ORD.md`): entity `OrderStatusHistory`, mã vận đơn của Order, chuyển trạng thái Order cho ShipmentFailed/Returned, đường đưa đơn COD `pending -> confirmed`, ADR bảo đảm phát event (outbox hay trong giao dịch), SB-08 so với staff cần địa chỉ giao, SB-24 chưa nói admin hủy, `roles.md` ghi staff "cập nhật đơn" trong khi ORD chỉ cho xem. Nền đã `approved` nên đi qua `sdlc-impact` rồi `sdlc-foundation`; bạn quyết từng điểm.
2. **Trả lời `spec/epics/ORD/questions.md`** (14 câu còn mở) và duyệt (đổi `status: approved`) các tài liệu ORD (đang `draft`): 6 requirement, 1 flow, thiết kế DB/API/SEC, 3 màn.
3. **Duyệt bài học** `spec/lessons/2026-10-06-ORD.md` (xóa dòng không đồng ý, đổi `status: approved`), rồi chạy `sdlc-improve-kit` để áp dụng (L1-L7 sửa kit; L8 là việc của nền, ở mục 1).
4. **Chốt hoàn tiền / thanh toán đến muộn** khi chạy research cho PAY.
5. **Dựng khung dự án theo ADR-002** (NestJS + Next.js, monorepo pnpm) để chạy được `sdlc-implement` và `sdlc-review` trên mã thật; các skill đó chưa từng chạy.

## Việc nên làm tiếp (đề xuất thứ tự)

1. Xử lý mục 1-3 ở trên.
2. Dựng khung dự án rồi chạy `sdlc-test-design` -> `sdlc-implement` -> `sdlc-review` -> `sdlc-retro` cho ORD: bằng chứng đầu tiên cho 4 skill chưa chạy thật.
3. Chạy `sdlc-research` cho các epic ORD phụ thuộc (CHK, PAY, SHP) vì nhiều `[OPEN]` của ORD chờ chúng.
4. Eval thêm cho skill 8-10 khi đã có mã thật; chạy lại eval có đối chứng sau mỗi lần `improve-kit` sửa skill (tốn nhiều lượt agent nên chưa tự động).
5. Cân nhắc tắt định dạng tự động của editor cho thư mục `spec/`: trình định dạng đã hai lần làm hỏng script (căn lề bảng, escape `*`); các script đã được vá nhưng còn dễ gặp lỗi tương tự.

## Mâu thuẫn nội bộ ở nền: đã giải quyết (2026-10-06)

Do eval `sdlc-tech-design` phát hiện; đã sửa trong `spec/` (vẫn `draft`, `check-foundation` qua), bạn xem lại khi duyệt:
- **Đồng hồ giữ hàng**: INV giữ đồng hồ duy nhất; reservation quá hạn `expired` rồi phát StockReservationExpired, ORD nhận và chuyển Order `expired`. Sửa ADR-009, `events.md` (INV không còn nhận OrderExpired), `entities.md`; `DECISIONS-ecommerce.md` cập nhật theo.
- **Thuộc tính thiếu**: quy ước ghi ở `entities.md` rằng entity có vòng đời mặc định có `status`; thêm `Order.payment_method`, `Order.payment_status` (bản sao chỉ-đọc từ event của PAY), `StockMovement.actor_id`.
- **Hủy đơn đã trừ kho**: thêm `StockReservation committed -> released` (hoàn lại `on_hand`).
- **Thanh toán thất bại hết lượt thử**: ORD nhận PaymentFailed và hủy đơn, rồi OrderCancelled nhả hàng (không thêm event).
- **SB-24**: hoàn tiền tự động do khách hủy đơn paid thuộc luật hủy (hệ thống tạo, có audit); hoàn tiền thủ công/ngoại lệ cần quyền admin.
- **Order `shipped`**: chỉ do ShipmentShipped từ SHP. Lệch "staff tự chuyển shipped" **chỉ nằm ở requirement ORD-02 của fixture eval** (do kit tự viết), không phải ở nền thật; khi chạy `sdlc-research` cho ORD, nhân viên đánh dấu giao hàng phải thuộc epic SHP.

Còn mở (chưa giải quyết được ở nền, cần PAY): thanh toán thành công đến muộn sau khi đơn đã hủy/hết hạn (PAY phải hoàn tiền) và hoàn tiền tự động khi hủy đơn paid. Chốt khi chạy `sdlc-research` cho PAY.
Các fixture eval giữ bản sao nền cũ, không cập nhật theo.

## Kết quả eval (chi tiết ở `evals/RESULTS.md` của từng skill)

- **research**: 3 lần có skill vs 2 lần prompt trần: **cả hai đều phát hiện đủ xung đột**, kể cả bẫy ẩn. Skill chưa chứng minh được lợi thế ở khâu phát hiện.
  Khác biệt đo được chỉ ở hợp đồng đầu ra (ID do script sinh, định dạng `[OPEN]`).
  Hạn chế: fixture có sẵn 7 requirement mẫu nên prompt trần bắt chước được định dạng; chưa thử epic đầu tiên không có mẫu; chấm bằng grep.
- **foundation**: lần 2 (sau khi thêm cột `Phát khi` + bảng chuyển trạng thái kiểm cứng) đã sửa lỗ hổng "event không khớp vòng đời" của lần 1. Chưa có đối chứng prompt trần.
- **impact** (`sdlc-impact/evals/RESULTS.md`): 3 lần có skill vs 2 lần trần: **phân tích ngang nhau**, kể cả 2 phụ thuộc script bỏ sót. Skill chỉ hơn ở khuôn báo cáo (3/3 vs 0/2) và 1 lần báo thừa CRT. Chấm bằng grep, chưa có subagent độc lập chấm.
- **tech-design / ui-ux / test-design** (3+2 lần, chấm bởi subagent độc lập; xem `evals/RESULTS.md` của từng skill): **ngang nhau ở phần lớn rubric** giống research/impact. Phát hiện hữu ích: 4/5 thiết kế DB có khóa ngoại chéo module trái kiến trúc (đã thêm kiểm cứng); skill giữ phạm vi UI tốt hơn trần (trần dựng màn cho hành vi hệ thống, thêm màn ngoài requirement); test-design cả 5 lần đạt, lỗi lọt: assert lệch số liệu so với requirement (16 vs 15 phút).
- **impact vòng 2**: khuôn báo cáo 3/3 đúng nhờ script, nhưng phần suy luận dao động (AUTH bắt 1/3, PRM 2/3, vòng 1 là 3/3 và 3/3); chưa rõ nhiễu hay do SKILL.md.
- **Chạy thật epic ORD** (research, tech-design, ui-ux trên `spec/` thật): cả bốn kiểm cứng qua; agent gặp 8 vấn đề của kit, ghi thành bài học L1-L8.
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
