---
name: sdlc-test-design
description: Thiết kế test cho một epic: test case (TC) phủ từng kịch bản Given/When/Then của requirement và từng mối đe dọa SEC cần kiểm bằng test, cùng luồng E2E dùng testid từ spec/testids.md; kèm checklist chất lượng requirement. Dùng sau sdlc-research, sdlc-tech-design và sdlc-ui-ux của epic, trước implement.
---

# sdlc-test-design

Đầu vào: epic đã có requirement `approved`, thiết kế kỹ thuật (đặc biệt SEC) và `spec/testids.md` (từ `sdlc-ui-ux`). Đầu ra theo `.claude/sdlc/contract.md`: `spec/epics/<EPIC>/tests/<ID>.md` với ID loại `TC` và `E2E`. **Không viết code test** ở phase này; code test là việc của `implement`.

Phần phủ và tham chiếu do script bảo đảm. Skill lo phần phán đoán: kịch bản nào đáng test, dữ liệu mồi, giá trị biên, assert đủ cụ thể chưa.

## Quy tắc cứng
- **ID do script sinh**: `node .claude/skills/sdlc-research/scripts/new-id.mjs <EPIC> <TC|E2E> spec/`.
- **Không sửa file `approved`, không tự đổi sang `approved`** (hook chặn). Test sai vì requirement sai thì chạy `sdlc-impact`, không sửa requirement.
- Mỗi test case phủ **đúng một requirement** và một mục kịch bản (`kind: chính | lỗi | biên`) có thật trong requirement đó. Không bịa hành vi mới trong test.
- **Job nền xóa hàng loạt** (dọn mồ côi, purge) dựa trên "danh sách còn dùng": kịch bản phải có ca "đóng khi không chắc": nguồn tham chiếu rỗng, lỗi hay không ánh xạ được (đổi cấu hình, đổi gốc URL) thì job dừng và báo lỗi, không xóa gì.
- **Trạng thái màn hình có thời hạn** ("tới hết giờ", "đếm ngược", "sau N giây") cần TC hoặc E2E nhắc testid của trạng thái đó cùng bước thoát (nút mở lại, banner biến mất). **Mỗi hàm** trong "Giao diện module ... cung cấp" của tài liệu API cần ít nhất một TC của epic nhắc tên hàm.
- E2E chỉ thao tác giao diện qua **testid có trong `spec/testids.md` và dành cho role của luồng**. Testid chưa có thì quay lại `sdlc-ui-ux`, không tự đặt.

## Quy tắc viết ca (từ bài học code)
- **Trường chữ**: giá trị biên thêm nửa cặp thay thế lẻ `\ud800`, NUL, ký tự điều khiển; chuỗi hoa/thường thêm `ſ` (U+017F), `ı`, Kelvin (U+212A) (L62). Giới hạn độ dài có CHECK `char_length`: ca emoji ở đúng biên, N được, N cộng 1 bị 400 (L113).
- **URL và đường dẫn nội bộ**: bộ giá trị xấu chuẩn `//host` không chấm, `//2130706433`, `/\evil`, `/a:b`; ca "từ chối URL ngoài" không chỉ thử tên miền có chấm (L126).
- **Job nền** ở tài liệu DB/API: mỗi mục có chữ "job" phải có TC nhắc tới job; mỗi cụm "giới hạn lô", "hạn thời gian", "idempotent" phải nằm trong một Then (L61). Bộ đếm có CHECK trần: TC dựng dòng ở đúng trần rồi chạy job (L123).
- **Ca `lỗi` chỉ đổi MỘT nhân tố** so với ca hợp lệ liền trước (cùng người, cùng mã, cùng đơn); ghi nhân tố đó ở bước When. Khẳng định ngưỡng không có độ chùng lớn hơn đại lượng nó bảo vệ (L76).
- **Có BẢNG quy tắc** (bảng chuyển trạng thái, bảng cho phép, CASE): TC phủ MỌI ô; ô không hợp lệ kiểm "không đổi, không phát event, có log". TC chỉ ghi vài ô phải nêu ô còn lại thuộc TC nào (L78).
- **Quy tắc nhiều bước "xét theo thứ tự"**: bảng quyết định, mỗi cặp bước cùng đúng là một TC. `check-tests` cảnh báo khi BR có cụm "theo thứ tự" mà số TC của requirement ít hơn số bước (L132).
- **Mỗi trần tài nguyên** (`limit`, số mốc, kích thước, độ sâu) có hai ca: vượt đúng một đơn vị bị từ chối; vượt gấp một triệu lần, khẳng định từ chối dưới 2 giây và TRƯỚC khi tốn tài nguyên (L80).
- **Entity có `version` hay `last_activity_at`** mà module khác dùng làm cổng: bảng test theo thao tác ghi, mỗi hàng một thao tác, kể cả thao tác không đổi gì (L110).
- **Hạn mức theo kết quả lời gọi ngoài dưới khóa**: TC hai lượt chạy song song với lời gọi chậm (L125).
- **Thời hạn, hạn mức, chu kỳ** ghi bằng TÊN biến cấu hình, kèm "mặc định kiểm riêng ở một TC cấu hình"; không ghi số giây cứng. Không gọi module nội bộ là "bản giả" (ADR-002 dùng test thật): nêu cách gài lỗi hay chậm bằng `jest.spyOn` trên lớp thật (L138).
- **"Tham số thiếu thì nhận mặc định"** ở tài liệu API: một TC giao diện riêng cho ca chỉ có MỘT tham số (đo: ô nhập khớp `from`, `to` máy chủ đã dùng). Mỗi hàm giao diện sao lại luật mặc định của máy chủ phải có một dòng đột biến (L139).
- **Tích hợp có chữ ký hay giao thức ngoài**: TC yêu cầu vectơ HẰNG SỐ tính ngoài mã hoặc của nhà cung cấp; test chỉ ký bằng hàm của mã là yếu (L99).
- **Bước E2E nhập hay chọn một giá trị**: đọc ghi chú và cột Trạng thái của ui cho phần tử đó trước khi viết. Bước đòi giá trị mà ui chặn thì ghi "gọi trực tiếp API" hoặc chuyển `sdlc-impact` đổi ui (L64).

