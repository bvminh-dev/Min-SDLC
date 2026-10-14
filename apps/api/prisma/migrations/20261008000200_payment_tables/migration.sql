-- PAY-DB-20261006-103701241 (Migration 1 đến 6): bảng của module payment (payments, payment_attempts, refunds, payment_webhook_logs) cùng 6 enum.
-- Thứ tự giữa module: platform, auth, user, catalog, inventory, promotion, order, shipping, payment. Khóa ngoại chỉ tới bảng của PAY và `orders` (ORD, ràng buộc toàn vẹn; PAY không SELECT `orders`, SB-35).
-- `payments.user_id` là cột trơn, không khóa ngoại (bảng `users` của AUTH không nằm trong Phụ thuộc của PAY). Không có dữ liệu mồi.
-- Ngoài thiết kế (đã ghi ở report PAY, Lệch spec): trigger chặn chuyển trạng thái ngoài vòng đời (payments, refunds; lớp bảo vệ thứ hai của SB-24), hai chỉ mục một phần theo `paid_at`
-- và `resolved_at` cho DSH (getRevenue, DSH-DB đề nghị), chỉ mục một phần cho job đối soát hoàn tiền.
-- Rollback (chỉ an toàn khi chưa có dữ liệu tiền thật): bỏ trigger và hàm của bốn bảng, bỏ bảng refunds, payment_webhook_logs, payment_attempts, payments theo thứ tự ngược, bỏ 6 kiểu enum;
-- sau khi có dữ liệu tiền thật thì KHÔNG rollback bằng xóa mà thêm migration sửa tiếp (dữ liệu tài chính giữ theo quy định).

-- CreateEnum
CREATE TYPE "payment_method" AS ENUM ('vnpay', 'cod');

-- CreateEnum
CREATE TYPE "payment_status" AS ENUM ('pending', 'processing', 'succeeded', 'failed', 'expired', 'cancelled', 'refunded');

-- CreateEnum
CREATE TYPE "attempt_status" AS ENUM ('processing', 'succeeded', 'failed', 'superseded');

-- CreateEnum
CREATE TYPE "payment_fail_reason" AS ENUM ('cancelled_by_user', 'declined', 'timeout', 'other');

-- CreateEnum
CREATE TYPE "refund_reason" AS ENUM ('order_cancelled', 'order_expired', 'late_payment', 'duplicate_payment', 'admin_manual');

-- CreateEnum
CREATE TYPE "refund_status" AS ENUM ('requested', 'succeeded', 'failed');

-- CreateTable
CREATE TABLE "payments" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "order_id" UUID NOT NULL,
    "order_code" TEXT NOT NULL,
    "user_id" UUID NOT NULL,
    "amount" BIGINT NOT NULL,
    "method" "payment_method" NOT NULL,
    "status" "payment_status" NOT NULL DEFAULT 'pending',
    "attempt_no" SMALLINT NOT NULL DEFAULT 0,
    "provider_ref" TEXT,
    "expires_at" TIMESTAMPTZ(6),
    "paid_at" TIMESTAMPTZ(6),
    "version" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_attempts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "payment_id" UUID NOT NULL,
    "attempt_no" SMALLINT NOT NULL,
    "txn_ref" TEXT NOT NULL,
    "status" "attempt_status" NOT NULL,
    "reason" "payment_fail_reason",
    "gateway_code" TEXT,
    "provider_txn_no" TEXT,
    "create_date" TIMESTAMPTZ(6) NOT NULL,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "resolved_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payment_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_webhook_logs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "payment_id" UUID,
    "txn_ref" TEXT,
    "payload" JSONB NOT NULL,
    "signature_valid" BOOLEAN NOT NULL,
    "rsp_code" TEXT NOT NULL,
    "result" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT clock_timestamp(),

    CONSTRAINT "payment_webhook_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refunds" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "payment_id" UUID NOT NULL,
    "attempt_id" UUID NOT NULL,
    "amount" BIGINT NOT NULL,
    "reason" "refund_reason" NOT NULL,
    "note" TEXT,
    "requested_by" UUID,
    "status" "refund_status" NOT NULL DEFAULT 'requested',
    "failure_reason" TEXT,
    "gateway_code" TEXT,
    "gateway_request_id" TEXT NOT NULL,
    "auto_attempt_no" SMALLINT,
    "next_retry_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolved_at" TIMESTAMPTZ(6),

    CONSTRAINT "refunds_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "payments_order_id_key" ON "payments"("order_id");

-- CreateIndex
CREATE INDEX "payments_user_id_created_at_id_idx" ON "payments"("user_id", "created_at" DESC, "id" DESC);

-- CreateIndex
CREATE INDEX "payments_status_created_at_id_idx" ON "payments"("status", "created_at" DESC, "id" DESC);

-- CreateIndex
CREATE INDEX "payments_method_status_created_at_id_idx" ON "payments"("method", "status", "created_at" DESC, "id" DESC);

-- CreateIndex
CREATE INDEX "payments_order_code_idx" ON "payments"("order_code");

