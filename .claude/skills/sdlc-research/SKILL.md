---
name: sdlc-research
description: Biến một epic/tính năng trong roadmap thành requirement đầy đủ (user story + Given/When/Then + quy tắc nghiệp vụ), flow mermaid và ma trận role/permission, không làm vỡ nghiệp vụ đã có. Dùng khi bắt đầu nghiên cứu một epic hoặc tính năng mới, trước khi thiết kế.
---

# sdlc-research

Đầu vào: một epic trong `spec/roadmap.md` (xương cá). Đầu ra: requirement + flow + ma trận quyền trong `spec/`, đủ để các skill sau (design, test-design) làm tiếp mà không phải hỏi lại.

## Quy tắc cứng
- **ID do script sinh**, không tự đặt: `node .claude/skills/sdlc-research/scripts/new-id.mjs <EPIC> <TYPE>`. Xem `references/id-convention.md`.
- **Không sửa file đã có trạng thái `approved`, không tự đổi sang `approved`.** Hook chặn cả hai (`.claude/sdlc/hooks/guard-approved.mjs`). Muốn đổi thì tạo bản đề xuất mới và chạy skill `sdlc-impact`; việc duyệt do người làm.
- Mỗi requirement phải nêu **role nào được làm** và **liên kết tới requirement ở epic khác** mà nó chạm tới.

## Quy trình
0. **Nạp framework tham chiếu.** Đọc `.claude/sdlc/adapter/active.md`, rồi file `mapping` nó chỉ tới, dòng phase `research`. Đọc các file ở cột *Đọc* để lấy tiêu chí chất lượng và kỹ thuật hỏi làm rõ. Cột *Kit tự làm* là phần skill này tự chịu trách nhiệm. **Đầu ra theo `.claude/sdlc/contract.md`**, không theo định dạng file của framework. Không có đường dẫn framework nào được viết cứng trong skill này. Chạy `node .claude/sdlc/scripts/check-adapter.mjs`: nếu báo **file trong mapping không tồn tại** thì dừng và báo người dùng; nếu chỉ báo lệch tag/version thì tiếp tục nhưng nói rõ trong báo cáo cuối.
1. **Đọc bối cảnh.** Đọc `spec/roadmap.md`, `spec/domain/` (entity, event), `spec/permissions-matrix.md`, các requirement đã có của epic liên quan. Thiếu domain model thì dừng và báo cần chạy foundation.
2. **Xác định ranh giới epic.** Liệt kê các mục con của epic từ roadmap, và các epic mà nó đọc/ghi dữ liệu hoặc kích hoạt (ví dụ Checkout chạm Cart, Promotion, Inventory, Shipping, Payment, Order).
3. **Hỏi người dùng** những điểm mơ hồ về nghiệp vụ (tối đa 5 câu, dạng lựa chọn). Không tự bịa quy tắc nghiệp vụ. Điểm nào phụ thuộc epic chưa có spec thì đánh dấu `[NEEDS CLARIFICATION]` trong requirement thay vì đoán.
4. **Vẽ flow**: một flow chính cho cả epic dạng mermaid (`templates/flow.md`), gồm nhánh lỗi. Flow lộ ra chỗ thiếu requirement.
5. **Viết requirement** theo `templates/requirement.md`, mỗi requirement một file. Mỗi cái có Given/When/Then cho luồng chính, ít nhất một luồng lỗi và một ca biên.
6. **Cập nhật ma trận role/permission** theo `templates/permission-matrix.md`. Hành động mới thì thêm dòng; không đổi quyền của dòng cũ mà không ghi vào mục Thay đổi. Khi một role đang bị tranh cãi (ví dụ guest), `roles` của requirement ghi theo **ma trận hiện hành**; đề xuất đổi đưa vào `Xung đột` và vào bảng Thay đổi với người duyệt "chưa duyệt".
7. **Kiểm tra va chạm.** Với mỗi requirement mới, đối chiếu quy tắc nghiệp vụ với requirement đã có. Mâu thuẫn thì ghi vào `Xung đột` dạng `[OPEN] <ID bị va chạm>: <câu hỏi>` và hỏi người dùng, không tự chọn bên nào. Có câu trả lời thì đổi thành `[RESOLVED]` kèm quyết định. Nếu không hỏi trực tiếp được (chạy tự động), chép các câu hỏi vào `questions.md`.
8. **Kiểm hình thức** do hook tự chạy sau mỗi lần sửa file spec và khi kết thúc. Hook báo lỗi thì sửa; không cần gọi `check-spec.mjs` thủ công (trừ khi chạy ngoài môi trường có hook: `node .claude/skills/sdlc-research/scripts/check-spec.mjs spec/`).
9. **Báo cáo** ngắn: đã tạo gì, xung đột nào còn mở, epic nào bị ảnh hưởng (chuyển sang `sdlc-impact` nếu có).

## Đầu ra
```
spec/epics/<EPIC>/requirements/<ID>.md
spec/epics/<EPIC>/flows/<FLOW-ID>.md
spec/permissions-matrix.md
spec/epics/<EPIC>/questions.md      (chỉ khi không hỏi trực tiếp được người dùng)
```

## Kiểm thử skill
Xem `evals/README.md`. Golden case và ca gài bẫy cho epic Checkout nằm trong `evals/checkout/`.
