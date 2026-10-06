---
status: approved
---

# Kiến trúc nền

Các quyết định dưới đây lấy từ `DECISIONS-ecommerce.md`, đã được người dùng xác nhận ngày 2026-10-06 nên ADR ở trạng thái `accepted`. Tài liệu vẫn `draft` cho tới khi người duyệt.

## Quyết định (ADR)

### ADR-001 Kiểu triển khai

- Trạng thái: accepted
- Bối cảnh: 14 epic, nhiều phụ thuộc chéo (CHK gọi CRT, INV, PRM, SHP, USR, ORD); đội nhỏ, chưa có nhu cầu scale riêng từng phần.
- Phương án: A modular monolith (một đơn vị triển khai, module tách theo epic), B tách dịch vụ theo epic. Loại B ở giai đoạn đầu vì chi phí vận hành và giao dịch phân tán cho luồng giữ hàng/thanh toán.
- Quyết định: A modular monolith, mỗi epic một module, event giữa module đi qua in-process bus, phát bền qua outbox (ADR-011).
- Hệ quả: giao dịch nhất quán đơn giản, triển khai nhanh; ranh giới module chỉ giữ bằng kỷ luật code (P7). Có thể tách dịch vụ sau khi một module cần scale riêng hoặc đội vượt 10 người.

### ADR-002 Stack và cấu trúc dự án

- Trạng thái: accepted
- Bối cảnh: chưa có ngôn ngữ, framework, công cụ build; epic PRJ cần Project setup.
- Phương án: A TypeScript (NestJS cho API, Next.js cho web), B Java/Spring, C Python/Django. Loại B và C vì phải dùng hai ngôn ngữ cho hai đầu hoặc thiếu cấu trúc module sẵn như NestJS.
- Quyết định: TypeScript, NestJS (API) và Next.js (web tách riêng), một monorepo pnpm.
- Hệ quả: một ngôn ngữ cho cả hai đầu, NestJS ép cấu trúc module khớp ADR-001; đổi lại đội phải biết TypeScript. Quyết định này chi phối công cụ test và hook kiểm bảo mật ở các skill sau.

### ADR-003 Cơ sở dữ liệu

- Trạng thái: accepted
- Bối cảnh: dữ liệu quan hệ mạnh (đơn, thanh toán, kho) cần giao dịch ACID và khóa ngoại; phải tránh bán vượt tồn kho.
- Phương án: A PostgreSQL, B NoSQL tài liệu. Loại B vì giao dịch đa bảng cho kho và đơn khó đảm bảo.
- Quyết định: PostgreSQL, migration bằng Prisma Migrate; giữ hàng bằng `UPDATE ... WHERE available >= n` trong giao dịch.
- Hệ quả: ràng buộc toàn vẹn và khóa dòng khi giữ hàng; đánh đổi là mở rộng ghi ngang khó hơn, và phần giữ hàng phải viết SQL thô ngoài Prisma.

### ADR-004 Xác thực và phiên

- Trạng thái: accepted
- Bối cảnh: AUTH có Register, Login, Logout, Session/Token, Forgot/Reset password; Session là entity có thể thu hồi; chỉ có web ở giai đoạn đầu; khách có thể ở cổng thanh toán ngoài tới 15 phút (ADR-009).
- Phương án: A session phía server (cookie HttpOnly), B JWT ngắn hạn kèm refresh token. Loại B vì không thu hồi tức thì và chưa có client di động.
- Quyết định: session phía server, cookie HttpOnly, Secure, SameSite=Lax, kho phiên trong PostgreSQL; hết hạn sau 30 phút không thao tác, tối đa 7 ngày.
- Hệ quả: thu hồi phiên tức thì; cần kho phiên. Hạn 30 phút dài hơn hạn giữ hàng 15 phút nên khách không mất phiên giữa lúc thanh toán; đổi một trong hai hạn phải chạy sdlc-impact. Có app di động thì thêm token bằng một ADR mới.

### ADR-005 Cổng thanh toán và tuân thủ

- Trạng thái: accepted
- Bối cảnh: PAY có callback/webhook, retry, refund; thị trường Việt Nam (VND); dữ liệu thẻ và tiền thuộc phạm vi tuân thủ.
- Phương án: A VNPay trang hosted cộng COD, B tự xử lý thẻ. Loại B vì kéo theo PCI DSS đầy đủ.
- Quyết định: VNPay (redirect tới trang hosted) và COD; không lưu số thẻ, CVV; webhook xác thực chữ ký, chống phát lại, idempotent theo mã tham chiếu; ở v1 chỉ hoàn tiền toàn phần. Điều khoản vận hành: đường dẫn thanh toán tối đa 10 phút (luôn nhỏ hơn hoặc bằng hạn giữ hàng, ADR-009) và tối đa `PAY_MAX_ATTEMPTS` lượt thử (cấu hình ADR-007, mặc định 3; `Payment.attempt_no` không vượt số này); hoàn tiền thất bại tự thử lại tối đa 3 lần rồi chuyển admin; đối soát bằng API truy vấn giao dịch của cổng; hoàn tiền tự động theo trạng thái Payment (đơn hủy hoặc hết hạn sau khi đã thu tiền, thanh toán muộn hoặc trùng).
- Hệ quả: phạm vi PCI thấp nhất nhưng phụ thuộc nhà cung cấp. COD: đơn vào `confirmed` ngay, Payment `succeeded` khi giao thành công và thu tiền. Cần thẻ quốc tế thì thêm cổng bằng ADR mới.

### ADR-006 Cấu trúc API và xử lý lỗi

- Trạng thái: accepted
- Bối cảnh: PRJ cần API structure và Error handling dùng chung cho mọi module.
- Phương án: A REST JSON có tiền tố phiên bản, B GraphQL. Loại B vì chưa có nhu cầu truy vấn linh hoạt và test phức tạp hơn.
- Quyết định: REST JSON `/api/v1`; lỗi theo `application/problem+json` kèm `trace_id`; phân trang `page` và `limit` (mặc định 20, tối đa 100); `type` của lỗi là URN theo ADR-023. Ngoại lệ: IPN của cổng thanh toán trả JSON `RspCode`/`Message` theo yêu cầu của cổng, không dùng `problem+json`.
- Hệ quả: client và test đơn giản; đổi định dạng lỗi sau này là thay đổi phá vỡ hợp đồng; IPN là endpoint duy nhất ngoài định dạng này, xác thực bằng chữ ký (không qua CSRF, ADR-016).

