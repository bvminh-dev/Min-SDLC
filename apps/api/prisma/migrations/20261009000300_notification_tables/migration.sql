-- NTF-DB-20261006-103815422 (Migration 1 đến 5): bảng của module notification (notifications, email_deliveries) cùng 5 enum.
-- Thứ tự giữa module: platform, auth, ..., checkout, notification. Khóa ngoại chỉ tới `users` (AUTH, ON DELETE CASCADE để xóa dữ liệu cá nhân theo người dùng); mã đơn, thanh toán, sản phẩm là cột trơn hoặc nằm trong `data`.
-- Không tạo `processed_events` (bảng của platform). Không có dữ liệu mồi, không nạp ngược từ bảng nào.
-- Ngoài thiết kế (ghi ở report NTF, Lệch spec): hai trigger vòng đời (notifications: chỉ `unread -> read`, chỉ ghi `status`, `read_at`, `updated_at`; email_deliveries: chỉ rời `pending` một lần, trạng thái cuối bất biến) là lớp bảo vệ thứ hai của SB-24.
-- Rollback (chỉ an toàn khi chưa có dữ liệu thật): bỏ trigger và hàm, bỏ bảng email_deliveries, notifications theo thứ tự ngược, bỏ 5 kiểu enum; sau đó chỉ tiến (forward-only).

-- CreateEnum
CREATE TYPE "notification_channel" AS ENUM ('in_app');

-- CreateEnum
CREATE TYPE "notification_type" AS ENUM ('order_created', 'order_confirmed', 'payment_succeeded', 'payment_failed', 'order_cancelled', 'refund_succeeded', 'order_shipped', 'shipment_failed', 'order_delivered', 'order_returned', 'order_expired', 'welcome', 'password_changed', 'low_stock', 'refund_failed');

-- CreateEnum
CREATE TYPE "notification_status" AS ENUM ('unread', 'read');

-- CreateEnum
CREATE TYPE "email_type" AS ENUM ('order_created', 'payment_succeeded', 'order_cancelled', 'refund_succeeded', 'order_shipped', 'shipment_failed', 'order_delivered', 'order_returned', 'password_changed', 'account_locked', 'email_verification', 'password_reset');

-- CreateEnum
CREATE TYPE "email_delivery_status" AS ENUM ('pending', 'sent', 'failed', 'skipped');

-- CreateTable
CREATE TABLE "notifications" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "channel" "notification_channel" NOT NULL DEFAULT 'in_app',
    "type" "notification_type" NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "link" TEXT,
    "data" JSONB NOT NULL DEFAULT '{}',
    "status" "notification_status" NOT NULL DEFAULT 'unread',
    "read_at" TIMESTAMPTZ(6),
    "event_id" UUID NOT NULL,
    "dedupe_key" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT clock_timestamp(),
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "email_deliveries" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "type" "email_type" NOT NULL,
    "delivery_status" "email_delivery_status" NOT NULL DEFAULT 'pending',
    "delivery_reason" TEXT,
    "attempts" SMALLINT NOT NULL DEFAULT 0,
    "next_attempt_at" TIMESTAMPTZ(6),
    "sent_at" TIMESTAMPTZ(6),
    "event_id" UUID NOT NULL,
    "dedupe_key" TEXT NOT NULL,
    "data" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT clock_timestamp(),
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "email_deliveries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "notifications_user_id_created_at_id_idx" ON "notifications"("user_id", "created_at" DESC, "id" DESC);

-- CreateIndex
CREATE INDEX "notifications_created_at_idx" ON "notifications"("created_at");

-- CreateIndex
CREATE UNIQUE INDEX "notifications_user_id_dedupe_key_key" ON "notifications"("user_id", "dedupe_key");

-- CreateIndex
CREATE INDEX "email_deliveries_created_at_idx" ON "email_deliveries"("created_at");

-- CreateIndex
CREATE UNIQUE INDEX "email_deliveries_user_id_type_dedupe_key_key" ON "email_deliveries"("user_id", "type", "dedupe_key");

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "email_deliveries" ADD CONSTRAINT "email_deliveries_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Ràng buộc toàn vẹn (Prisma không biểu diễn được; NTF-DB mục Bảng)
ALTER TABLE "notifications"
  ADD CONSTRAINT "notifications_title_len" CHECK (char_length(title) BETWEEN 1 AND 120),
  ADD CONSTRAINT "notifications_body_len" CHECK (char_length(body) BETWEEN 1 AND 500),
  -- chỉ đường dẫn nội bộ một dấu gạch chéo đầu (T15): không `//host`, không `https://`, không `?`, không ký tự lạ
  ADD CONSTRAINT "notifications_link_internal" CHECK (link IS NULL OR link ~ '^/[A-Za-z0-9/_-]*$'),
  ADD CONSTRAINT "notifications_data_object" CHECK (jsonb_typeof(data) = 'object'),
  ADD CONSTRAINT "notifications_read_at_matches_status" CHECK ((status = 'read') = (read_at IS NOT NULL)),
  ADD CONSTRAINT "notifications_dedupe_key_len" CHECK (char_length(dedupe_key) <= 120);

