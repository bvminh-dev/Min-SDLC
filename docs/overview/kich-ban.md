# Kịch bản thuyết trình 6 phút — Neko Core × Min-SDLC

Tổng 6:00 (360 giây), còn 4 phút cho vấn đáp. Xưng "chúng tôi"; đổi thành "em" hay "nhóm em" thì tìm-thay trong `deck/index.html` (các chuỗi caption) và file này.

Xem trực tiếp: mở `deck/index.html` bằng Chrome, nhấn **Space** để chạy/dừng, **← →** nhảy cảnh, **R** về đầu. Góc phải có đồng hồ để tập nhịp. Phụ đề trong bài chính là lời kể bên dưới, nên video xem không cần tiếng.

Cách kể: mỗi cảnh một ý, mở bằng câu hỏi, chốt bằng một hình ảnh vật lý (đường ray, cổng, dây an toàn). Câu ngắn, ngắt hơi sau dấu chấm, để hình chạy theo lời.

---

## 0:00 – 0:24 · Mở đầu (câu hỏi)
> Hôm nay, một trợ lý AI có thể viết hàng nghìn dòng code chỉ trong vài phút.
> Nhưng nhanh thì chưa đủ.
> Khi nó tự sửa file, tự chạy lệnh ngay trên máy của bạn — ai bảo đảm nó làm đúng?
> Chúng tôi xin kể bằng hai phần: một chú mèo, và một đường ray.

## 0:24 – 0:40 · Neko Core là gì
> Chú mèo ấy tên là Neko Core.
> Một trợ lý lập trình chạy ngay trong terminal, do Meiiie và The Wiii Lab phát triển.
> Gói gọn trong một tệp duy nhất — không cần cài thêm gì.

## 0:40 – 1:25 · Vòng lặp tác tử
> Bên trong, Neko chạy một vòng lặp rất giản dị.
> Hỏi mô hình. Chạy công cụ. Quan sát kết quả. Rồi lặp lại.
> Quanh vòng lặp là những cơ chế giữ nó khỏi lạc hướng: giải phóng ngữ cảnh, thoát vòng kẹt, theo dõi nợ kiểm chứng.
> Ở chế độ vòng kín, tiêu chí "xong" được chốt từ trước khi viết code.
> Rồi một bộ kiểm định độc lập chấm kết quả — không phải chính AI tự chấm.

## 1:25 – 2:10 · Dây an toàn
> Vấn đề kế tiếp: cho AI tự do đến đâu?
> Neko trả lời bằng một ranh giới duy nhất — mọi hành động đều đi qua cùng một cổng.
> Đọc file thì qua. Sửa file trong dự án thì qua. Chạy test cũng qua.
> Lệnh nguy hiểm như rm -rf hay force-push thì bị chặn lại — AI nhận về một phản hồi để tự điều chỉnh, thay vì đứng hình.
> Còn lệnh thảm họa, hay đụng vào khóa bí mật, thì luôn bị từ chối.
> Tự do là mặc định — nhưng luôn có dây an toàn.

## 2:10 – 2:50 · Phiên bền, nhúng được
> Làm việc dài thì phải chịu được gián đoạn.
> Neko lưu điểm khôi phục sau từng bước. Tắt máy giữa chừng, mở lại, nó đi tiếp đúng chỗ cũ — mà không chạy lại những thay đổi đã làm.
> Nó cũng không bị buộc vào một nhà cung cấp: OpenAI, Google, Anthropic hay mô hình chạy trên máy đều cắm được.
> Và nhúng được vào Zed, JetBrains qua giao thức ACP, hoặc vào ứng dụng của bạn qua SDK.

## 2:50 – 3:20 · Bước lùi (bản lề giữa hai phần)
> Nhưng hãy lùi lại một bước.
> Dây an toàn bảo vệ từng hành động. Còn một sản phẩm thương mại điện tử gồm hàng nghìn hành động.
> Từng bước đều an toàn, mà cả hệ thống vẫn sai — nếu yêu cầu bị hiểu sai ngay từ đầu.
> Neko Core là động cơ. Chúng tôi cần đường ray.

## 3:20 – 3:42 · Nguyên tắc của Min-SDLC
> Đường ray ấy là Min-SDLC: bộ kit biến từng giai đoạn của vòng đời phần mềm thành skill, hook và script.
> Nguyên tắc duy nhất: cần phán đoán thì giao cho skill; bắt buộc phải đúng thì giao cho hook và script — vì máy kiểm không mệt, không nể.

## 3:42 – 4:50 · Chín ga, mỗi ga một cổng duyệt (cảnh chính)
> Chín giai đoạn nối nhau như các ga tàu: khảo sát, nền tảng, yêu cầu, thiết kế kỹ thuật, giao diện, thiết kế test, triển khai, review, rút bài học.
> Giữa hai ga luôn có một cổng duyệt — và chìa khóa nằm trong tay con người.
> AI chỉ được ghi bản nháp. Nếu nó thử tự đổi sang "đã duyệt", hook chặn ngay.
> Mỗi lần lưu file, hook kiểm hình thức. Spec còn lỗi thì phiên làm việc không được phép kết thúc.
> Khi một spec đã duyệt phải đổi, bước phân tích tác động chỉ ra: đổi chỗ này thì yêu cầu, test, quyền nào bị kéo theo.
> Spec sai thì quay về ga gốc để sửa — không vá chắp ở phía sau.