### ADR-007 Cấu hình môi trường và quản lý bí mật

- Trạng thái: accepted
- Bối cảnh: PRJ cần Environment configuration; có khóa cổng thanh toán, thông tin DB, khóa ký.
- Phương án: A biến môi trường kiểm schema khi khởi động, bí mật từ kho bí mật của nền tảng host, B file cấu hình trong repo. Loại B vì lộ bí mật.
- Quyết định: ba môi trường dev, staging, prod; biến môi trường kiểm schema (zod), dừng nếu thiếu; bí mật lấy từ kho bí mật của nền tảng host; `.env` local nằm trong `.gitignore`. Hằng số vận hành đi qua cấu hình này, gồm `RESERVATION_TTL` (15 phút, ADR-009), `REVIEW_PRE_MODERATION` (ADR-018) và `PAY_MAX_ATTEMPTS` (số lượt thanh toán tối đa mỗi đơn, mặc định 3, ADR-005).
- Hệ quả: fail-fast khi thiếu cấu hình (SB-16); đánh đổi là cần quy trình cấp bí mật cho từng môi trường.

### ADR-008 Logging và quan sát

- Trạng thái: accepted
- Bối cảnh: PRJ cần Logging; cần truy vết đơn/thanh toán và audit, không để lộ dữ liệu nhạy cảm.
- Phương án: A log JSON có correlation id và che dữ liệu nhạy cảm, B log văn bản tự do. Loại B vì khó truy vết.
- Quyết định: log JSON (pino) ra stdout kèm `correlation_id`, gom về dịch vụ log của nền tảng host, giữ 30 ngày; audit log lưu trong CSDL 12 tháng (entity AuditLog, ADR-021); nhật ký webhook thanh toán cũng giữ 12 tháng (bảng hạn lưu ở ADR-022).
- Hệ quả: truy vết chéo module dễ; cần quy ước trường log và bộ lọc che dữ liệu (SB-18). Quy định yêu cầu lưu lâu hơn thì tăng thời gian giữ.

### ADR-009 Thứ tự giữ hàng và tạo đơn

- Trạng thái: accepted
- Bối cảnh: roadmap CHK đặt "Reserve stock" trước "Create order", nhưng StockReservation gắn với Order (N-1 Order).
- Phương án: A tạo Order `pending` trước rồi giữ hàng trong cùng giao dịch checkout, B giữ hàng gắn với CheckoutSession rồi chuyển sang đơn. Loại B vì thêm một loại liên kết.
- Quyết định: A; hạn giữ hàng 15 phút cho thanh toán online, COD không có hạn chờ (đơn vào `confirmed` ngay). INV giữ đồng hồ duy nhất: job của INV chạy mỗi phút, reservation quá hạn chuyển `expired` rồi phát StockReservationExpired; ORD nhận event đó và chuyển Order sang `expired` (phát OrderExpired cho PAY, PRM). Hạn 15 phút là hằng số `RESERVATION_TTL` (ADR-007); CHK truyền cùng một `expires_at` cho `INV.reserve` và `ORD.createPending`, Order lưu bản sao chỉ đọc `payment_expires_at` (rỗng nếu COD) cho PAY và giao diện đếm ngược. Hạn đường dẫn thanh toán của PAY (10 phút, ADR-005) luôn nhỏ hơn hoặc bằng `payment_expires_at` và lượt thử cuối không vượt hạn đó. Phiên checkout và giỏ là đồng hồ riêng của CHK, CRT, không liên quan hàng. Thanh toán đến sau khi reservation không còn `held`: một giao dịch thắng (khóa dòng reservation), bên thua PAY hoàn tiền `late_payment`; ORD nhận StockCommitFailed thì không đổi đơn đã đóng (`cancelled`, `expired`), còn đơn đã `paid` (PaymentSucceeded tới trước StockReservationExpired) thì hủy do hệ thống (`paid -> cancelled`, `cancelled_by_role` = `system`, `cancel_reason` = `stock_commit_failed`) để đơn không kẹt `paid` khi tiền đã hoàn.
- Hệ quả: quan hệ rõ với đơn, hủy hoặc hết hạn đơn tự nhả hàng; có đơn pending bị bỏ dở cần job dọn. Thanh toán chuyển khoản, hoặc muốn đủ 3 lượt thử trong hạn dài hơn 15 phút, thì đổi hạn bằng ADR mới kèm ADR-004 (hạn phiên) qua sdlc-impact; làm rõ này không đổi quyết định gốc.

### ADR-010 Lưu trữ tệp và gửi email

- Trạng thái: accepted
- Bối cảnh: USR upload avatar, REV upload ảnh, NTF gửi email (gồm email xác minh đăng ký).
- Phương án: A object storage tương thích S3 và Amazon SES, B lưu đĩa cục bộ và SMTP tự chạy. Loại B vì khó mở rộng và dễ lọt thư rác.
- Quyết định: A; avatar tối đa 2 MB, ảnh review tối đa 5 MB và 5 ảnh mỗi review; ảnh sản phẩm tối đa 5 MB và 8 ảnh mỗi sản phẩm; chỉ JPEG, PNG, WebP; kiểm magic bytes và xử lý lại ảnh trước khi lưu. Chi tiết xử lý ảnh, quyền truy cập và dọn ảnh mồ côi ở ADR-018.
- Hệ quả: bền, mở rộng được; chi phí và phụ thuộc nhà cung cấp (SB-10 áp dụng); ảnh là nội dung công khai nên truy cập theo khóa ngẫu nhiên, không ký URL (ADR-018).

### ADR-011 Phát event bền (outbox) và phong bì event