ALTER TABLE "email_deliveries"
  ADD CONSTRAINT "email_deliveries_reason_len" CHECK (char_length(delivery_reason) <= 50),
  ADD CONSTRAINT "email_deliveries_attempts_range" CHECK (attempts BETWEEN 0 AND 3),
  ADD CONSTRAINT "email_deliveries_dedupe_key_len" CHECK (char_length(dedupe_key) <= 120),
  ADD CONSTRAINT "email_deliveries_data_object" CHECK (jsonb_typeof(data) = 'object'),
  -- email chứa bí mật không có dữ liệu nào (T2): token thô không thể nằm trong cột nào
  ADD CONSTRAINT "email_deliveries_secret_no_data" CHECK (type NOT IN ('email_verification', 'password_reset') OR data = '{}'::jsonb);

-- Chỉ mục một phần (NTF-DB mục Bảng): đếm chưa đọc, một thông báo chưa đọc mỗi sản phẩm hoặc mỗi hoàn tiền mỗi người (NTF-REQ-20261006-103209168 BR4), job gửi, hạn mức
CREATE INDEX "notifications_unread_idx" ON "notifications"("user_id") WHERE status = 'unread';
CREATE UNIQUE INDEX "notifications_low_stock_unread_key" ON "notifications"("user_id", (jsonb_extract_path_text(data, 'product_id'))) WHERE type = 'low_stock' AND status = 'unread';
CREATE UNIQUE INDEX "notifications_refund_failed_unread_key" ON "notifications"("user_id", (jsonb_extract_path_text(data, 'refund_id'))) WHERE type = 'refund_failed' AND status = 'unread';
CREATE INDEX "email_deliveries_due_idx" ON "email_deliveries"("next_attempt_at", "id") WHERE delivery_status = 'pending' AND next_attempt_at IS NOT NULL;
CREATE INDEX "email_deliveries_sent_idx" ON "email_deliveries"("user_id", "sent_at" DESC) WHERE delivery_status = 'sent';

-- Vòng đời (SB-24, lớp bảo vệ thứ hai; mã dùng bảng chuyển ở NTF-DB mục Giao dịch và khóa): thông báo chỉ `unread -> read`, nội dung bất biến
CREATE FUNCTION "notifications_guard"() RETURNS trigger AS $$
BEGIN
  IF OLD.status = 'read' AND (NEW.status IS DISTINCT FROM OLD.status OR NEW.read_at IS DISTINCT FROM OLD.read_at) THEN
    RAISE EXCEPTION 'notification already read (status is terminal)' USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF (NEW.user_id, NEW.channel, NEW.type, NEW.title, NEW.body, NEW.link, NEW.data, NEW.event_id, NEW.dedupe_key, NEW.created_at)
     IS DISTINCT FROM (OLD.user_id, OLD.channel, OLD.type, OLD.title, OLD.body, OLD.link, OLD.data, OLD.event_id, OLD.dedupe_key, OLD.created_at) THEN
    RAISE EXCEPTION 'notification content is immutable' USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "notifications_guard" BEFORE UPDATE ON "notifications" FOR EACH ROW EXECUTE FUNCTION "notifications_guard"();

-- Email: trạng thái gửi `sent`, `failed`, `skipped` là cuối (không đổi lại); người nhận, loại, khóa chống trùng, dữ liệu bất biến
CREATE FUNCTION "email_deliveries_guard"() RETURNS trigger AS $$
BEGIN
  IF OLD.delivery_status <> 'pending' THEN
    RAISE EXCEPTION 'email delivery already final (%)', OLD.delivery_status USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF (NEW.user_id, NEW.type, NEW.event_id, NEW.dedupe_key, NEW.data, NEW.created_at) IS DISTINCT FROM (OLD.user_id, OLD.type, OLD.event_id, OLD.dedupe_key, OLD.data, OLD.created_at) THEN
    RAISE EXCEPTION 'email delivery identity is immutable' USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "email_deliveries_guard" BEFORE UPDATE ON "email_deliveries" FOR EACH ROW EXECUTE FUNCTION "email_deliveries_guard"();
