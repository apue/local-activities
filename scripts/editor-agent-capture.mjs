#!/usr/bin/env node

import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

import {
  loadEnvFile,
  mergeEnvs,
} from "./env-inventory.mjs";
import { runCollectorAgent } from "./collector-agent-processor.mjs";

const TRAILING_URL_PUNCTUATION = /[。，“”‘’'")\]}>,]+$/u;

export function extractCaptureInputUrl(input) {
  const match = String(input ?? "")
    .trim()
    .match(/https?:\/\/[^\s<>"'，。]+/u);
  if (!match) return undefined;

  const candidate = match[0].replace(TRAILING_URL_PUNCTUATION, "");
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

  return {
    ...env,
    ...(collectorBaseUrl ? { COLLECTOR_BASE_URL: collectorBaseUrl } : {}),
    COLLECTOR_ID: clean(env.COLLECTOR_ID) ?? "local-editor",
    COLLECTOR_BROWSER_RUNNER:
      clean(env.COLLECTOR_BROWSER_RUNNER) ?? "agent_browser",
    AGENT_PROVIDER: clean(env.AGENT_PROVIDER) ?? "openai",
    ...(editorApiBaseUrl ? { OPENAI_BASE_URL: editorApiBaseUrl } : {}),
    ...(editorApiKey ? { OPENAI_API_KEY: editorApiKey } : {}),
    ...(editorModel ? { OPENAI_MODEL: editorModel } : {}),
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
  };
}

export function formatEditorCaptureSummary(result) {
  const uploaded = result.uploadedIds ?? {};
  const parts = [
    "Editor capture finished",
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
    if (arg === "--env-file") {
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
  const result = await runEditorCapture({ input: args.input, env });
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
