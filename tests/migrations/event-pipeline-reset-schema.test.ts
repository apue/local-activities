import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const migrationsDir = fileURLToPath(
  new URL("../../supabase/migrations", import.meta.url),
);
const migrationPath = fileURLToPath(
  new URL(
    "../../supabase/migrations/20260608103000_event_pipeline_reset_schema.sql",
    import.meta.url,
  ),
);
const residueMigrationPath = fileURLToPath(
  new URL(
    "../../supabase/migrations/20260608104500_drop_legacy_public_residue.sql",
    import.meta.url,
  ),
);
const snapshotResidueMigrationPath = fileURLToPath(
  new URL(
    "../../supabase/migrations/20260608130000_remove_article_snapshot_residue.sql",
    import.meta.url,
  ),
);
const sql = readFileSync(migrationPath, "utf8");
const residueSql = readFileSync(residueMigrationPath, "utf8");
const snapshotResidueSql = readFileSync(snapshotResidueMigrationPath, "utf8");
const allMigrationSql = readdirSync(migrationsDir)
  .filter((fileName) => fileName.endsWith(".sql"))
  .sort()
  .map((fileName) => readFileSync(path.join(migrationsDir, fileName), "utf8"))
  .join("\n");

describe("event pipeline reset migration", () => {
  it("creates the reset database tables required by the pipeline", () => {
    for (const table of [
      "source_channels",
      "article_bundles",
      "processing_ledger",
      "event_drafts",
      "canonical_events",
      "evidence_assets",
      "dedupe_decisions",
      "llm_usage_ledger",
      "evaluation_runs",
      "evaluation_case_results",
    ]) {
      expect(sql).toContain(`create table public.${table}`);
    }
  });

  it("creates the reset storage buckets and policies", () => {
    expect(sql).toContain("'article-bundles'");
    expect(sql).toContain("'event-evidence-assets'");
    expect(sql).toContain("'eval-artifacts'");
    expect(sql).toContain("event evidence assets are publicly readable");
    expect(sql).toContain("service role can manage event pipeline storage");
  });

  it("scopes every pipeline table with data_class instead of ad hoc fixture detection", () => {
    for (const table of [
      "source_channels",
      "collector_jobs",
      "source_runs",
      "collector_failures",
      "article_bundles",
      "evidence_assets",
      "event_drafts",
      "canonical_events",
      "excluded_articles",
      "llm_usage_ledger",
      "processing_ledger",
      "dedupe_decisions",
      "evaluation_runs",
      "evaluation_case_results",
    ]) {
      expect(allMigrationSql).toMatch(
        new RegExp(`alter table public\\.${table}[\\s\\S]*data_class`),
      );
    }
    expect(allMigrationSql).toMatch(
      /check \(data_class in \(''?production''?, ''?eval''?, ''?test''?, ''?smoke''?\)\)/,
    );
    expect(allMigrationSql).toContain("canonical_events_data_class_public_idx");
    expect(allMigrationSql).toContain("event_drafts_data_class_review_created_idx");
    expect(allMigrationSql).toContain("evidence_assets_data_class_asset_id_idx");
  });

  it("keeps eval/test isolated by scope while preserving product-shaped rows", () => {
    expect(allMigrationSql).toContain(
      "add column if not exists data_class text not null default %L",
    );
    expect(allMigrationSql).toContain("'production'");
    expect(allMigrationSql).toContain("'eval'");
    expect(allMigrationSql).toContain("unique (source_url, content_hash, data_class)");
    expect(allMigrationSql).toContain("unique (run_id, case_id, data_class)");
    expect(sql).toContain("evaluation_case_results");
    expect(sql).toContain("references public.evaluation_runs(run_id)");
  });

  it("tracks evaluation run validity for obsolete live evals", () => {
    expect(allMigrationSql).toContain("validity text not null default 'valid'");
    expect(allMigrationSql).toContain(
      "check (validity in ('valid', 'invalidated'))",
    );
    expect(allMigrationSql).toContain("invalidated_reason text");
    expect(allMigrationSql).toContain("invalidated_at timestamptz");
    expect(allMigrationSql).toContain("evaluation_runs_validity_started_idx");
  });

  it("adds normalized V5 pipeline ledger tables for run trace visibility", () => {
    for (const table of [
      "pipeline_runs",
      "pipeline_steps",
      "pipeline_artifacts",
      "pipeline_attempts",
    ]) {
      expect(allMigrationSql).toContain(`create table public.${table}`);
      expect(allMigrationSql).toMatch(
        new RegExp(`alter table public\\.${table} enable row level security`),
      );
      expect(allMigrationSql).toMatch(
        new RegExp(
          `${table}_data_class_check[\\s\\S]*check \\(data_class in \\('production', 'eval', 'test', 'smoke'\\)\\)`,
        ),
      );
    }

    expect(allMigrationSql).toContain("run_id text not null unique");
    expect(allMigrationSql).toContain(
      "run_id text not null references public.pipeline_runs(run_id) on delete cascade",
    );
    expect(allMigrationSql).toContain(
      "step_id text references public.pipeline_steps(step_id) on delete set null",
    );
    expect(allMigrationSql).not.toContain(
      "step_id text not null references public.pipeline_steps(step_id) on delete set null",
    );
    expect(allMigrationSql).toContain("usage jsonb not null default '{}'::jsonb");
    expect(allMigrationSql).toContain("input_artifact_ids text[] not null default '{}'");
    expect(allMigrationSql).toContain("output_artifact_ids text[] not null default '{}'");
    expect(allMigrationSql).toContain("pipeline_runs_data_class_started_idx");
    expect(allMigrationSql).toContain("pipeline_steps_run_order_idx");
    expect(allMigrationSql).toContain("pipeline_artifacts_run_created_idx");
    expect(allMigrationSql).toContain("pipeline_attempts_step_attempt_idx");
    expect(allMigrationSql).toContain("pipeline_attempts_data_class_run_idx");
  });

  it("extends LLM usage ledger for agent-readable call audit", () => {
    for (const column of [
      "pipeline_run_id text",
      "pipeline_step_id text",
      "source_id text",
      "source_url text",
      "prompt_version text",
      "schema_version text",
      "params jsonb not null default '{}'::jsonb",
      "error_code text",
      "request_artifact_path text",
      "response_artifact_path text",
    ]) {
      expect(allMigrationSql).toContain(column);
    }

    expect(allMigrationSql).toContain("llm_usage_agent_filter_idx");
    expect(allMigrationSql).toContain("llm_usage_article_recorded_idx");
    expect(allMigrationSql).toContain("llm_usage_source_recorded_idx");
  });

  it("adds structured admin feedback ledger for agent-operable ground truth", () => {
    expect(allMigrationSql).toContain("create table public.admin_feedback_ledger");
    for (const column of [
      "feedback_id text not null unique",
      "data_class text not null default 'production'",
      "feedback_type text not null",
      "pipeline_run_id text",
      "article_bundle_id text",
      "draft_id text",
      "event_id text",
      "field_name text",
      "old_value jsonb",
      "corrected_value jsonb",
      "reason text",
      "created_by text not null",
      "status text not null default 'open'",
      "metadata jsonb not null default '{}'::jsonb",
    ]) {
      expect(allMigrationSql).toContain(column);
    }
    expect(allMigrationSql).toContain(
      "admin_feedback_ledger_feedback_type_check",
    );
    expect(allMigrationSql).toContain(
      "check (feedback_type in ('not_event', 'not_public', 'should_publish', 'missing_event', 'wrong_time', 'wrong_location', 'missing_registration', 'missing_qr', 'duplicate_event', 'bad_summary', 'bad_category_or_tags', 'other'))",
    );
    expect(allMigrationSql).toContain("admin_feedback_ledger_data_class_created_idx");
    expect(allMigrationSql).toContain("admin_feedback_ledger_draft_created_idx");
    expect(allMigrationSql).toContain("admin_feedback_ledger_event_created_idx");
    expect(allMigrationSql).toContain("admin_feedback_ledger_article_created_idx");
    expect(allMigrationSql).toContain("admin_feedback_ledger_run_created_idx");
    expect(allMigrationSql).toContain(
      "validate_admin_feedback_data_class()",
    );
    expect(allMigrationSql).toContain(
      "raise exception 'admin_feedback_data_class_mismatch:pipeline_run_id:%'",
    );
    expect(allMigrationSql).toContain(
      "raise exception 'admin_feedback_data_class_mismatch:article_bundle_id:%'",
    );
    expect(allMigrationSql).toContain(
      "raise exception 'admin_feedback_data_class_mismatch:draft_id:%'",
    );
    expect(allMigrationSql).toContain(
      "raise exception 'admin_feedback_data_class_mismatch:event_id:%'",
    );
    expect(allMigrationSql).toContain(
      "before insert or update on public.admin_feedback_ledger",
    );
    expect(allMigrationSql).toContain(
      "alter table public.admin_feedback_ledger enable row level security",
    );
  });

  it("adds prompt/model config registry for scoped candidate and active configs", () => {
    expect(allMigrationSql).toContain("create table public.prompt_model_configs");
    for (const column of [
      "config_id text not null unique",
      "data_class text not null default 'production'",
      "operation text not null",
      "stage text not null default 'candidate'",
      "provider text not null",
      "model text not null",
      "prompt_version text not null",
      "prompt_text text not null",
      "schema_version text not null",
      "params jsonb not null default '{}'::jsonb",
      "budget_policy jsonb not null default '{}'::jsonb",
      "created_reason text not null",
      "created_by text not null",
      "activation_eval_run_id text",
      "activation_reason text",
      "activated_at timestamptz",
    ]) {
      expect(allMigrationSql).toContain(column);
    }
    expect(allMigrationSql).toContain(
      "check (operation in ('cheap_triage', 'full_extract', 'editor_pass', 'judge_eval', 'eval'))",
    );
    expect(allMigrationSql).toContain(
      "check (stage in ('active', 'candidate', 'archived'))",
    );
    expect(allMigrationSql).toContain("prompt_model_configs_active_unique_idx");
    expect(allMigrationSql).toContain("where stage = 'active'");
    expect(allMigrationSql).toContain(
      "prompt_model_configs_scope_stage_created_idx",
    );
    expect(allMigrationSql).toContain(
      "prompt_model_configs_activation_metadata_check",
    );
    expect(allMigrationSql).toContain(
      "create or replace function public.activate_prompt_model_config",
    );
    expect(allMigrationSql).toContain(
      "raise exception 'prompt_model_config_not_found:%'",
    );
    expect(allMigrationSql).toContain(
      "set stage = 'archived'",
    );
    expect(allMigrationSql).toContain(
      "returning * into activated",
    );
    expect(allMigrationSql).toContain(
      "alter table public.prompt_model_configs enable row level security",
    );
  });

  it("adds AI Editor decision metadata for exception-driven review", () => {
    for (const table of ["event_drafts", "canonical_events"]) {
      expect(allMigrationSql).toContain(`alter table public.${table}`);
    }
    for (const column of [
      "editor_decision text",
      "editor_reason text",
      "exception_reason_codes text[] not null default '{}'",
      "actionability_status text",
      "editor_version text",
    ]) {
      expect(allMigrationSql).toContain(column);
    }

    expect(allMigrationSql).toContain(
      "check (editor_decision is null or editor_decision in ('publish', 'needs_exception'))",
    );
    expect(allMigrationSql).toContain(
      "actionability_status in ('actionable', 'needs_info', 'not_actionable', 'possible_duplicate')",
    );
    expect(allMigrationSql).toContain(
      "event_drafts_data_class_editor_exception_idx",
    );
    expect(allMigrationSql).toContain("event_drafts_exception_reason_codes_idx");
  });

  it("does not reintroduce removed active collector and Vercel asset paths", () => {
    expect(sql).not.toMatch(/vercel[_-]?sandbox/i);
    expect(sql).not.toContain(["BLOB", "READ", "WRITE", "TOKEN"].join("_"));
    expect(sql).not.toContain(["collector", "api", "key"].join("_"));
    expect(sql).not.toContain(["event", "pipeline", "v2"].join("_"));
    expect(sql).not.toContain("create table public.article_snapshots");
    expect(sql).not.toContain("article_snapshot_id text");
    expect(sql).not.toContain("article_snapshot_ids text");
    expect(sql).not.toContain("local_run_id text");
    expect(sql).toContain("article_bundle_ids text[]");
    expect(sql).toContain("article_bundle_id text references public.article_bundles");
    expect(sql).toContain("capture_run_id text");
  });

  it("drops public schema residue from the pre-reset pipeline", () => {
    for (const table of [
      "event_mentions",
      "event_revisions",
      "source_posts",
      "sources",
    ]) {
      expect(residueSql).toContain(`drop table if exists public.${table}`);
    }
    expect(residueSql).toContain("llm_usage_ledger_no_delete");
    expect(residueSql).toContain("llm_usage_ledger_no_update");
  });

  it("cleans up article snapshot residue without making it an active contract", () => {
    expect(snapshotResidueSql).toContain(
      "rename column article_snapshot_ids to article_bundle_ids",
    );
    expect(snapshotResidueSql).toContain(
      "rename column local_run_id to capture_run_id",
    );
    expect(snapshotResidueSql).toContain(
      "drop column if exists article_snapshot_id",
    );
    expect(snapshotResidueSql).toContain(
      "drop table if exists public.article_snapshots cascade",
    );
    expect(snapshotResidueSql).not.toContain(
      "create table public.article_snapshots",
    );
  });
});
