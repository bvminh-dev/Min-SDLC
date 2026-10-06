# Câu hỏi còn mở của epic REV (sdlc-research, sdlc-tech-design, sdlc-ui-ux, sdlc-test-design)

Chạy tự động nên không hỏi trực tiếp. Mọi mặc định dưới đây đã áp vào requirement, thiết kế, màn hình và test; đổi quyết định thì chạy `sdlc-impact`. Mọi file spec của REV vẫn `draft`; skill đòi requirement `approved` nhưng chạy trên `draft` (đã được phép), nên P1 chưa đạt. Đã đồng bộ với nền mới ngày 2026-10-06 (xem mục "Nhật ký đồng bộ nền 2026-10-06" ở cuối); các mục đã được nền quyết ghi `[RESOLVED]` kèm mã quyết định.

Phạm vi REV theo roadmap: Create review; Rating; Comment; Upload images; Edit review; Delete review; Verified purchase; Admin moderation. Thêm ba requirement ngoài danh sách mục con nhưng cần để các mục trên dùng được: xem đánh giá công khai của sản phẩm (REV-REQ-20261006-103135566), xem đánh giá của tôi (REV-REQ-20261006-103135655), hàng đợi kiểm duyệt của admin (REV-REQ-20261006-103135744). Chưa có "danh sách sản phẩm đã mua chưa đánh giá" (không có endpoint liệt kê, chỉ có kiểm điều kiện từng sản phẩm).

## A. Mặc định đã chọn thay người dùng (cần người xác nhận)
1. Kiểm duyệt trước: biến môi trường `REVIEW_PRE_MODERATION` (ADR-007, ADR-018), mặc định bật (đánh giá mới vào `pending`); tắt thì tự công bố trong cùng giao dịch (REV-REQ-20261006-103134939 BR3).
2. Một đánh giá chưa xóa cho mỗi (customer, sản phẩm); `rejected` và `hidden` vẫn giữ chỗ cho tới khi bị xóa; chỉ `deleted` nhường chỗ (BR2 của tạo). [RESOLVED, E-22]: xóa được ở mọi trạng thái nên khách luôn viết lại được.
3. Chỉ đơn `delivered` mới cho đánh giá (SB-36); cửa sổ 90 ngày kể từ `delivered_at`; khi khách có nhiều dòng đơn thì xét dòng giao gần nhất còn trong cửa sổ (REV-REQ-20261006-103135296).
4. Điểm là số nguyên 1 đến 5, bắt buộc; bình luận tùy chọn, tối đa 2000 ký tự Unicode, văn bản thường, ký tự điều khiển bị từ chối (REV-REQ-20261006-103135029, REV-REQ-20261006-103135117).
5. Ảnh: JPEG, PNG, WebP theo magic bytes, tối đa 5 MB (đúng 5.242.880 byte), 5 ảnh mỗi đánh giá (ADR-010). [RESOLVED, ADR-018, S-08]: giới hạn đầu vào 25 megapixel (bỏ trần 4096 x 4096 và 16 triệu của bản cũ), re-encode WebP cạnh dài 1600, bỏ EXIF, khóa `reviews/<uuid>.webp`, ảnh chưa gắn và ảnh của đánh giá đã xóa dọn sau 24 giờ bằng job nền của REV (REV-REQ-20261006-103135207).
6. Sửa: chỉ `pending` và `published`. [RESOLVED, E-22]: sửa `published` khi bật `REVIEW_PRE_MODERATION` đưa về `pending` (đặt `edited_at`), tắt thì giữ `published` kèm nhãn "Đã chỉnh sửa" và phát ReviewRatingChanged nếu điểm đổi (REV-REQ-20261006-103135385).
7. Xóa: [RESOLVED, E-22, V-12] ở mọi trạng thái trừ `deleted`; customer xóa của mình, admin xóa mọi đánh giá; xóa mềm, phát ReviewDeleted, ảnh dọn trong 24 giờ (REV-REQ-20261006-103135477).
8. Công khai: tên che dạng "An N.", sắp xếp mặc định mới nhất, lọc theo sao, `summary` (count, avg một chữ số, phân bố) tính trên mọi đánh giá `published`, `page`/`limit` theo ADR-006 (mặc định 20).
9. Giới hạn tần suất: [RESOLVED, SB-14, S-01, ADR-014] bậc B tạo 10, sửa 30, tải ảnh 20 lần mỗi giờ mỗi người; bậc C đọc công khai 120 mỗi phút mỗi IP; chỉ tin `X-Forwarded-For` từ proxy cấu hình.
10. Kiểm duyệt chỉ admin (R-02, R-03: staff không có quyền); lý do từ chối và ẩn bắt buộc 1 đến 500 ký tự; `rejected` là trạng thái cuối ngoài xóa; [RESOLVED, E-22] `hidden` thoát bằng bỏ ẩn (`hidden -> published`, endpoint `unhide`) hoặc xóa; mọi thao tác kiểm duyệt và xóa của admin ghi audit (SB-19, ADR-021).
11. Chủ đánh giá thấy lý do từ chối hoặc ẩn trong "Đánh giá của tôi".
12. Địa chỉ ảnh công khai theo khóa ngẫu nhiên [RESOLVED, ADR-018].
13. Hàng đợi admin: `pending` cũ nhất trước, các trạng thái khác mới nhất trước; lọc theo `status`, `product_id`, `rating`; không có ô tìm theo tên sản phẩm hay người viết.
13b. Tạo đánh giá bắt buộc header `Idempotency-Key` (ADR-017, scope `review.create`): thêm lỗi 422 `idempotency_mismatch` khi cùng khóa khác nội dung. Giao diện sinh khóa mới mỗi lần mở form và giữ khi gửi lại.
13c. API `GET /api/v1/me/reviews` thêm cờ `edit_requires_review` để giao diện báo trước khi sửa đánh giá `published` sẽ về chờ duyệt (do cấu hình `REVIEW_PRE_MODERATION`).

