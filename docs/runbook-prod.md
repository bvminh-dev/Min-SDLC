# Runbook hạ tầng prod (PRJ task 21, trạng thái `blocked`)

Các việc dưới đây nằm ngoài mã nguồn: repo này không làm và không kiểm được chúng. Mỗi việc cần một người có quyền ở host hoặc GitHub xác nhận trước go-live. Nguồn yêu cầu là các BR của PRJ trong `spec/epics/PRJ/requirements/`.

| # | Việc | Nguồn | Ai làm | Cách kiểm (bằng chứng cần lưu) |
|---|---|---|---|---|
| 1 | Sao lưu tự động CSDL prod: RPO 24 giờ, RTO 4 giờ | PRJ-REQ-20261006-095422563 BR10 | Người vận hành host (DBA) | Bật snapshot hoặc `pg_dump` hằng ngày ở nhà cung cấp CSDL. Chạy khôi phục thử sang CSDL tạm trước go-live: đo thời gian phải dưới 4 giờ, rồi so số bảng và số dòng `_prisma_migrations` với prod. Lưu ảnh chụp lịch sao lưu và biên bản khôi phục. |
| 2 | Giữ log 30 ngày ở host | PRJ-REQ-20261006-095422908 BR1 | Người vận hành host | Ứng dụng chỉ ghi JSON ra stdout. Cấu hình thu gom log của nền tảng giữ tối thiểu 30 ngày. Kiểm: tìm được dòng log theo `correlation_id` của một yêu cầu cũ 29 ngày; ảnh chụp cấu hình retention. |
| 3 | Kho bí mật của host (không `.env` trong repo, không bí mật trong CI) | PRJ-REQ-20261006-095422735 BR5 | Người vận hành host | Đặt bí mật trong kho của nền tảng: `DATABASE_URL` (vai trò `ecom_app`), `RETENTION_DATABASE_URL` (vai trò `ecom_retention`), `MIGRATE_DATABASE_URL` (chỉ bước migration), mật khẩu thật cho các vai trò này (khác mật khẩu local trong `docker/initdb/01-app-roles.sql`), khóa phiên và khóa thanh toán của các epic sau. Kiểm: khởi động prod thành công (app dừng với mã 1 nếu thiếu biến); `pnpm scan:secrets` sạch; CI không dùng `secrets.*`. |
| 4 | Vai trò CSDL ứng dụng ở prod | PRJ-DB mục 12, PRJ-SEC T19, SB-32 | Người vận hành host | Chạy `docker/initdb/01-app-roles.sql` bằng superuser rồi `ALTER ROLE ecom_app PASSWORD '...'` và `ecom_retention` với mật khẩu từ kho bí mật; `prisma migrate deploy` bằng tài khoản chủ bảng. Kiểm: kết nối bằng `ecom_app` rồi thử `TRUNCATE audit_logs`, `DELETE FROM audit_logs`, `UPDATE audit_logs` đều báo `permission denied`; test mẫu: `apps/api/test/platform/audit.spec.ts`. |
| 5 | CSDL prod bật TLS | PRJ-REQ-20261006-095422563 BR7 | Người vận hành host | `sslmode=require` trở lên trong cả ba URL; ứng dụng từ chối khởi động nếu thiếu (đã có test cấu hình). |
| 6 | Chặn merge khi CI đỏ (Require status checks) | PRJ-REQ-20261006-095422475 BR3 | Chủ repo GitHub | Settings, Branches, nhánh `main`: bật "Require status checks to pass" với `ci / verify`, `ci / smoke`, `audit / audit`; bật "Require branches to be up to date". Kiểm: mở PR cố ý làm `pnpm lint` đỏ, nút Merge bị khóa. |
| 7 | Chạy workflow GitHub Actions thật một lần | review.md mục HIGH 1 | Chủ repo | Đẩy nhánh, xem `ci` (verify, smoke) và `audit` xanh trên GitHub; lưu liên kết lượt chạy. Test hiện chạy trên runner sạch theo thiết kế nhưng chưa có bằng chứng chạy thật. |
| 8 | Ghim action GitHub theo SHA (LOW) | review.md mục LOW 13 | Chủ repo | Thay `@v4` bằng SHA đầy đủ trong `.github/workflows/*.yml`. |
| 9 | `TRUST_PROXY_HOPS` đúng số lớp proxy của host (LOW) | review.md mục LOW 14 | Người vận hành host | Mặc định 0: sai thì IP client trong giới hạn tần suất và log là IP của proxy. Đặt đúng số rồi kiểm `X-Forwarded-For` giả không đổi được IP bị đếm. |

Khi mọi dòng 1 đến 7 có bằng chứng, người có thẩm quyền đổi task 21 trong `spec/epics/PRJ/report.md` từ `blocked` sang `done`.
