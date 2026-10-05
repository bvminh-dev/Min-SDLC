---
status: draft
---
# Kiến trúc nền

Không hỏi được người dùng nên mọi quyết định công nghệ/kiến trúc ở đây đều `proposed` kèm `[OPEN]`. "Khuyến nghị tạm" chỉ là gợi ý, chưa phải quyết định.

## Quyết định (ADR)

### ADR-001 Kiểu triển khai
- Trạng thái: proposed
- Bối cảnh: 14 epic, nhiều phụ thuộc chéo (CHK gọi CRT, INV, PRM, PAY, ORD, SHP); chưa rõ quy mô đội và tải.
- Phương án: A modular monolith (một đơn vị triển khai, module tách theo epic), B tách dịch vụ theo epic. Loại B ở giai đoạn đầu vì chi phí vận hành và giao dịch phân tán cho luồng giữ hàng/thanh toán. Khuyến nghị tạm: A.
- Quyết định: chưa chọn, chờ người quyết định. [OPEN] Triển khai modular monolith hay tách dịch vụ?
- Hệ quả: A giúp giao dịch nhất quán đơn giản và triển khai nhanh, đánh đổi là ranh giới module chỉ được giữ bằng kỷ luật code; event giữa module dùng in-process bus, có thể tách dịch vụ sau.

### ADR-002 Stack và cấu trúc dự án
- Trạng thái: proposed
- Bối cảnh: chưa có ngôn ngữ, framework, công cụ build; epic PRJ cần Project setup.
- Phương án: các stack web phổ biến (ví dụ TypeScript/Node, Java/Spring, Python/Django); chưa loại phương án nào vì thiếu ràng buộc đội ngũ.
- Quyết định: chưa chọn, chờ người quyết định. [OPEN] Dùng ngôn ngữ và framework nào, có frontend tách riêng không?
- Hệ quả: quyết định này chi phối công cụ test, hook kiểm bảo mật và thiết kế ở các skill sau; chọn muộn làm chậm epic PRJ.

### ADR-003 Cơ sở dữ liệu
- Trạng thái: proposed
- Bối cảnh: dữ liệu quan hệ mạnh (đơn, thanh toán, kho) cần giao dịch ACID và ràng buộc khóa ngoại; cần tránh bán vượt tồn kho.
- Phương án: A cơ sở dữ liệu quan hệ (PostgreSQL/MySQL), B NoSQL tài liệu. Loại B vì giao dịch đa bảng cho kho và đơn khó đảm bảo. Khuyến nghị tạm: A.
- Quyết định: chưa chọn, chờ người quyết định. [OPEN] Chọn hệ quản trị CSDL nào và cách migration?
- Hệ quả: A cho ràng buộc toàn vẹn và khóa dòng khi giữ hàng, đánh đổi là mở rộng ghi ngang khó hơn.

### ADR-004 Xác thực và phiên
- Trạng thái: proposed
- Bối cảnh: AUTH có Register, Login, Logout, Session/Token, Forgot/Reset password; Session là entity có thể thu hồi.
- Phương án: A session phía server (cookie HttpOnly), B token JWT ngắn hạn kèm refresh token. Loại tạm B không refresh vì không thu hồi được. Khuyến nghị tạm: A nếu chỉ có web.
- Quyết định: chưa chọn, chờ người quyết định. [OPEN] Dùng session hay token, có app di động không?
- Hệ quả: A thu hồi phiên tức thì nhưng cần kho phiên; B dễ mở rộng nhiều client nhưng cần quản lý refresh và danh sách thu hồi.

### ADR-005 Cổng thanh toán và tuân thủ
- Trạng thái: proposed
- Bối cảnh: PAY có callback/webhook, retry, refund; dữ liệu thẻ và tiền thuộc phạm vi tuân thủ.
- Phương án: A dùng cổng bên thứ ba có trang thanh toán hosted (không lưu dữ liệu thẻ), B tự xử lý thẻ. Loại B vì kéo theo PCI DSS đầy đủ. Khuyến nghị tạm: A.
- Quyết định: chưa chọn, chờ người quyết định. [OPEN] Cổng thanh toán nào, phương thức nào, có yêu cầu tuân thủ nào (PCI DSS, thuế, lưu hóa đơn)?
- Hệ quả: A giảm phạm vi tuân thủ nhưng phụ thuộc nhà cung cấp; webhook phải xác thực chữ ký và idempotent.

### ADR-006 Cấu trúc API và xử lý lỗi
- Trạng thái: proposed
- Bối cảnh: PRJ cần API structure và Error handling dùng chung cho mọi module.
- Phương án: A REST JSON có tiền tố phiên bản và định dạng lỗi chuẩn (mã lỗi, thông điệp, trace id), B GraphQL. Chưa loại B hoàn toàn. Khuyến nghị tạm: A.
- Quyết định: chưa chọn, chờ người quyết định. [OPEN] REST hay GraphQL, định dạng lỗi và phân trang thống nhất ra sao?
- Hệ quả: định dạng lỗi thống nhất giúp client và test đơn giản; đổi sau này là thay đổi phá vỡ hợp đồng.