## B. Cần người quyết ở phạm vi REV
14. [RESOLVED, E-22] Sửa đánh giá đã `published` có kiểm duyệt lại hay không: nền thêm `published -> pending` chỉ khi bật `REVIEW_PRE_MODERATION` (tắt thì giữ `published`). Đã áp vào REV-REQ-20261006-103135385 BR6, BR7, thiết kế DB, API, test. Phần còn thiếu của nền: xem "Nền còn thiếu" mục 1.
15. [RESOLVED, E-22] Khách rút được đánh giá `pending` (xóa); viết lại sau `rejected` hoặc `hidden` bằng cách xóa đánh giá cũ (đã có `rejected -> deleted`, `hidden -> deleted`); admin bỏ ẩn được (`hidden -> published`). `rejected` là trạng thái cuối ngoài xóa. Đã áp vào REV-REQ-20261006-103135477, REV-REQ-20261006-103135835, UI, test.
16. [OPEN] Cửa sổ đánh giá 90 ngày hay không giới hạn (SB-36 chỉ nói "trong cửa sổ quy định", chưa có con số); một đánh giá mỗi sản phẩm hay mỗi dòng đơn (mặc định mỗi sản phẩm).
17. [RESOLVED, ADR-018] Ảnh review công khai theo khóa ngẫu nhiên (loại URL ký hạn ngắn); ai biết URL đều xem được ảnh, chấp nhận.
18. [OPEN] `REVIEW_PRE_MODERATION` mặc định bật hay tắt và có cần công tắc đổi được lúc vận hành không. Nền đã quyết nơi đặt (biến môi trường ở danh sách ADR-007, ADR-018, đổi cần khởi động lại) nhưng chưa quyết giá trị mặc định (REV giữ `true`) và chưa có công tắc runtime.
19. [RESOLVED, ADR-018] Ngưỡng ảnh: 25 megapixel tổng đầu vào, không có trần riêng từng cạnh; test đã đổi (đúng 25.000.000 hợp lệ, 25.000.001 trở lên bị từ chối).
20. Tên hiển thị đã che: [RESOLVED, SB-08, S-04] được phép công khai ở đánh giá. [OPEN] Hiện ảnh đại diện của người viết công khai: SB-08 chưa nêu ảnh đại diện (cùng điểm với USR câu 11).
21. [RESOLVED, R-02, R-03] Staff không xem hàng đợi; kiểm duyệt (duyệt, từ chối, ẩn, xóa, không sửa nội dung) là việc của admin.
22. [OPEN] Có thông báo cho khách khi đánh giá được duyệt, bị từ chối, bị ẩn không: NTF chưa có event cho việc này (NTF không nhận event nào của REV, `events.md` không đổi).
23. [OPEN] Danh sách "sản phẩm đã mua chưa đánh giá" để nhắc khách (không có trong roadmap, không dựng).

