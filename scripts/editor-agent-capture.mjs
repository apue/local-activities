#!/usr/bin/env node

import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

import {
  loadEnvFile,
  mergeEnvs,
} from "./env-inventory.mjs";
import { runCollectorAgent } from "./collector-agent-processor.mjs";

const TRAILING_URL_PUNCTUATION = /[。，“”‘’'")\]}>,]+$/u;
const URL_PATTERN = /https?:\/\/[^\s<>"'，。]+/gu;

export function extractCaptureInputUrl(input) {
  return extractCaptureInputUrls(input)[0];
}

export function extractCaptureInputUrls(input) {
  const seen = new Set();
  const urls = [];

  for (const match of String(input ?? "").trim().matchAll(URL_PATTERN)) {
    const url = normalizeCaptureUrl(match[0]);
    if (!url || seen.has(url)) continue;
    seen.add(url);
    urls.push(url);
  }

  return urls;
}

function normalizeCaptureUrl(value) {
  const candidate = String(value ?? "").replace(TRAILING_URL_PUNCTUATION, "");
  try {
    const url = new URL(candidate);
    if (!["http:", "https:"].includes(url.protocol)) return undefined;
    return url.toString();
  } catch {
    return undefined;
  }
}

export function buildEditorCaptureEnv(env = {}) {
  const collectorBaseUrl =
    clean(env.COLLECTOR_BASE_URL) ??
    clean(env.APP_BASE_URL) ??
    clean(env.NEXT_PUBLIC_APP_URL);
  const editorApiBaseUrl =
    clean(env.EDITOR_AGENT_API_BASE_URL) ?? clean(env.OPENAI_BASE_URL);
  const editorApiKey =
    clean(env.EDITOR_AGENT_API_KEY) ?? clean(env.OPENAI_API_KEY);
  const editorModel =
    clean(env.EDITOR_AGENT_MODEL) ?? clean(env.OPENAI_MODEL);
  const editorApiStyle =
    clean(env.EDITOR_AGENT_API_STYLE) ?? clean(env.AGENT_API_STYLE);

  return {
    ...env,
    ...(collectorBaseUrl ? { COLLECTOR_BASE_URL: collectorBaseUrl } : {}),
    COLLECTOR_ID: clean(env.COLLECTOR_ID) ?? "local-editor",
    COLLECTOR_BROWSER_RUNNER:
      clean(env.COLLECTOR_BROWSER_RUNNER) ?? "agent_browser",
    AGENT_EVENT_CANDIDATE_LOOKUP:
      clean(env.AGENT_EVENT_CANDIDATE_LOOKUP) ?? "true",
    AGENT_PROVIDER: clean(env.AGENT_PROVIDER) ?? "openai",
    ...(editorApiBaseUrl ? { OPENAI_BASE_URL: editorApiBaseUrl } : {}),
    ...(editorApiKey ? { OPENAI_API_KEY: editorApiKey } : {}),
    ...(editorModel ? { OPENAI_MODEL: editorModel } : {}),
    ...(editorApiStyle ? { AGENT_API_STYLE: editorApiStyle } : {}),
  };
}

export async function runEditorCapture({
  input,
  env = process.env,
  now = new Date(),
  runCollectorAgentImpl = runCollectorAgent,
} = {}) {
  const seedUrl = extractCaptureInputUrl(input);
  if (!seedUrl) throw new Error("missing_capture_url");

  const runId = buildRunId(seedUrl, now);
  const captureEnv = buildEditorCaptureEnv(env);
  validateEditorCaptureEnv(captureEnv);
  const result = await runCollectorAgentImpl({
    env: captureEnv,
    seedUrl,
    runId,
    reportVercelJob: false,
  });

  const uploadedIds = result.uploadedIds ?? {};
  return {
    kind: result.kind,
    outcome: classifyUploadedIds(uploadedIds),
    seedUrl,
    runId,
    uploadedIds,
    ...(result.eventCandidates
      ? { eventCandidates: result.eventCandidates }
      : {}),
  };
}

export async function runEditorCaptureBatch({
  input,
  env = process.env,
  now = new Date(),
  runCollectorAgentImpl = runCollectorAgent,
} = {}) {
  const seedUrls = extractCaptureInputUrls(input);
  if (seedUrls.length === 0) throw new Error("missing_capture_url");

  const results = [];
  for (const seedUrl of seedUrls) {
    try {
      const result = await runEditorCapture({
        input: seedUrl,
        env,
        now,
        runCollectorAgentImpl,
      });
      results.push({
        ok: true,
        ...result,
      });
    } catch (error) {
      results.push({
        ok: false,
        seedUrl,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const failedCount = results.filter((result) => !result.ok).length;
  return {
    kind: "batch",
    totalCount: results.length,
    succeededCount: results.length - failedCount,
    failedCount,
    results,
  };
}

function validateEditorCaptureEnv(env) {
  const missingCollector = [];
  if (!clean(env.COLLECTOR_BASE_URL)) {
    missingCollector.push("COLLECTOR_BASE_URL|APP_BASE_URL|NEXT_PUBLIC_APP_URL");
  }
  if (!clean(env.COLLECTOR_ID)) missingCollector.push("COLLECTOR_ID");
  if (!clean(env.COLLECTOR_API_KEY)) missingCollector.push("COLLECTOR_API_KEY");
  if (missingCollector.length > 0) {
    throw new Error(`missing_editor_collector_config:${missingCollector.join(",")}`);
  }

  const missingAgent = [];
  if (!clean(env.OPENAI_API_KEY)) {
    missingAgent.push("EDITOR_AGENT_API_KEY|OPENAI_API_KEY");
  }
  if (!clean(env.OPENAI_MODEL)) {
    missingAgent.push("EDITOR_AGENT_MODEL|OPENAI_MODEL");
  }
  if (missingAgent.length > 0) {
    throw new Error(`missing_editor_agent_config:${missingAgent.join(",")}`);
  }
}

export function formatEditorCaptureSummary(result) {
  if (result?.kind === "batch") {
    const lines = [
      `Editor capture batch finished total=${result.totalCount} succeeded=${result.succeededCount} failed=${result.failedCount}`,
    ];
    for (const [index, item] of (result.results ?? []).entries()) {
      if (item.ok) {
        lines.push(`[${index + 1}] ok ${formatSingleCaptureFields(item)}`);
      } else {
        lines.push(
          `[${index + 1}] failed seedUrl=${item.seedUrl} error=${item.error}`,
        );
      }
    }
    return lines.join("\n");
  }

  return `Editor capture finished ${formatSingleCaptureFields(result)}`;
}

function formatSingleCaptureFields(result) {
  const uploaded = result.uploadedIds ?? {};
  const parts = [
    `outcome=${result.outcome}`,
    `seedUrl=${result.seedUrl}`,
    `runId=${result.runId}`,
  ];
  for (const key of [
    "sourceId",
    "sourceRunId",
    "articleSnapshotId",
    "eventDraftId",
    "failureId",
    "eventCandidateCount",
  ]) {
    if (uploaded[key]) parts.push(`${key}=${uploaded[key]}`);
  }
  if (uploaded.evidenceAssetIds?.length) {
    parts.push(`evidenceAssetIds=${uploaded.evidenceAssetIds.join(",")}`);
  }
  return parts.join(" ");
}

export function parseArgs(argv) {
  const result = {
    envFile: undefined,
    json: false,
    inputParts: [],
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--" && result.inputParts.length === 0) {
      continue;
    } else if (arg === "--env-file") {
      result.envFile = argv[index + 1];
      index += 1;
    } else if (arg === "--json") {
      result.json = true;
    } else if (arg === "--") {
      result.inputParts.push(...argv.slice(index + 1));
      break;
    } else {
      result.inputParts.push(arg);
    }
  }

  return {
    ...result,
    input: result.inputParts.join(" ").trim(),
  };
}

function classifyUploadedIds(uploadedIds) {
  if (uploadedIds.eventDraftId) return "event_submitted";
  if (uploadedIds.failureId) return "structured_failure";
  return "captured";
}

function buildRunId(seedUrl, now) {
  const timestamp = now.toISOString().replace(/[-:.]/g, "");
  const hash = createHash("sha256").update(seedUrl).digest("hex").slice(0, 8);
  return `editor-${timestamp}-${hash}`;
}

function clean(value) {
  const stringValue = typeof value === "string" ? value.trim() : "";
  return stringValue || undefined;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.input) {
    console.error(
      "Usage: pnpm editor:capture -- [--env-file .env.local] [--json] <url-or-shared-text>",
    );
    process.exitCode = 2;
    return;
  }

  const env = mergeEnvs(
    process.env,
    args.envFile ? loadEnvFile(args.envFile) : {},
  );
  const urls = extractCaptureInputUrls(args.input);
  const result = urls.length > 1
    ? await runEditorCaptureBatch({ input: args.input, env })
    : await runEditorCapture({ input: args.input, env });
  console.log(
    args.json
      ? JSON.stringify(result, null, 2)
      : formatEditorCaptureSummary(result),
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
