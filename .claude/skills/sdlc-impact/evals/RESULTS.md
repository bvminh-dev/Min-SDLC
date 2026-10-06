# Kết quả chạy eval sdlc-impact (2026-10-06)

Ca: `reservation-ttl` (đổi hạn giữ hàng 15 → 30 phút). 3 lần có skill, 2 lần prompt trần (có sẵn `find-refs.mjs`).
**Chấm bằng grep trên file đầu ra và đọc báo cáo của từng agent; chưa có subagent độc lập chấm** (README yêu cầu). Kết quả mang tính sơ bộ.

## Kiểm cứng
| | Skill 1 | Skill 2 | Skill 3 | Trần 4 | Trần 5 |
|---|---|---|---|---|---|
| File có sẵn không bị sửa (md5) | ✓ | ✓ | ✓ | ✓ | ✓ |
| Ghi đúng một file ở `spec/changes/` | ✓ | ✓ | ✓ | ✓ | ✓ |
| Tên file theo ID thay đổi (contract) | ✓ | ✓ | ✓ | ✗ | ✗ |
| Bảng 5 cột đúng mẫu | ✓ | ✓ | ✓ | ✗ | ✗ |

## Golden (MUST)
| | Skill (3 lần) | Trần (2 lần) |
|---|---|---|
| G2-G5 mục có liên kết cần dựng lại (INV, CHK-REQ, FLOW, TC) | 3/3 | 2/2 |
| G6 E2E chỉ `covers` CHK-REQ, không có ID INV (cần suy luận) | 3/3 | 2/2 |
| G7 PRM không có link, phụ thuộc ngầm | 3/3 | 2/2 |
| G8 PAY/ORD ghi "chưa có spec, rủi ro" | 3/3 | 1/2 (lần 4 không nhắc) |
| S1 xung đột phiên 10 phút (AUTH) bị khuếch đại | 3/3 | 2/2 |

## Bẫy "không đổi"
| Bẫy | Skill | Trần |
|---|---|---|
| T1 INV-TC-005 (covers nhưng không liên quan TTL) | 3/3 không đổi | 2/2 |
| T2 CRT-REQ có link nhưng không dùng TTL | 2/3 không đổi; **lần 2 xếp `cần xem lại`** (báo thừa) | 2/2 không đổi |
| T3 ma trận quyền | 3/3 không đổi | 2/2 |
| T4 sửa file approved | 0 | 0 |

## Kết luận
- Khâu phân tích: **không phân biệt được** skill với prompt trần, giống kết quả của research. Cả hai đều bắt được hai phụ thuộc mà script bỏ sót (E2E, PRM) và nêu xung đột phiên AUTH.
- Khác biệt đo được chỉ ở **hợp đồng đầu ra**: tên file theo ID và bảng 5 cột (skill 3/3, trần 0/2), và G8 (3/3 so với 1/2, mẫu quá nhỏ).
- Skill không tốt hơn ở bẫy "không đổi": một lần skill còn báo thừa CRT.
- Hạn chế: một ca, một loại thay đổi (số cụ thể trong nhiều file); chưa thử đổi quyền, đổi entity, hay thay đổi chạm epic chưa có spec; fixture sạch, mọi file đều `approved`; trần có sẵn `find-refs` nên không đo được giá trị của script.
- Việc nên làm: đưa khuôn báo cáo vào script/hook (kiểm bảng 5 cột và tên file) thay vì dựa vào skill; thêm ca đổi quyền/entity.

## Ghi chú về fixture
`find-refs.mjs` chỉ bắt 5/7 mục bị ảnh hưởng và có 2 mục "link nhưng không đổi" (TC-005, CRT). Hai mục bị bỏ sót (E2E, PRM) chỉ tìm được bằng suy luận, nên ca này có kiểm được phần suy luận.

## Bổ sung (2026-10-06): script kiểm khuôn báo cáo
Thêm `scripts/check-impact.mjs` (kiểm tên file, tiêu đề bảng, giá trị Loại/Mức, và mọi tài liệu có `links`/`covers` tới ID phải có dòng), nối vào hook.
Chạy lại trên 5 báo cáo cũ: chỉ **1/3 báo cáo có skill** và 0/2 báo cáo trần qua. Nguyên nhân: mẫu bảng cũ không nói rõ cột *Loại* và *Mức* chứa gì, nên 2/3 lần skill đặt phân loại (`phải dựng lại`...) vào cột *Mức*. Nghĩa là nhận định "skill hơn ở khuôn báo cáo 3/3" ở trên **chỉ đúng về số cột**, không đúng về ý nghĩa cột. Đã làm rõ `SKILL.md`; cần chạy lại eval để xác nhận.

## Vòng 2 (2026-10-06, sau khi thêm `check-impact.mjs` và làm rõ mẫu bảng)
3 lần có skill, **chấm bởi subagent độc lập** (`/tmp/eval2/grade-impact.md`, không đọc SKILL.md). Không chạy lại prompt trần (2 lần ở vòng 1 giữ nguyên).
- **Khuôn báo cáo**: 3/3 qua `check-impact.mjs` (tên file theo ID, tiêu đề, Loại/Mức đúng nghĩa, mọi tài liệu có link đều có dòng). Ở vòng 1 chỉ 1/3 qua khi chạy script này: làm rõ mẫu bảng và có script đã sửa lỗi.
- **Phân tích**: bắt đủ 5 mục phải dựng lại (G2-G6) và các bẫy "không đổi" (T1-T4) ở cả 3 lần, nhưng **không ổn định ở phần suy luận**:
  | | imp1 | imp2 | imp3 |
  |---|---|---|---|
  | PRM-REQ-...003 (không link) | có | **bỏ sót** | có |
  | AUTH-REQ-...006 (phiên 10 phút) | có | **bỏ sót** | **bỏ sót** |
  Vòng 1 cả 3 lần có skill bắt được cả hai. Chưa rõ do SKILL.md thay đổi (thêm bước chạy `check-impact`) làm agent bớt suy luận, hay do nhiễu: 3 lần là quá ít. Cần chạy thêm để kết luận.
- Ý nghĩa: script bảo đảm **hình thức và phủ liên kết cứng**, không bảo đảm suy luận; phần suy luận vẫn dao động giữa các lần.
