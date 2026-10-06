# Kết quả chạy eval sdlc-tech-design (2026-10-06)

Ca `ordering` (ORD, INV). **Một lần chạy có skill, không có đối chứng prompt trần** (README yêu cầu 3 + 2). Chấm bằng grep trên đầu ra, không có subagent độc lập. Chỉ đủ để nói skill chạy được, chưa đủ để kết luận về chất lượng.

## Kiểm cứng
- `check-tech-design.mjs --strict` và `check-spec.mjs`: qua ngay lần đầu (6 tài liệu thiết kế).
- Không file nào của fixture bị sửa (md5).
- ID do `new-id.mjs` sinh.

## Golden / bẫy
| Mục | Kết quả |
|---|---|
| G1 đủ DB/API/SEC cho cả hai epic | có |
| G2 trạng thái DB khớp vòng đời | có (script) |
| G3 role endpoint, 404 cho đơn người khác | có; staff không có endpoint hủy |
| G4 hủy đơn nhả hàng bằng event | có (`emits OrderCancelled`, INV `consumes`); riêng việc nhả hàng **đồng bộ trong giao dịch của ORD** được ghi `[OPEN]` |
| G5 giữ hàng nguyên tử | có (`UPDATE ... WHERE on_hand - reserved >= n`, CHECK, khóa theo thứ tự, job `SKIP LOCKED`) |
| G6 SEC: IDOR, staff vượt quyền, audit, bán vượt | có (SB-06, SB-05/07, SB-19, SB-25) |
| G7 PAY chưa có spec | có: `[OPEN]`, không thiết kế bảng/endpoint PAY |
| H1 ORD chỉ phụ thuộc AUTH | bắt: `depends_on: [AUTH]` |
| H2 INV cần đơn pending nhưng không gọi được ORD | **bắt một phần**: không thêm phụ thuộc, không khóa ngoại sang `orders`, ghi `[OPEN]` về toàn vẹn; chưa nói rõ điều kiện "pending" do ai bảo đảm |
| H3 event đúng bên | bắt (script) |
| H4 staff không hủy đơn | bắt |
| H6 sửa file approved | không |

## Phát hiện có giá trị ngoài rubric (đáng người đọc)
Skill tự nêu lệch giữa các tài liệu nền; phần lớn là lệch thật ở `spec/` và đã được sửa ngày 2026-10-06 (xem HANDOFF.md). Fixture giữ bản nền cũ:
- ADR-009 nói job "Order `expired` rồi release", trong khi `events.md` để INV hết hạn reservation rồi phát event cho ORD.
- `entities.md` ghi Order `shipped` khi Shipment shipped (SHP), còn ORD-02 cho staff tự chuyển (lệch này do requirement ORD-02 của fixture, không phải nền thật).
- `StockReservation` thiếu cột `status`; hủy đơn đã `committed` không có đường cộng lại `on_hand`.
- Order thiếu `payment_method`/`payment_status`; `StockMovement` thiếu `actor_id`.

## Hạn chế
Một lần chạy; một ca; chấm bằng grep; chưa so với prompt trần nên chưa biết skill hơn gì (theo bài học research/impact, nhiều khả năng giá trị nằm ở script).

## Vòng 2 (2026-10-06): 3 lần có skill + 2 lần prompt trần, chấm bởi subagent độc lập
Chi tiết: `/tmp/eval2/grade-td.md` (không lưu trong repo).

| | td1 | td2 | td3 | trần 1 | trần 2 |
|---|---|---|---|---|---|
| Qua `check-tech-design --strict` + `check-spec` (lúc chạy) | ✓ | ✓ | ✓ | ✓ | ✓ |
| G1-G7, S1-S2, H1, H3-H6 | đạt | đạt | đạt | đạt | đạt |
| H2 (INV cần đơn pending, không gọi ORD) | một phần | có | có (sạch) | có | có |
| Endpoint ORD+INV / mối đe dọa | 8 / 27 | 10 / 30 | 9 / 20 | 8 / 35 | 9 / 26 |
| **FK chéo module trái kiến trúc** (kiểm sau) | không | **có, im lặng** | có (1, `users`) | có, ghi `[OPEN]` | có, ghi `[OPEN]` |
| SB-08 (staff thấy địa chỉ) nêu mâu thuẫn | có | không | không (tự mâu thuẫn SEC/API) | có | có |

- **Ngang nhau ở phần lớn rubric**, giống kết quả research/impact: phân tích bám ADR tốt dù có hay không có skill (ORD chỉ `depends_on` AUTH, nhả hàng qua event, bán vượt chặn bằng `UPDATE ... WHERE`, staff không hủy đơn, PAY không bịa).
- **Lỗ hổng thật do eval phát hiện**: khóa ngoại cấp CSDL chéo module (INV -> orders, ORD -> products) là phụ thuộc ngầm mà `depends_on` không thấy; 4/5 lần có (cả skill lẫn trần), tdb1/tdb2 tự ghi `[OPEN]`, td2 im lặng. Đã thêm kiểm cứng vào `check-tech-design.mjs` (kèm test); chạy lại trên 5 đầu ra cũ bắt 4/5.
- Khác biệt skill vs trần: không rõ. Trần chi tiết hơn (26-35 mối đe dọa) và tự phê bình rõ hơn; skill gọn hơn. Mẫu 3+2.
- Hạn chế: chấm S3 (báo cáo P1-P7) không làm được vì nằm ở câu trả lời cuối không lưu file.
