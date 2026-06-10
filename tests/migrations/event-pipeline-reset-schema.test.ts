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
