#!/usr/bin/env node

import path from "node:path";
import { fileURLToPath } from "node:url";

import { createClient } from "@supabase/supabase-js";

import {
  buildAgentAuditPacket,
  writeAgentAuditPacket,
} from "../src/pipeline/v5/agent-audit.mjs";
import { createSupabaseAgentAuditStore } from "../src/pipeline/v5/agent-audit-supabase-store.mjs";
import { loadEnvFile, mergeEnvs } from "./env-inventory.mjs";

export function parseAgentAuditArgs(argv = []) {
  const args = {
    days: 7,
    envFiles: [],
    dataClasses: [],
    monthlyBudgetCny: 100,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--") {
      continue;
    } else if (arg === "--env-file") {
      args.envFiles.push(requireValue(argv, ++index, arg));
    } else if (arg === "--days") {
      args.days = parsePositiveInteger(requireValue(argv, ++index, arg), arg);
    } else if (arg === "--output-dir") {
      args.outputDir = requireValue(argv, ++index, arg);
    } else if (arg === "--data-class") {
      args.dataClasses.push(requireValue(argv, ++index, arg));
    } else if (arg === "--monthly-budget-cny") {
      args.monthlyBudgetCny = parseNonNegativeNumber(requireValue(argv, ++index, arg), arg);
    } else {
      throw new Error(`unknown_agent_audit_arg:${arg}`);
    }
  }
  return args;
}

export async function runAgentAuditCli(
  argv = process.argv.slice(2),
  consoleLike = console,
  {
    env = process.env,
    loadEnvFileImpl = loadEnvFile,
    getSupabaseClientImpl = createSupabaseAdminClientFromEnv,
    createStoreImpl = createSupabaseAgentAuditStore,
    buildPacketImpl = buildAgentAuditPacket,
    writePacketImpl = writeAgentAuditPacket,
    now = new Date(),
    store,
  } = {},
) {
  const args = parseAgentAuditArgs(argv);
  const outputDir = args.outputDir ?? path.join(
    ".agent-runs",
    `agent-audit-${timestampId(now)}`,
  );
  const envFromFiles = args.envFiles.map((envFile) => loadEnvFileImpl(envFile));
  const mergedEnv = mergeEnvs(env, ...envFromFiles);
  const auditStore = store ?? createStoreImpl({
    client: getSupabaseClientImpl(mergedEnv),
  });
  const packet = await buildPacketImpl({
    store: auditStore,
    days: args.days,
    now,
    dataClasses: args.dataClasses.length > 0 ? args.dataClasses : undefined,
    outputDir,
    monthlyBudgetCny: args.monthlyBudgetCny,
  });
  const paths = await writePacketImpl({ packet, outputDir });
  const output = {
    ok: true,
    runId: packet.runId,
    outputDir,
    candidateCount: packet.candidateIndex.candidates.length,
    paths,
  };
  consoleLike.log(JSON.stringify(output, null, 2));
  return { packet, paths };
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

function requireValue(argv, index, flag) {
  const value = argv[index];
  if (!value || value.startsWith("--")) {
    throw new Error(`missing_value_for_${flag.replace(/^--/, "").replaceAll("-", "_")}`);
  }
  return value;
}

function parsePositiveInteger(value, flag) {
  const number = Number(value);
  if (!Number.isInteger(number) || number <= 0) {
    throw new Error(`invalid_positive_integer_for_${flag.replace(/^--/, "").replaceAll("-", "_")}`);
  }
  return number;
}

function parseNonNegativeNumber(value, flag) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) {
    throw new Error(`invalid_non_negative_number_for_${flag.replace(/^--/, "").replaceAll("-", "_")}`);
  }
  return number;
}

function timestampId(value) {
  return value.toISOString().replace(/[^0-9]/g, "").slice(0, 14);
}

function clean(value) {
  const text = String(value ?? "").trim();
  return text || undefined;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runAgentAuditCli().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
