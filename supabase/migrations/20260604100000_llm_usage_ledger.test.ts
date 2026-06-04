import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const migrationPath = join(
  process.cwd(),
  "supabase/migrations/20260604100000_llm_usage_ledger.sql",
);

describe("LLM usage ledger migration", () => {
  const sql = () => readFileSync(migrationPath, "utf8");

  it("creates an append-only usage ledger with safe accounting fields", () => {
    const migration = sql();

    expect(migration).toContain(
      "create table if not exists public.llm_usage_ledger",
    );
    for (const column of [
      "usage_id text not null unique",
      "recorded_at timestamptz not null default now()",
      "operation text not null",
      "provider text not null",
      "model text not null",
      "status text not null",
      "input_tokens integer not null default 0",
      "output_tokens integer not null default 0",
      "total_tokens integer not null default 0",
      "cost_micro_cny bigint not null default 0",
      "metadata jsonb not null default '{}'::jsonb",
    ]) {
      expect(migration).toContain(column);
    }
    expect(migration).toContain("llm_usage_ledger_tokens_nonnegative");
    expect(migration).toContain("llm_usage_ledger_cost_nonnegative");
    expect(migration).toContain("llm_usage_ledger_no_update");
    expect(migration).toContain("llm_usage_ledger_no_delete");
  });

  it("indexes admin summary reads without adding sensitive payload columns", () => {
    const migration = sql();

    for (const indexName of [
      "llm_usage_ledger_recorded_at_idx",
      "llm_usage_ledger_model_idx",
      "llm_usage_ledger_operation_idx",
      "llm_usage_ledger_source_run_idx",
    ]) {
      expect(migration).toContain(`create index if not exists ${indexName}`);
    }

    for (const forbidden of [
      "prompt",
      "response",
      "html",
      "image_data",
      "api_key",
      "headers",
      "cookies",
      "admin_token",
      "collector_secret",
    ]) {
      expect(migration.toLowerCase()).not.toContain(forbidden);
    }
  });
});