- Trạng thái: accepted
- Bối cảnh: bus in-process (ADR-001) mất event nếu tiến trình chết giữa commit và phát: đơn đã thanh toán bị hủy mà không hoàn tiền, đơn `pending` không bao giờ `expired`, giỏ không `converted`, điểm đánh giá lệch; 13 trong 14 epic nêu vấn đề này.
- Phương án: A outbox (ghi OutboxEvent cùng giao dịch, job chuyển phát at-least-once, consumer chống trùng bằng ProcessedEvent), B phát đồng bộ trong giao dịch, C giữ nguyên và đối soát từng cặp bằng job. Loại B vì handler của consumer lỗi làm hỏng giao dịch của producer; loại C vì phải viết một job đối soát riêng cho mỗi cặp event.
- Quyết định: A; mọi event có phong bì `event_id` (uuid), `occurred_at`, `correlation_id`; thứ tự theo `aggregate_id`; OutboxEvent giữ 14 ngày sau khi phát; relay là một job của ADR-013; consumer chống trùng theo `event_id`. Ngoại lệ: hai event mang token thô (EmailVerificationRequested, PasswordResetRequested) không đi outbox, phát in-process sau commit, best-effort (mất thì khách bấm gửi lại), token chỉ ở bộ nhớ, không log (SB-03, SB-26).
- Hệ quả: không mất event khi tiến trình chết, consumer phải idempotent (SB-27); đánh đổi là thêm bảng OutboxEvent, ProcessedEvent và độ trễ vài giây giữa commit và xử lý; vẫn một CSDL, không thêm hạ tầng.

### ADR-012 Giao diện module, truyền giao dịch, guard platform

- Trạng thái: accepted
- Bối cảnh: CHK gọi 6 module trong một giao dịch đặt hàng; cần quy ước truyền kết nối giao dịch, thứ tự khóa và nơi đặt guard phiên (AUTH không được là phụ thuộc của mọi module).
- Phương án: A service công khai của module nhận `tx` (Prisma transaction client) làm tham số, B mỗi module tự mở giao dịch rồi bù trừ (saga), C giao dịch ngầm qua ngữ cảnh bất đồng bộ (CLS). Loại B vì thêm trạng thái trung gian và bù trừ cho luồng giữ hàng; loại C vì ranh giới giao dịch ẩn, khó kiểm.
- Quyết định: A (khớp ADR-001, ADR-003); bảng "Giao diện module" bên dưới là hợp đồng gọi đồng bộ; thứ tự khóa cố định CheckoutSession, Cart, Order, StockItem (id tăng dần), Coupon; không gọi hệ thống ngoài trong giao dịch; guard là interface `SessionContext {user_id, role, email_verified}` ở platform, AUTH cung cấp triển khai (đảo phụ thuộc).
- Hệ quả: giao dịch đặt hàng một CSDL, không saga; module chỉ gọi nhau qua service công khai (SB-35); đổi chữ ký giao diện phải chạy sdlc-impact; thứ tự khóa sai gây deadlock nên phải kiểm ở tech-design.

### ADR-013 Job nền chung

- Trạng thái: accepted
- Bối cảnh: nhiều việc định kỳ cần chạy đúng một bản khi có nhiều instance: INV hết hạn giữ hàng, CHK hết hạn phiên, CRT bỏ giỏ, PRM hết hạn coupon, PAY thử lại và đối soát, NTF gửi email, dọn ảnh mồ côi, relay outbox, dọn dữ liệu quá hạn.
- Phương án: A bộ lập lịch trong ứng dụng (`@nestjs/schedule`) cộng khóa `pg_try_advisory_lock` hoặc `FOR UPDATE SKIP LOCKED` theo lô, B hàng đợi trên PostgreSQL (pg-boss), C cron của host gọi endpoint nội bộ, D BullMQ cộng Redis. Loại D vì thêm Redis; loại C vì thêm endpoint nội bộ cần bảo vệ và phụ thuộc host; loại B ở v1 vì chưa cần hàng đợi lớn.
- Quyết định: A; mỗi job idempotent, có hạn thời gian và giới hạn thử lại (SB-34); bảng job (tên, module, chu kỳ chỉ định, chốt ở tech-design): relay outbox (PRJ, vài giây), hết hạn giữ hàng (INV, mỗi phút) và đối soát kho (INV, đêm), hết hạn phiên checkout (CHK, 5 phút), bỏ giỏ (CRT, mỗi giờ), hết hạn coupon (PRM), thử lại và đối soát thanh toán, hoàn tiền (PAY), gửi email (NTF), dọn ảnh mồ côi (PRD, USR, REV), dọn dữ liệu quá hạn theo ADR-022 (PRJ).
- Hệ quả: không thêm hạ tầng; job chạy chung tiến trình API nên tải job ảnh hưởng API; lên B (pg-boss) khi cần hàng đợi email lớn.

### ADR-014 Kho đếm giới hạn tần suất

- Trạng thái: accepted
- Bối cảnh: SB-14 mở rộng giới hạn tần suất cho mọi endpoint; nhiều instance thì cần nơi đếm chung, bậc xác thực và dò cần chính xác.
- Phương án: A Redis, B bảng PostgreSQL (cửa sổ cố định, UNLOGGED), C bộ nhớ từng instance. Loại A ở v1 vì thêm hạ tầng; loại C cho bậc A, B, D, E vì mỗi instance đếm riêng nên vượt giới hạn.
- Quyết định: B cho bậc A, B, D và E (chính xác, khóa tài khoản vốn đã ở CSDL; bậc E gồm thanh toán, hoàn tiền, IPN cần đếm chính xác như tiền; bậc D chọn B cho đồng nhất, một cơ chế đếm duy nhất cho mọi bậc cần chính xác), C cho bậc C (đọc công khai, xấp xỉ chấp nhận được); chỉ tin `X-Forwarded-For` từ proxy cấu hình qua env (ADR-007). Hợp đồng đếm theo kết quả, chỉ cần giao diện ở PRJ-API: `check(key, limit, window)` (kiểm, không tăng), `hit(key)` (tăng, chỉ khi thao tác sai), `reset(key)` (xóa khi thành công); dùng cho đổi mật khẩu (`usr:pwchange:<user_id>`) và mã giảm giá. Bậc D không dùng bộ nhớ từng instance (DSH đổi sang giao diện đếm của PRJ).
- Hệ quả: không thêm Redis; `ponytail`: đổi sang Redis khi quá vài instance hoặc khi tải đếm ảnh hưởng CSDL; bậc C có thể cho qua nhiều hơn giới hạn theo số instance.

