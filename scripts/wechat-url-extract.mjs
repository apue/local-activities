#!/usr/bin/env node

import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

import { loadEnvFile, mergeEnvs } from "./env-inventory.mjs";
import {
  formatLlmExtractionSummary,
  runLlmExtractionOnce,
} from "./llm-extractor.mjs";

const execFileAsync = promisify(execFile);
const maxVisibleTextLength = 12_000;

export function parseWechatUrlExtractionArgs(argv) {
  const args = {
    url: undefined,
    envFile: undefined,
    upload: false,
    session: "wechat-url-extract",
    help: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") args.help = true;
    else if (arg === "--url") args.url = argv[(index += 1)];
    else if (arg === "--env-file") args.envFile = argv[(index += 1)];
    else if (arg === "--upload") args.upload = true;
    else if (arg === "--session") args.session = argv[(index += 1)];
    else throw new Error(`unknown_arg:${arg}`);
  }
  return args;
}

export function buildWechatArticleSnapshotFromText({ url, text, now = new Date() }) {
  const visibleText = cleanText(text).slice(0, maxVisibleTextLength);
  const lines = visibleText
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const title = lines[0] ?? "Untitled WeChat article";
  const authorName = inferAuthorName(lines, title);
  const publishedAt = inferPublishedAt(lines);
  return {
    canonicalUrl: url,
    finalUrl: url,
    title,
    authorName,
    publishedAt,
    capturedAt: now.toISOString(),
    languageHints: inferLanguageHints(visibleText),
    captureMode: "text_complete",
    visibleText,
    textHash: hashText(visibleText),
    evidenceAssetIds: [],
    contentHash: hashText(`${url}\n${visibleText}`),
  };
}

export async function runWechatUrlExtractionOnce({
  env = process.env,
  url,
  upload = false,
  session = "wechat-url-extract",
  now = new Date(),
  fetchImpl = fetch,
  readArticleText = readWechatArticleTextWithAgentBrowser,
  extract = runLlmExtractionOnce,
}) {
  if (!url) throw new Error("missing_url");
  const text = await readArticleText({ url, session });
  const articleSnapshot = buildWechatArticleSnapshotFromText({ url, text, now });
  const runId = `wechat-url-${now.toISOString().replace(/[^0-9]/g, "").slice(0, 14)}`;
  const extraction = await extract({
    env,
    articleSnapshot,
    fetchImpl,
    now,
    runId,
    upload,
  });
  return {
    url,
    runId,
    articleTitle: articleSnapshot.title,
    articleSnapshot,
    extraction,
    draftSummaries: summarizeDrafts(extraction.eventDrafts ?? []),
    failureSummaries: (extraction.failures ?? []).map((failure) => failure.payload),
  };
}

export function formatWechatUrlExtractionSummary(result) {
  return [
    "Wechat URL extraction",
    `run=${result.runId}`,
    `title=${JSON.stringify(result.articleTitle)}`,
    `drafts=${result.draftSummaries.length}`,
    `failures=${result.failureSummaries.length}`,
  ].join(" ");
}

export async function readWechatArticleTextWithAgentBrowser({ url, session }) {
  await execAgentBrowser(["--session", session, "open", url]);
  await execAgentBrowser(["--session", session, "wait", "--load", "networkidle"]);
  return execAgentBrowser(["--session", session, "get", "text", "body"]);
}

async function execAgentBrowser(args) {
  const { stdout } = await execFileAsync("agent-browser", args, {
    encoding: "utf8",
    maxBuffer: 2_000_000,
  });
  return stdout.trim();
}

function inferAuthorName(lines, title) {
  const titleIndex = lines.findLastIndex?.((line) => line === title) ?? -1;
  const start = titleIndex >= 0 ? titleIndex + 1 : 1;
  return lines.find((line, index) => index >= start && !isWechatDateLine(line));
}

function inferPublishedAt(lines) {
  const dateLine = lines.find(isWechatDateLine);
  if (!dateLine) return undefined;
  const match = dateLine.match(
    /(\d{4})年(\d{1,2})月(\d{1,2})日\s+(\d{1,2}):(\d{2})/,
  );
  if (!match) return undefined;
  const [, year, month, day, hour, minute] = match.map(String);
  return new Date(
    Date.UTC(
      Number(year),
      Number(month) - 1,
      Number(day),
      Number(hour) - 8,
      Number(minute),
    ),
  ).toISOString();
}

function isWechatDateLine(line) {
  return /\d{4}年\d{1,2}月\d{1,2}日\s+\d{1,2}:\d{2}/.test(line);
}

function inferLanguageHints(text) {
  const hints = ["zh"];
  if (/[áéíóúñ¿¡]|\b(el|la|los|las|de|del|en|con)\b/i.test(text)) {
    hints.push("es");
  }
  return hints;
}

function summarizeDrafts(drafts) {
  return drafts.map((draft) => ({
    title: draft.payload?.title,
    startsAt: draft.payload?.startsAt,
    endsAt: draft.payload?.endsAt,
    scheduleText: draft.payload?.scheduleText,
    venueName: draft.payload?.venueName,
    confidence: draft.payload?.confidence,
    signals: draft.payload?.signals,
  }));
}

function cleanText(text) {
  return String(text ?? "")
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .trim();
}

function hashText(text) {
  return createHash("sha256").update(text).digest("hex");
}

function usage() {
  return `Usage: pnpm extractor:wechat-url --url <mp.weixin.qq.com/s/...> [--env-file .env.collector] [--upload] [--session name]

Runs one WeChat article URL through agent-browser text capture and the lightweight LLM extractor.
Default behavior is dry-run and does not upload collector payloads.

Required env:
  COLLECTOR_ID
  AGENT_PROVIDER
  OPENAI_API_KEY
  OPENAI_MODEL
  OPENAI_BASE_URL`;
}

async function main() {
  const args = parseWechatUrlExtractionArgs(process.argv.slice(2));
  if (args.help) {
    console.log(usage());
    return;
  }
  const env = mergeEnvs(process.env, loadEnvFile(args.envFile));
  const result = await runWechatUrlExtractionOnce({
    env,
    url: args.url,
    upload: args.upload,
    session: args.session,
  });
  console.log(formatWechatUrlExtractionSummary(result));
  console.log(
    JSON.stringify(
      {
        url: result.url,
        runId: result.runId,
        title: result.articleTitle,
        extraction: formatLlmExtractionSummary(result.extraction),
        failures: result.failureSummaries,
        drafts: result.draftSummaries,
      },
      null,
      2,
    ),
  );
}

const isMain = process.argv[1] === fileURLToPath(import.meta.url);
if (isMain) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