-- CreateIndex
CREATE UNIQUE INDEX "payment_attempts_txn_ref_key" ON "payment_attempts"("txn_ref");

-- CreateIndex
CREATE INDEX "payment_attempts_status_expires_at_idx" ON "payment_attempts"("status", "expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "payment_attempts_payment_id_attempt_no_key" ON "payment_attempts"("payment_id", "attempt_no");

-- CreateIndex
CREATE INDEX "payment_webhook_logs_txn_ref_created_at_idx" ON "payment_webhook_logs"("txn_ref", "created_at");

-- CreateIndex
CREATE INDEX "payment_webhook_logs_created_at_idx" ON "payment_webhook_logs"("created_at");

-- CreateIndex
CREATE UNIQUE INDEX "refunds_attempt_id_key" ON "refunds"("attempt_id");

-- CreateIndex
CREATE INDEX "refunds_payment_id_created_at_idx" ON "refunds"("payment_id", "created_at");

-- CreateIndex
CREATE INDEX "refunds_status_created_at_id_idx" ON "refunds"("status", "created_at" DESC, "id" DESC);

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_attempts" ADD CONSTRAINT "payment_attempts_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "payments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "payments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_attempt_id_fkey" FOREIGN KEY ("attempt_id") REFERENCES "payment_attempts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Ràng buộc và chỉ mục ngoài Prisma
-- payments: số tiền đồng VND dương; số lượt thử 0..10 (trần an toàn của schema, giới hạn chính `PAY_MAX_ATTEMPTS` do ứng dụng kiểm); online bắt buộc có hạn (COD thì không); `succeeded` có `paid_at`
-- và (online) có mã giao dịch cổng; mã đơn là bản sao chuẩn hóa chữ hoa của ORD (Crockford base32, 12 ký tự, bỏ I, L, O, U).
ALTER TABLE "payments"
  ADD CONSTRAINT "payments_amount_positive" CHECK (amount > 0),
  ADD CONSTRAINT "payments_attempt_no_range" CHECK (attempt_no BETWEEN 0 AND 10),
  ADD CONSTRAINT "payments_expires_online" CHECK (method = 'cod' OR expires_at IS NOT NULL),
  ADD CONSTRAINT "payments_succeeded_paid_at" CHECK (status <> 'succeeded' OR paid_at IS NOT NULL),
  ADD CONSTRAINT "payments_succeeded_provider_ref" CHECK (status <> 'succeeded' OR method = 'cod' OR provider_ref IS NOT NULL),
  ADD CONSTRAINT "payments_order_code_format" CHECK (order_code ~ '^[0-9A-HJKMNP-TV-Z]{12}$'),
  ADD CONSTRAINT "payments_version_nonneg" CHECK (version >= 0);
-- DSH getRevenue: Payment đã thu tiền theo `paid_at`
CREATE INDEX "payments_paid_at_idx" ON "payments" (paid_at) WHERE status IN ('succeeded', 'refunded');

-- payment_attempts: số lượt 1..10 cùng trần với payments; `txn_ref` 18 ký tự (16 hex ngẫu nhiên và số lượt hai chữ số); `reason` chỉ ở lượt thất bại; lượt thành công có mã giao dịch cổng;
-- `resolved_at` có đúng khi lượt đã kết thúc; hạn đường dẫn sau giờ tạo; một giao dịch cổng chỉ gắn một lượt thử.
ALTER TABLE "payment_attempts"
  ADD CONSTRAINT "payment_attempts_attempt_no_range" CHECK (attempt_no BETWEEN 1 AND 10),
  ADD CONSTRAINT "payment_attempts_txn_ref_format" CHECK (txn_ref ~ '^[0-9a-f]{16}[0-9]{2}$'),
  ADD CONSTRAINT "payment_attempts_reason_scope" CHECK (reason IS NULL OR status = 'failed'),
  ADD CONSTRAINT "payment_attempts_succeeded_txn_no" CHECK (status <> 'succeeded' OR provider_txn_no IS NOT NULL),
  ADD CONSTRAINT "payment_attempts_resolved_at" CHECK ((status = 'processing') = (resolved_at IS NULL)),
  ADD CONSTRAINT "payment_attempts_expiry_after_create" CHECK (expires_at > create_date);
CREATE UNIQUE INDEX "payment_attempts_provider_txn_no_key" ON "payment_attempts" (provider_txn_no) WHERE provider_txn_no IS NOT NULL;

-- refunds: số tiền dương; `note` (5..300 ký tự) có khi và chỉ khi hoàn thủ công; người yêu cầu chỉ ở hoàn thủ công; `failure_reason` và `next_retry_at` chỉ ở Refund `failed`;
-- `resolved_at` có khi Refund đã chốt (`requested` thì rỗng); mã yêu cầu gửi cổng 32 ký tự hex; số lần tự thử 1..3.
ALTER TABLE "refunds"
  ADD CONSTRAINT "refunds_amount_positive" CHECK (amount > 0),
  ADD CONSTRAINT "refunds_note_len" CHECK (note IS NULL OR char_length(note) BETWEEN 5 AND 300),
  ADD CONSTRAINT "refunds_note_manual" CHECK ((reason = 'admin_manual') = (note IS NOT NULL)),
  ADD CONSTRAINT "refunds_requested_by_manual" CHECK (requested_by IS NULL OR reason = 'admin_manual'),
  ADD CONSTRAINT "refunds_failure_reason_scope" CHECK (failure_reason IS NULL OR status = 'failed'),
  ADD CONSTRAINT "refunds_next_retry_scope" CHECK (next_retry_at IS NULL OR status = 'failed'),
  ADD CONSTRAINT "refunds_resolved_at" CHECK ((status = 'requested') = (resolved_at IS NULL)),
  ADD CONSTRAINT "refunds_request_id_format" CHECK (gateway_request_id ~ '^[0-9a-f]{32}$'),
  ADD CONSTRAINT "refunds_auto_attempt_range" CHECK (auto_attempt_no IS NULL OR auto_attempt_no BETWEEN 1 AND 3);
CREATE INDEX "refunds_next_retry_at_idx" ON "refunds" (next_retry_at) WHERE next_retry_at IS NOT NULL;
-- DSH getRevenue: Refund đã thành công theo `resolved_at`; job đối soát: Refund còn `requested`
CREATE INDEX "refunds_resolved_at_idx" ON "refunds" (resolved_at) WHERE status = 'succeeded';
CREATE INDEX "refunds_requested_updated_at_idx" ON "refunds" (updated_at) WHERE status = 'requested';

-- payment_webhook_logs: RspCode của VNPay; `payload` là đối tượng (đã che ở ứng dụng: chỉ trường trong danh sách cho phép, không chữ ký, SB-18); mã kết quả dạng chữ thường nối bằng gạch dưới.
ALTER TABLE "payment_webhook_logs"
  ADD CONSTRAINT "payment_webhook_logs_rsp_code" CHECK (rsp_code IN ('00', '01', '02', '04', '97', '99')),
  ADD CONSTRAINT "payment_webhook_logs_payload_object" CHECK (jsonb_typeof(payload) = 'object'),
  ADD CONSTRAINT "payment_webhook_logs_result_format" CHECK (result ~ '^[a-z_]{1,40}$');

-- Nhật ký webhook chỉ thêm (SB-32, T22): UPDATE luôn bị chặn; DELETE chỉ qua cho dòng quá 12 tháng (job dọn của ADR-022). Thu quyền UPDATE, TRUNCATE của vai trò ứng dụng; DELETE giữ vì job dọn chạy bằng chính vai trò đó
-- và trigger là lớp chặn (dòng chưa quá 12 tháng không xóa được cho mọi vai trò).
CREATE FUNCTION payment_webhook_logs_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' AND OLD.created_at < now() - interval '12 months' THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'payment_webhook_logs is append-only (%)', TG_OP USING ERRCODE = 'integrity_constraint_violation';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "payment_webhook_logs_append_only"
  BEFORE UPDATE OR DELETE ON "payment_webhook_logs"
  FOR EACH ROW EXECUTE FUNCTION payment_webhook_logs_guard();
REVOKE UPDATE, TRUNCATE ON "payment_webhook_logs" FROM PUBLIC, app_runtime;

-- Vòng đời hợp lệ (SB-24, E-19): chuyển trạng thái ngoài bảng bị CSDL từ chối, kể cả khi mã ứng dụng sai (lớp bảo vệ thứ hai; nguồn chính là TRANSITIONS ở ứng dụng).
CREATE FUNCTION payments_status_guard() RETURNS trigger AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status AND NOT (
       (OLD.status = 'pending' AND NEW.status IN ('processing', 'succeeded', 'expired', 'cancelled'))
    OR (OLD.status = 'processing' AND NEW.status IN ('succeeded', 'failed', 'expired', 'cancelled'))
    OR (OLD.status = 'failed' AND NEW.status IN ('processing', 'succeeded', 'expired', 'cancelled'))
    OR (OLD.status = 'succeeded' AND NEW.status = 'refunded')
  ) THEN
    RAISE EXCEPTION 'payments: invalid status transition % -> %', OLD.status, NEW.status USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "payments_status_transition"
  BEFORE UPDATE OF "status" ON "payments"
  FOR EACH ROW EXECUTE FUNCTION payments_status_guard();

CREATE FUNCTION refunds_status_guard() RETURNS trigger AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status AND NOT (
       (OLD.status = 'requested' AND NEW.status IN ('succeeded', 'failed'))
    OR (OLD.status = 'failed' AND NEW.status = 'requested')
  ) THEN
    RAISE EXCEPTION 'refunds: invalid status transition % -> %', OLD.status, NEW.status USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "refunds_status_transition"
  BEFORE UPDATE OF "status" ON "refunds"
  FOR EACH ROW EXECUTE FUNCTION refunds_status_guard();
