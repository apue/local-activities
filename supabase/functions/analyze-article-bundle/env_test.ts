/// <reference lib="deno.ns" />

import { assertEquals } from "./test_assertions.ts";
import {
  readAnalysisTimeoutMs,
  readBooleanEnv,
  readServiceRoleKey,
} from "./env.ts";

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

Deno.test("readBooleanEnv accepts common true and false values", () => {
  assertEquals(
    readBooleanEnv("ANALYSIS_LLM_ENABLE_THINKING", envReader({
      ANALYSIS_LLM_ENABLE_THINKING: "false",
    })),
    false,
  );
  assertEquals(
    readBooleanEnv("ANALYSIS_LLM_ENABLE_THINKING", envReader({
      ANALYSIS_LLM_ENABLE_THINKING: "1",
    })),
    true,
  );
  assertEquals(
    readBooleanEnv("ANALYSIS_LLM_ENABLE_THINKING", envReader({
      ANALYSIS_LLM_ENABLE_THINKING: "not-a-boolean",
    })),
    undefined,
  );
});

function envReader(values: Record<string, string>) {
  return (name: string) => values[name];
}
