-- AUTH-DB-20261006-100006037 (Migration 1 đến 3): bảng của module auth. Prisma không biểu diễn CHECK và chỉ mục một phần
-- nên các phần đó viết tay ở cuối. Không có dữ liệu mồi: admin đầu tiên tạo bằng lệnh seed (SB-29).
-- Rollback (chỉ an toàn khi chưa có người dùng thật): DROP bảng theo thứ tự ngược (token, sessions, users) rồi các enum; sau đó chỉ tiến.
CREATE EXTENSION IF NOT EXISTS citext;

-- CreateEnum
CREATE TYPE "user_role" AS ENUM ('customer', 'staff', 'admin');

-- CreateEnum
CREATE TYPE "user_status" AS ENUM ('active', 'locked');

-- CreateEnum
CREATE TYPE "lock_reason" AS ENUM ('too_many_attempts', 'admin');

-- CreateEnum
CREATE TYPE "session_status" AS ENUM ('active', 'revoked', 'expired');

-- CreateEnum
CREATE TYPE "session_revoke_reason" AS ENUM ('logout', 'password_changed', 'admin_lock', 'replaced');

-- CreateEnum
CREATE TYPE "token_status" AS ENUM ('issued', 'used', 'expired');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "email" CITEXT NOT NULL,
    "email_verified_at" TIMESTAMPTZ(6),
    "password_hash" TEXT NOT NULL,
    "role" "user_role" NOT NULL DEFAULT 'customer',
    "full_name" TEXT NOT NULL,
    "phone" TEXT,
    "avatar_url" TEXT,
    "status" "user_status" NOT NULL DEFAULT 'active',
    "failed_login_count" INTEGER NOT NULL DEFAULT 0,
    "last_failed_login_at" TIMESTAMPTZ(6),
    "locked_until" TIMESTAMPTZ(6),
    "locked_reason" "lock_reason",
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "token_hash" CHAR(64) NOT NULL,
    "status" "session_status" NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMPTZ(6) NOT NULL,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "absolute_expires_at" TIMESTAMPTZ(6) NOT NULL,
    "revoked_at" TIMESTAMPTZ(6),
    "revoked_reason" "session_revoke_reason",
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "password_reset_tokens" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "token_hash" CHAR(64) NOT NULL,
    "status" "token_status" NOT NULL DEFAULT 'issued',
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "used_at" TIMESTAMPTZ(6),
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "password_reset_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "email_verification_tokens" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "token_hash" CHAR(64) NOT NULL,
    "status" "token_status" NOT NULL DEFAULT 'issued',
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "used_at" TIMESTAMPTZ(6),
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "email_verification_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "users_role_status_idx" ON "users"("role", "status");

-- CreateIndex
CREATE UNIQUE INDEX "sessions_token_hash_key" ON "sessions"("token_hash");

-- CreateIndex
CREATE INDEX "sessions_user_id_status_idx" ON "sessions"("user_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "password_reset_tokens_token_hash_key" ON "password_reset_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "password_reset_tokens_user_id_idx" ON "password_reset_tokens"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "email_verification_tokens_token_hash_key" ON "email_verification_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "email_verification_tokens_user_id_created_at_idx" ON "email_verification_tokens"("user_id", "created_at" DESC);

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "password_reset_tokens" ADD CONSTRAINT "password_reset_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "email_verification_tokens" ADD CONSTRAINT "email_verification_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;



-- Ràng buộc và chỉ mục ngoài Prisma
ALTER TABLE "users"
  ADD CONSTRAINT "users_email_len" CHECK (length(email) <= 254),
  ADD CONSTRAINT "users_full_name_len" CHECK (length(full_name) BETWEEN 1 AND 100),
  ADD CONSTRAINT "users_failed_login_count_nonneg" CHECK (failed_login_count >= 0),
  ADD CONSTRAINT "users_lock_consistent" CHECK ((status = 'locked') OR (locked_until IS NULL AND locked_reason IS NULL)),
  ADD CONSTRAINT "users_admin_lock_no_expiry" CHECK (locked_reason IS DISTINCT FROM 'admin' OR locked_until IS NULL);
CREATE INDEX "users_created_at_id_idx" ON "users" ("created_at" DESC, "id" DESC);
CREATE INDEX "users_lower_email_prefix_idx" ON "users" (lower(email::text) text_pattern_ops);

ALTER TABLE "sessions"
  ADD CONSTRAINT "sessions_revoked_consistent" CHECK ((status = 'revoked') = (revoked_at IS NOT NULL)),
  ADD CONSTRAINT "sessions_idle_le_absolute" CHECK (expires_at <= absolute_expires_at);
CREATE INDEX "sessions_active_expires_idx" ON "sessions" ("expires_at") WHERE status = 'active';

ALTER TABLE "password_reset_tokens" ADD CONSTRAINT "password_reset_tokens_used_consistent" CHECK ((status = 'used') = (used_at IS NOT NULL));
CREATE UNIQUE INDEX "password_reset_tokens_one_issued_idx" ON "password_reset_tokens" ("user_id") WHERE status = 'issued';
CREATE INDEX "password_reset_tokens_issued_expires_idx" ON "password_reset_tokens" ("expires_at") WHERE status = 'issued';

ALTER TABLE "email_verification_tokens" ADD CONSTRAINT "email_verification_tokens_used_consistent" CHECK ((status = 'used') = (used_at IS NOT NULL));
CREATE UNIQUE INDEX "email_verification_tokens_one_issued_idx" ON "email_verification_tokens" ("user_id") WHERE status = 'issued';
