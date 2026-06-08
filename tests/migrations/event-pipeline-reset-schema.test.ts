import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

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
const sql = readFileSync(migrationPath, "utf8");
const residueSql = readFileSync(residueMigrationPath, "utf8");

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

  it("does not reintroduce removed active collector and Vercel asset paths", () => {
    expect(sql).not.toMatch(/vercel[_-]?sandbox/i);
    expect(sql).not.toContain(["BLOB", "READ", "WRITE", "TOKEN"].join("_"));
    expect(sql).not.toContain(["collector", "api", "key"].join("_"));
    expect(sql).not.toContain(["event", "pipeline", "v2"].join("_"));
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
});
