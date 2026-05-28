#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const placeholderPatterns = [
  /^replace-with-/i,
  /^https:\/\/your-/i,
  /^https:\/\/replace-with-/i,
  /^postgresql:\/\/postgres:password@/i,
  /^same-long-random-secret-as-vercel$/i,
  /^collector-side-provider-secret$/i,
  /^provider-model-name$/i,
];

const targetPlaceholderPatterns = {
  vercel: {
    NEXT_PUBLIC_APP_URL: [/^http:\/\/localhost(?::\d+)?$/i],
  },
  collector: {
    APP_BASE_URL: [/^http:\/\/localhost(?::\d+)?$/i],
    COLLECTOR_BASE_URL: [/^http:\/\/localhost(?::\d+)?$/i],
  },
};

export const targets = {
  "local-app": {
    description: "Next.js app and API on a developer machine",
    required: [
      "NEXT_PUBLIC_APP_URL",
      "ADMIN_ACCESS_TOKEN",
      "COLLECTOR_API_KEY",
      "NEXT_PUBLIC_SUPABASE_URL",
      "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
      "SUPABASE_SECRET_KEY",
    ],
    optional: ["SUPABASE_SERVICE_ROLE_KEY", "DATABASE_URL"],
  },
  vercel: {
    description: "Vercel hosted app, admin API, collector API, and public pages",
    required: [
      "NEXT_PUBLIC_APP_URL",
      "ADMIN_ACCESS_TOKEN",
      "COLLECTOR_API_KEY",
      "INTERNAL_API_SECRET",
      "NEXT_PUBLIC_SUPABASE_URL",
      "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
      "SUPABASE_SECRET_KEY",
      "DATABASE_URL",
      "CRON_SECRET",
      "OBSERVABILITY_PROVIDER",
      "VERCEL_WEB_ANALYTICS_ENABLED",
      "VERCEL_SPEED_INSIGHTS_ENABLED",
    ],
    optional: [
      "NEXT_PUBLIC_AMAP_JS_API_KEY",
      "AMAP_WEB_SERVICE_API_KEY",
      "AMAP_SECURITY_JS_CODE",
    ],
  },
  collector: {
    description: "Home collector machine or VM that polls Vercel and uploads runs",
    required: [
      "APP_BASE_URL",
      "COLLECTOR_BASE_URL",
      "COLLECTOR_API_KEY",
      "COLLECTOR_ID",
      "COLLECTOR_INTERVAL_HOURS",
      "COLLECTOR_BROWSER_PROFILE_DIR",
      "TEXT_INFERENCE_PROVIDER",
      "TEXT_INFERENCE_API_BASE_URL",
      "TEXT_INFERENCE_API_KEY",
      "TEXT_INFERENCE_MODEL",
      "TEXT_INFERENCE_ENDPOINT_STYLE",
    ],
    optional: [
      "LOCAL_COLLECTOR_CONSOLE_TOKEN",
      "EXA_API_KEY",
      "SERPER_API_KEY",
      "FIRECRAWL_API_KEY",
    ],
  },
};

export const targetNames = Object.keys(targets);

export function parseEnvText(text) {
  const env = {};

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const separatorIndex = line.indexOf("=");
    if (separatorIndex === -1) continue;

    const key = line.slice(0, separatorIndex).trim();
    const value = stripOptionalQuotes(line.slice(separatorIndex + 1).trim());
    if (key) env[key] = value;
  }

  return env;
}

export function loadEnvFile(path) {
  if (!path) return {};

  const absolutePath = resolve(process.cwd(), path);
  if (!existsSync(absolutePath)) {
    throw new Error(`env_file_not_found:${path}`);
  }

  return parseEnvText(readFileSync(absolutePath, "utf8"));
}

export function mergeEnvs(...envs) {
  return Object.assign({}, ...envs);
}

export function evaluateTarget(targetName, env) {
  const target = targets[targetName];
  if (!target) throw new Error(`unknown_target:${targetName}`);

  const missing = [];
  const placeholders = [];
  const present = [];

  for (const name of target.required) {
    const value = env[name]?.trim();
    if (!value) {
      missing.push(name);
      continue;
    }

    if (isPlaceholderValue(value, targetName, name)) {
      placeholders.push(name);
      continue;
    }

    present.push(name);
  }

  return {
    target: targetName,
    description: target.description,
    required: target.required,
    optional: target.optional,
    missing,
    placeholders,
    present,
    ok: missing.length === 0 && placeholders.length === 0,
  };
}

export function formatReport(results) {
  const lines = [];

  for (const result of results) {
    lines.push(`${result.ok ? "OK" : "MISSING"} ${result.target}`);
    lines.push(`  ${result.description}`);
    lines.push(
      `  Required: ${result.present.length}/${result.required.length} configured`,
    );

    if (result.missing.length > 0) {
      lines.push(`  Missing: ${result.missing.join(", ")}`);
    }

    if (result.placeholders.length > 0) {
      lines.push(`  Placeholder: ${result.placeholders.join(", ")}`);
    }

    if (result.present.length > 0) {
      lines.push(`  Present: ${result.present.join(", ")}`);
    }

    if (result.optional.length > 0) {
      lines.push(`  Optional: ${result.optional.join(", ")}`);
    }
  }

  return lines.join("\n");
}

export function redactValue(value) {
  return value ? "[set]" : "[missing]";
}

function isPlaceholderValue(value, targetName, variableName) {
  const targetPatterns =
    targetPlaceholderPatterns[targetName]?.[variableName] ?? [];

  return [...placeholderPatterns, ...targetPatterns].some((pattern) =>
    pattern.test(value),
  );
}

function stripOptionalQuotes(value) {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }

  return value;
}

function parseArgs(argv) {
  const args = {
    target: "all",
    envFile: undefined,
    help: false,
    listTargets: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") {
      args.help = true;
    } else if (arg === "--list-targets") {
      args.listTargets = true;
    } else if (arg === "--target") {
      args.target = argv[index + 1];
      index += 1;
    } else if (arg === "--env-file") {
      args.envFile = argv[index + 1];
      index += 1;
    } else {
      throw new Error(`unknown_arg:${arg}`);
    }
  }

  return args;
}

function printHelp() {
  console.log(`Usage: pnpm env:check [--target ${targetNames.join("|")}|all] [--env-file .env.local]

Checks required environment variable names without printing configured values.

Options:
  --target        Runtime target to check. Defaults to all.
  --env-file      Optional dotenv file merged over the current process env.
  --list-targets  Print supported target names.
  --help          Show this help text.`);
}

export function runCli(argv = process.argv.slice(2), baseEnv = process.env) {
  const args = parseArgs(argv);

  if (args.help) {
    printHelp();
    return 0;
  }

  if (args.listTargets) {
    console.log(targetNames.join("\n"));
    return 0;
  }

  const selectedTargets = args.target === "all" ? targetNames : [args.target];
  for (const targetName of selectedTargets) {
    if (!targets[targetName]) throw new Error(`unknown_target:${targetName}`);
  }

  const env = mergeEnvs(baseEnv, loadEnvFile(args.envFile));
  const results = selectedTargets.map((targetName) =>
    evaluateTarget(targetName, env),
  );

  console.log(formatReport(results));

  return results.every((result) => result.ok) ? 0 : 1;
}

const isMain = process.argv[1] === fileURLToPath(import.meta.url);
if (isMain) {
  try {
    process.exitCode = runCli();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 2;
  }
}
