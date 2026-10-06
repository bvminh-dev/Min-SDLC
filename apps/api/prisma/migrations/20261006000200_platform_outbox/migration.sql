-- PRJ-DB: outbox_events (OutboxEvent) và processed_events (ProcessedEvent), ADR-011.
CREATE TABLE "outbox_events" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "type" TEXT NOT NULL,
    "aggregate_type" TEXT NOT NULL,
    "aggregate_id" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "correlation_id" TEXT NOT NULL,
    "occurred_at" TIMESTAMPTZ(6) NOT NULL,
    "dispatched_at" TIMESTAMPTZ(6),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "next_attempt_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "outbox_events_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "outbox_events_attempts_check" CHECK ("attempts" >= 0)
);

-- Chỉ mục một phần (relay chỉ đọc event chưa phát; job dọn chỉ đọc event đã phát).
CREATE INDEX "outbox_events_pending_idx" ON "outbox_events"("next_attempt_at", "occurred_at", "id") WHERE "dispatched_at" IS NULL;
CREATE INDEX "outbox_events_aggregate_pending_idx" ON "outbox_events"("aggregate_id", "occurred_at", "id") WHERE "dispatched_at" IS NULL;
CREATE INDEX "outbox_events_dispatched_idx" ON "outbox_events"("dispatched_at") WHERE "dispatched_at" IS NOT NULL;

CREATE TABLE "processed_events" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "consumer" TEXT NOT NULL,
    "event_id" UUID NOT NULL,
    "processed_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "processed_events_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "processed_events_processed_at_idx" ON "processed_events"("processed_at");
CREATE UNIQUE INDEX "processed_events_consumer_event_id_key" ON "processed_events"("consumer", "event_id");
