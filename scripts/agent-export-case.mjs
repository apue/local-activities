#!/usr/bin/env node

import { fileURLToPath } from "node:url";

import { createClient } from "@supabase/supabase-js";

import { exportPrivateCorpusCase } from "../src/pipeline/v5/private-corpus-builder.mjs";
import { createSupabasePrivateCorpusStore } from "../src/pipeline/v5/private-corpus-supabase-store.mjs";
import { loadEnvFile, mergeEnvs } from "./env-inventory.mjs";

export function parseAgentExportCaseArgs(argv = []) {
  const args = {
    outputDir: ".local/private-corpus",
    envFiles: [],
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--feedback-id") {
      args.feedbackId = requireValue(argv, ++index, arg);
    } else if (arg === "--pipeline-run-id") {
      args.pipelineRunId = requireValue(argv, ++index, arg);
    } else if (arg === "--article-bundle-id") {
      args.articleBundleId = requireValue(argv, ++index, arg);
    } else if (arg === "--output-dir") {
      args.outputDir = requireValue(argv, ++index, arg);
    } else if (arg === "--case-id") {
      args.caseId = requireValue(argv, ++index, arg);
    } else if (arg === "--expected-action") {
      args.expectedAction = requireValue(argv, ++index, arg);
    } else if (arg === "--expected-event-count") {
      args.expectedEventCount = Number(requireValue(argv, ++index, arg));
    } else if (arg === "--env-file") {
      args.envFiles.push(requireValue(argv, ++index, arg));
    } else {
      throw new Error(`unknown_agent_export_case_arg:${arg}`);
    }
  }
  if (!args.feedbackId && !args.pipelineRunId && !args.articleBundleId) {
    throw new Error("agent_export_case_source_id_required");
  }
  if (
    args.expectedEventCount !== undefined &&
    (!Number.isInteger(args.expectedEventCount) || args.expectedEventCount < 0)
  ) {
    throw new Error("agent_export_case_expected_event_count_invalid");
  }
  return args;
}

export async function runAgentExportCaseCli(
  argv = process.argv.slice(2),
  consoleLike = console,
  {
    env = process.env,
    loadEnvFileImpl = loadEnvFile,
    getSupabaseAdminClientImpl = createSupabaseAdminClientFromEnv,
    exportPrivateCorpusCaseImpl = exportPrivateCorpusCase,
  } = {},
) {
  const args = parseAgentExportCaseArgs(argv);
  const envFromFiles = args.envFiles.map((envFile) => loadEnvFileImpl(envFile));
  const mergedEnv = mergeEnvs(env, ...envFromFiles);
  const client = getSupabaseAdminClientImpl(mergedEnv);
  const expected = args.expectedAction
    ? {
      action: args.expectedAction,
      eventCount: args.expectedEventCount ?? 1,
    }
    : undefined;
  const result = await exportPrivateCorpusCaseImpl({
    feedbackId: args.feedbackId,
    pipelineRunId: args.pipelineRunId,
    articleBundleId: args.articleBundleId,
    outputDir: args.outputDir,
    caseId: args.caseId,
    expected,
    store: createSupabasePrivateCorpusStore({ client }),
  });
  const output = {
    ok: true,
    caseId: result.caseId,
    caseDir: result.caseDir,
    manifestPath: result.manifestPath,
  };
  consoleLike.log(JSON.stringify(output, null, 2));
  return result;
}

function requireValue(argv, index, flag) {
  const value = argv[index];
  if (!value || value.startsWith("--")) {
    throw new Error(`missing_value_for_${flag.replace(/^--/, "").replaceAll("-", "_")}`);
  }
  return value;
}

export function createSupabaseAdminClientFromEnv(env) {
  const supabaseUrl =
    clean(env.NEXT_PUBLIC_SUPABASE_URL) ?? clean(env.SUPABASE_URL) ?? clean(env.SUPA_URL);
  const supabaseSecretKey =
    clean(env.SUPABASE_SECRET_KEY) ??
    clean(env.SUPABASE_SERVICE_ROLE_KEY) ??
    clean(env.SUPA_SERVICE_KEY);
  if (!supabaseUrl) throw new Error("missing_next_public_supabase_url");
  if (!supabaseSecretKey) throw new Error("missing_supabase_secret_key");
  return createClient(supabaseUrl, supabaseSecretKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
    },
  });
}

function clean(value) {
  const text = String(value ?? "").trim();
  return text || undefined;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runAgentExportCaseCli().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