### ADR-015 Băm mật khẩu

- Trạng thái: accepted
- Bối cảnh: SB-01 chỉ nói thuật toán "chuyên dụng", chưa chọn thuật toán và tham số.
- Phương án: A argon2id, B bcrypt cost 12, C scrypt. Loại B vì giới hạn 72 byte và không chống GPU bằng bộ nhớ; loại C vì ít thư viện và công cụ hơn argon2id.
- Quyết định: A với m=19 MiB, t=2, p=1 (khuyến nghị OWASP), tham số nằm trong cấu hình (ADR-007), tự băm lại khi đăng nhập nếu tham số đổi; không dùng pepper ở v1; token đặt lại, token xác minh và token phiên (ngẫu nhiên 256 bit) băm bằng SHA-256 vì không cần chậm.
- Hệ quả: chống tấn công GPU tốt hơn bcrypt; tốn bộ nhớ khi nhiều đăng nhập cùng lúc nên cần giới hạn tần suất (SB-14); thêm pepper bằng ADR mới nếu cần.

### ADR-016 Chống CSRF

- Trạng thái: accepted
- Bối cảnh: SB-13 yêu cầu chống CSRF cho endpoint đổi trạng thái dùng cookie phiên nhưng chưa chọn cơ chế.
- Phương án: A kiểm `Origin`/`Referer` theo danh sách cho phép cộng SameSite=Lax (ADR-004) và chỉ nhận `application/json`, B token đồng bộ (double-submit). Loại B ở v1 vì thêm trạng thái token cho cả web và API khi A đã đủ.
- Quyết định: A; web (Next.js, ADR-002) và API phải cùng site để Lax có tác dụng, nếu khác site thì chuyển sang B bằng ADR mới; IPN của cổng thanh toán là ngoại lệ, xác thực bằng chữ ký (SB-22).
- Hệ quả: không cần token CSRF ở client; phụ thuộc trình duyệt gửi `Origin` và triển khai cùng site; danh sách Origin cho phép nằm trong cấu hình (ADR-007).

### ADR-017 Idempotency-Key

- Trạng thái: accepted
- Bối cảnh: thao tác ghi quan trọng bị gửi lại (mạng chập chờn, bấm đúp): đặt hàng, tạo thanh toán, hoàn tiền, nhập xuất điều chỉnh kho, tạo đánh giá.
- Phương án: A bảng chung ở platform, B mỗi module tự làm (ví dụ cột trong StockMovement), C chỉ dựa vào ràng buộc duy nhất. Loại B vì lặp cơ chế ở mỗi module; loại C vì không trả lại được phản hồi cũ và không phát hiện cùng khóa khác nội dung.
- Quyết định: A; entity IdempotencyKey (`scope, key, user_id, request_hash, response, expires_at`, unique `(scope, user_id, key)`), giữ 24 giờ, so `request_hash` (cùng khóa khác nội dung thì 422); header `Idempotency-Key` bắt buộc ở: đặt hàng (CHK), tạo thanh toán và hoàn tiền (PAY), nhập, xuất, điều chỉnh kho (INV), tạo đánh giá (REV); luồng hệ thống (event, job) dùng ràng buộc duy nhất.
- Hệ quả: thao tác ghi gửi lại an toàn; thêm một bảng và một bước chặn ở platform; INV không còn cột idempotency riêng.

### ADR-018 Ảnh và quyền truy cập (bổ sung ADR-010)

- Trạng thái: accepted
- Bối cảnh: ADR-010 chỉ nêu avatar và ảnh review; thiếu ảnh sản phẩm, giới hạn điểm ảnh, chính sách truy cập, dọn ảnh mồ côi.
- Phương án: truy cập A công khai theo khóa ngẫu nhiên qua CDN, B URL ký hạn ngắn. Loại B vì ảnh sản phẩm, avatar, ảnh review vốn công khai nên chữ ký chỉ thêm chi phí.
- Quyết định: A; ảnh sản phẩm tối đa 5 MB và 8 ảnh mỗi sản phẩm; giới hạn đầu vào 25 megapixel (chặn bom giải nén); cạnh dài sau xử lý 1600 px (avatar 512 px); re-encode và bỏ EXIF; khóa tệp ngẫu nhiên; job dọn ảnh chưa gắn quá 24 giờ và ảnh của đánh giá đã xóa (ADR-013); `REVIEW_PRE_MODERATION` thêm vào danh sách cấu hình ADR-007.
- Hệ quả: ai biết URL đều xem được ảnh nên không dùng cho nội dung riêng tư; cần job dọn; nội dung riêng tư sau này cần ADR mới dùng URL ký.

### ADR-019 Tìm kiếm sản phẩm

- Trạng thái: accepted
- Bối cảnh: PRD cần duyệt và tìm sản phẩm theo tên có dấu và không dấu.
- Phương án: A PostgreSQL (`pg_trgm`, `unaccent`), B Meilisearch hoặc OpenSearch. Loại B ở v1 vì thêm hạ tầng và đồng bộ chỉ mục khi số sản phẩm còn nhỏ.
- Quyết định: A (khớp ADR-003), tìm kiếm là bậc C của giới hạn tần suất (SB-14).
- Hệ quả: không thêm hạ tầng; xếp hạng và chịu tải kém công cụ chuyên dụng nên xem lại khi số sản phẩm lớn.

### ADR-020 Giao diện đọc cho tổng hợp và cache

- Trạng thái: accepted
- Bối cảnh: DSH tổng hợp số liệu từ ORD, PAY, PRD, INV, USR mà không đọc bảng chéo (P7).
- Phương án: A phương thức đọc của module chủ (một truy vấn, nhận khoảng UTC, trả số nguyên VND, không trả trường cá nhân), B read model dựng từ event, C đọc bảng trực tiếp. Loại C vì phá ranh giới module; loại B ở v1 vì thêm bảng chiếu và xử lý event khi chưa thấy chậm.
- Quyết định: A cộng cache bộ nhớ 60 giây; số tiền chỉ lấy từ PAY (SB-23); DSH không nhận event ở v1; số khách là `USR.countCustomers` (USR gọi AUTH).
- Hệ quả: số liệu trễ tối đa 60 giây; chuyển sang B chỉ khi truy vấn tổng hợp chậm, khi đó thêm DSH vào consumer của các event liên quan.

