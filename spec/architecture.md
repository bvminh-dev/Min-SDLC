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
- Quyết định: A modular monolith, mỗi epic một module, event giữa module đi qua in-process bus.
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
- Quyết định: VNPay (redirect tới trang hosted) và COD; không lưu số thẻ, CVV; webhook xác thực chữ ký, chống phát lại, idempotent theo mã tham chiếu; ở v1 chỉ hoàn tiền toàn phần.
- Hệ quả: phạm vi PCI thấp nhất nhưng phụ thuộc nhà cung cấp. COD: đơn vào `confirmed` ngay, Payment `succeeded` khi giao thành công và thu tiền. Cần thẻ quốc tế thì thêm cổng bằng ADR mới.

### ADR-006 Cấu trúc API và xử lý lỗi

- Trạng thái: accepted
- Bối cảnh: PRJ cần API structure và Error handling dùng chung cho mọi module.
- Phương án: A REST JSON có tiền tố phiên bản, B GraphQL. Loại B vì chưa có nhu cầu truy vấn linh hoạt và test phức tạp hơn.
- Quyết định: REST JSON `/api/v1`; lỗi theo `application/problem+json` kèm `trace_id`; phân trang `page` và `limit` (mặc định 20, tối đa 100).
- Hệ quả: client và test đơn giản; đổi định dạng lỗi sau này là thay đổi phá vỡ hợp đồng.

### ADR-007 Cấu hình môi trường và quản lý bí mật

- Trạng thái: accepted
- Bối cảnh: PRJ cần Environment configuration; có khóa cổng thanh toán, thông tin DB, khóa ký.
- Phương án: A biến môi trường kiểm schema khi khởi động, bí mật từ kho bí mật của nền tảng host, B file cấu hình trong repo. Loại B vì lộ bí mật.
- Quyết định: ba môi trường dev, staging, prod; biến môi trường kiểm schema (zod), dừng nếu thiếu; bí mật lấy từ kho bí mật của nền tảng host; `.env` local nằm trong `.gitignore`.
- Hệ quả: fail-fast khi thiếu cấu hình (SB-16); đánh đổi là cần quy trình cấp bí mật cho từng môi trường.

### ADR-008 Logging và quan sát

- Trạng thái: accepted
- Bối cảnh: PRJ cần Logging; cần truy vết đơn/thanh toán và audit, không để lộ dữ liệu nhạy cảm.
- Phương án: A log JSON có correlation id và che dữ liệu nhạy cảm, B log văn bản tự do. Loại B vì khó truy vết.
- Quyết định: log JSON (pino) ra stdout kèm `correlation_id`, gom về dịch vụ log của nền tảng host, giữ 30 ngày; audit log lưu trong CSDL 12 tháng.
- Hệ quả: truy vết chéo module dễ; cần quy ước trường log và bộ lọc che dữ liệu (SB-18). Quy định yêu cầu lưu lâu hơn thì tăng thời gian giữ.

### ADR-009 Thứ tự giữ hàng và tạo đơn

- Trạng thái: accepted
- Bối cảnh: roadmap CHK đặt "Reserve stock" trước "Create order", nhưng StockReservation gắn với Order (N-1 Order).
- Phương án: A tạo Order `pending` trước rồi giữ hàng trong cùng giao dịch checkout, B giữ hàng gắn với CheckoutSession rồi chuyển sang đơn. Loại B vì thêm một loại liên kết.
- Quyết định: A; hạn giữ hàng 15 phút cho thanh toán online, COD không có hạn chờ (đơn vào `confirmed` ngay). INV giữ đồng hồ duy nhất: job của INV chạy mỗi phút, reservation quá hạn chuyển `expired` rồi phát StockReservationExpired; ORD nhận event đó và chuyển Order sang `expired` (phát OrderExpired cho PAY, PRM).
- Hệ quả: quan hệ rõ với đơn, hủy hoặc hết hạn đơn tự nhả hàng; có đơn pending bị bỏ dở cần job dọn. Thanh toán chuyển khoản hay quá 15 phút thì tăng hạn qua sdlc-impact.

### ADR-010 Lưu trữ tệp và gửi email

- Trạng thái: accepted
- Bối cảnh: USR upload avatar, REV upload ảnh, NTF gửi email (gồm email xác minh đăng ký).
- Phương án: A object storage tương thích S3 và Amazon SES, B lưu đĩa cục bộ và SMTP tự chạy. Loại B vì khó mở rộng và dễ lọt thư rác.
- Quyết định: A; avatar tối đa 2 MB, ảnh review tối đa 5 MB và 5 ảnh mỗi review; chỉ JPEG, PNG, WebP; kiểm magic bytes và xử lý lại ảnh trước khi lưu.
- Hệ quả: bền, mở rộng được; chi phí và phụ thuộc nhà cung cấp (SB-10 áp dụng).

## Ánh xạ epic → module

Cột Phụ thuộc: mã epic mà module này gọi trực tiếp, cách nhau bởi dấu phẩy, hoặc `-`. Không được có vòng phụ thuộc.
Liên lạc ngược chiều (ví dụ PAY báo ORD) đi qua domain event trong `domain/events.md`, không tính là phụ thuộc gọi trực tiếp.

| Epic | Module       | Phụ thuộc                    |
| ---- | ------------ | ---------------------------- |
| PRJ  | platform     | -                            |
| AUTH | auth         | PRJ                          |
| USR  | user         | AUTH                         |
| PRD  | catalog      | PRJ                          |
| INV  | inventory    | PRD                          |
| CRT  | cart         | PRD, INV, PRM, SHP           |
| PRM  | promotion    | PRD                          |
| CHK  | checkout     | CRT, USR, PRM, INV, SHP, ORD |
| ORD  | order        | AUTH                         |
| PAY  | payment      | ORD                          |
| SHP  | shipping     | ORD, USR                     |
| NTF  | notification | AUTH, USR                    |
| REV  | review       | PRD, ORD, AUTH               |
| DSH  | dashboard    | ORD, PRD, INV, USR, PAY      |

## Mối quan tâm cắt ngang

Mỗi dòng trỏ về một ADR đã viết ở trên.

| Mối quan tâm              | ADR     |
| ------------------------- | ------- |
| Project setup             | ADR-002 |
| Database                  | ADR-003 |
| API structure             | ADR-006 |
| Environment configuration | ADR-007 |
| Error handling            | ADR-006 |
| Logging                   | ADR-008 |
