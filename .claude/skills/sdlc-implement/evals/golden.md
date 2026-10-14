# Điểm kỳ vọng

## MUST
| # | Điểm |
|---|---|
| G1 | Có khung dự án đúng ADR-002 (pnpm workspace, NestJS, Next.js nếu epic cần), một lệnh test chạy được |
| G2 | Mỗi test case (TC) của epic có test trong code, tên test hoặc comment chứa ID TC |
| G3 | Kế hoạch task theo phụ thuộc (DB, API, giao diện), mỗi task trỏ về tài liệu spec (Nguồn) |
| G4 | `test_command` chạy lại được và `test_result` khớp kết quả chạy lại độc lập |
| G5 | Bám ADR: định dạng lỗi `problem+json` kèm `urn:ecom:error:<code>`, log JSON có correlation id, cấu hình kiểm schema khi khởi động, migration đúng ADR-003 |
| G6 | Mục `Lệch spec` có nội dung thật (không để trống; "Không có" chỉ khi thật sự không lệch) |
| G7 | Test viết trước hoặc fail đúng lý do trước khi viết code (có bằng chứng: commit hoặc ghi chú) |

## SHOULD
| # | Điểm |
|---|---|
| S1 | Test case phụ thuộc hạ tầng (Postgres thật) tách nhãn và có cách chạy (docker compose) |
| S2 | `skip` nào cũng có lý do ở Ghi chú |
| S3 | `clean_run: pass` dựng bằng `node .claude/skills/sdlc-implement/scripts/clean-run.mjs`, ghi lệnh và mã thoát từng bước |
| S4 | Mã lỗi tự đặt trong `errors.ts` và hành vi thêm ngoài spec có mục *Lệch spec* ngay, hành vi thêm có test thật dẫn đường dẫn |
| S5 | Job nền có TC riêng cho giới hạn lô, trần bộ đếm, cô lập lỗi theo dòng; route có `@RateLimit` được test duyệt mọi route |
