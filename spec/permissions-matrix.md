# Ma trận role / permission

Hành động đặt theo hàng, role theo cột. `Y` được phép, `-` không, `own` chỉ với dữ liệu của chính mình.
Role lấy từ `spec/domain/roles.md`. Cột `system` là tác nhân hệ thống (cổng thanh toán gọi webhook, job nền, handler event): không đăng nhập, `Y` chỉ ở các hành động tự động (sau nền sửa 2026-10-06, role `system` thay cho `admin` giữ chỗ).
Mỗi epic thêm dòng khi chạy sdlc-research của epic đó.

| Hành động | Requirement | guest | customer | staff | admin | system |
|---|---|---|---|---|---|---|
| Xem danh sách đơn của mình (lọc theo trạng thái) | ORD-REQ-20261006-092320716 | - | own | - | - | - |
| Xem danh sách mọi đơn, lọc trạng thái, tìm theo mã đơn | ORD-REQ-20261006-092320743 | - | - | Y | Y | - |
| Xem chi tiết đơn | ORD-REQ-20261006-092320768 | - | own | Y | Y | - |
| Xem trạng thái đơn | ORD-REQ-20261006-092320790 | - | own | Y | Y | Y |
| Xem lịch sử trạng thái đơn | ORD-REQ-20261006-092320812 | - | own | Y | Y | - |
| Hủy đơn (trước khi giao) | ORD-REQ-20261006-092320834 | - | own | - | Y | - |
| Đăng ký tài khoản | AUTH-REQ-20261006-095515620 | Y | - | - | - | - |
| Xác minh email bằng liên kết | AUTH-REQ-20261006-095515665 | Y | Y | Y | Y | - |
| Gửi lại email xác minh | AUTH-REQ-20261006-095515702 | - | own | - | - | - |
| Đăng nhập | AUTH-REQ-20261006-095515738 | Y | - | - | - | - |
| Đăng xuất (phiên hiện tại) | AUTH-REQ-20261006-095515774 | - | own | own | own | - |
| Xem thông tin và hạn của phiên hiện tại | AUTH-REQ-20261006-095515808 | - | own | own | own | - |
| Quên mật khẩu (yêu cầu liên kết đặt lại) | AUTH-REQ-20261006-095515843 | Y | - | - | - | - |
| Đặt lại mật khẩu bằng token | AUTH-REQ-20261006-095515881 | Y | - | - | - | - |
| Kiểm quyền endpoint theo role (mặc định từ chối) | AUTH-REQ-20261006-095515918 | Y | Y | Y | Y | - |
| Xem danh sách người dùng (lọc, tìm theo email) | AUTH-REQ-20261006-095515956 | - | - | - | Y | - |
| Đổi role người dùng | AUTH-REQ-20261006-095515956 | - | - | - | Y | - |
| Khóa tài khoản người dùng | AUTH-REQ-20261006-095515994 | - | - | - | Y | - |
| Mở khóa tài khoản người dùng | AUTH-REQ-20261006-095515994 | - | - | - | Y | - |
| Xem cây danh mục | PRD-REQ-20261006-095502484 | Y | Y | Y | Y | - |
| Tạo và sửa danh mục | PRD-REQ-20261006-095502507 | - | - | - | Y | - |
| Xóa danh mục | PRD-REQ-20261006-095502529 | - | - | - | Y | - |
| Tạo sản phẩm nháp | PRD-REQ-20261006-095502550 | - | - | - | Y | - |
| Sửa thông tin sản phẩm | PRD-REQ-20261006-095502571 | - | - | - | Y | - |
| Quản lý ảnh sản phẩm | PRD-REQ-20261006-095502592 | - | - | - | Y | - |
| Công bố sản phẩm | PRD-REQ-20261006-095502613 | - | - | - | Y | - |
| Ngừng bán hoặc hủy nháp sản phẩm | PRD-REQ-20261006-095502634 | - | - | - | Y | - |
| Xem danh sách và chi tiết sản phẩm ở trang quản trị (mọi trạng thái) | PRD-REQ-20261006-095502655 | - | - | Y | Y | - |
| Xem chi tiết sản phẩm đang bán | PRD-REQ-20261006-095502676 | Y | Y | Y | Y | - |
| Duyệt sản phẩm theo danh mục, lọc giá, sắp xếp | PRD-REQ-20261006-095502697 | Y | Y | Y | Y | - |
| Tìm kiếm sản phẩm theo từ khóa | PRD-REQ-20261006-095502718 | Y | Y | Y | Y | - |
| Xem điểm đánh giá của sản phẩm | PRD-REQ-20261006-095502739 | Y | Y | Y | Y | Y |
| Dựng dự án, chạy CI, kiểm ranh giới module (developer/vận hành qua CLI và CI, không có endpoint) | PRJ-REQ-20261006-095422475 | - | - | - | - | Y |
| Chạy migration, seed, sao lưu CSDL (vận hành qua CLI và nền tảng host, không có endpoint) | PRJ-REQ-20261006-095422563 | - | - | - | - | Y |
| Gọi API qua quy ước chung: phân trang, kiểm đầu vào, CORS, CSRF, giới hạn tần suất | PRJ-REQ-20261006-095422650 | Y | Y | Y | Y | - |
| Gọi health liveness và readiness (`/api/v1/health`, `/api/v1/health/ready`) | PRJ-REQ-20261006-095422650 | Y | Y | Y | Y | - |
| Cấu hình biến môi trường và bí mật (vận hành qua kho bí mật của host, không có endpoint) | PRJ-REQ-20261006-095422735 | - | - | - | - | Y |
| Nhận lỗi chuẩn problem+json kèm trace_id | PRJ-REQ-20261006-095422820 | Y | Y | Y | Y | - |
| Đọc log và audit log (chỉ vận hành có quyền CSDL và host, chưa có API) | PRJ-REQ-20261006-095422908 | - | - | - | - | Y |
| Xem danh sách và chi tiết tồn kho | INV-REQ-20261006-101122435 | - | - | Y | Y | - |
| Nhập kho | INV-REQ-20261006-101122463 | - | - | Y | Y | - |
| Xuất kho thủ công | INV-REQ-20261006-101122487 | - | - | Y | Y | - |
| Điều chỉnh tồn kho theo kiểm kê | INV-REQ-20261006-101122512 | - | - | Y | Y | - |
| Giữ hàng cho đơn (CHK gọi nội bộ trong giao dịch tạo đơn, không có endpoint) | INV-REQ-20261006-101122538 | - | - | - | - | Y |
| Chốt và nhả hàng giữ theo event của đơn, thanh toán, giao hàng (tác nhân hệ thống, không có endpoint) | INV-REQ-20261006-101122562 | - | - | - | - | Y |
| Hết hạn giữ hàng bằng job mỗi phút (tác nhân hệ thống, không có endpoint) | INV-REQ-20261006-101122587 | - | - | - | - | Y |
| Đặt ngưỡng tồn thấp | INV-REQ-20261006-101122611 | - | - | Y | Y | - |
| Xem danh sách sản phẩm tồn thấp | INV-REQ-20261006-101122611 | - | - | Y | Y | - |
| Xem lịch sử biến động kho của một sản phẩm | INV-REQ-20261006-101122637 | - | - | Y | Y | - |
| Bảo đảm không bán vượt tồn và hỏi số còn bán được (giao diện nội bộ cho CRT, CHK, không có endpoint) | INV-REQ-20261006-101122661 | - | - | - | - | Y |
| Tạo và khóa bản ghi kho theo ProductActivated, ProductArchived (tác nhân hệ thống, không có endpoint) | INV-REQ-20261006-101122685 | - | - | - | - | Y |
| Tạo coupon | PRM-REQ-20261006-101036201 | - | - | - | Y | - |
| Sửa coupon (giá trị, điều kiện, hạn, số lượt) | PRM-REQ-20261006-101036227 | - | - | - | Y | - |
| Xóa coupon (xóa mềm) | PRM-REQ-20261006-101036252 | - | - | - | Y | - |
| Bật và tắt coupon | PRM-REQ-20261006-101036275 | - | - | - | Y | - |
| Xem danh sách và chi tiết coupon (quản trị) | PRM-REQ-20261006-101036299 | - | - | - | Y | - |
| Kiểm tra mã và xem tiền giảm (qua giỏ và checkout, PRM không có endpoint công khai) | PRM-REQ-20261006-101036327 | - | Y | - | - | - |
| Giảm theo phần trăm có mức giảm tối đa (qua giỏ và checkout) | PRM-REQ-20261006-101036352 | - | Y | - | - | - |
| Giảm theo số tiền cố định (qua giỏ và checkout) | PRM-REQ-20261006-101036376 | - | Y | - | - | - |
| Điều kiện giá trị đơn tối thiểu của coupon (qua giỏ và checkout) | PRM-REQ-20261006-101036400 | - | Y | - | - | - |
| Hạn dùng của coupon (qua giỏ và checkout) | PRM-REQ-20261006-101036424 | - | Y | - | - | Y |
| Giới hạn lượt dùng của coupon (qua giỏ và checkout) | PRM-REQ-20261006-101036447 | - | Y | - | - | - |
| Giữ, tiêu thụ, nhả lượt coupon theo vòng đời đơn (do event, không có endpoint) | PRM-REQ-20261006-101036470 | - | own | - | - | Y |
| Xem danh sách mọi phương thức vận chuyển (kể cả đã tắt) | SHP-REQ-20261006-101103755 | - | - | - | Y | - |
| Tạo và sửa phương thức vận chuyển | SHP-REQ-20261006-101103755 | - | - | - | Y | - |
| Bật hoặc tắt phương thức vận chuyển | SHP-REQ-20261006-101103755 | - | - | - | Y | - |
| Xem các phương thức vận chuyển đang áp dụng | SHP-REQ-20261006-101103782 | - | Y | - | - | - |
| Báo phí vận chuyển theo phương thức, thành phố và tạm tính | SHP-REQ-20261006-101103806 | - | Y | - | - | - |
| Tạo vận đơn tự động khi đơn paid hoặc confirmed (event của ORD, không có endpoint) | SHP-REQ-20261006-101103829 | - | - | - | - | Y |
| Bàn giao vận đơn và nhập mã vận đơn | SHP-REQ-20261006-101103855 | - | - | Y | Y | - |
| Sửa mã vận đơn đã nhập | SHP-REQ-20261006-101103880 | - | - | Y | Y | - |
| Xác nhận giao xong, báo giao thất bại, xác nhận hàng hoàn về kho | SHP-REQ-20261006-101103903 | - | - | Y | Y | - |
| Xem danh sách vận đơn (lọc theo trạng thái, mã đơn, mã vận đơn) | SHP-REQ-20261006-101103927 | - | - | Y | Y | - |
| Xem trạng thái và chi tiết vận đơn của một đơn | SHP-REQ-20261006-101103927 | - | own | Y | Y | - |
| Hủy vận đơn chưa bàn giao khi đơn bị hủy (event của ORD, không có endpoint) | SHP-REQ-20261006-101103950 | - | - | - | - | Y |
| Xem lịch sử trạng thái vận đơn | SHP-REQ-20261006-101103972 | - | own | Y | Y | - |
| Xem hồ sơ cá nhân | USR-REQ-20261006-101003419 | - | own | own | own | - |
| Sửa hồ sơ cá nhân (họ tên, điện thoại) | USR-REQ-20261006-101003504 | - | own | own | own | - |
| Đổi mật khẩu | USR-REQ-20261006-101003591 | - | own | own | own | - |
| Tải lên và xóa ảnh đại diện | USR-REQ-20261006-101003679 | - | own | own | own | - |
| Xem danh sách địa chỉ giao hàng của mình | USR-REQ-20261006-101003767 | - | own | - | - | - |
| Thêm địa chỉ giao hàng | USR-REQ-20261006-101003855 | - | own | - | - | - |
| Sửa địa chỉ và đặt địa chỉ mặc định | USR-REQ-20261006-101003941 | - | own | - | - | - |
| Xóa địa chỉ giao hàng | USR-REQ-20261006-101004028 | - | own | - | - | - |
| Tra cứu hồ sơ khách (staff: bản che; admin: đầy đủ kèm địa chỉ) | USR-REQ-20261006-101004117 | - | - | Y | Y | - |
| Bắt đầu phiên checkout từ giỏ (cần email đã xác minh) | CHK-REQ-20261006-105050948 | - | own | - | - | - |
| Chọn địa chỉ giao hàng cho phiên checkout | CHK-REQ-20261006-105051095 | - | own | - | - | - |
| Chọn phương thức vận chuyển và xem phí theo địa chỉ | CHK-REQ-20261006-105051242 | - | own | - | - | - |
| Chọn phương thức thanh toán (VNPay hoặc COD) | CHK-REQ-20261006-105051386 | - | own | - | - | - |
| Áp và gỡ mã giảm giá ở checkout | CHK-REQ-20261006-105051536 | - | own | - | - | - |
| Xem lại đơn trước khi đặt | CHK-REQ-20261006-105051681 | - | own | - | - | - |
| Kiểm tra giá khi đặt đơn (trong giao dịch đặt hàng, không có endpoint) | CHK-REQ-20261006-105051825 | - | own | - | - | - |
| Kiểm tra tồn kho khi xem lại và khi đặt đơn (không có endpoint riêng) | CHK-REQ-20261006-105051977 | - | own | - | - | - |
| Giữ hàng và giữ lượt coupon trong giao dịch đặt đơn (gọi nội bộ INV, PRM, không có endpoint) | CHK-REQ-20261006-105052127 | - | own | - | - | - |
| Đặt hàng và tạo đơn | CHK-REQ-20261006-105052272 | - | own | - | - | - |
| Hủy phiên checkout và hết hạn phiên (khách hủy; job hết hạn là tác nhân hệ thống) | CHK-REQ-20261006-105052414 | - | own | - | - | Y |
| Thêm sản phẩm vào giỏ | CRT-REQ-20261006-103226376 | - | own | - | - | - |
| Đổi số lượng của một dòng trong giỏ | CRT-REQ-20261006-103226406 | - | own | - | - | - |
| Xóa một sản phẩm khỏi giỏ | CRT-REQ-20261006-103226434 | - | own | - | - | - |
| Làm trống giỏ | CRT-REQ-20261006-103226460 | - | own | - | - | - |
| Xem giỏ, tạm tính, huy hiệu giỏ và cập nhật giá | CRT-REQ-20261006-103226486 | - | own | - | - | - |
| Áp và gỡ mã giảm giá trên giỏ | CRT-REQ-20261006-103226511 | - | own | - | - | - |
| Chọn phương thức vận chuyển và xem phí trên giỏ | CRT-REQ-20261006-103226537 | - | own | - | - | - |
| Xem tổng tiền giỏ (CHK đọc giỏ đã định giá qua giao diện nội bộ, không có endpoint riêng) | CRT-REQ-20261006-103226562 | - | own | - | - | - |
| Kiểm tồn khi thêm, sửa và xem giỏ (không giữ hàng, không có endpoint riêng) | CRT-REQ-20261006-103226588 | - | own | - | - | - |
| Chuyển giỏ sang đã đặt, đánh dấu dòng ngừng bán, dọn giỏ bỏ dở (do event và job, không có endpoint) | CRT-REQ-20261006-103226614 | - | - | - | - | Y |
| Mở trang dashboard (kiểm quyền admin, lỗi từng khối, độ tươi) | DSH-REQ-20261006-105126549 | - | - | - | Y | - |
| Xem tổng doanh thu và hoàn tiền thất bại cần xử lý | DSH-REQ-20261006-105125714 | - | - | - | Y | - |
| Xem tổng số đơn theo trạng thái | DSH-REQ-20261006-105125811 | - | - | - | Y | - |
| Xem tổng số khách hàng | DSH-REQ-20261006-105125901 | - | - | - | Y | - |
| Xem tổng số sản phẩm theo trạng thái | DSH-REQ-20261006-105125995 | - | - | - | Y | - |
| Xem sản phẩm tồn thấp trên dashboard | DSH-REQ-20261006-105126089 | - | - | - | Y | - |
| Xem đơn hàng gần đây trên dashboard | DSH-REQ-20261006-105126180 | - | - | - | Y | - |
| Xem báo cáo doanh thu theo khoảng ngày | DSH-REQ-20261006-105126271 | - | - | - | Y | - |
| Xem báo cáo đơn hàng theo khoảng ngày | DSH-REQ-20261006-105126368 | - | - | - | Y | - |
| Xem báo cáo sản phẩm bán chạy | DSH-REQ-20261006-105126458 | - | - | - | Y | - |
| Tạo thông báo trong ứng dụng từ domain event (tác nhân hệ thống, không có endpoint; role là người nhận) | NTF-REQ-20261006-103208460 | - | own | own | own | Y |
| Gửi email thông báo qua SES (tác nhân hệ thống, không có endpoint; role là người nhận) | NTF-REQ-20261006-103208551 | - | own | own | own | Y |
| Nhận thông báo đơn đã tạo và đã xác nhận (do event, không có endpoint) | NTF-REQ-20261006-103208641 | - | own | - | - | Y |
| Nhận thông báo thanh toán thành công (do event, không có endpoint) | NTF-REQ-20261006-103208725 | - | own | - | - | Y |
| Nhận thông báo đơn đang giao và giao thất bại (do event, không có endpoint) | NTF-REQ-20261006-103208812 | - | own | - | - | Y |
| Nhận thông báo đơn đã giao (do event, không có endpoint) | NTF-REQ-20261006-103208902 | - | own | - | - | Y |
| Nhận thông báo thanh toán thất bại, đơn bị hủy, hoàn tiền (do event, không có endpoint) | NTF-REQ-20261006-103208992 | - | own | - | - | Y |
| Nhận email đặt lại mật khẩu, xác minh email, báo đổi mật khẩu, báo khóa tài khoản (do event, không có endpoint; guest yêu cầu ở AUTH nhưng người nhận là chủ tài khoản) | NTF-REQ-20261006-103209078 | - | own | own | own | Y |
| Nhận cảnh báo tồn thấp (do event, không có endpoint) | NTF-REQ-20261006-103209168 | - | - | own | own | Y |
| Nhận cảnh báo hoàn tiền thất bại (do event, không có endpoint; chỉ admin vì hoàn tiền thủ công chỉ admin) | NTF-REQ-20261006-103209168 | - | - | - | own | Y |
| Xem số thông báo chưa đọc | NTF-REQ-20261006-103209256 | - | own | own | own | - |
| Đánh dấu một thông báo đã đọc | NTF-REQ-20261006-103209256 | - | own | own | own | - |
| Đánh dấu tất cả thông báo đã đọc | NTF-REQ-20261006-103209256 | - | own | own | own | - |
| Xem lịch sử thông báo của mình (lọc đọc hoặc chưa đọc, theo loại) | NTF-REQ-20261006-103209345 | - | own | own | own | - |
| Tạo thanh toán khi đơn được tạo (event OrderCreated, không có endpoint) | PAY-REQ-20261006-103110331 | - | - | - | - | Y |
| Bắt đầu thanh toán online qua VNPay | PAY-REQ-20261006-103110422 | - | own | - | - | - |
| Nhận webhook IPN của VNPay (cổng gọi, xác thực bằng chữ ký) | PAY-REQ-20261006-103110513 | Y | - | - | - | Y |
| Ghi nhận đã thu tiền COD | PAY-REQ-20261006-103110597 | - | - | Y | Y | Y |
| Ghi nhận thanh toán online thành công (kết quả webhook, không có endpoint riêng) | PAY-REQ-20261006-103110597 | - | - | - | - | Y |
| Ghi nhận thanh toán thất bại, đếm lượt thử, đối soát quá thời gian (hệ thống, không có endpoint) | PAY-REQ-20261006-103110684 | - | - | - | - | Y |
| Thử lại thanh toán online | PAY-REQ-20261006-103110771 | - | own | - | - | - |
| Đóng thanh toán khi đơn hết hạn hoặc bị hủy (event, không có endpoint) | PAY-REQ-20261006-103110858 | - | - | - | - | Y |
| Hoàn tiền tự động (hủy đơn đã thanh toán, thanh toán muộn, thanh toán trùng; hệ thống, không có endpoint) | PAY-REQ-20261006-103110946 | - | - | - | - | Y |
| Hoàn tiền thủ công toàn phần | PAY-REQ-20261006-103111034 | - | - | - | Y | - |
| Thử lại hoàn tiền thất bại | PAY-REQ-20261006-103111034 | - | - | - | Y | - |
| Xem danh sách thanh toán của mình | PAY-REQ-20261006-103111122 | - | own | - | - | - |
| Xem chi tiết thanh toán của mình | PAY-REQ-20261006-103111122 | - | own | - | - | - |
| Xem danh sách mọi thanh toán (lọc trạng thái, phương thức, mã đơn) | PAY-REQ-20261006-103111211 | - | - | Y | Y | - |
| Xem chi tiết thanh toán (mã giao dịch cổng, lượt thử, webhook, hoàn tiền) | PAY-REQ-20261006-103111211 | - | - | Y | Y | - |
| Xem danh sách hoàn tiền (hàng đợi hoàn tiền thất bại) | PAY-REQ-20261006-103111211 | - | - | Y | Y | - |
| Tạo đánh giá sản phẩm (người đã nhận hàng) | REV-REQ-20261006-103134939 | - | Y | - | - | - |
| Chấm điểm sao khi tạo hoặc sửa đánh giá | REV-REQ-20261006-103135029 | - | Y | - | - | - |
| Viết bình luận khi tạo hoặc sửa đánh giá | REV-REQ-20261006-103135117 | - | Y | - | - | - |
| Tải ảnh đính kèm đánh giá | REV-REQ-20261006-103135207 | - | Y | - | - | - |
| Kiểm điều kiện được đánh giá sản phẩm (mua có xác minh) | REV-REQ-20261006-103135296 | - | own | - | - | - |
| Sửa đánh giá của mình | REV-REQ-20261006-103135385 | - | own | - | - | - |
| Xóa đánh giá (chủ hoặc admin) | REV-REQ-20261006-103135477 | - | own | - | Y | - |
| Xem đánh giá công khai của sản phẩm | REV-REQ-20261006-103135566 | Y | Y | Y | Y | - |
| Xem đánh giá của tôi (danh sách và chi tiết) | REV-REQ-20261006-103135655 | - | own | - | - | - |
| Xem hàng đợi và danh sách đánh giá để kiểm duyệt | REV-REQ-20261006-103135744 | - | - | - | Y | - |
| Duyệt đánh giá chờ duyệt | REV-REQ-20261006-103135835 | - | - | - | Y | - |
| Từ chối đánh giá chờ duyệt | REV-REQ-20261006-103135835 | - | - | - | Y | - |
| Ẩn đánh giá đã đăng | REV-REQ-20261006-103135835 | - | - | - | Y | - |
| Xem còn hàng hay hết hàng theo lô (công khai, không lộ số tồn) | INV-REQ-20261006-120036236 | Y | Y | Y | Y | - |
| Giao diện nội bộ cho CHK - tạo đơn, xác nhận COD, đếm đơn mở, tóm tắt đơn | ORD-REQ-20261006-120227589 | - | - | - | - | Y |
| Giao diện đọc nội bộ cho PAY, SHP, REV và DSH | ORD-REQ-20261006-120227681 | - | - | - | - | Y |

