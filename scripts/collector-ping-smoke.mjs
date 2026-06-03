#!/usr/bin/env node

import { fileURLToPath } from "node:url";

import { loadEnvFile, mergeEnvs } from "./env-inventory.mjs";

export function readCollectorPingSmokeConfig(env = process.env) {
  const baseUrl = normalizeBaseUrl(
    env.APP_BASE_URL ?? env.NEXT_PUBLIC_APP_URL ?? env.COLLECTOR_BASE_URL ?? "",
  );
  const collectorApiKey = env.COLLECTOR_API_KEY?.trim();
  const collectorId = env.COLLECTOR_ID?.trim();
  const missing = [];

  if (!baseUrl) missing.push("APP_BASE_URL");
  if (!collectorApiKey) missing.push("COLLECTOR_API_KEY");
  if (!collectorId) missing.push("COLLECTOR_ID");

  if (missing.length) return { ok: false, missing };

  return {
    ok: true,
    baseUrl,
    collectorApiKey,
    collectorId,
  };
}

export function buildCollectorPingHeaders(collectorId, collectorApiKey) {
  return {
    authorization: `Bearer ${collectorApiKey}`,
    "content-type": "application/json",
    "x-collector-id": collectorId,
  };
}

export async function runCollectorPingSmoke({
  env = process.env,
  fetchImpl = fetch,
}) {
  const config = readCollectorPingSmokeConfig(env);
  if (!config.ok) {
    throw new Error(`missing_collector_ping_env:${config.missing.join(",")}`);
  }

  const response = await fetchImpl(`${config.baseUrl}/api/collector/ping`, {
    method: "GET",
    headers: buildCollectorPingHeaders(
      config.collectorId,
      config.collectorApiKey,
    ),
  });
  const data = await response.json().catch(() => ({}));

  if (!response.ok || data?.ok !== true) {
    throw new Error(
      `collector_ping_failed:${response.status}:${data?.error ?? "unknown"}`,
    );
  }
  if (data.collectorId && data.collectorId !== config.collectorId) {
    throw new Error("collector_ping_shape_failed");
  }
  if (!("collectorId" in data)) {
    throw new Error("collector_ping_shape_failed");
  }

  return {
    kind: "passed",
    baseUrl: config.baseUrl,
    collectorId: config.collectorId,
  };
}

export function formatCollectorPingSmokeSummary(result) {
  return [
    "Collector ping smoke passed",
    `baseUrl=${result.baseUrl}`,
    `collectorId=${result.collectorId}`,
  ].join(" ");
}

function normalizeBaseUrl(value) {
  const trimmed = value.trim();
  if (!trimmed) return "";
  try {
    return new URL(trimmed).toString().replace(/\/+$/, "");
  } catch {
    return "";
  }
}

function parseArgs(argv) {
  const args = {
    envFile: undefined,
    help: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") {
      args.help = true;
    } else if (arg === "--env-file") {
      args.envFile = argv[++index];
    } else {
      throw new Error(`unknown_arg:${arg}`);
    }
  }
  return args;
}

function printHelp() {
  console.log(`Usage: pnpm smoke:collector-ping --env-file .env.local

Runs a read-only collector API ping against the configured app.

Required environment:
  APP_BASE_URL or COLLECTOR_BASE_URL
  COLLECTOR_API_KEY
  COLLECTOR_ID`);
}

export async function runCli(argv = process.argv.slice(2), baseEnv = process.env) {
  const args = parseArgs(argv);
  if (args.help) {
    printHelp();
    return 0;
  }

  const env = mergeEnvs(baseEnv, loadEnvFile(args.envFile));
  const result = await runCollectorPingSmoke({ env });
  console.log(formatCollectorPingSmokeSummary(result));
  return 0;
}

const isMain = process.argv[1] === fileURLToPath(import.meta.url);
if (isMain) {
  try {
    process.exitCode = await runCli();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
