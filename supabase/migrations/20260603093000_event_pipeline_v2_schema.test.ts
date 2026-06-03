import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const migrationPath = join(
  process.cwd(),
  "supabase/migrations/20260603093000_event_pipeline_v2_schema.sql",
);

describe("Event Pipeline V2 Supabase migration", () => {
  const sql = () => readFileSync(migrationPath, "utf8");

  it("adds first-class excluded article storage", () => {
    const migration = sql();

    expect(migration).toContain(
      "create table if not exists public.excluded_articles",
    );
    for (const column of [
      "triage_decision text not null",
      "triage_action text not null",
      "exclusion_reason text not null",
      "processing_state text not null default 'excluded'",
      "promoted_at timestamptz",
    ]) {
      expect(migration).toContain(column);
    }
    expect(migration).toContain("excluded_articles_processing_state_idx");
  });

  it("adds V2 triage, schedule, evidence, blocker, and resolution fields", () => {
    const migration = sql();

    for (const table of ["event_drafts", "canonical_events"]) {
      expect(migration).toContain(`alter table public.${table}`);
    }

    for (const column of [
      "triage_decision text",
      "triage_action text",
      "public_eligibility text",
      "event_kind text",
      "schedule_kind text",
      "recurrence_rule text",
      "occurrence_starts_at timestamptz[]",
      "poster_asset_id text",
      "qr_asset_id text",
      "registration_qr_asset_id text",
      "hard_blockers jsonb not null default '[]'::jsonb",
      "soft_blockers jsonb not null default '[]'::jsonb",
      "operator_override_reason text",
      "resolution_decision text",
    ]) {
      expect(migration).toContain(column);
    }
  });
});