## Quy trình
0. **Nạp framework tham chiếu.** Đọc `.claude/sdlc/adapter/active.md` và dòng phase `test-design` trong file mapping; đọc các file ở cột *Đọc* (`checklist-template.md`, `checklist.md`) để lấy cách kiểm chất lượng requirement. Cột *Kit tự làm* là phần dưới đây.
1. **Đọc bối cảnh**: requirement của epic, `spec/epics/<EPIC>/design/` (nhất là bảng SEC và API), `spec/testids.md`, `permissions-matrix.md`, `spec/security-baseline.md`. Thiếu requirement `approved`, SEC hoặc `testids.md` thì dừng và nói cần chạy skill nào.
2. **Checklist chất lượng requirement** (từ framework tham chiếu, chỉ báo cáo, không ghi file): mỗi quy tắc nghiệp vụ có kiểm được không, có con số/điều kiện cụ thể chưa, kịch bản lỗi và biên có đủ không, có từ mơ hồ không. Chỗ yếu thì ghi vào báo cáo và đề xuất quay lại `sdlc-research`; không tự sửa requirement.
3. **Viết test case** (`templates/tc.md`): mỗi requirement × mỗi mục kịch bản (`chính`, `lỗi`, `biên`) có ít nhất một TC. Given/When/Then cụ thể đến mức viết được assert. Test case của mối đe dọa SEC có `Kiểm bằng test` thì ghi `threats: [<SEC-ID>:<mã>]`.
4. **Viết E2E** (`templates/e2e.md`): luồng đi qua nhiều màn hoặc nhiều requirement (ví dụ khách đặt hàng rồi hủy). Mỗi bước giao diện có testid trong dấu backtick; `role` là role thực hiện luồng.
5. **Kiểm cứng** (sửa tới khi qua): `node .claude/skills/sdlc-test-design/scripts/check-tests.mjs spec/ --epic <EPIC> --strict`. Hook kiểm hình thức chung và file vừa sửa tự chạy.
5b. **Tự kiểm cuối**: mỗi testid dùng ở bước E2E thao tác được theo mô tả của ui (ô, trạng thái, ghi chú), không chỉ có trong `testids.md` (L64).
6. **Báo cáo**: tài liệu đã tạo, chỗ yếu của requirement (bước 2), testid còn thiếu (chuyển `sdlc-ui-ux`), mối đe dọa SEC chưa kiểm được bằng test.

## Script kiểm (`scripts/check-tests.mjs`)
`covers` trỏ tới requirement có thật; TC phủ đúng một requirement, `kind` đúng một trong ba mục và mục đó **có thật** trong requirement; đủ Given/When/Then; `threats` trỏ tới mối đe dọa có thật; E2E có `role` hợp lệ, mọi testid trong backtick **có trong `spec/testids.md` và dành cho role đó**, có ít nhất một testid. Với `--strict`: thiếu TC cho mục kịch bản nào của requirement nào, hoặc mối đe dọa `Kiểm bằng test` chưa có TC, đều là lỗi. Tự kiểm: `node .claude/skills/sdlc-test-design/scripts/check-tests.test.mjs`. Cảnh báo (lỗi ở `--strict`): trạng thái màn hình có thời hạn không có TC/E2E nhắc testid cùng bước thoát (L45); hàm trong "Giao diện module ... cung cấp" của tài liệu API không TC nào nhắc (L50); mối đe dọa kiểm bằng `script`/`hook` (cổng kiểm) có ít hơn 2 TC hoặc không có ca `lỗi`/`biên` (đầu vào kiểm cứng hỏng thì cổng phải đỏ; mỗi mẫu quét một ca dương tính); Given/When nêu phiên bản công cụ cụ thể mà mục Dữ liệu không nói cách dựng. Mục job của tài liệu DB/API không TC nào nhắc job, hoặc cụm "giới hạn lô", "hạn thời gian", "idempotent" không nằm trong Then nào (L61); BR có cụm "theo thứ tự" mà số TC ít hơn số bước (L132). Nhãn Given/When/Then lặp hoặc không đứng đầu bước: lỗi với TC `draft` và `--strict`, cảnh báo với TC `approved`.

## Chưa làm
- Chưa kiểm được chất lượng assert hay dữ liệu mồi (cần người đọc).
- Chưa có eval với dữ liệu thật; eval có dữ liệu mẫu ở `evals/`.
