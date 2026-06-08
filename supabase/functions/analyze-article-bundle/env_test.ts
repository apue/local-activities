/// <reference lib="deno.ns" />

import { assertEquals } from "./test_assertions.ts";
import { readAnalysisTimeoutMs, readServiceRoleKey } from "./env.ts";

Deno.test("readServiceRoleKey prefers hosted secret key and falls back to compatibility names", () => {
  assertEquals(
    readServiceRoleKey(envReader({
      SUPABASE_SECRET_KEY: "sb_secret_value",
      SUPABASE_SERVICE_ROLE_KEY: "service_role_value",
      SUPA_SERVICE_KEY: "local_service_value",
    })),
    "sb_secret_value",
  );
  assertEquals(
    readServiceRoleKey(envReader({
      SUPABASE_SERVICE_ROLE_KEY: "service_role_value",
      SUPA_SERVICE_KEY: "local_service_value",
    })),
    "service_role_value",
  );
  assertEquals(
    readServiceRoleKey(envReader({ SUPA_SERVICE_KEY: "local_service_value" })),
    "local_service_value",
  );
});

Deno.test("readAnalysisTimeoutMs accepts seconds env used by docs and ms env for compatibility", () => {
  assertEquals(
    readAnalysisTimeoutMs(envReader({ ANALYSIS_LLM_TIMEOUT_SECONDS: "120" })),
    120_000,
  );
  assertEquals(
    readAnalysisTimeoutMs(envReader({
      ANALYSIS_LLM_TIMEOUT_MS: "45000",
      ANALYSIS_LLM_TIMEOUT_SECONDS: "120",
    })),
    45_000,
  );
  assertEquals(
    readAnalysisTimeoutMs(() => undefined),
    30_000,
  );
});

function envReader(values: Record<string, string>) {
  return (name: string) => values[name];
}
