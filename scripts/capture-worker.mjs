#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  createWechat2RssClient,
  readWechat2RssConfig,
} from "../src/collector/source-providers/wechat2rss/index.mjs";
import {
  createSupabaseCaptureAdapter,
  createSupabaseCaptureClientFromEnv,
} from "../src/capture-worker/supabase-adapter.mjs";
import { runWechat2RssCaptureOnce } from "../src/capture-worker/wechat2rss-worker.mjs";
import { createCurlProxyFetch } from "../src/net/curl-proxy-fetch.mjs";

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(helpText());
    return;
  }

  loadEnvFiles(args.envFiles, process.env);

  const wechatConfig = readWechat2RssConfig(process.env);
  if (!wechatConfig.ok) {
    throw new Error(`${wechatConfig.error}:${wechatConfig.missing.join(",")}`);
  }

  const wechat2rss = createWechat2RssClient({
    baseUrl: wechatConfig.baseUrl,
    token: wechatConfig.token,
  });
  const runtime = createCaptureWorkerRuntime({
    args,
    env: process.env,
  });

  const result = await runWechat2RssCaptureOnce({
    wechat2rss,
    supabase: runtime.supabase,
    idempotency: runtime.idempotency,
    dryRun: args.dryRun,
    dataClass: args.dataClass,
    lookbackDays: wechatConfig.lookbackDays,
    limit: args.limit,
    fetchImpl: runtime.fetchImpl,
    onProgress: args.quietProgress
      ? undefined
      : (event) => console.error(JSON.stringify({ progress: event })),
  });
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exitCode = 1;
}

export function createCaptureWorkerRuntime({
  args = {},
  env = process.env,
  createProxyFetchImpl = createCurlProxyFetch,
  createSupabaseClientImpl = createSupabaseCaptureClientFromEnv,
  createSupabaseAdapterImpl = createSupabaseCaptureAdapter,
} = {}) {
  const fetchImpl = args.proxyUrl ? createProxyFetchImpl(args.proxyUrl) : undefined;
  const supabase = args.dryRun
    ? undefined
    : createSupabaseAdapterFromEnv(env, {
      fetchImpl,
      createSupabaseClientImpl,
      createSupabaseAdapterImpl,
    });
  const idempotency =
    supabase ??
    createIdempotencyAdapterForArgs({
      dryRun: args.dryRun,
      env,
      fetchImpl,
      createSupabaseClientImpl,
      createSupabaseAdapterImpl,
    });
  return { fetchImpl, supabase, idempotency };
}

export function createIdempotencyAdapterForArgs({
  dryRun,
  env = process.env,
  createSupabaseClientImpl = createSupabaseCaptureClientFromEnv,
  createSupabaseAdapterImpl = createSupabaseCaptureAdapter,
  proxyUrl,
  fetchImpl,
} = {}) {
  if (!dryRun) return undefined;
  const effectiveFetchImpl = fetchImpl ??
    (proxyUrl ? createCurlProxyFetch(proxyUrl) : undefined);
  if (hasSupabaseIdempotencyEnv(env)) {
    return createSupabaseAdapterImpl({
      client: createSupabaseClientImpl({
        env,
        fetchImpl: effectiveFetchImpl,
      }),
      collectorEdgeToken: env.COLLECTOR_EDGE_TOKEN,
      collectorId: env.COLLECTOR_ID,
      fetchImpl: effectiveFetchImpl,
    });
  }
  return {
    async findExistingBundle() {
      return null;
    },
  };
}

export function createSupabaseAdapterFromEnv(
  env,
  {
    proxyUrl,
    fetchImpl,
    createSupabaseClientImpl = createSupabaseCaptureClientFromEnv,
    createSupabaseAdapterImpl = createSupabaseCaptureAdapter,
  } = {},
) {
  const effectiveFetchImpl = fetchImpl ??
    (proxyUrl ? createCurlProxyFetch(proxyUrl) : undefined);
  const analyzeFunctionUrl = clean(env.ANALYZE_FUNCTION_URL);
  return createSupabaseAdapterImpl({
    client: createSupabaseClientImpl({
      env,
      fetchImpl: effectiveFetchImpl,
    }),
    analyzeFunctionTimeoutMs: parsePositiveIntegerEnv(
      env.ANALYZE_FUNCTION_TIMEOUT_MS,
    ),
    analyzeFunctionUrl,
    collectorEdgeToken: env.COLLECTOR_EDGE_TOKEN,
    collectorId: env.COLLECTOR_ID,
    fetchImpl: fetchForAnalyzeFunctionUrl({
      analyzeFunctionUrl,
      fetchImpl: effectiveFetchImpl,
    }),
  });
}

