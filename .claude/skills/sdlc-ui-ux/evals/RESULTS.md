# Kết quả chạy eval sdlc-ui-ux (2026-10-06)

Ca `ordering` (ORD, INV). **Một lần chạy có skill, không có đối chứng prompt trần.** Chấm bằng grep, không có subagent độc lập. Chỉ đủ để nói skill chạy được.

## Kiểm cứng
- `check-ui.mjs --epic ORD` và `--epic INV`: qua (6 màn, 87 testid). `testids.md` do script sinh.
- Không file nào của fixture bị sửa (md5).
- Phát hiện **lỗi script** khi chạy: bảng Trạng thái 3 cột nhưng script đọc cột thứ 4 nên không kiểm Requirement. Đã sửa và thêm test.

## Golden / bẫy
| Mục | Kết quả |
|---|---|
| G1 màn cho ORD-01/02/03, INV-05 | có (6 màn) |
| G2 role tách đúng | có (script); customer riêng, staff/admin riêng |
| G3 trạng thái lấy từ Given/When/Then | có; thêm nhiều trạng thái không truy được về requirement (đang tải, rỗng...) và tự liệt kê chúng trong báo cáo |
| G5 ghi phương án wireframe và lý do, ghi mặc định khi không hỏi được | có (3 phương án mỗi màn, chọn A, ghi là mặc định) |
| G6 INV-04 không có màn | có |
| S1 hoàn tiền chỉ thông báo | có (`ord-order-detail-refund-note`) |
| S2 cảnh báo màn phía người mua | có |
| U1 staff không hủy đơn | **đạt một phần**: dùng chung màn staff/admin, nút Hủy ghi "chỉ admin". Script không kiểm được quyền theo từng phần tử |
| U5 testids.md viết tay | không |

## Phát hiện
- Chọn phương án A cho cả 6 màn: có dấu hiệu "chọn khuyến nghị cho xong" khi không có người chọn; cổng chọn wireframe không được thử thật.
- INV-04 ghi `roles: [customer]` dù do hệ thống làm: lệch ở spec nguồn, skill đã nêu.

## Việc còn lại
- Thêm cột role vào bảng Phần tử để script kiểm hiển thị theo quyền (lỗ hổng U1).
- Chạy đủ 3 lần có skill + 2 lần trần.

## Vòng 2 (2026-10-06): 3 lần có skill + 2 lần prompt trần, chấm bởi subagent độc lập
Chi tiết: `/tmp/eval2/grade-ui.md` (không lưu trong repo). Sau khi script thêm kiểm role từng phần tử.

| | ui1 | ui2 | ui3 | trần 1 | trần 2 |
|---|---|---|---|---|---|
| Qua `check-ui.mjs` | ✓ | ✓ | ✓ | ✓ | ✓ |
| Số màn / testid | 4/73 | 4/51 | 5/43 | 5/70 | 7/75 |
| G6 INV-04 không dựng màn | có (ghi rõ) | một phần (không dựng, không ghi) | một phần | **không: dựng màn `giu-hang`** | một phần |
| G5 phương án wireframe + lý do + ghi mặc định | đủ nhất | có | có | có, không ghi mặc định | yếu nhất |
| S2 báo skill evon chưa dạy màn người mua | không | không | có | không | không |
| U1 staff không có nút Hủy | đạt | đạt | đạt | đạt | đạt |
| U3 INV-04 không phải màn | đạt | đạt | đạt | **rớt** | đạt |
| U4 hoàn tiền chỉ ghi chú | đạt | đạt | đạt | đạt | đạt |
| Thêm màn ngoài requirement | không | không | không | thêm lịch sử StockMovement | thêm màn `stock-movements` |

- **Phân biệt được skill với prompt trần ở hai điểm**: (1) trần 1 dựng màn cho hành vi hệ thống (U3), trần 2 thêm màn ngoài requirement; skill 3/3 giữ đúng phạm vi. (2) Ghi mặc định/lý do wireframe đầy đủ hơn ở skill. Khác biệt nhỏ, mẫu 3+2.
- **Script bắt đúng** nút Hủy chỉ cho admin ở cả 5 lần (cột Role phần tử). Hạn chế: cả trần cũng đọc script nên điền đúng Role; không đo được script có ép model nghĩ tới quyền hay chỉ ép nó điền đúng ô.
- Lặp lại: cả 3 lần skill đều chọn phương án A cho mọi màn (không có người chọn); cổng chọn wireframe vẫn chưa được thử với người thật.
- Ca còn thiếu: màn dùng chung nhiều role bằng một nút dành riêng một role đã đạt; chưa thử màn có dữ liệu `own` phức tạp.
