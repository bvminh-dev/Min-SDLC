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

## Ecommerce: giai đoạn spec xong cho cả 14 epic, mâu thuẫn đã giải quyết (2026-10-06)

Chạy `sdlc-research` -> `sdlc-tech-design` -> `sdlc-ui-ux` -> `sdlc-test-design` cho từng epic, rồi **sửa nền hai đợt** để hết mâu thuẫn và đồng bộ lại cả 14 epic. Tổng: 145 requirement, 14 flow, 42 thiết kế (DB/API/SEC), 51 màn (1185 testid), 1000 test case, 93 E2E. Toàn bộ kiểm cứng qua (`check-spec` 1294 tài liệu, `check-tests --strict` 1093, `check-tech-design --strict` 42, `check-ui`, `check-foundation`, hook Stop, `selftest` 9/9). Tài liệu epic đều `draft`; nền `approved` lại.

**Sửa nền theo change-control (theo yêu cầu của bạn: "sửa hook, hạ file về draft kèm lý do + giải pháp, sửa xong thì duyệt lại")**
- Hook `guard-approved` có thêm cơ chế kiểm soát thay đổi: Claude chỉ hạ/duyệt lại được file đã duyệt khi file đó được khai trong `.claude/sdlc/change-control.json` (reason, solution, authorized_by); mọi lần hạ và duyệt lại ghi vào `.claude/sdlc/change-control.log`; duyệt lại xong thì mục đăng ký bị đóng. File không khai vẫn bị chặn như cũ. Có test (`guard-approved.test.mjs`).
- Đã hạ rồi **tự duyệt lại** 6 file nền: `entities.md`, `events.md`, `roles.md`, `architecture.md`, `security-baseline.md`, `constitution.md` (roadmap không đổi). **Việc duyệt lại do Claude làm theo ủy quyền của bạn, chưa có người đọc nền mới**: hãy đọc mục `## Nhật ký thay đổi nền` ở cuối mỗi file (mỗi thay đổi một dòng: mã, thay đổi, lý do, giải pháp) và `change-control.log`; muốn thu hồi thì `git diff` rồi đổi status.
- Đợt 1 áp dụng `FOUNDATION-CHANGES.md` (K-01..K-16 và các mục E, V, A, S, R, C, ADR-011..023). Đợt 2 áp dụng phân xử của `FOUNDATION-REMAINING.md` cho 11 mâu thuẫn còn lại (M-01..M-11), cộng 2 làm rõ do epic tự phát hiện (audit thao tác chỉ đọc chia hai loại; `refunded` của DSH; `StockCommitFailed` tới khi đơn còn `pending`). M-12 (AUTH) và M-13 (DSH) sửa ở epic.
- Cột `system` mới ở `permissions-matrix.md` (role `system` cho job, webhook, handler); 145 requirement đều có hàng.
- Sửa kit đi kèm: `check-tech-design` coi `system` như `guest` ở kiểm 401/403 và bắt khóa ngoại chéo module; script chịu được bảng căn lề; `selftest.mjs` chạy cả test của hook.

**Giới hạn cần biết**
- Hai đợt đồng bộ lớn do agent làm, kiểm bằng script và grep; chưa người nào đọc nội dung. Test case viết tay (không trùng nội dung, hầu hết có số liệu cụ thể) nhưng chưa được duyệt.
- 111 tài liệu còn `[OPEN]`/`NEEDS CLARIFICATION` là quyết định nghiệp vụ cần người (mọi số mặc định như hạn, giới hạn tần suất, ngưỡng là số tạm).
- Nền còn **41 mục THIẾU** không phải mâu thuẫn (ưu tiên NÊN/SAU) ở `FOUNDATION-REMAINING.md`, chưa áp dụng.
- Chưa có **dòng code nào**; `sdlc-implement`, `sdlc-review`, `sdlc-retro`, `sdlc-improve-kit` chưa chạy thật.

## Việc đang chờ NGƯỜI

1. **Đọc nền mới** (xem trên) và xác nhận hoặc thu hồi. Chú ý các quyết định "cần người xác nhận" đã làm theo khuyến nghị: Order `shipped -> returned` (hoàn tiền thủ công `admin_manual`), coupon COD tiêu thụ tại `OrderConfirmed` và trả lượt khi hủy, `OrderReturned` mới, đơn `pending`/`paid` tự hủy khi `StockCommitFailed`, giữ 15 phút (không kéo dài để đủ 3 lượt thanh toán), outbox PostgreSQL, không thêm Redis.
2. **Trả lời `questions.md`** của 14 epic (`spec/epics/<EPIC>/questions.md`), rồi duyệt (đổi `status: approved`) tài liệu từng epic; theo P8, chỉ duyệt epic khi các mục `[OPEN]` trỏ vào nền đã được giải quyết.
3. **Xem `FOUNDATION-REMAINING.md`**: 41 mục THIẾU, 3 mục ưu tiên CHẶN đã làm (R-02, R-15, R-25); còn lại chưa. Mục 8 của file có 10 việc cần người quyết.
4. **Duyệt bài học** `spec/lessons/2026-10-06-ORD.md` rồi chạy `sdlc-improve-kit`; thêm KT-01..KT-11 của `FOUNDATION-CHANGES.md` thành bài học (nhiều cái, như cổng chặn chạy song song và `depends_epics`, chưa làm).
5. **Quyết nơi đặt code** (repo này hay repo riêng) khi muốn chạy `sdlc-implement`.

## Việc nên làm tiếp (đề xuất thứ tự)

1. Xử lý mục 1-3 ở trên.
2. Vá kit theo KT-01..KT-11 bằng `sdlc-retro` rồi `sdlc-improve-kit`.
3. Dựng khung dự án theo ADR-002 (NestJS + Next.js, monorepo pnpm) rồi chạy `sdlc-implement` -> `sdlc-review` -> `sdlc-retro` cho **một epic trước** (PRJ rồi AUTH), không chạy song song nhiều epic.
4. Eval thêm cho skill 8-10 khi đã có mã thật.
5. Cân nhắc tắt định dạng tự động của editor cho thư mục `spec/`: đã hai lần làm hỏng script.

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