### ADR-021 Audit log: entity và cách ghi

- Trạng thái: accepted
- Bối cảnh: SB-19 và ADR-008 nói audit lưu CSDL 12 tháng nhưng chưa entity nào sở hữu và chưa nói module ghi bằng đường nào.
- Phương án: A `AuditService.record()` của platform gọi đồng bộ trong giao dịch của thao tác, B phát event rồi ghi qua outbox. Loại B vì audit có thể trễ hoặc mất khi consumer lỗi, trái SB-19.
- Quyết định: A; entity AuditLog thuộc PRJ (`actor_id` rỗng nếu hệ thống, `actor_role` gồm `system`, `action`, `target_type`, `target_id`, `before`, `after`, `reason`, `correlation_id`), chỉ thêm, chỉ admin đọc; phạm vi theo SB-19: mọi thao tác thay đổi và mọi truy cập dữ liệu cá nhân của người khác. Thao tác chỉ đọc không có giao dịch ghi để đi cùng, chia hai loại: (1) truy cập dữ liệu cá nhân của người khác (tra cứu hồ sơ khách USR, xem người nhận SHP): mỗi lần một dòng audit trong giao dịch ngắn riêng, ghi trước khi trả dữ liệu, lỗi audit thì không trả dữ liệu (đóng khi lỗi); (2) số liệu tổng hợp không chứa dữ liệu cá nhân (xem dashboard `dashboard.view`): gộp một dòng mỗi người mỗi phút, lỗi audit không chặn việc xem, chỉ log `error` (khác thao tác thay đổi, nơi lỗi audit làm hỏng cả giao dịch). Đặt hàng ghi `checkout.place_order` cùng giao dịch. Job nền và handler event của `system` chỉ audit hủy và hoàn tiền tự động (SB-19); hết hạn (giữ hàng, coupon, phiên, giỏ) không audit vì đã có lịch sử trạng thái và event.
- Hệ quả: audit thao tác thay đổi cùng giao dịch với thao tác nên không mất (thao tác chỉ đọc số liệu tổng hợp là ngoại lệ có chủ đích, có thể mất một dòng khi audit lỗi; truy cập dữ liệu cá nhân của người khác thì đóng khi lỗi nên không mất); mọi module ghi audit phụ thuộc interface của platform (không khai ở cột Phụ thuộc); tăng chi phí ghi nhưng đáng với dữ liệu truy vết.

### ADR-022 Thời hạn lưu dữ liệu

- Trạng thái: accepted
- Bối cảnh: nhiều epic cần hạn lưu dữ liệu nhưng không có bảng chung nên mỗi epic tự chọn.
- Phương án: A bảng hạn lưu chung trong ADR cùng job dọn theo ADR-013, B mỗi epic tự quy định trong tech-design. Loại B vì hạn lệch nhau giữa module và khó kiểm.
- Quyết định: A; hạn lưu: audit log 12 tháng (ADR-008), nhật ký webhook thanh toán 12 tháng, OutboxEvent đã phát 14 ngày, IdempotencyKey 24 giờ, địa chỉ xóa mềm 30 ngày rồi xóa cứng, các hạn còn lại do epic chốt ở tech-design.
- Hệ quả: một nơi tra hạn lưu và một job dọn; đổi hạn là đổi ADR này; dữ liệu cá nhân đã xóa mềm chỉ thực sự mất sau hạn xóa cứng.

### ADR-023 Định danh `type` của lỗi

- Trạng thái: accepted
- Bối cảnh: ADR-006 dùng `application/problem+json` nhưng chưa nói trường `type` có giá trị gì.
- Phương án: A URN `urn:ecom:error:<code>`, B URL theo tên miền. Loại B vì phải có tên miền và trang tài liệu cho từng lỗi.
- Quyết định: A; mỗi lỗi có mã ổn định `<code>` do module chủ khai ở tech-design; IPN của cổng thanh toán là ngoại lệ vì cổng đòi `RspCode` (ADR-006).
- Hệ quả: client so khớp lỗi theo `type` mà không cần tên miền; đổi `code` là thay đổi phá vỡ hợp đồng.

## Ánh xạ epic → module

Cột Phụ thuộc: mã epic mà module này gọi trực tiếp, cách nhau bởi dấu phẩy, hoặc `-`. Không được có vòng phụ thuộc.
Liên lạc ngược chiều (ví dụ PAY báo ORD) đi qua domain event trong `domain/events.md`, không tính là phụ thuộc gọi trực tiếp; event chỉ được khai Consumer khi có handler. Ngược lại, chiều gọi đồng bộ ngược chiều event là hợp lệ khi cột Phụ thuộc có khai: PAY và SHP gọi ORD (giao diện đọc đơn) trong khi ORD không gọi PAY, SHP.
Phần dùng chung của `platform` (guard phiên và role, audit, giới hạn tần suất, outbox, job nền...) là mối quan tâm cắt ngang bên dưới, không cần khai PRJ hay AUTH ở cột này cho phần đó.

| Epic | Module       | Phụ thuộc                    |
| ---- | ------------ | ---------------------------- |
| PRJ  | platform     | -                            |
| AUTH | auth         | -                            |
| USR  | user         | AUTH                         |
| PRD  | catalog      | PRJ                          |
| INV  | inventory    | PRD                          |
| CRT  | cart         | PRD, INV, PRM, SHP           |
| PRM  | promotion    | -                            |
| CHK  | checkout     | CRT, USR, PRM, INV, SHP, ORD |
| ORD  | order        | AUTH                         |
| PAY  | payment      | ORD                          |
| SHP  | shipping     | ORD                          |
| NTF  | notification | AUTH                         |
| REV  | review       | PRD, ORD, AUTH               |
| DSH  | dashboard    | ORD, PRD, INV, USR, PAY      |