### ADR-007 Cấu hình môi trường và quản lý bí mật
- Trạng thái: proposed
- Bối cảnh: PRJ cần Environment configuration; có khóa cổng thanh toán, thông tin DB, khóa ký.
- Phương án: A biến môi trường kèm schema kiểm tra khi khởi động, bí mật từ kho bí mật của nền tảng; B file cấu hình trong repo. Loại B vì lộ bí mật. Khuyến nghị tạm: A.
- Quyết định: chưa chọn, chờ người quyết định. [OPEN] Môi trường nào (dev, staging, prod) và kho bí mật nào?
- Hệ quả: fail-fast khi thiếu cấu hình; đánh đổi là cần quy trình cấp bí mật cho từng môi trường.

### ADR-008 Logging và quan sát
- Trạng thái: proposed
- Bối cảnh: PRJ cần Logging; cần truy vết đơn/thanh toán và audit, không để lộ dữ liệu nhạy cảm.
- Phương án: A log có cấu trúc JSON kèm correlation id và che dữ liệu nhạy cảm, B log văn bản tự do. Loại B vì khó truy vết. Khuyến nghị tạm: A.
- Quyết định: chưa chọn, chờ người quyết định. [OPEN] Nơi tập trung log và thời gian lưu?
- Hệ quả: A dễ truy vết chéo module; đánh đổi là cần quy ước trường log và bộ lọc che dữ liệu.

### ADR-009 Thứ tự giữ hàng và tạo đơn
- Trạng thái: proposed
- Bối cảnh: roadmap CHK đặt "Reserve stock" trước "Create order", nhưng StockReservation gắn với Order (N-1 Order).
- Phương án: A tạo Order trạng thái pending trước rồi giữ hàng trong cùng giao dịch checkout; B giữ hàng gắn với CheckoutSession rồi chuyển sang đơn. Loại B vì thêm một loại liên kết. Khuyến nghị tạm: A.
- Quyết định: chưa chọn, chờ người xác nhận. [OPEN] Xác nhận tạo đơn pending trước rồi giữ hàng, và thời hạn giữ hàng là bao lâu?
- Hệ quả: A giữ quan hệ rõ ràng với đơn, hủy/hết hạn đơn tự nhả hàng; đánh đổi là có đơn pending bị bỏ dở cần job dọn.

### ADR-010 Lưu trữ tệp và gửi email
- Trạng thái: proposed
- Bối cảnh: USR upload avatar, REV upload ảnh, NTF gửi email; chưa có dịch vụ nào được chọn.
- Phương án: A object storage và dịch vụ email bên thứ ba, B lưu đĩa cục bộ và SMTP tự chạy. Loại B vì khó mở rộng và dễ lọt thư rác. Khuyến nghị tạm: A.
- Quyết định: chưa chọn, chờ người quyết định. [OPEN] Dịch vụ lưu tệp và gửi email nào, giới hạn kích thước/định dạng tệp?
- Hệ quả: A bền và mở rộng được, đánh đổi là chi phí và phụ thuộc nhà cung cấp; cần quét loại tệp tải lên.

## Ánh xạ epic → module

Cột Phụ thuộc: mã epic mà module này gọi trực tiếp, cách nhau bởi dấu phẩy, hoặc `-`. Không được có vòng phụ thuộc.
Liên lạc ngược chiều (ví dụ PAY báo ORD) đi qua domain event trong `domain/events.md`, không tính là phụ thuộc gọi trực tiếp.

| Epic | Module | Phụ thuộc |
|---|---|---|
| PRJ | platform | - |
| AUTH | auth | PRJ |
| USR | user | AUTH |
| PRD | catalog | PRJ |
| INV | inventory | PRD |
| CRT | cart | PRD, INV, PRM, SHP |
| PRM | promotion | PRD |
| CHK | checkout | CRT, USR, PRM, INV, SHP, ORD |
| ORD | order | AUTH |
| PAY | payment | ORD |
| SHP | shipping | ORD, USR |
| NTF | notification | AUTH, USR |
| REV | review | PRD, ORD, AUTH |
| DSH | dashboard | ORD, PRD, INV, USR, PAY |

## Mối quan tâm cắt ngang

Mỗi dòng trỏ về một ADR đã viết ở trên.

| Mối quan tâm | ADR |
|---|---|
| Project setup | ADR-002 |
| Database | ADR-003 |
| API structure | ADR-006 |
| Environment configuration | ADR-007 |
| Error handling | ADR-006 |
| Logging | ADR-008 |
