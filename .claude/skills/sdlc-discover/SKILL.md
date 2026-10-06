---
name: sdlc-discover
description: Từ một ý tưởng sản phẩm, khảo sát sản phẩm tương tự và lập roadmap xương cá (danh sách epic, mỗi epic có mục con) thành spec/roadmap.md. Dùng đầu tiên cho dự án mới, trước sdlc-foundation.
---

# sdlc-discover

Đầu vào: ý tưởng sản phẩm của người dùng. Đầu ra theo `.claude/sdlc/contract.md`: `spec/roadmap.md`, bảng cột `STT | Mã | Epic | Mục con`, mã epic 2-4 chữ in hoa. Roadmap là nguồn mã epic cho mọi ID về sau, nên đặt mã cẩn thận: đổi mã sau này là thay đổi lan rộng (chạy `sdlc-impact`).

## Quy tắc cứng
- **Chỉ ghi `status: draft`.** Người duyệt đổi sang `approved` (hook chặn Claude tự làm).
- **Không bịa tính năng không có nguồn.** Mục con phải đến từ một trong: yêu cầu của người dùng, khảo sát có nguồn (ghi URL hoặc tên sản phẩm), hoặc suy ra bắt buộc từ mục khác (ghi rõ là suy ra). Điều chưa chắc ghi vào mục *Giả định và câu hỏi mở*, không nhét vào bảng.
- **Mã epic không đổi** sau khi `spec/` đã có tài liệu dùng nó. Roadmap đã `approved` thì dừng và chạy `sdlc-impact`.

## Quy trình
0. **Nạp framework tham chiếu.** Đọc `.claude/sdlc/adapter/active.md` và dòng phase `discover` trong file mapping. Phase này framework không phủ; toàn bộ do skill.
1. **Hỏi người dùng** (tối đa 5 câu, dạng lựa chọn, có khuyến nghị): sản phẩm cho ai và giải quyết gì; phạm vi bản đầu (v1) và điều **chắc chắn không làm**; sản phẩm tương tự để tham chiếu; thị trường/ràng buộc (ngôn ngữ, tiền tệ, quy định); quy mô đội và thời gian. Không hỏi được thì ghi giả định vào mục *Giả định và câu hỏi mở*.
2. **Khảo sát**: với 2-3 sản phẩm tương tự (người dùng nêu, hoặc tìm bằng công cụ web nếu có), liệt kê nhóm tính năng chuẩn của loại sản phẩm này. Ghi nguồn. Không có công cụ web thì nói rõ khảo sát dựa trên kiến thức chung, chưa kiểm chứng.
3. **Dựng roadmap xương cá**:
   - Epic 01 là nền kỹ thuật (mã `PRJ`: project setup, database, API structure, cấu hình, lỗi, log).
   - Thứ tự theo phụ thuộc: nền, định danh, dữ liệu lõi, luồng nghiệp vụ chính, phần phụ (thông báo, báo cáo).
   - Mỗi epic 4-10 mục con, mỗi mục con là một khả năng người dùng hoặc hệ thống làm được (động từ + danh từ). Epic quá 10 mục con thì tách; dưới 3 thì gộp.
   - Mã epic: 2-4 chữ in hoa dễ nhớ (AUTH, ORD...), không trùng.
4. **Ghi `spec/roadmap.md`** theo `templates/roadmap.md`: bảng, rồi mục *Nguồn khảo sát* và *Giả định và câu hỏi mở*. Hook chạy `check-foundation.mjs` kiểm bảng (cột, mã epic, trùng mã); sửa theo thông báo.
5. **Báo cáo**: số epic, epic nào ít chắc chắn nhất (dựa giả định), mục con suy ra thay vì có nguồn, câu hỏi cần người quyết trước khi duyệt.

## Chưa làm
- Chưa có script kiểm chất lượng nội dung roadmap (cỡ epic, mục con mơ hồ): cần người đọc. Phần hình thức do `check-foundation.mjs`.
- Chưa có eval.
