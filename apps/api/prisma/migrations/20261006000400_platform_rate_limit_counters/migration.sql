-- PRJ-DB: bộ đếm giới hạn tần suất bậc A, B, D, E (ADR-014). UNLOGGED: dữ liệu tạm, mất khi sự cố CSDL là chấp nhận được.
CREATE UNLOGGED TABLE "rate_limit_counters" (
    "bucket" TEXT NOT NULL,
    "window_start" TIMESTAMPTZ(6) NOT NULL,
    "count" INTEGER NOT NULL,

    CONSTRAINT "rate_limit_counters_pkey" PRIMARY KEY ("bucket","window_start")
);
