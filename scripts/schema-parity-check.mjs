#!/usr/bin/env node

import { fileURLToPath } from "node:url";

import { createClient } from "@supabase/supabase-js";

import { loadEnvFile, mergeEnvs } from "./env-inventory.mjs";

export const requiredEventPipelineV2Columns = {
  event_drafts: [
    "triage_decision",
    "triage_action",
    "triage_confidence",
    "public_signals",
    "exclusion_signals",
    "public_eligibility",
    "event_kind",
    "schedule_kind",
    "schedule_text",
    "recurrence_rule",
    "occurrence_starts_at",
    "poster_asset_id",
    "qr_asset_id",
    "registration_qr_asset_id",
    "hard_blockers",
    "soft_blockers",
    "operator_override_reason",
    "resolution_decision",
    "canonical_event_id",
    "processing_state",
  ],
  canonical_events: [
    "triage_decision",
    "public_eligibility",
    "event_kind",
    "schedule_kind",
    "schedule_text",
    "recurrence_rule",
    "occurrence_starts_at",
    "poster_asset_id",
    "qr_asset_id",
    "registration_qr_asset_id",
    "hard_blockers",
    "soft_blockers",
    "operator_override_reason",
    "resolution_decision",
  ],
  excluded_articles: [
    "excluded_article_id",
    "article_url",
    "triage_attempt_id",
    "triage_decision",
    "triage_action",
    "confidence",
    "public_signals",
    "exclusion_signals",
    "exclusion_reason",
    "evidence_asset_ids",
    "prompt_version",
    "schema_version",
    "provider",
    "model",
    "processing_state",
    "promoted_at",
  ],
};

export async function runSchemaParityCheck({
  client,
  requiredColumns = requiredEventPipelineV2Columns,
}) {
  const missing = [];

  for (const [table, columns] of Object.entries(requiredColumns)) {
    const { error } = await client
      .from(table)
      .select(columns.join(","))
      .limit(0);

    if (error) {
      missing.push({
        table,
        columns,
        error: sanitizeError(error),
      });
    }
  }

  return {
    ok: missing.length === 0,
    missing,
  };
}

function readConfig(env) {
  const supabaseUrl = env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const supabaseSecretKey =
    env.SUPABASE_SECRET_KEY?.trim() ||
    env.SUPABASE_SERVICE_ROLE_KEY?.trim() ||
    env.SUPA_SERVICE_KEY?.trim();

  if (!supabaseUrl) throw new Error("missing_next_public_supabase_url");
  if (!supabaseSecretKey) throw new Error("missing_supabase_secret_key");

  return { supabaseUrl, supabaseSecretKey };
}

function sanitizeError(error) {
  const message =
    typeof error === "object" && error && "message" in error
      ? String(error.message)
      : String(error ?? "");
  return message.replace(/Bearer\s+[A-Za-z0-9._-]+/g, "Bearer [redacted]");
}

async function main() {
  const args = process.argv.slice(2);
  const envFileIndex = args.indexOf("--env-file");
  const envFile =
    envFileIndex >= 0 && args[envFileIndex + 1]
      ? args[envFileIndex + 1]
      : undefined;
  const env = mergeEnvs(process.env, envFile ? loadEnvFile(envFile) : {});
  const config = readConfig(env);
  const client = createClient(config.supabaseUrl, config.supabaseSecretKey, {
    auth: { persistSession: false },
  });
  const result = await runSchemaParityCheck({ client });

  if (!result.ok) {
    console.error(
      JSON.stringify(
        {
          ok: false,
          missing: result.missing,
          target: config.supabaseUrl,
        },
        null,
        2,
      ),
    );
    process.exitCode = 1;
    return;
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        checkedTables: Object.keys(requiredEventPipelineV2Columns),
        target: config.supabaseUrl,
      },
      null,
      2,
    ),
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