## Thay đổi
| Ngày | Dòng | Từ | Thành | Lý do | Người duyệt |
|---|---|---|---|---|---|
| 2026-10-06 | Toàn bộ 6 dòng ORD | (chưa có) | (dòng mới) | Tạo ma trận lần đầu cho epic ORD; chưa có dòng cũ bị đổi quyền | chưa duyệt |
| 2026-10-06 | 13 dòng AUTH | (chưa có) | (dòng mới) | Gộp dòng ma trận của epic AUTH (các epic chạy song song nên gộp một lần) | chưa duyệt |
| 2026-10-06 | 13 dòng PRD | (chưa có) | (dòng mới) | Gộp dòng ma trận của epic PRD (các epic chạy song song nên gộp một lần) | chưa duyệt |
| 2026-10-06 | 7 dòng PRJ | (chưa có) | (dòng mới) | Gộp dòng ma trận của epic PRJ (các epic chạy song song nên gộp một lần) | chưa duyệt |
| 2026-10-06 | 12 dòng INV | (chưa có) | (dòng mới) | Gộp dòng ma trận của epic INV (các epic chạy song song nên gộp một lần) | chưa duyệt |
| 2026-10-06 | 12 dòng PRM | (chưa có) | (dòng mới) | Gộp dòng ma trận của epic PRM (các epic chạy song song nên gộp một lần) | chưa duyệt |
| 2026-10-06 | 13 dòng SHP | (chưa có) | (dòng mới) | Gộp dòng ma trận của epic SHP (các epic chạy song song nên gộp một lần) | chưa duyệt |
| 2026-10-06 | 9 dòng USR | (chưa có) | (dòng mới) | Gộp dòng ma trận của epic USR (các epic chạy song song nên gộp một lần) | chưa duyệt |
| 2026-10-06 | 11 dòng CHK | (chưa có) | (dòng mới) | Gộp dòng ma trận của epic CHK (các epic chạy song song nên gộp một lần) | chưa duyệt |
| 2026-10-06 | 10 dòng CRT | (chưa có) | (dòng mới) | Gộp dòng ma trận của epic CRT (các epic chạy song song nên gộp một lần) | chưa duyệt |
| 2026-10-06 | 10 dòng DSH | (chưa có) | (dòng mới) | Gộp dòng ma trận của epic DSH (các epic chạy song song nên gộp một lần) | chưa duyệt |
| 2026-10-06 | 14 dòng NTF | (chưa có) | (dòng mới) | Gộp dòng ma trận của epic NTF (các epic chạy song song nên gộp một lần) | chưa duyệt |
| 2026-10-06 | 16 dòng PAY | (chưa có) | (dòng mới) | Gộp dòng ma trận của epic PAY (các epic chạy song song nên gộp một lần) | chưa duyệt |
| 2026-10-06 | 13 dòng REV | (chưa có) | (dòng mới) | Gộp dòng ma trận của epic REV (các epic chạy song song nên gộp một lần) | chưa duyệt |
| 2026-10-06 | cột system, 34 dòng đặt Y, 3 dòng mới | (chưa có) | Y theo roles của requirement | Role `system` thêm vào nền (R-01); thêm hàng cho requirement tạo sau lần gộp đầu (ORD giao diện CHK/đọc, INV availability). Dòng mới chỉ ghi `Y` ở role khai trong requirement, cần người rà `own` | chưa duyệt |