## C. Phụ thuộc epic khác
Epic đã có spec (ORD, PRD, AUTH, PRJ, USR):
24. [RESOLVED, A-02, V-13, K-09] ORD: giao diện `getDeliveredItems` (đọc, không `tx`) ở bảng "Giao diện module" của `architecture.md`; `delivered_at` là thuộc tính Order (E-12); REV bị bỏ khỏi consumer của OrderDelivered. Đợt 2: ORD đã có ORD-REQ-20261006-120227681 BR5 và ORD-API ghi chữ ký `getDeliveredItems(user_id, product_id)` trả `{ order_item_id, order_id, delivered_at }` của đơn `delivered`; REV đã link tới requirement đó.
25. PRD: [RESOLVED, V-12, K-11] ReviewHidden mang `rating`, thêm ReviewDeleted và ReviewRatingChanged, PRD giữ `ProductReviewRating` idempotent. [RESOLVED, M-01, R-27] bảng "Giao diện module" đã có hàng REV -> PRD (trạng thái `active`, tên, ảnh đại diện theo danh sách id, đọc theo lô, không `tx`); PRD-API chỉ định `getSummaries(product_ids)` (tối đa 100 id), chữ ký chốt cùng PRD.
26. AUTH: [RESOLVED, A-01, ADR-012] guard phiên và role là interface `SessionContext` của platform, REV không khai thêm ở `depends_on`. [RESOLVED, M-01, R-27] bảng "Giao diện module" đã có hàng REV -> AUTH `getDisplayNames(user_ids)` (tên hiển thị, ảnh đại diện, đọc theo lô, không `tx`); AUTH chưa có requirement riêng cho phương thức này, chữ ký chốt ở tech-design của AUTH.
27. PRJ: [RESOLVED, A-01, ADR-011, ADR-013, ADR-014, ADR-016, ADR-017, ADR-018, ADR-021, ADR-023] audit (`AuditService.record`), giới hạn tần suất, kho object, chuẩn lỗi, CSRF, Idempotency-Key, outbox, job dọn ảnh đều là dịch vụ platform, không khai PRJ ở `depends_on`; `REVIEW_PRE_MODERATION` đã nằm trong cấu hình ADR-007.
28. USR: ảnh đại diện hiện ở danh sách công khai (USR câu 25, xem câu 20); REV không phụ thuộc USR (đọc qua AUTH vì avatar_url là thuộc tính User).

Epic chưa có spec, không bịa ID (chuyển cho spec của epic đó):
29. NTF: có muốn nhận event kết quả kiểm duyệt (duyệt, từ chối, ẩn) để báo khách; hiện không có event nào của REV có NTF làm consumer (xem câu 22).
30. DSH: [RESOLVED, ADR-020, K-09] DSH v1 dùng giao diện đọc, không nhận event; REV không phát event cho DSH và DSH không phụ thuộc REV ở cột Phụ thuộc. Số liệu đánh giá trên dashboard là việc sau v1.
31. CHK, PAY, SHP, CRT: không liên quan REV.

