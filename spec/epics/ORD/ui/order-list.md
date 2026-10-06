---
screen: order-list
epic: ORD
status: draft
covers: [ORD-REQ-20261006-092320716, ORD-REQ-20261006-092320790]
roles: [customer]
---
# Đơn hàng của tôi (danh sách đơn của customer)

## Wireframe
Phương án đã chọn: **A** (danh sách dòng một cột, hàng tab trạng thái phía trên, phân trang 20 đơn). **Đây là lựa chọn mặc định** của skill (khuyến nghị theo `U3`), chưa có người dùng chọn: các cổng "duyệt brief", "xác nhận danh sách màn" và "chọn wireframe" không hỏi được ở lần chạy này.

| Phương án | Việc chính thấy ở đâu | Đổi gì | Đánh đổi |
|---|---|---|---|
| **A. Danh sách dòng (khuyên dùng, đã chọn)** | Mã đơn, trạng thái và tổng tiền cùng một dòng, mới nhất trên cùng | Hàng tab trạng thái là bộ lọc chính; mỗi dòng bấm để mở chi tiết | Không có ảnh sản phẩm (dữ liệu danh sách chỉ có số mặt hàng, ORD-REQ-20261006-092320716 BR5) |
| B. Bảng dữ liệu nhiều cột | Cột Mã đơn, Ngày, Trạng thái, Tổng | Giống màn quản trị | Hợp màn làm việc cả ngày của staff, nặng với khách trên điện thoại |
| C. Card mỗi đơn có ảnh và tên sản phẩm | Ảnh và tên mặt hàng đầu tiên | Dễ nhận ra đơn hơn | Cần dữ liệu tên và ảnh mặt hàng trong danh sách mà API chưa trả; logic do bạn nối |

Lý do chọn A: việc khách đến màn này làm là tìm lại một đơn và biết nó đang ở bước nào; thứ để chọn giữa các đơn là trạng thái, ngày và tổng tiền, nên dòng gọn một cột là đủ và đọc tốt cả ở 375px.

```
Thanh header:  ☰  Đơn hàng của tôi                                   🔔  (T)
┌──────────────────────────────────────────────────────────────────────────┐
│ [Tất cả] Chờ xử lý  Đã xác nhận  Đã thanh toán  Đang giao  Đã giao  Đã hoàn  ...  │  <- tab trạng thái (chọn một, tám trạng thái)
├──────────────────────────────────────────────────────────────────────────┤
│ #7K3M9Q2XH4TB   06/10/2026 09:00   3 sản phẩm   (Đã thanh toán)  350.000 đ │  <- mỗi dòng bấm mở chi tiết
│ #5FQ2H8B7C1ZD   03/10/2026 21:14   1 sản phẩm   (Đã hủy)         90.000 đ │
│ #2N6R4T8W0KLA   28/09/2026 08:02   2 sản phẩm   (Đã giao)       210.000 đ │
├──────────────────────────────────────────────────────────────────────────┤
│ 1 tới 20 trong 25 đơn                                      ‹ 1 2 ›        │
└──────────────────────────────────────────────────────────────────────────┘
Dưới sm: tab thành nút "Trạng thái: Tất cả · 25" mở danh sách; mỗi dòng hai tầng (mã trên, ngày dưới; badge trái dưới, tổng căn phải).
```

## Trạng thái
| Trạng thái | Trông ra sao | Requirement |
|---|---|---|
| có dữ liệu | 20 dòng mới nhất trước, tab đang chọn gạch chân, tổng số đơn ở chân, phân trang khi từ 2 trang | ORD-REQ-20261006-092320716 |
| đang tải | Khung chờ đúng hình 5 dòng (mã, ngày, badge, tổng); đổi tab hay trang thì giữ dữ liệu cũ | ORD-REQ-20261006-092320716 |
| rỗng | "Bạn chưa có đơn hàng nào." một dòng chữ mờ, kèm liên kết "Tiếp tục mua sắm" (chưa có đơn nào, tổng 0) | ORD-REQ-20261006-092320716 |
| rỗng do lọc | "Không có đơn nào ở trạng thái này." kèm nút "Xoá lọc"; cũng là trang trống khi đúng 20 đơn mà vào trang 2 | ORD-REQ-20261006-092320716 |
| lỗi | Banner lỗi "Không tải được danh sách đơn." kèm nút "Thử lại"; lỗi bộ lọc không hợp lệ (400) và quá giới hạn tần suất (429, nêu "thử lại sau ít giây") cũng vào đây | ORD-REQ-20261006-092320716 |
| hết phiên | Phiên hết hạn (401): chuyển về đăng nhập, không hiện đơn nào | ORD-REQ-20261006-092320716 |
| trạng thái đơn | Badge theo trạng thái hiện tại của đơn (chờ xử lý, đã xác nhận, đã thanh toán, đang giao, đã giao, đã hoàn, đã hủy, hết hạn), nhãn đọc rõ không chỉ bằng màu | ORD-REQ-20261006-092320790 |

