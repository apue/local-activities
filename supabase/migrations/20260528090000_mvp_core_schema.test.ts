import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const migrationPath = join(
  process.cwd(),
  "supabase/migrations/20260528090000_mvp_core_schema.sql",
);

describe("MVP core Supabase migration", () => {
  const sql = () => readFileSync(migrationPath, "utf8");

  it("creates every core MVP table", () => {
    const migration = sql();

    for (const table of [
      "sources",
      "collector_jobs",
      "source_runs",
      "source_posts",
      "article_snapshots",
      "evidence_assets",
      "event_drafts",
      "canonical_events",
      "event_mentions",
      "event_revisions",
      "collector_failures",
    ]) {
      expect(migration).toContain(`create table if not exists public.${table}`);
    }
  });

  it("adds indexes for queues, public upcoming events, and foreign keys", () => {
    const migration = sql();

    for (const indexName of [
      "collector_jobs_queued_idx",
      "event_drafts_review_state_idx",
      "canonical_events_public_upcoming_idx",
      "source_runs_source_id_idx",
      "article_snapshots_source_run_id_idx",
      "event_mentions_canonical_event_id_idx",
      "collector_failures_source_run_id_idx",
    ]) {
      expect(migration).toContain(`create index if not exists ${indexName}`);
    }
  });
});