## D. Ghi chú từ test-design (chỗ yếu của requirement, không tự sửa)
32. [RESOLVED, ADR-018] REV-REQ-20261006-103135207 BR4: ngưỡng ảnh đã thống nhất 25 megapixel (câu 19).
33. "Cùng nội dung" của các 404 chung: test so sánh thân phản hồi sau khi bỏ `trace_id` (cùng `type`, `title`, `status`); requirement chưa nêu `detail` cụ thể.
34. Ngưỡng đệm 64 KB và bộ nhớ dưới 50 MB cho cắt luồng ảnh, và dưới 100 MB cho PNG bom 30000 x 30000: do test tự đặt (cùng cách USR), cần người chốt.
35. [RESOLVED, SB-14] Các con số giới hạn tần suất (10, 30, 20 mỗi giờ; 120 mỗi phút) đã nằm trong bảng bậc B, C của SB-14.
36. Mối đe dọa SEC không kiểm bằng test: T21 (event giả, review; có thêm test giết tiến trình ở phía producer). T13 nay kiểm bằng test (sửa đánh giá `published` về `pending`), T16 kiểm bằng test và review (outbox, event ReviewRatingChanged, ReviewDeleted); T10 và T14 kiểm cả test và review; phần review của T10 là rà soát không có cột dữ liệu cá nhân trong serializer công khai.
37. Kiểm DOM của việc escape (T7) cần giao diện thật khi implement; ở API chỉ kiểm chuỗi thô.
38. [OPEN] Chưa có test cho phía PRD khi nhận ReviewPublished, ReviewHidden, ReviewDeleted, ReviewRatingChanged (thuộc epic PRD); ở REV chỉ kiểm payload và tính nguyên tử với giao dịch (outbox, SB-27). Chưa kiểm được điểm lệch khi bản sửa của đánh giá `published` bị từ chối (xem "Nền còn thiếu" mục 1).
39. E2E chưa có ca 429, 409 của form và trạng thái "hết phiên", "không có quyền" (đích nằm ở màn của AUTH, testid khác role); các trạng thái đó chỉ kiểm bằng test API. Chuyển về sdlc-ui-ux nếu muốn thêm testid chuyển hướng.
40. Test của ca hai giao dịch song song (sửa và ẩn, hai admin duyệt, hai lần tạo, hai lần xóa) cần môi trường PostgreSQL thật để kiểm khóa dòng và chỉ mục duy nhất một phần, không giả được bằng bộ nhớ.
41. Các test mô tả "A tạo đánh giá" (không nêu chi tiết yêu cầu HTTP) ngầm gồm header `Idempotency-Key` mới ở mỗi lần tạo; chỉ các test có ý nghĩa với khóa (ca thiếu khóa, gửi lại, đồng thời) nêu rõ.

## Nền còn thiếu sau lần sửa 2026-10-06
Không sửa nền trong epic này (các file nền đang `draft` chờ duyệt lại); chuyển cho `sdlc-foundation` hoặc `sdlc-impact`.

1. [OPEN, đợt 2 không đổi: `events.md` vẫn không có event cho chuyển này] `spec/domain/events.md`: không có event cho `Review published -> pending` (sửa đánh giá đã đăng khi bật `REVIEW_PRE_MODERATION`). PRD vẫn tính điểm cũ trong lúc `pending`; nếu bản sửa bị từ chối thì PRD lệch vĩnh viễn (xóa thì ReviewDeleted xử lý được). Đề xuất: thêm event (ví dụ ReviewUnpublished, REV phát, PRD nhận, payload `review_id, product_id, rating`, phát khi `Review:pending` từ `published`) hoặc cho ReviewHidden phát cả ở chuyển này.
2. [RESOLVED, M-01, R-27, đợt 2] `spec/architecture.md` "Giao diện module (gọi đồng bộ)" đã có hàng REV -> PRD và REV -> AUTH `getDisplayNames(user_ids)` (chỉ đọc, không `tx`), khớp cột Phụ thuộc PRD, ORD, AUTH.
3. `spec/permissions-matrix.md` (việc của người, theo yêu cầu đồng bộ): thêm hàng `POST /api/v1/admin/reviews/{id}/unhide` (admin) và cột `system` cho job dọn ảnh của REV (không có requirement riêng; nằm trong REV-REQ-20261006-103135207 BR8).
(ADR-022 để các hạn lưu còn lại cho epic chốt ở tech-design: REV giữ Review `deleted` xóa mềm không hạn, ảnh dọn sau 24 giờ; đã ghi ở thiết kế DB, người duyệt có thể đổi.)

