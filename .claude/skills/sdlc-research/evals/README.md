# Kiểm thử skill sdlc-research

Hình thức (ID, liên kết, role, Given/When/Then) do **script** kiểm. Nội dung do **rubric** kiểm. Hai việc tách riêng.

## Cấu trúc một ca
```
evals/<tên-ca>/
  input.md     đầu vào: epic từ roadmap + spec đã có (fixture) + ghi chú nghiệp vụ
  golden.md    điểm kỳ vọng mà đầu ra phải có (MUST / SHOULD)
  traps.md     mâu thuẫn/thiếu sót cố ý gài; skill phải phát hiện, không được lặng lẽ chọn một bên
```

## Cách chạy một ca
1. Tạo thư mục tạm, chép phần fixture trong `input.md` vào `spec/`.
2. Chạy skill `sdlc-research` với epic trong `input.md`. **Chạy 3 lần**, vì đầu ra LLM không ổn định.
3. Với mỗi lần: chạy `check-spec.mjs` (phải qua), rồi chấm theo `golden.md` và `traps.md`.
4. Chấm nội dung bằng một subagent riêng, đưa nó đầu ra + `golden.md` + `traps.md`, không cho xem `SKILL.md`. Mỗi điểm trả lời `có / một phần / không` kèm trích dẫn.

## Tiêu chí đạt
- `check-spec.mjs` qua cả 3 lần.
- 100% điểm MUST trong golden có ở ít nhất 2/3 lần chạy, và không lần nào bỏ sót cùng một MUST.
- Mọi bẫy trong `traps.md` được **nêu ra ở mục Xung đột** (hoặc hỏi người dùng) ở cả 3 lần. Một lần chọn bừa một bên là rớt.

## Đối chứng
Chạy lại cùng đầu vào bằng prompt trần (không skill). Nếu kết quả không khác đáng kể thì skill chưa có giá trị.

## Hồi quy
Mỗi bài học từ `retro` thành một ca mới hoặc một dòng mới trong `golden.md` / `traps.md`. Không xóa ca cũ.
