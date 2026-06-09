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

  it("keeps eval isolated from production event publication", () => {
    expect(sql).toContain("mode text not null default 'production'");
    expect(sql).toContain("mode text not null default 'production' check");
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