## Nhật ký đồng bộ nền 2026-10-06
- `requirements/REV-REQ-20261006-103134939` (tạo): ADR-017 thêm `Idempotency-Key` (BR6b, BR7, kịch bản thiếu khóa, gửi lại, đồng thời); V-12, ADR-011, SB-27 event qua outbox cùng giao dịch (BR9); SB-14 bậc B; Xung đột chuyển [RESOLVED] cho `REVIEW_PRE_MODERATION` (ADR-007, ADR-018) và `getDeliveredItems` (A-02).
- `requirements/REV-REQ-20261006-103135029` (điểm): K-11, V-12 điểm đi trong payload mọi event Review và PRD giữ `ProductReviewRating` idempotent (BR4, BR5); ghi lỗ hổng `published -> pending` còn thiếu event.
- `requirements/REV-REQ-20261006-103135207` (ảnh): ADR-018, S-08 đổi ngưỡng ảnh sang 25 megapixel đầu vào (BR4 và kịch bản 5000 x 5000 / 5001 x 5000), truy cập công khai theo khóa ngẫu nhiên (BR10), job dọn là job nền chung với tác nhân `system` (BR8, ADR-013, SB-34), entity ReviewImage (E-17), bậc B SB-14.
- `requirements/REV-REQ-20261006-103135296` (mua có xác minh): A-02, V-13, K-09 REV hỏi `ORD.getDeliveredItems`, không còn nhận OrderDelivered; SB-36, SB-35 (BR6, Dữ liệu, Xung đột).
- `requirements/REV-REQ-20261006-103135385` (sửa): E-22, V-12, K-11 thêm `published -> pending` khi bật `REVIEW_PRE_MODERATION`, giữ `published` và phát ReviewRatingChanged khi tắt (BR6, BR7, BR11, kịch bản mới); `rejected` cuối, `hidden` chỉ bỏ ẩn hoặc xóa (BR2).
- `requirements/REV-REQ-20261006-103135477` (xóa): E-22, V-12 xóa ở mọi trạng thái (bỏ 409 `review_not_deletable`), ReviewDeleted mọi lần xóa, audit admin theo ADR-021 (BR2 đến BR8, kịch bản).
- `requirements/REV-REQ-20261006-103135566` (công khai): SB-14 bậc C, SB-08 (S-04, K-13) cho phép tên đã che; ghi thiếu hàng REV -> PRD, AUTH ở bảng giao diện.
- `requirements/REV-REQ-20261006-103135655` (của tôi): E-22 `can_delete` ở mọi trạng thái, thêm cờ `edit_requires_review` (BR5, kịch bản).
- `requirements/REV-REQ-20261006-103135744` (hàng đợi): R-02, R-03, K-16 staff không xem hàng đợi, xem hàng đợi không audit.
- `requirements/REV-REQ-20261006-103135835` (kiểm duyệt): E-22, V-12 thêm bỏ ẩn (`hidden -> published`, BR4b, kịch bản), ReviewHidden có `rating`, ReviewPublished cũng phát khi bỏ ẩn; ADR-021, E-02, SB-19 audit; ADR-011 outbox (BR9); đổi tiêu đề.
- `flows/REV-FLOW-20261006-103135925`: thêm nhánh Idempotency-Key (ADR-017); vẽ lại vòng đời theo E-22 (xóa ở mọi trạng thái, bỏ ẩn, `published -> pending`), event ReviewDeleted, ReviewRatingChanged qua outbox.
- `design/REV-DB-20261006-103618216`: E-17 thêm entity ReviewImage (khai `entities: [Review, ReviewImage]`, bỏ [OPEN]); E-22 bảng chuyển trạng thái đầy đủ; V-12 event theo từng chuyển; ADR-011 outbox thay bus in-process; ADR-017 Idempotency-Key; ADR-021 audit; ADR-018 25 megapixel; ADR-013 job dọn ảnh; CHECK `moderation_reason` nới theo `rejected, hidden -> deleted`; SB-14 bậc B, C.
- `design/REV-API-20261006-103618306`: `emits` thêm ReviewDeleted, ReviewRatingChanged; thêm `POST /admin/reviews/{id}/unhide`; bỏ 409 `review_not_deletable`; header `Idempotency-Key` và 422; `edit_requires_review`; `type` lỗi theo URN (ADR-023); giao tiếp module theo bảng giao diện, platform là mối quan tâm cắt ngang (A-01).
- `design/REV-SEC-20261006-103618395`: T5 -> SB-36, T6 -> SB-14 và Idempotency-Key, T9 -> SB-14, T8 -> 25 megapixel (ADR-018), T13 đóng bằng `published -> pending` (E-22), T14 -> ADR-021 và SB-32, T16 -> outbox và SB-27, T17 -> SB-14, T21 -> SB-27; viết lại "Rủi ro còn lại".
- `ui/my-reviews`: Xóa ở mọi trạng thái (bỏ lỗi 409 trong hộp thoại), chú thích "Sửa sẽ đưa đánh giá về chờ duyệt". `ui/admin-moderation`: thêm Bỏ ẩn (`rev-admin-moderation-row-unhide`), Xóa ở mọi dòng. `ui/review-form`: cảnh báo `rev-review-form-edit-notice`, chữ ảnh 25 megapixel, ghi chú Idempotency-Key.
- `tests/`: sửa REV-TC-...104523767, ...104523823, ...104523878, ...104523936, ...104523993, ...104524045, ...104524159, ...104524227, ...104525433 (header Idempotency-Key, outbox); ...104525319 (25 megapixel); ...104525890 (sửa published khi tắt kiểm duyệt); ...104526283, ...104526332 (ReviewDeleted); ...104526433, ...104526616 (xóa pending, rejected, hidden thành công); ...104527184 (can_delete, edit_requires_review); ...104528071, ...104527996, ...104528265, ...104526228 (ReviewHidden có rating, outbox); ...104528104, ...104528170 (thêm unhide); E2E ...104528360, ...104528456, ...104528486, ...104528614. Thêm REV-TC-20261006-140000001 (sửa published về pending, T13), ...140000002 (ReviewRatingChanged, T16), ...140000003 (bỏ ẩn), ...140000004 (Idempotency-Key, T6), ...140000005 (giết tiến trình, outbox, T16, T21) và REV-E2E-20261006-140000006 (sửa đánh giá đã đăng khi bật kiểm duyệt trước).
- Quyết định nền ảnh hưởng nhiều nhất: E-22 (vòng đời Review), V-12 và K-11 (event Review và điểm trung bình), ADR-011 (outbox), ADR-017 (Idempotency-Key), ADR-018 (ảnh).
- Dọn sót CSRF (ADR-016, SB-13): bỏ `X-CSRF-Token` và "token sai" ở REV-SEC-...103618395 (T15), REV-TC-...104525092 và ...104528234; thay bằng kiểm `Origin` theo danh sách cho phép (lạ hoặc thiếu: 403 `csrf_failed`), SameSite=Lax, chỉ `application/json` (sai: 415).