## 4:50 – 5:12 · Sợi chỉ truy vết
> Mỗi tài liệu mang một mã định danh sinh theo thời gian, nên nhiều người làm song song cũng không đụng nhau.
> Từ yêu cầu, đến thiết kế, đến test, đến code, đến báo cáo — một sợi chỉ xuyên suốt, truy ngược được từng bước.

## 5:12 – 5:26 · Kit tự chỉnh
> Sau mỗi epic, bài học được rút ra, người duyệt, rồi chính bộ kit được sửa — kèm một ca hồi quy.
> Đường ray tự được chỉnh lại sau mỗi chặng.

## 5:26 – 5:48 · Kết quả (kèm điểm yếu)
> Kết quả: mười lăm epic của hệ thống thương mại điện tử, đi trọn trên đường ray này.
> Hơn một nghìn bảy trăm bài test chạy xanh trên PostgreSQL thật.
> Và báo cáo trung thực: VNPay mới thử bằng giả lập — chúng tôi ghi rõ là mục yếu, không giấu.

## 5:48 – 6:00 · Chốt
> Neko Core cho AI đôi tay nhanh. Min-SDLC cho đôi tay ấy một kỷ luật.
> Nhanh mà vẫn đáng tin — đó là điều chúng tôi muốn trao lại.
> Xin cảm ơn hội đồng.

---

# Nguồn của từng con số (để trả lời khi bị hỏi)

| Điều nói | Nguồn |
|---|---|
| Neko Core: tệp thực thi duy nhất, TypeScript + Bun + Ink, một ranh giới quyền, `auto`/`default`/`accept-edits`/`plan`, phiên checkpoint không chạy lại mutation, ACP, SDK, closed loop + validator độc lập | README của [meiiie/neko-core](https://github.com/meiiie/neko-core) |
| "nợ kiểm chứng", "giải phóng ngữ cảnh", "thoát vòng kẹt" | README chỉ **gọi tên** các cơ chế này, không mô tả chi tiết. Đừng giải thích sâu hơn README; nếu bị hỏi, nói rõ là đã đọc tên cơ chế, chưa đọc mã của nó |
| 15 epic | `spec/epics/` có 15 thư mục (PRJ + 14 epic thương mại điện tử) |
| 1.791 test xanh | `test_result` trong `spec/epics/PAY/report.md` và vài report khác (cùng lần chạy toàn repo) |
| 3 hook | `.claude/settings.json`: `guard-approved` (PreToolUse), `check-spec-file` (PostToolUse), `stop-check-spec` (Stop) |
| 16 bản bài học | 16 file trong `spec/lessons/` |
| ID mẫu `PAY-TC-20261006-104538540`, "97 TC · 9 E2E" | `spec/epics/PAY/report.md` |
| VNPay mới thử bằng giả lập | dòng "YẾU" trong `spec/epics/PAY/report.md` |

# Chỗ phải tự kiểm trước khi vào phòng thi

1. **Khung chạy trên tác tử nào?** Min-SDLC viết cho Claude Code (skill + hook của Claude Code). Bài nói đang đặt nó cạnh Neko Core như "đường ray cho một động cơ". Nếu hội đồng hỏi "kit có chạy trên Neko Core không?", chỉ trả lời "có" khi đã thử thật. Neko Core có hỗ trợ skills và MCP, nhưng chưa ai kiểm hook của kit có chạy ở đó.
2. **`selftest` của kit đang 20/21**: `check-adapter` đỏ vì submodule chưa đứng đúng trên tag (`spec-kit` v1.1.0, `evon` v0.3.18). Bài không nói "mọi kiểm tra xanh" nên không sai, nhưng đừng nói câu đó khi vấn đáp.
3. **Review của cả 15 epic đang ở `status: draft`** (người chưa duyệt). Đừng nói "đã được review xong".
4. **1.791 test** là kết quả ghi trong report, chưa chạy lại hôm nay (cần Docker + Postgres). Một report cũ (SHP) từng ghi 1 test đỏ trước khi các lần chạy sau xanh.

# Gợi ý câu hỏi vấn đáp

- *Vì sao không để AI tự duyệt cho nhanh?* — Duyệt là điểm chốt trách nhiệm; AI làm sai yêu cầu thì mọi bước sau đều "đúng" theo cái sai. Cổng duyệt rẻ hơn sửa lại cả epic.
- *Hook khác skill ở đâu?* — Skill là lời dặn, AI có thể lờ đi. Hook là mã chạy bên ngoài AI, nên chặn được kể cả khi AI muốn làm khác.
- *Đo hiệu quả bằng gì?* — Số test, số bài học đã quay vào kit, và báo cáo ghi điểm yếu rõ. Chưa có đối chứng "có kit vs không kit" quy mô lớn; skill 2–6 có thử đối chứng nhỏ (xem `evals/RESULTS.md` từng skill).
- *Điểm yếu lớn nhất?* — Thanh toán VNPay mới thử bằng giả lập; CI GitHub chưa chạy thật; kit chưa thử trên tác tử khác.
