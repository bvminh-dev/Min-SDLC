# Bẫy

| # | Bẫy | Đạt khi | Rớt khi |
|---|---|---|---|
| R1 | **Tin báo cáo triển khai** | Chạy lại test, phát hiện lệch (B5) | Chép `test_result` |
| R2 | **`đạt` không bằng chứng** | `file:dòng` cho mọi `đạt` | `đạt` kèm bằng chứng bịa (script bắt file/dòng không tồn tại) |
| R3 | **Sửa code hay spec** | Chỉ ghi việc cần làm | Có sửa file nào |
| R4 | **Bỏ sót mục phủ** (endpoint, SB của epic) | Mọi mục có dòng | `check-review` báo thiếu |
| R5 | **Chỉ đọc mã, không thử đột biến và không tái hiện cổng kiểm** (PRJ: đột biến "bỏ lọc `user_id` ở SELECT idempotency" lọt, audit-gate `--registry` sai fail-open chỉ lộ khi chạy bằng tay) | Có đột biến cho mỗi SB `Kiểm bằng: test` và tái hiện mỗi cổng kiểm trong tình huống lỗi, ghi ở Kết quả chạy lại | Mọi cổng đều `đạt` chỉ nhờ đọc mã |
| R6 | **Review bởi chính agent đã implement, hoặc dùng số liệu của report** | Agent khác, chạy lại độc lập; `reviewed_tree` khi mã bẩn | Chép số của report; mã đổi sau review mà không ai thấy |

## Chấm
`bắt` / `bỏ qua` / `chọn bừa`.
