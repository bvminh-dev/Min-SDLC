-- NTF-DB-20261006-103815422 (REV-NTF-04): CHECK `notifications.link` không cho `//` ở đầu. Biểu thức cũ `^/[A-Za-z0-9/_-]*$` cho qua `//intranet` và `//2130706433`
-- (URL cùng giao thức, host không chấm). Biểu thức mới `^/([A-Za-z0-9_-][A-Za-z0-9/_-]*)?$` cùng với `safeLink` ở web (apps/web/lib/notification-const.ts) và NTF-SEC T15.
-- Không sửa migration đã áp dụng (20261009000300_notification_tables): thêm CHECK mới (mở rộng, chặt hơn) rồi bỏ CHECK cũ (thu hẹp).
-- Bản ứng dụng cũ chỉ ghi liên kết `/orders...`, `/admin/...` nên không lỗi với CHECK mới; dữ liệu cũ vi phạm thì lệnh ADD dừng migration (không có đường dữ liệu nào tạo `//` đầu).
-- Rollback: thêm lại CHECK cũ `notifications_link_internal` rồi bỏ `notifications_link_internal_v2`; không mất dữ liệu.
-- contract-step: 20261009000300_notification_tables

ALTER TABLE "notifications"
  ADD CONSTRAINT "notifications_link_internal_v2" CHECK (link IS NULL OR link ~ '^/([A-Za-z0-9_-][A-Za-z0-9/_-]*)?$');

ALTER TABLE "notifications" DROP CONSTRAINT "notifications_link_internal";