Ghi chú cột Phụ thuộc: AUTH bỏ PRJ (phần dùng chung của platform là cắt ngang, không khai); ORD giữ AUTH có chủ đích vì hai khóa ngoại tới bảng `users` của AUTH (`orders.user_id`, `order_status_history.actor_id`), không có lời gọi nào nên không có hàng ORD trong bảng Giao diện module (loại phương án đổi hai khóa thành cột trơn vì ORD-DB đã dựng khóa ngoại và `users` là bảng định danh dùng chung); PRM bỏ PRD (khai lại nếu sau này coupon theo sản phẩm); NTF bỏ USR, giữ AUTH (`getUserContact`, `listActiveUserIdsByRole`); SHP bỏ USR vì người nhận lấy từ bản chụp địa chỉ của Order; DSH lấy số khách qua `USR.countCustomers` (USR gọi AUTH, bảng giữ nguyên).

## Giao diện module (gọi đồng bộ)

Chiều gọi phải khớp cột Phụ thuộc ở trên. Tên phương thức là chỉ định, chữ ký chốt ở tech-design của epic bên được gọi, trừ các chữ ký ghi đầy đủ ở cột Phương thức (đã là hợp đồng, đổi phải chạy sdlc-impact). `tx` = nhận kết nối giao dịch của bên gọi (ADR-012). Bảng này là hợp đồng (P7).

| Gọi | Đến | Phương thức (chỉ định) | tx |
| --- | --- | ---------------------- | --- |
| CHK | CRT | `snapshotForCheckout`, `lockForCheckout` | có |
| CHK | USR | `listAddresses`, `getAddress` | không |
| CHK | PRM | `evaluate(..., count_attempt = true)` (false khi kiểm lại mã đã lưu, không tính lượt sai), `reserve(..., tx)` | có |
| CHK | INV | `reserve(order_id, items, expires_at, tx)` | có |
| CHK | SHP | `listActiveMethods`, `quote` | không |
| CHK | ORD | `createPending(..., payment_expires_at, tx)` (cùng `expires_at` với `INV.reserve`, rỗng nếu COD), `confirmCod`, `countOpenOrders`, `getSummary` | có |
| CRT | PRD, INV, PRM, SHP | `getForCart`, `getAvailability`, `evaluate(..., count_attempt)`, `quote` (đọc theo lô) | không |
| PAY | ORD | `findForPayment` (đọc) | không |
| SHP | ORD | `findForShipment`, `findByCode`, `findOwned`, `getRecipient` | không |
| INV | PRD | đọc theo lô `getSummaries(product_ids)` (name, sku), `searchProductIds(q, limit <= 200)`, liệt kê `product_id` của sản phẩm `active` (đối soát, tạo bù) | không |
| REV | ORD | `getDeliveredItems` (đọc) | không |
| REV | PRD | trạng thái `active`, tên, ảnh đại diện theo danh sách id (đọc theo lô) | không |
| REV | AUTH | `getDisplayNames(user_ids)`: tên hiển thị, ảnh đại diện theo danh sách `user_id` (đọc theo lô) | không |
| NTF | AUTH | `getUserContact`, `listActiveUserIdsByRole` | không |
| USR | AUTH | `updateProfile(full_name, phone, avatar_url)`, `getUser`, `changePassword` (kiểm mật khẩu cũ, thu hồi mọi phiên, phiên của request `replaced`, cấp phiên mới, phát PasswordChanged, giới hạn bậc A), `findCustomerById`, `findCustomerByEmail` (chỉ role customer), `listAvatarUrlsInUse`, `countCustomers` (DSH lấy qua USR) | không |
| DSH | ORD | `countByStatus`, `getOrderSeries`, `listRecent`, `getTopProducts` (chỉ đọc, ADR-020) | không |
| DSH | PAY | `getRevenue`, `countFailedRefunds` (chỉ đọc; doanh thu thuần trừ đúng các Refund làm Payment sang `refunded`, kể cả Refund `late_payment` trên Payment `succeeded` do StockCommitFailed; Refund `late_payment` hoặc `duplicate_payment` trên Payment đã đóng (`expired`, `cancelled`) hoặc giao dịch cổng trùng không trừ vì tiền đó chưa vào doanh thu; PAY xác nhận ở tech-design) | không |
| DSH | PRD | `countByStatus` (chỉ đọc) | không |
| DSH | INV | `getLowStockSummary(limit)` (chỉ đọc) | không |
| DSH | USR | `countCustomers` (chỉ đọc; USR gọi AUTH) | không |
| Web | INV | `GET /inventory/availability?product_ids=` công khai, chỉ trả `in_stock` theo lô (không lộ số chính xác, SB-37) | - |

## Mối quan tâm cắt ngang

Mỗi dòng trỏ về một ADR đã viết ở trên. Module không cần khai `platform` (PRJ) hay AUTH ở cột Phụ thuộc cho phần dùng chung này; guard là interface ở platform và AUTH cung cấp triển khai (ADR-012).

| Mối quan tâm              | ADR     |
| ------------------------- | ------- |
| Project setup             | ADR-002 |
| Database                  | ADR-003 |
| API structure             | ADR-006 |
| Environment configuration | ADR-007 |
| Error handling            | ADR-006 |
| Logging                   | ADR-008 |
| Nền tảng dùng chung (platform, PRJ): guard phiên và role, `email_verified` trong session context, audit, giới hạn tần suất, CSRF/CORS, `problem+json`, giao dịch, job nền, outbox, kho object, log che dữ liệu | ADR-012 |
| Phát event bền, phong bì event | ADR-011 |
| Job nền | ADR-013 |
| Giới hạn tần suất | ADR-014 |
| Băm mật khẩu | ADR-015 |
| Chống CSRF | ADR-016 |
| Idempotency-Key | ADR-017 |
| Ảnh và quyền truy cập | ADR-018 |
| Tìm kiếm sản phẩm | ADR-019 |
| Giao diện đọc cho tổng hợp | ADR-020 |
| Audit log | ADR-021 |
| Thời hạn lưu dữ liệu | ADR-022 |
| Định danh lỗi | ADR-023 |

## Nhật ký thay đổi nền

