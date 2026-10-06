---
name: sdlc-impact
description: Phân tích tác động khi một requirement, flow hoặc quyền trong spec/ thay đổi. Liệt kê requirement, flow, test case, ma trận quyền bị ảnh hưởng và đề xuất việc cần dựng lại. Dùng mỗi khi sửa spec đã có hoặc khi sdlc-research phát hiện chạm epic khác.
---

# sdlc-impact

Đầu vào: một thay đổi (ID nào, đổi gì, vì sao). Đầu ra: báo cáo tác động và danh sách việc cần làm, **không tự sửa** các file bị ảnh hưởng.

## Quy trình
0. **Nạp framework tham chiếu.** Đọc `.claude/sdlc/adapter/active.md` và dòng phase `impact` trong file mapping; lấy cách xếp mức nghiêm trọng từ các file ở cột *Đọc*. Truy vết theo ID và phân loại là phần của kit. Đầu ra theo `.claude/sdlc/contract.md`.
1. **Khoanh vùng tín hiệu cứng bằng script** trước khi suy luận:
   `node .claude/skills/sdlc-impact/scripts/find-refs.mjs spec/ <ID>`
   Script liệt kê mọi file có `links` hoặc `covers` trỏ tới ID đó, và các file nhắc ID trong thân.
2. **Mở rộng bằng suy luận** những thứ liên kết không bắt được: cùng entity (xem `spec/domain/`), cùng domain event, cùng dòng trong ma trận quyền, cùng quy tắc nghiệp vụ.
3. **Phân loại từng mục bị ảnh hưởng:**
   - `phải dựng lại`: nghiệp vụ hoặc flow hết đúng.
   - `cần xem lại`: có thể đúng, cần người xác nhận.
   - `không đổi`: có liên kết nhưng không bị tác động (nói rõ vì sao).
4. **Nêu rõ điều không chắc.** Chưa có spec của epic bị chạm thì ghi là "chưa có spec, rủi ro", không đoán.
5. **Ghi báo cáo** vào `spec/changes/<ID>.md` (`<ID>` là ID của tài liệu bị đổi) theo bảng dưới, rồi chạy `node .claude/skills/sdlc-impact/scripts/check-impact.mjs spec/` (hook cũng tự chạy). Script kiểm khuôn bảng, tên file, giá trị Loại/Mức, và **mọi tài liệu có `links`/`covers` tới ID đều phải có dòng** (không bị tác động thì ghi `không đổi` kèm lý do). Trả lại danh sách việc cho người duyệt.

## Mẫu báo cáo
| ID bị ảnh hưởng | Loại | Mức | Lý do | Việc cần làm |
|---|---|---|---|---|

- **ID bị ảnh hưởng**: ID tài liệu trong `spec/`, hoặc đường dẫn file `spec/...` (ma trận quyền, domain).
- **Loại**: đúng một trong `phải dựng lại`, `cần xem lại`, `không đổi`.
- **Mức**: `CRITICAL`, `HIGH`, `MEDIUM`, `LOW` theo cách xếp của framework tham chiếu, hoặc `-` khi `không đổi`.
- **Việc cần làm**: bắt buộc trừ khi `không đổi`.

## Quy tắc
- Không sửa file `approved`. Đề xuất thay đổi, chờ người duyệt.
- Báo thêm các test case (`TC`, `E2E`) cần viết lại, vì chúng cũng là phần của spec.
