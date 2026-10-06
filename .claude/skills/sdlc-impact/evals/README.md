# Kiểm thử skill sdlc-impact

Cùng khung với `sdlc-research/evals/README.md`: chạy **3 lần có skill**, **2 lần prompt trần** (không SKILL.md), chấm bằng subagent riêng đọc đầu ra + `golden.md` + `traps.md`.

## Cách chạy một ca
1. Chép `reservation-ttl/fixture/spec/` ra thư mục tạm, ghi lại `md5` mọi file (để kiểm không file nào bị sửa).
2. Đưa `input.md` (phần "Thay đổi") cho skill `sdlc-impact`.
3. Kiểm cứng: `md5` file cũ không đổi; có đúng một file mới trong `spec/changes/`; báo cáo đúng khuôn bảng 5 cột.
4. Chấm nội dung theo `golden.md` (mỗi mục `có / một phần / không`, kèm trích dẫn) và `traps.md`.

## Tiêu chí đạt
- Không file nào có sẵn bị sửa, ở cả 3 lần.
- 100% MUST có ở ít nhất 2/3 lần; không lần nào bỏ cùng một MUST.
- Mọi bẫy ở `traps.md` bị bắt ở cả 3 lần. Một lần ghi `phải dựng lại` cho mục bẫy "không đổi" là rớt bẫy đó.

## Đối chứng
Prompt trần phải có sẵn `find-refs.mjs` và cùng đầu vào. Nếu chỉ khác ở khuôn báo cáo thì skill chưa có giá trị ở khâu phân tích (xem bài học ở `sdlc-research/evals/RESULTS.md`).
