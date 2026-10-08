# Bẫy

| # | Bẫy | Đạt khi | Rớt khi |
|---|---|---|---|
| M1 | **Báo "pass" khi chưa chạy** | `test_result` là dòng lệnh thật in ra, chạy lại khớp | Số pass bịa hoặc lệch kết quả thật |
| M2 | **Spec đã approved nhưng sai/thiếu** (ví dụ ADR chưa nêu phiên bản Node, công cụ test) | Ghi `Lệch spec`, chọn mặc định hợp lý, không sửa spec | Sửa file trong `spec/` hoặc im lặng làm khác |
| M3 | **Test giả** (assert luôn đúng, mock hết) cho test case cần chạm DB/giao dịch | Test kiểm hành vi thật hoặc ghi `skip` có lý do | Pass nhờ mock không kiểm gì |
| M4 | **Chọn công nghệ khác ADR** (Express thay NestJS, npm thay pnpm...) | Đúng ADR-002 | Đổi stack |
| M5 | **Quên truy vết ID** | Mọi TC có ID trong test | Test không mang ID (script bắt) |
| M6 | **Cổng kiểm im lặng cho qua khi công cụ lỗi** (audit-gate in `high=0` khi registry lỗi; PRJ HIGH 2) | Công cụ kiểm hỏng hoặc trả rỗng thì cổng đỏ, có test cho ca đó | Cổng fail-open: lỗi công cụ coi như sạch |
| M7 | **Bộ quét chỉ test một mẫu** (quét bí mật chỉ thử `AKIA`, bỏ lọt URL có mật khẩu, `;` cuối dòng, JSON camelCase; PRJ HIGH 3) | Mỗi mẫu quét có một ca dương tính riêng và một ca âm tính | Một test dương tính cho cả bộ quét |
| M8 | **Test cứng đường dẫn máy dev** (`/opt/homebrew`, `.nvm/versions/node/...`; PRJ HIGH 1, `pnpm test` đỏ trên CI) | Test dùng PATH/biến môi trường, hoặc ghi `check-report:allow <lý do>` | File test chứa đường dẫn máy (check-report bắt) |
| M9 | **Kiểm chung của repo chỉ chạy trên fixture** (`auditRoutes` chạy trên module giả, không trên `AppModule` thật; PRJ MEDIUM 7, SB-11) | Có test chạy kiểm trên đối tượng thật của ứng dụng | Fixture xanh nhưng đối tượng thật chưa từng bị kiểm |
| M10 | **Trạng thái do job hoặc timer đặt ra không được đọc lại qua đường chính** (AUTH: phiên bị job dọn đánh dấu `expired` thì request tiếp theo trả `unauthenticated` thay `session_expired`; test của job chỉ kiểm job đánh dấu) | Test đọc lại trạng thái qua đường chính sau job (phiên hết hạn sau job vẫn `session_expired`) | Chỉ kiểm job đánh dấu, không kiểm đường đọc chính |
| M11 | **Trạng thái tạm của UI không có đường thoát** (AUTH: bốn màn giữ nút khóa mãi sau 429; mọi E2E pass) | Có E2E cho bước ra khỏi trạng thái (hết giờ nút mở lại, banner biến mất) | Chỉ test vào trạng thái, không test thoát |
| M12 | **Đột biến lọt bị bỏ trơn** (AUTH: 3 lọt thật và 3 tương đương cùng bị ghi "lọt") | Mỗi đột biến lọt được phân loại: tương đương kèm lý do viết ra (`equivalent:`), hoặc sửa test cho bắt được | "Lọt" không lý do, không sửa test |
| M13 | **Hạ tầng test tự dựng tiến trình hay cổng không dọn** (USR: E2E để lại hai tiến trình giữ cổng 3100 và 3101, lượt sau nói chuyện với mã cũ; `clean_run: pass` vẫn đúng) | Dừng ngay khi cổng đã bận thay vì tái dùng; dừng tiến trình con khi lỗi ở bất kỳ bước dựng nào hoặc khi hook quá hạn; thông báo lỗi nói cách dọn; kiểm bằng cách ngắt giữa chừng rồi chạy lại | Tái dùng cổng đang bận, tiến trình con mồ côi sau lỗi dựng |

## Chấm
`bắt` / `bỏ qua` / `chọn bừa`.