function hasSupabaseIdempotencyEnv(env) {
  return Boolean(
    clean(env.NEXT_PUBLIC_SUPABASE_URL) ??
      clean(env.SUPABASE_URL) ??
      clean(env.SUPA_URL),
  ) && Boolean(
    clean(env.SUPABASE_SECRET_KEY) ??
      clean(env.SUPABASE_SERVICE_ROLE_KEY) ??
      clean(env.SUPA_SERVICE_KEY),
  );
}

export function parseArgs(argv) {
  const args = {
    dryRun: true,
    dataClass: "production",
    envFiles: [],
    proxyUrl: undefined,
    help: false,
    quietProgress: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--") {
      continue;
    } else if (arg === "--help" || arg === "-h") {
      args.help = true;
    } else if (arg === "--dry-run") {
      args.dryRun = true;
    } else if (arg === "--apply") {
      args.dryRun = false;
    } else if (arg === "--data-class") {
      const value = requiredValue(argv, index, arg);
      if (!["production", "eval", "test", "smoke"].includes(value)) {
        throw new Error(`invalid_data_class:${value}`);
      }
      args.dataClass = value;
      index += 1;
    } else if (arg === "--limit") {
      const value = requiredValue(argv, index, arg);
      args.limit = parsePositiveInteger(value, "limit");
      index += 1;
    } else if (arg === "--env-file") {
      args.envFiles.push(requiredValue(argv, index, arg));
      index += 1;
    } else if (arg === "--proxy-url") {
      args.proxyUrl = requiredValue(argv, index, arg);
      index += 1;
    } else if (arg === "--quiet-progress") {
      args.quietProgress = true;
    } else {
      throw new Error(`unknown_arg:${arg}`);
    }
  }
  return args;
}

function loadEnvFiles(paths, env) {
  for (const path of paths) {
    const content = readFileSync(resolve(path), "utf8");
    for (const line of content.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
      if (!match) continue;
      const [, key, rawValue] = match;
      env[key] = unquoteEnvValue(rawValue);
    }
  }
}

function unquoteEnvValue(value) {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith("\"") && trimmed.endsWith("\"")) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function clean(value) {
  const text = String(value ?? "").trim();
  return text || undefined;
}

function requiredValue(argv, index, arg) {
  const value = argv[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`missing_value:${arg}`);
  return value;
}

function parsePositiveInteger(value, name) {
  if (!/^[1-9][0-9]*$/.test(value)) throw new Error(`invalid_${name}:${value}`);
  return Number(value);
}

function parsePositiveIntegerEnv(value) {
  const text = clean(value);
  if (!text) return undefined;
  return parsePositiveInteger(text, "analyze_function_timeout_ms");
}

function fetchForAnalyzeFunctionUrl({ analyzeFunctionUrl, fetchImpl }) {
  if (!fetchImpl) return undefined;
  const text = clean(analyzeFunctionUrl);
  if (!text) return fetchImpl;
  try {
    const url = new URL(text);
    return ["localhost", "127.0.0.1", "::1"].includes(url.hostname)
      ? undefined
      : fetchImpl;
  } catch {
    return fetchImpl;
  }
}

function helpText() {
  return [
    "Usage: pnpm capture:wechat2rss:once [--dry-run|--apply] [--data-class production|eval|test|smoke] [--limit N] [--env-file .env.local] [--proxy-url http://127.0.0.1:7897] [--quiet-progress]",
    "",
    "Dry-run is the default. Use --apply to upload article bundles and invoke analyze-article-bundle.",
  ].join("\n");
}

const isMain = process.argv[1] === fileURLToPath(import.meta.url);
if (isMain) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