### Đợt 2
- `design/REV-API-20261006-103618306`, `requirements/REV-REQ-20261006-103134939`, `...103135566`, `...103135655`: M-01, R-27 bảng Giao diện module đã có hàng REV -> PRD và REV -> AUTH `getDisplayNames(user_ids)`; đổi `[OPEN]` và `[NEEDS CLARIFICATION]` "chưa có hàng" thành `[RESOLVED]`, ghi tên giao diện (PRD-API chỉ định `getSummaries(product_ids)`) khớp bảng.
- `design/REV-API-20261006-103618306`, `requirements/REV-REQ-20261006-103135296`, `...103134939` (thêm link ORD-REQ-20261006-120227681): ORD đã chốt chữ ký `getDeliveredItems(user_id, product_id)` trả `{ order_item_id, order_id, delivered_at }` chỉ của đơn `delivered` (ORD-REQ-20261006-120227681 BR5, ORD-API); sửa câu cũ "kèm trạng thái đơn", bỏ ghi chú "chữ ký chốt ở tech-design của ORD".
- `questions.md`: câu 24, 25, 26 và "Nền còn thiếu" mục 2 thành `[RESOLVED]` (M-01, R-27); mục 1 (event cho `published -> pending`) giữ `[OPEN]` vì đợt 2 không thêm event.
- Đã rà và không phải sửa: OrderReturned, `paid -> cancelled` hệ thống (M-03, M-04, R-02, R-15), `PAY_MAX_ATTEMPTS` (M-06), `Coupon.per_user_limit` (M-07), UserRegistered in_app, chữ ký INV, PRM, ORD (M-02, R-29) đều không chạm REV (REV chỉ phát ReviewPublished, ReviewHidden, ReviewDeleted, ReviewRatingChanged, không nhận event nào). ADR-014 đợt 2 (bậc D, E PostgreSQL; bậc C bộ nhớ) khớp REV (bậc B PostgreSQL, bậc C đọc công khai); ADR-021 đợt 2 (đọc gộp mỗi phút) chỉ nêu dashboard nên xem hàng đợi của REV vẫn không audit (K-16). Mục còn `[OPEN]` cần người: câu 16, 18, 20, 22, 23 (cửa sổ 90 ngày, mặc định `REVIEW_PRE_MODERATION`, ảnh đại diện công khai, thông báo kết quả kiểm duyệt, danh sách chưa đánh giá) và câu 38, 34.