## Phần tử
| testid | Phần tử | Role | Hành động | Requirement |
|---|---|---|---|---|
| ord-order-list-status-filter | Hàng tab lọc trạng thái (dropdown dưới sm) | customer | Chọn một trạng thái hoặc Tất cả | ORD-REQ-20261006-092320716 |
| ord-order-list-clear-filter | Nút Xoá lọc (chỉ khi đang lọc) | customer | Về Tất cả | ORD-REQ-20261006-092320716 |
| ord-order-list-row | Dòng đơn | customer | Bấm để mở chi tiết đơn | ORD-REQ-20261006-092320716 |
| ord-order-list-code | Mã đơn trên dòng (font-mono) | customer | - | ORD-REQ-20261006-092320716 |
| ord-order-list-created-at | Thời điểm tạo đơn | customer | - | ORD-REQ-20261006-092320716 |
| ord-order-list-item-count | Số mặt hàng | customer | - | ORD-REQ-20261006-092320716 |
| ord-order-list-total | Tổng tiền, căn phải | customer | - | ORD-REQ-20261006-092320716 |
| ord-order-list-status-badge | Badge trạng thái đơn | customer | - | ORD-REQ-20261006-092320790 |
| ord-order-list-summary | Dòng "1 tới 20 trong 25 đơn" | customer | - | ORD-REQ-20261006-092320716 |
| ord-order-list-pagination | Phân trang ‹ 1 2 › (ẩn khi một trang) | customer | Sang trang khác | ORD-REQ-20261006-092320716 |
| ord-order-list-loading | Khung chờ | customer | - | ORD-REQ-20261006-092320716 |
| ord-order-list-empty | Vùng rỗng, chưa có đơn | customer | Bấm Tiếp tục mua sắm | ORD-REQ-20261006-092320716 |
| ord-order-list-empty-filtered | Vùng rỗng do lọc | customer | - | ORD-REQ-20261006-092320716 |
| ord-order-list-error | Banner lỗi | customer | - | ORD-REQ-20261006-092320716 |
| ord-order-list-retry | Nút Thử lại | customer | Tải lại danh sách | ORD-REQ-20261006-092320716 |

## Ghi chú thiết kế (mặc định, chưa duyệt)
- **Báo trước theo skill evon:** skill giao diện chưa được dạy cho cửa hàng online phía người mua; màn này vẫn làm theo mẫu "Danh sách có bộ lọc" và "Danh sách rỗng" của evon, kết quả có thể chưa đẹp bằng màn trong app.
- **Audit (câu 2 của evon):** chưa có codebase hay `package.json`, nên không có token, component hay phong cách có sẵn; stack web theo ADR-002 (Next.js), thư viện UI và CSS chưa có ADR. Mặc định theo evon: flat (hướng A), Tailwind và `references/tokens.css`, copy tiếng Việt theo spec. Cần chốt thư viện UI khi chạy PRJ (Project setup) hoặc thêm ADR.
- **Brief (U1, nguồn: đọc spec):** sản phẩm bán hàng online; người dùng là customer đã đăng nhập; việc chính: tìm lại đơn và biết trạng thái; nền tảng dùng nhiều: chưa có dữ liệu, thiết kế cho cả điện thoại (375px) và máy tính.
- **Danh sách màn (U2, mặc định đã xác nhận thay người dùng):** `order-list` (customer, ORD-REQ-...716, ...790), `order-admin-list` (staff, admin, ORD-REQ-...743, ...790), `order-detail` (customer, staff, admin, ORD-REQ-...768, ...790, ...812, ...834). Hủy đơn là hộp thoại trên `order-detail`, lịch sử trạng thái là khối trên `order-detail`.
- Sắp xếp mới nhất trước và 20 đơn mỗi trang cố định, không có ô chọn số dòng mỗi trang (ORD-REQ-20261006-092320716 BR2, BR3).
- Màn customer không có ô tìm, không có cột email hay bộ lọc theo khách (chỉ đơn của mình).
- Phân trang bấm vào dòng cuối thì không dựng thêm màn "vượt trang": trang quá cuối trả danh sách rỗng và hiện trạng thái rỗng do lọc.
- Nhãn trạng thái mặc định: pending "Chờ xử lý", confirmed "Đã xác nhận", paid "Đã thanh toán", shipped "Đang giao", delivered "Đã giao", returned "Đã hoàn" (hàng giao thất bại rồi hoàn về, E-18), cancelled "Đã hủy", expired "Hết hạn". Màu badge theo bảng `M7` của evon.
- Không viết code giao diện; dựng thật là việc của `implement`.
