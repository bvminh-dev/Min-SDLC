# Quyết định nền cho dự án ecommerce (đề xuất của Claude, chờ bạn xác nhận)

Cập nhật: 2026-10-06. Đây là câu trả lời cho các mục `[OPEN]` ở ADR-001..010 và các câu hỏi ngoài ADR trong [HANDOFF.md](HANDOFF.md).
Khi chạy lại `sdlc-foundation` ở bước 2 (hỏi người dùng), đưa file này làm câu trả lời; skill sẽ ghi ADR `accepted` thay cho `proposed`. Việc đổi `status: approved` vẫn do bạn làm tay.

**Giả định chung (sai giả định nào thì đổi quyết định kéo theo):** đội nhỏ (2-5 người), thị trường Việt Nam (VND), chỉ web ở giai đoạn đầu, chưa có yêu cầu mở rộng ngang lớn.

| ADR | Quyết định | Vì sao (một dòng) | Đổi khi |
|---|---|---|---|
| 001 Triển khai | **Modular monolith**, mỗi epic một module, event giữa module qua in-process bus | CHK gọi 6 module; giữ hàng/thanh toán cần giao dịch nội bộ | một module cần scale riêng hoặc đội > 10 người |
| 002 Stack | **TypeScript**: NestJS (API) + Next.js (web tách riêng), một monorepo pnpm | NestJS ép cấu trúc module khớp ADR-001; một ngôn ngữ cho cả hai đầu | đội không biết TypeScript |
| 003 CSDL | **PostgreSQL**, migration bằng **Prisma Migrate**; giữ hàng bằng `UPDATE ... WHERE available >= n` trong giao dịch | khóa dòng và ràng buộc khóa ngoại chặn bán vượt tồn | không có |
| 004 Xác thực | **Session phía server**, cookie HttpOnly+Secure+SameSite=Lax, kho phiên trong PostgreSQL; hết hạn do không thao tác **30 phút**, tối đa 7 ngày | thu hồi tức thì; 30 phút > hạn giữ hàng 15 phút nên không mất phiên giữa lúc thanh toán | có app di động thì thêm token |
| 005 Thanh toán | **VNPay** (trang hosted, redirect) và **COD**; không lưu dữ liệu thẻ; webhook xác thực chữ ký + idempotent theo mã tham chiếu; chỉ hoàn tiền **toàn phần** ở v1 | hosted giữ phạm vi PCI ở mức thấp nhất; COD phổ biến ở VN | cần thẻ quốc tế thì thêm Stripe |
| 006 API | **REST JSON** `/api/v1`; lỗi theo `application/problem+json` kèm `trace_id`; phân trang `page`+`limit` (mặc định 20, tối đa 100) | đơn giản, test dễ; không có nhu cầu truy vấn linh hoạt kiểu GraphQL | client cần gộp nhiều nguồn |
| 007 Môi trường | **dev, staging, prod**; cấu hình bằng biến môi trường kiểm schema (zod) lúc khởi động, dừng nếu thiếu; bí mật lấy từ kho bí mật của nền tảng host, `.env` local nằm trong `.gitignore` | khớp SB-15, SB-16 | không có |
| 008 Log | **JSON log (pino) ra stdout** kèm `correlation_id`, gom về dịch vụ log của nền tảng host; giữ **30 ngày**; audit log lưu trong CSDL **12 tháng** | khớp SB-18, SB-19 | quy định yêu cầu lưu lâu hơn |
| 009 Giữ hàng | **Tạo Order `pending` trước, rồi reserve cùng giao dịch checkout**. Hạn giữ **15 phút** cho thanh toán online; COD không có hạn chờ (đơn vào `confirmed` ngay). INV giữ đồng hồ duy nhất: job của INV chạy mỗi phút, reservation hết hạn → `expired` + phát event; ORD nhận event rồi chuyển Order `expired` (đã sửa 2026-10-06 để khớp events.md) | khớp mô hình roadmap + StockReservation N-1 Order | thanh toán chuyển khoản hay quá 15 phút thì tăng (làm đúng ca `sdlc-impact/evals/reservation-ttl`) |
| 010 Tệp và email | **Object storage tương thích S3** (R2 hoặc S3) và **Amazon SES**. Avatar ≤ 2 MB; ảnh review ≤ 5 MB, tối đa 5 ảnh; chỉ JPEG/PNG/WebP, kiểm magic bytes, xử lý lại ảnh (re-encode) trước khi lưu | khớp SB-10; bền, không phải tự chạy SMTP | không có |

## Ngoài ADR

| Câu hỏi | Quyết định |
|---|---|
| Role staff | **Thêm role `staff`** (kho + chăm sóc khách hàng dùng chung một role). Quyền hẹp hơn admin: xem/cập nhật đơn, cập nhật kho, xem khách; **không** có doanh thu dashboard, coupon, hoàn tiền, đổi role. Hoàn tiền chỉ admin. |
| Xác minh email | **Có**: gửi link xác minh khi đăng ký; chưa xác minh thì xem hàng và dùng giỏ được nhưng **không đặt hàng**. |
| Order | `pending` → `paid` (online) hoặc `confirmed` (COD) → `shipped` → `delivered`; nhánh `cancelled`, `expired`. Trạng thái cuối: `delivered`, `cancelled`, `expired`. |
| Payment | `pending` → `processing` → `succeeded` \| `failed`; `failed` → `processing` (thử lại); `succeeded` → `refunded`; nhánh `expired`, `cancelled`. COD: `succeeded` khi giao thành công và thu tiền. Trạng thái cuối: `refunded`, `expired`, `cancelled`. |
| Shipment | `pending` → `shipped` → `delivered` \| `failed`; `failed` → `returned`; nhánh `cancelled` trước bàn giao. Trạng thái cuối: `delivered`, `returned`, `cancelled`. |

## Hệ quả cần biết
- Role mới `staff` kéo theo sửa `roles.md`, ma trận quyền và security baseline (SB-07 thêm dòng staff).
- `confirmed` là trạng thái mới của Order; `entities.md` và vòng đời chi tiết phải thêm, và `OrderConfirmed` hoặc tương đương cần một bên phát duy nhất (ORD).
- Phiên 30 phút (ADR-004) và giữ hàng 15 phút (ADR-009) được chọn cùng nhau: đổi một trong hai phải chạy `sdlc-impact`.
