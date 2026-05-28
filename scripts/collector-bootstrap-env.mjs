#!/usr/bin/env node

import { chmod, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { loadEnvFile, mergeEnvs } from "./env-inventory.mjs";

const defaultCollectorHost = "192.168.0.16";
const defaultOutputPath = ".env.collector.generated";

const outputOrder = [
  "APP_BASE_URL",
  "COLLECTOR_BASE_URL",
  "COLLECTOR_API_KEY",
  "COLLECTOR_ID",
  "COLLECTOR_INTERVAL_HOURS",
  "COLLECTOR_BROWSER_PROFILE_DIR",
  "LOCAL_COLLECTOR_PROCESSOR",
  "LOCAL_COLLECTOR_QUEUE_FILE",
  "COLLECTOR_CONSOLE_HOST",
  "COLLECTOR_CONSOLE_PORT",
  "COLLECTOR_POLLING_ENABLED",
  "COLLECTOR_POLL_INTERVAL_SECONDS",
  "COLLECTOR_ERROR_BACKOFF_SECONDS",
  "COLLECTOR_CAPABILITIES",
  "TEXT_INFERENCE_PROVIDER",
  "TEXT_INFERENCE_API_BASE_URL",
  "TEXT_INFERENCE_API_KEY",
  "TEXT_INFERENCE_MODEL",
  "TEXT_INFERENCE_ENDPOINT_STYLE",
  "EXA_API_KEY",
  "SERPER_API_KEY",
  "FIRECRAWL_API_KEY",
];

export function buildCollectorBootstrapEnv({
  sourceEnv = process.env,
  collectorHost = defaultCollectorHost,
  collectorId,
} = {}) {
  const appBaseUrl =
    usableValue(sourceEnv.APP_BASE_URL)
    || usableValue(sourceEnv.COLLECTOR_BASE_URL)
    || usableValue(sourceEnv.NEXT_PUBLIC_APP_URL)
    || "https://replace-with-vercel-app-url.example";
  const resolvedCollectorId =
    collectorId
    || value(sourceEnv.COLLECTOR_ID)
    || `home-${collectorHost.replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-|-$/g, "")}`;

  return removeUndefined({
    APP_BASE_URL: appBaseUrl,
    COLLECTOR_BASE_URL: usableValue(sourceEnv.COLLECTOR_BASE_URL) || appBaseUrl,
    COLLECTOR_API_KEY:
      value(sourceEnv.COLLECTOR_API_KEY) || "replace-with-collector-api-key",
    COLLECTOR_ID: resolvedCollectorId,
    COLLECTOR_INTERVAL_HOURS: value(sourceEnv.COLLECTOR_INTERVAL_HOURS) || "4",
    COLLECTOR_BROWSER_PROFILE_DIR:
      value(sourceEnv.COLLECTOR_BROWSER_PROFILE_DIR) || ".collector-profile",
    LOCAL_COLLECTOR_PROCESSOR: "extract",
    LOCAL_COLLECTOR_QUEUE_FILE:
      value(sourceEnv.LOCAL_COLLECTOR_QUEUE_FILE) || ".collector-runs.json",
    COLLECTOR_CONSOLE_HOST:
      value(sourceEnv.COLLECTOR_CONSOLE_HOST) || "127.0.0.1",
    COLLECTOR_CONSOLE_PORT: value(sourceEnv.COLLECTOR_CONSOLE_PORT) || "4317",
    COLLECTOR_POLLING_ENABLED:
      value(sourceEnv.COLLECTOR_POLLING_ENABLED) || "true",
    COLLECTOR_POLL_INTERVAL_SECONDS:
      value(sourceEnv.COLLECTOR_POLL_INTERVAL_SECONDS) || "60",
    COLLECTOR_ERROR_BACKOFF_SECONDS:
      value(sourceEnv.COLLECTOR_ERROR_BACKOFF_SECONDS) || "60",
    COLLECTOR_CAPABILITIES:
      value(sourceEnv.COLLECTOR_CAPABILITIES)
      || "wechat_browser,dom_text,image_capture,vision_extraction",
    TEXT_INFERENCE_PROVIDER:
      value(sourceEnv.TEXT_INFERENCE_PROVIDER) || "openai-compatible",
    TEXT_INFERENCE_API_BASE_URL:
      value(sourceEnv.TEXT_INFERENCE_API_BASE_URL)
      || "https://your-agent-or-llm-api.example/v1",
    TEXT_INFERENCE_API_KEY:
      value(sourceEnv.TEXT_INFERENCE_API_KEY)
      || "replace-with-text-inference-api-key",
    TEXT_INFERENCE_MODEL:
      value(sourceEnv.TEXT_INFERENCE_MODEL) || "provider-model-name",
    TEXT_INFERENCE_ENDPOINT_STYLE:
      value(sourceEnv.TEXT_INFERENCE_ENDPOINT_STYLE) || "responses",
    EXA_API_KEY: value(sourceEnv.EXA_API_KEY),
    SERPER_API_KEY: value(sourceEnv.SERPER_API_KEY),
    FIRECRAWL_API_KEY: value(sourceEnv.FIRECRAWL_API_KEY),
  });
}

export function formatCollectorBootstrapEnv(env) {
  const lines = [
    "# Local Activities collector machine environment",
    "# Generated for the home collector runtime. Keep this file off Git.",
    "",
  ];

  for (const key of outputOrder) {
    if (env[key] === undefined) continue;
    lines.push(`${key}=${formatEnvValue(env[key])}`);
  }

  lines.push("");
  return lines.join("\n");
}

export async function runCollectorBootstrapEnvCli(
  argv = process.argv.slice(2),
  baseEnv = process.env,
) {
  const args = parseArgs(argv);
  if (args.help) {
    printHelp();
    return 0;
  }

  const sourceEnv = mergeEnvs(loadEnvFile(args.envFile), baseEnv);
  const env = buildCollectorBootstrapEnv({
    sourceEnv,
    collectorHost: args.collectorHost,
    collectorId: args.collectorId,
  });

  await writeFile(args.output, formatCollectorBootstrapEnv(env), {
    encoding: "utf8",
    mode: 0o600,
  });
  await chmod(args.output, 0o600);
  console.log(`Wrote collector env template to ${args.output}`);
  return 0;
}

function parseArgs(argv) {
  const args = {
    envFile: undefined,
    output: defaultOutputPath,
    collectorHost: defaultCollectorHost,
    collectorId: undefined,
    help: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") {
      args.help = true;
    } else if (arg === "--env-file") {
      args.envFile = argv[index + 1];
      index += 1;
    } else if (arg === "--output") {
      args.output = argv[index + 1];
      index += 1;
    } else if (arg === "--collector-host") {
      args.collectorHost = argv[index + 1];
      index += 1;
    } else if (arg === "--collector-id") {
      args.collectorId = argv[index + 1];
      index += 1;
    } else {
      throw new Error(`unknown_arg:${arg}`);
    }
  }

  if (!args.output) throw new Error("missing_output");
  if (!args.collectorHost) throw new Error("missing_collector_host");
  return args;
}

