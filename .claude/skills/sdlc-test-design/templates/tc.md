---
id: ORD-TC-00000000-000000000
title: Khách xem danh sách đơn của mình
epic: ORD
status: draft            # draft | approved | superseded
covers: [ORD-REQ-...]    # ĐÚNG MỘT requirement mà test case này kiểm
kind: chính              # chính | lỗi | biên: khớp mục kịch bản của requirement (Luồng chính, Luồng lỗi, Ca biên)
threats: []              # (tùy chọn) mối đe dọa SEC mà test này kiểm: <SEC-ID>:<mã>, ví dụ ORD-SEC-20261006-110000003:T1
---

## Các bước
- **Given** (điều kiện, lấy từ Given của kịch bản)
- **When** (hành động)
- **Then** (kết quả quan sát được; cụ thể đến mức viết được assert)

## Dữ liệu và ghi chú
(dữ liệu mồi, cách dựng điều kiện, giá trị biên)

<!-- Mối đe dọa SEC có Kiểm bằng `script` hoặc `hook` (cổng kiểm: quét bí mật, quét lỗ hổng, hook, workflow CI) cần ÍT NHẤT HAI TC trỏ tới nó trong `threats`, một ca `lỗi` hoặc `biên`:
     - ca đầu vào kiểm cứng hỏng hoặc thiếu (registry lỗi, kết quả rỗng, công cụ không chạy được) thì cổng PHẢI đỏ, không im lặng cho qua;
     - mỗi mẫu quét (mỗi dạng bí mật, mỗi mức lỗ hổng) một ca dương tính riêng, không gộp một ca cho cả bộ quét.
     Given/When nêu phiên bản công cụ cụ thể (Node 22.11.0) thì mục Dữ liệu ghi cách dựng (container, .nvmrc). Mỗi bước bắt đầu bằng đúng một nhãn in đậm Given, When hoặc Then. Hàm trong "Giao diện module ... cung cấp" của API cần ít nhất một TC nhắc tên hàm; job nền xóa hàng loạt cần ca "nguồn tham chiếu rỗng/không ánh xạ được thì không xóa gì"; trạng thái UI có thời hạn cần bước thoát (mở lại, hết giờ). Xóa chú thích này khi dùng. -->
