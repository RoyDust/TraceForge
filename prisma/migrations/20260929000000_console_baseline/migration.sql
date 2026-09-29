-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "api_key_scope" AS ENUM ('gateway', 'trace_ingest');

-- CreateEnum
CREATE TYPE "span_type" AS ENUM ('llm', 'tool', 'workflow', 'db', 'review');

-- CreateEnum
CREATE TYPE "usage_source" AS ENUM ('provider', 'estimated');

-- CreateEnum
CREATE TYPE "trace_status" AS ENUM ('running', 'success', 'failed', 'cancelled');

-- CreateEnum
CREATE TYPE "trace_event_type" AS ENUM ('stream_start', 'first_token', 'chunk_count', 'stream_end', 'stream_error', 'stream_cancelled', 'fallback_triggered', 'fallback_failed');

-- CreateEnum
CREATE TYPE "assertion_type" AS ENUM ('exact_match', 'contains', 'regex', 'json_schema', 'llm_judge', 'manual_review');

-- CreateTable
CREATE TABLE "project" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "project_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "api_key" (
    "id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "scope" "api_key_scope"[],
    "key_hash" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "expires_at" TIMESTAMP(3),
    "rpm_limit" INTEGER,
    "concurrency_limit" INTEGER,
    "revoked_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "api_key_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "model_provider" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "base_url" TEXT NOT NULL,
    "api_key_encrypted" TEXT,
    "type" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "model_provider_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "model_config" (
    "id" UUID NOT NULL,
    "provider_id" UUID NOT NULL,
    "model_name" TEXT NOT NULL,
    "display_name" TEXT,
    "max_tokens" INTEGER,
    "fallback_model_id" UUID,
    "status" TEXT NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "model_config_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "model_pricing" (
    "id" UUID NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "input_price" DECIMAL(20,10) NOT NULL,
    "output_price" DECIMAL(20,10) NOT NULL,
    "effective_from" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "model_pricing_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trace_run" (
    "id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "name" TEXT,
    "prompt_version_id" UUID,
    "status" "trace_status" NOT NULL DEFAULT 'running',
    "error_code" TEXT,
    "input_preview" TEXT,
    "output_preview" TEXT,
    "total_tokens" INTEGER,
    "cost" DECIMAL(20,10),
    "latency_ms" INTEGER,
    "usage_source" "usage_source",
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ended_at" TIMESTAMP(3),

    CONSTRAINT "trace_run_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trace_span" (
    "id" UUID NOT NULL,
    "run_id" UUID NOT NULL,
    "parent_id" UUID,
    "type" "span_type" NOT NULL,
    "name" TEXT NOT NULL,
    "model" TEXT,
    "provider" TEXT,
    "input_preview" TEXT,
    "output_preview" TEXT,
    "raw_payload_ref" TEXT,
    "prompt_tokens" INTEGER,
    "completion_tokens" INTEGER,
    "usage_source" "usage_source",
    "cost" DECIMAL(20,10),
    "latency_ms" INTEGER,
    "status" "trace_status" NOT NULL DEFAULT 'running',
    "error_code" TEXT,
    "error" TEXT,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ended_at" TIMESTAMP(3),

    CONSTRAINT "trace_span_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trace_event" (
    "id" UUID NOT NULL,
    "span_id" UUID NOT NULL,
    "type" "trace_event_type" NOT NULL,
    "payload" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "trace_event_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "prompt" (
    "id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "active_version_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "prompt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "prompt_version" (
    "id" UUID NOT NULL,
    "prompt_id" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "content" TEXT NOT NULL,
    "variables_schema" JSONB,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "prompt_version_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "eval_dataset" (
    "id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "eval_dataset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "eval_case" (
    "id" UUID NOT NULL,
    "dataset_id" UUID NOT NULL,
    "input" TEXT NOT NULL,
    "expected_output" TEXT,
    "assertion_type" "assertion_type" NOT NULL,
    "assertion_config" JSONB,
    "tags" TEXT[],
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "eval_case_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "eval_run" (
    "deadline_at" TIMESTAMP(3),
    "id" UUID NOT NULL,
    "dataset_id" UUID NOT NULL,
    "prompt_version_id" UUID,
    "model_config_id" UUID,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "average_score" DECIMAL(6,3),
    "total_cost" DECIMAL(20,10),
    "duration_ms" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "eval_run_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "eval_result" (
    "id" UUID NOT NULL,
    "eval_run_id" UUID NOT NULL,
    "eval_case_id" UUID NOT NULL,
    "output" TEXT,
    "assertion_type" "assertion_type" NOT NULL,
    "pass" BOOLEAN,
    "score" DECIMAL(6,3),
    "judge_reason" TEXT,
    "cost" DECIMAL(20,10),
    "duration_ms" INTEGER,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "eval_result_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "usage_daily" (
    "id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "model_config_id" UUID,
    "date" DATE NOT NULL,
    "request_count" INTEGER NOT NULL DEFAULT 0,
    "success_count" INTEGER NOT NULL DEFAULT 0,
    "failure_count" INTEGER NOT NULL DEFAULT 0,
    "prompt_tokens" BIGINT NOT NULL DEFAULT 0,
    "completion_tokens" BIGINT NOT NULL DEFAULT 0,
    "total_cost" DECIMAL(20,10) NOT NULL DEFAULT 0,
    "average_latency_ms" INTEGER,

    CONSTRAINT "usage_daily_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "api_key_key_hash_key" ON "api_key"("key_hash");

-- CreateIndex
CREATE INDEX "api_key_project_id_idx" ON "api_key"("project_id");

-- CreateIndex
CREATE INDEX "model_config_provider_id_idx" ON "model_config"("provider_id");

-- CreateIndex
CREATE INDEX "model_pricing_provider_model_idx" ON "model_pricing"("provider", "model");

-- CreateIndex
CREATE UNIQUE INDEX "model_pricing_provider_model_effective_from_key" ON "model_pricing"("provider", "model", "effective_from");

-- CreateIndex
CREATE INDEX "trace_run_project_id_started_at_idx" ON "trace_run"("project_id", "started_at");

-- CreateIndex
CREATE INDEX "trace_run_status_started_at_idx" ON "trace_run"("status", "started_at");

-- CreateIndex
CREATE INDEX "trace_span_run_id_idx" ON "trace_span"("run_id");

-- CreateIndex
CREATE INDEX "trace_span_parent_id_idx" ON "trace_span"("parent_id");

-- CreateIndex
CREATE INDEX "trace_event_span_id_idx" ON "trace_event"("span_id");

-- CreateIndex
CREATE UNIQUE INDEX "prompt_active_version_id_key" ON "prompt"("active_version_id");

-- CreateIndex
CREATE INDEX "prompt_project_id_idx" ON "prompt"("project_id");

-- CreateIndex
CREATE UNIQUE INDEX "prompt_version_prompt_id_version_key" ON "prompt_version"("prompt_id", "version");

-- CreateIndex
CREATE INDEX "eval_dataset_project_id_idx" ON "eval_dataset"("project_id");

-- CreateIndex
CREATE INDEX "eval_case_dataset_id_idx" ON "eval_case"("dataset_id");

-- CreateIndex
CREATE INDEX "eval_run_dataset_id_idx" ON "eval_run"("dataset_id");

-- CreateIndex
CREATE UNIQUE INDEX "eval_result_eval_run_id_eval_case_id_key" ON "eval_result"("eval_run_id", "eval_case_id");

-- CreateIndex
CREATE INDEX "usage_daily_project_id_date_idx" ON "usage_daily"("project_id", "date");

-- CreateIndex
CREATE UNIQUE INDEX "usage_daily_project_id_model_config_id_date_key" ON "usage_daily"("project_id", "model_config_id", "date");

-- AddForeignKey
ALTER TABLE "api_key" ADD CONSTRAINT "api_key_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "model_config" ADD CONSTRAINT "model_config_provider_id_fkey" FOREIGN KEY ("provider_id") REFERENCES "model_provider"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "model_config" ADD CONSTRAINT "model_config_fallback_model_id_fkey" FOREIGN KEY ("fallback_model_id") REFERENCES "model_config"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trace_run" ADD CONSTRAINT "trace_run_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trace_run" ADD CONSTRAINT "trace_run_prompt_version_id_fkey" FOREIGN KEY ("prompt_version_id") REFERENCES "prompt_version"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trace_span" ADD CONSTRAINT "trace_span_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "trace_run"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trace_span" ADD CONSTRAINT "trace_span_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "trace_span"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trace_event" ADD CONSTRAINT "trace_event_span_id_fkey" FOREIGN KEY ("span_id") REFERENCES "trace_span"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prompt" ADD CONSTRAINT "prompt_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prompt" ADD CONSTRAINT "prompt_active_version_id_fkey" FOREIGN KEY ("active_version_id") REFERENCES "prompt_version"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prompt_version" ADD CONSTRAINT "prompt_version_prompt_id_fkey" FOREIGN KEY ("prompt_id") REFERENCES "prompt"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "eval_dataset" ADD CONSTRAINT "eval_dataset_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "eval_case" ADD CONSTRAINT "eval_case_dataset_id_fkey" FOREIGN KEY ("dataset_id") REFERENCES "eval_dataset"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "eval_run" ADD CONSTRAINT "eval_run_dataset_id_fkey" FOREIGN KEY ("dataset_id") REFERENCES "eval_dataset"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "eval_run" ADD CONSTRAINT "eval_run_prompt_version_id_fkey" FOREIGN KEY ("prompt_version_id") REFERENCES "prompt_version"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "eval_run" ADD CONSTRAINT "eval_run_model_config_id_fkey" FOREIGN KEY ("model_config_id") REFERENCES "model_config"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "eval_result" ADD CONSTRAINT "eval_result_eval_run_id_fkey" FOREIGN KEY ("eval_run_id") REFERENCES "eval_run"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "eval_result" ADD CONSTRAINT "eval_result_eval_case_id_fkey" FOREIGN KEY ("eval_case_id") REFERENCES "eval_case"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "usage_daily" ADD CONSTRAINT "usage_daily_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "usage_daily" ADD CONSTRAINT "usage_daily_model_config_id_fkey" FOREIGN KEY ("model_config_id") REFERENCES "model_config"("id") ON DELETE SET NULL ON UPDATE CASCADE;