function printHelp() {
  console.log(`Usage: pnpm collector:bootstrap-env [--env-file .env.local] [--output .env.collector.generated]

Generates a collector-machine-only dotenv file without Supabase, admin, or Vercel management secrets.

Options:
  --env-file        Source dotenv file to merge over current environment.
  --output          Output dotenv path. Defaults to ${defaultOutputPath}.
  --collector-host  Collector machine host/IP. Defaults to ${defaultCollectorHost}.
  --collector-id    Override COLLECTOR_ID.
  --help            Show this help text.`);
}

function formatEnvValue(rawValue) {
  const envValue = String(rawValue);
  if (/^[A-Za-z0-9_./:@,+-]+$/.test(envValue)) return envValue;
  return JSON.stringify(envValue);
}

function value(rawValue) {
  const envValue = rawValue?.trim();
  return envValue || undefined;
}

function usableValue(rawValue) {
  const envValue = value(rawValue);
  if (!envValue) return undefined;
  if (
    /^https:\/\/your-/i.test(envValue) ||
    /^https:\/\/replace-with-/i.test(envValue) ||
    /^http:\/\/localhost(?::\d+)?$/i.test(envValue)
  ) {
    return undefined;
  }
  return envValue;
}

function removeUndefined(object) {
  return Object.fromEntries(
    Object.entries(object).filter(([, entryValue]) => entryValue !== undefined),
  );
}

const isMain = process.argv[1] === fileURLToPath(import.meta.url);
if (isMain) {
  try {
    process.exitCode = await runCollectorBootstrapEnvCli();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