- 2026-10-06 | ADR-011, K-14, V-01 | Thêm ADR-011 phát event bền bằng outbox kèm phong bì event, hai event mang token thô ngoại lệ không qua outbox | lý do: 13 trong 14 epic (ORD, PAY, INV, CRT, CHK, REV, AUTH, NTF...) nêu bus in-process mất event khi tiến trình chết; AUTH, NTF phát hiện outbox sẽ vô tình lưu token thô | giải pháp: chọn A outbox cùng giao dịch, consumer chống trùng theo event_id; loại B phát đồng bộ trong giao dịch (consumer lỗi hỏng producer) và C đối soát từng cặp; token thô phát in-process best-effort
- 2026-10-06 | ADR-012, A-01, A-02, A-03, A-04, K-15 | Thêm ADR-012 (service nhận tx, thứ tự khóa, guard là interface ở platform), bảng "Giao diện module", dòng "Nền tảng dùng chung" ở Mối quan tâm cắt ngang, sửa cột Phụ thuộc (PRM bỏ PRD, NTF bỏ USR, SHP bỏ USR), ghi chiều gọi ngược chiều event hợp lệ | lý do: CHK, CRT, PRM, INV, SHP, ORD, PAY, NTF, DSH, REV, USR cần hợp đồng giao diện; check-tech-design báo lỗi khi epic khai PRJ hay AUTH cho guard; PRM, NTF, SHP khai phụ thuộc không dùng | giải pháp: chọn A truyền tx (khớp ADR-001, ADR-003); loại B saga và C CLS; bảng giao diện lấy theo khuyến nghị A-02 và các hàng khớp cột Phụ thuộc, đồ thị vẫn không có vòng; ORD, REV vẫn khai AUTH (A-03 không yêu cầu bỏ), AUTH, PRD vẫn khai PRJ
- 2026-10-06 | ADR-013, ADR-014 | Thêm ADR-013 job nền (bộ lập lịch trong ứng dụng cộng advisory lock) và ADR-014 kho đếm giới hạn tần suất (bảng PostgreSQL cho bậc A, B; bộ nhớ cho bậc C) | lý do: INV, CHK, CRT, PRM, PAY, NTF, PRJ, USR, REV cần chạy job một bản duy nhất; mọi endpoint cần giới hạn tần suất | giải pháp: chọn A cho job và B+C cho rate limit; loại Redis (D, A) vì không thêm hạ tầng ở v1, loại pg-boss, cron host
- 2026-10-06 | ADR-015, ADR-016, ADR-017 | Thêm ADR băm mật khẩu argon2id, chống CSRF bằng kiểm Origin cộng SameSite=Lax, Idempotency-Key bằng bảng chung | lý do: AUTH, USR (SB-01), PRJ, NTF (SB-13), INV, CHK, PAY, REV (thao tác ghi gửi lại) | giải pháp: chọn argon2id (loại bcrypt, scrypt), Origin (loại double-submit token), bảng chung (loại cột riêng từng module và chỉ dùng unique)
- 2026-10-06 | ADR-018, ADR-010, ADR-007 | Thêm ADR-018 (ảnh sản phẩm, 25 megapixel, re-encode, bỏ EXIF, truy cập công khai theo khóa ngẫu nhiên, dọn ảnh mồ côi) và bổ sung dòng Quyết định, Hệ quả của ADR-010; thêm RESERVATION_TTL và REVIEW_PRE_MODERATION vào cấu hình ở ADR-007 | lý do: PRD, USR, REV; ADR-010 thiếu ảnh sản phẩm và chính sách truy cập; K-01 đặt RESERVATION_TTL trong cấu hình | giải pháp: chọn truy cập công khai (loại URL ký vì nội dung vốn công khai)
- 2026-10-06 | ADR-019, ADR-020, ADR-021, ADR-022, ADR-023 | Thêm ADR tìm kiếm bằng PostgreSQL, giao diện đọc cho DSH cộng cache 60 giây, AuditLog ghi đồng bộ, bảng thời hạn lưu dữ liệu, `type` lỗi dạng URN | lý do: PRD (tìm kiếm), DSH (tổng hợp không đọc bảng chéo), PRJ và 11 epic ghi audit, USR, PAY, PRJ (hạn lưu), PRJ, ORD, PAY (type lỗi) | giải pháp: chọn pg_trgm (loại Meilisearch), đọc qua phương thức module (loại read model, đọc bảng trực tiếp), audit đồng bộ (loại qua outbox), URN (loại URL); không thêm ADR-024..026 (để backlog)
- 2026-10-06 | A-05, ADR-005, ADR-006, ADR-008 | Bổ sung ADR-005 điều khoản vận hành thanh toán (đường dẫn 10 phút, 3 lượt thử, hoàn tiền tự thử lại 3 lần, đối soát bằng API cổng, hoàn tiền tự động theo trạng thái Payment), ADR-006 (IPN ngoại lệ problem+json, trả RspCode; type URN), ADR-008 (nhật ký webhook 12 tháng, entity AuditLog) | lý do: PAY không tìm thấy chỗ ghi các điều khoản này trong nền | giải pháp: sửa dòng Quyết định và Hệ quả của ADR hiện có, không đổi quyết định gốc
- 2026-10-06 | A-06, K-01, K-02, ADR-009, ADR-001 | Làm rõ ADR-009: INV chạy hạn 15 phút (RESERVATION_TTL), Order có payment_expires_at chỉ đọc, hạn PAY nhỏ hơn hoặc bằng hạn đó, quy tắc một giao dịch thắng khi thanh toán đến sau hết hạn; ADR-001 ghi event phát bền qua outbox | lý do: INV, PAY, ORD, CHK mỗi epic hiểu đồng hồ hạn thanh toán một kiểu | giải pháp: giữ nguyên 15 phút (loại kéo dài hạn để đủ 3 lượt thử vì phải đổi ADR-004), muốn dài hơn thì đổi bằng ADR mới qua sdlc-impact
- 2026-10-06 | M-01, R-25, R-26, R-27, R-28 | Bảng Giao diện module: thay hàng USR -> AUTH bằng `updateProfile(full_name, phone, avatar_url)`, `getUser`, `changePassword`, `findCustomerById`, `findCustomerByEmail`, `listAvatarUrlsInUse`, `countCustomers`; thêm hàng INV -> PRD, REV -> PRD, REV -> AUTH (`getDisplayNames`); tách hàng DSH thành năm hàng tên chỉ định (ORD, PAY, PRD, INV, USR) | lý do: AUTH-API, USR-API, DSH-API, INV-API, REV-API dùng phương thức chưa có trong bảng và tự ghi "chưa là hợp đồng" (AUTH, USR, DSH, INV, REV) | giải pháp: thêm hàng làm hợp đồng, chiều gọi khớp cột Phụ thuộc (không cần phụ thuộc mới, đồ thị không vòng); R-10 chọn (b) cho REV chỉ qua `getDisplayNames`, KHÔNG thêm INV -> AUTH (INV để `actor.name` rỗng, chờ người quyết R-10), loại thêm AUTH vào Phụ thuộc của INV
- 2026-10-06 | M-02, R-29 | Ghi chữ ký vào bảng Giao diện module: `INV.reserve(order_id, items, expires_at, tx)`, `PRM.reserve(..., tx)`, `PRM.evaluate(..., count_attempt = true)` (CHK và CRT), `ORD.createPending(..., payment_expires_at, tx)` | lý do: CHK, CRT, PRM, INV, ORD hiểu chữ ký lệch nhau (`payment_method` lỗi thời, PRM `reserve` thiếu `tx`, `count_attempt` chỉ CRT, CHK đề nghị) | giải pháp: ghi đầy đủ chữ ký ở cột Phương thức và nói rõ đã là hợp đồng; dọn mục câu hỏi mở (OPEN) lỗi thời ở INV, CHK questions là việc của epic
- 2026-10-06 | M-08, R-30 | Cột Phụ thuộc: AUTH `PRJ` thành `-`; ORD giữ AUTH có chủ đích (hai khóa ngoại tới `users`), ghi vào Ghi chú cột Phụ thuộc | lý do: AUTH-API khai `depends_on: []`, ORD không gọi AUTH nhưng ORD-API, ORD-DB khai AUTH và khóa ngoại tới `users`; A-01 nói phần dùng chung không cần khai | giải pháp: AUTH bỏ PRJ theo A-01; ORD giữ (loại đổi hai khóa ngoại thành cột trơn vì buộc sửa ORD-DB, ORD-API đã duyệt hướng này); không có hàng ORD trong bảng giao diện, không tạo vòng (AUTH không phụ thuộc ai)
- 2026-10-06 | M-09, R-31 | ADR-014: gán kho đếm bậc D, E là bảng PostgreSQL (cùng bậc A, B), chỉ bậc C ở bộ nhớ; ghi hợp đồng đếm theo kết quả `check`, `hit` (chỉ khi sai), `reset` (khi thành công), khóa `usr:pwchange:<user_id>` cho đổi mật khẩu, giao diện đặt ở PRJ-API | lý do: DSH chọn bậc D bộ nhớ từng instance, PRJ chọn PostgreSQL cho D, E, PAY đề xuất PostgreSQL cho E; USR cần đếm theo kết quả | giải pháp: PostgreSQL cho D, E (loại bộ nhớ cho D để một cơ chế duy nhất; DSH phải đổi sang giao diện của PRJ, quản trị ít người nên tải đếm không đáng kể)
- 2026-10-06 | M-10, R-43 | ADR-021: nói rõ thao tác chỉ đọc (xem dashboard) ghi audit giao dịch riêng gộp mỗi người mỗi phút, lỗi audit không chặn việc xem (log `error`); `checkout.place_order` được audit cùng giao dịch; job, handler của `system` chỉ audit hủy và hoàn tiền tự động | lý do: ADR-021, SB-19 ghi "cùng giao dịch" nhưng xem dashboard không có giao dịch ghi; DSH chọn không chặn, CHK ghi `checkout.place_order`, PRM chọn không audit job hết hạn | giải pháp: theo ba lựa chọn đã có của DSH, CHK, PRM (loại chặn việc xem khi lỗi audit, loại audit mọi hành động của `system`)
- 2026-10-06 | M-04, R-02 | ADR-009: ORD nhận StockCommitFailed không đổi đơn đã đóng nhưng đơn `paid` thì hủy do hệ thống (`paid -> cancelled`, `stock_commit_failed`) | lý do: ghi chú cũ "ORD không đổi đơn đã đóng" làm đơn kẹt `paid` dù PAY đã hoàn `late_payment` (ORD, INV, PAY) | giải pháp: khớp entities.md, events.md đợt 2; loại no-op chờ admin
- 2026-10-06 | M-06, R-06 | ADR-005 thay "tối đa 3 lượt" cố định bằng `PAY_MAX_ATTEMPTS` (mặc định 3); ADR-007 thêm `PAY_MAX_ATTEMPTS` vào cấu hình | lý do: ADR-005 ghi cố định 3 còn PAY dùng `is_final = attempt_no >= PAY_MAX_ATTEMPTS` (PAY, NTF, ORD) | giải pháp: hằng số cấu hình mặc định 3 (loại giữ cố định vì PAY đã cấu hình hóa); các biến cấu hình khác của R-36 để backlog
- 2026-10-06 | M-10, R-43 (làm rõ đợt 2b) | Tách thao tác chỉ đọc thành hai loại: truy cập dữ liệu cá nhân của người khác (audit mỗi lần, lỗi audit thì không trả dữ liệu) và số liệu tổng hợp như dashboard (gộp mỗi phút, lỗi audit không chặn) | lý do: USR và SHP tự phát hiện SB-19, ADR-021 chỉ nêu ví dụ dashboard nên mâu thuẫn với SB-08 và K-16 (audit từng lần cho dữ liệu cá nhân) | giải pháp: nêu hai quy tắc tường minh theo K-16 gốc; loại phương án gộp mọi thao tác chỉ đọc vì sẽ cho phép trả dữ liệu cá nhân khi audit hỏng
- 2026-10-06 | M-04, R-28 (làm rõ đợt 2b) | Hàng DSH|PAY: định nghĩa lại cái trừ khỏi doanh thu thuần: chỉ Refund làm Payment sang `refunded` | lý do: DSH phát hiện câu cũ "`refunded` bỏ Refund late_payment" mâu thuẫn M-04 (Refund late_payment trên Payment `succeeded` đưa Payment sang `refunded`), làm doanh thu thuần tính cả khoản đã hoàn | giải pháp: phân biệt Payment `succeeded` (đã vào doanh thu, phải trừ) với Payment đã đóng hoặc giao dịch cổng trùng (chưa vào doanh thu, không trừ); loại phương án bỏ mọi late_payment vì sai tiền
