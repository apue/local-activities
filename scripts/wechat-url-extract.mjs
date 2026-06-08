#!/usr/bin/env node

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

import { loadEnvFile, mergeEnvs } from "./env-inventory.mjs";
import {
  formatLlmExtractionSummary,
  runLlmExtractionOnce,
} from "./llm-extractor.mjs";
import {
  articleBundleToArticleSnapshot,
  articleBundleToExtractionInput,
  createCaptureFailureResult,
  createCaptureSuccessResult,
} from "../src/capture/article-bundle.mjs";
import { storeImageEvidenceAssets } from "../src/collector/evidence/wechat-images.mjs";
import { createUrlBrowserArticleBundle } from "../src/capture/source-adapters.mjs";

const execFileAsync = promisify(execFile);
const maxVisibleTextLength = 12_000;
const collectorPayloadVersion = "2026-05-collector-v1";

export function parseWechatUrlExtractionArgs(argv) {
  const args = {
    url: undefined,
    envFile: undefined,
    upload: false,
    session: "wechat-url-extract",
    keepOpen: false,
    help: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") args.help = true;
    else if (arg === "--url") args.url = argv[(index += 1)];
    else if (arg === "--env-file") args.envFile = argv[(index += 1)];
    else if (arg === "--upload") args.upload = true;
    else if (arg === "--session") args.session = argv[(index += 1)];
    else if (arg === "--keep-open") args.keepOpen = true;
    else throw new Error(`unknown_arg:${arg}`);
  }
  return args;
}

export function buildWechatArticleSnapshotFromText({ url, text, now = new Date() }) {
  return articleBundleToArticleSnapshot(
    buildWechatArticleBundleFromText({ url, text, now }),
  );
}

export function buildWechatArticleBundleFromText({ url, text, now = new Date() }) {
  return buildWechatArticleBundleFromPage({ url, text, now });
}

export function buildWechatArticleBundleFromPage({
  url,
  canonicalUrl,
  finalUrl,
  text,
  html,
  title,
  authorName,
  publishedAt,
  links,
  miniPrograms,
  diagnostics,
  captureWarnings,
  now = new Date(),
}) {
  const visibleText = cleanText(text).slice(0, maxVisibleTextLength);
  const lines = visibleText
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const inferredTitle = clean(title) ?? lines[0] ?? "Untitled WeChat article";
  const inferredAuthorName =
    clean(authorName) ?? inferAuthorName(lines, inferredTitle);
  const inferredPublishedAt = clean(publishedAt) ?? inferPublishedAt(lines);
  return createUrlBrowserArticleBundle({
    sourceUrl: url,
    canonicalUrl,
    finalUrl: finalUrl ?? url,
    title: inferredTitle,
    authorName: inferredAuthorName,
    publishedAt: inferredPublishedAt,
    capturedAt: now.toISOString(),
    languageHints: inferLanguageHints(visibleText),
    text: visibleText,
    html,
    links,
    miniPrograms,
    diagnostics,
    captureWarnings,
  });
}

export async function runWechatUrlExtractionOnce({
  env = process.env,
  url,
  upload = false,
  session = "wechat-url-extract",
  keepOpen = false,
  now = new Date(),
  fetchImpl = fetch,
  readArticlePage = readWechatArticlePageWithAgentBrowser,
  readArticleText,
  storeImages,
  putPublicAsset,
  extract = runLlmExtractionOnce,
}) {
  if (!url) throw new Error("missing_url");
  const runId = `wechat-url-${now.toISOString().replace(/[^0-9]/g, "").slice(0, 14)}`;
  let page;
  try {
    page = readArticleText
      ? { text: await readArticleText({ url, session, keepOpen }) }
      : await readArticlePage({ url, session, keepOpen });
  } catch (error) {
    const captureResult = createCaptureFailureResult({
      stage: error?.stage ?? "page_fetch",
      reason: error?.reason ?? mapCaptureErrorToFailureReason(error),
      message: error instanceof Error ? error.message : String(error),
      retryable: error?.retryable ?? true,
      sourceUrl: url,
      diagnostics: error?.diagnostics ?? [],
    });
    const extraction = captureFailureExtractionResult({
      env,
      url,
      runId,
      now,
      failure: captureResult.failure,
    });
    return failedCaptureRunResult({ url, runId, extraction, captureResult });
  }
  const captureFailure = detectWechatArticleCaptureFailure({
    url,
    finalUrl: page.finalUrl,
    text: page.text,
    html: page.html,
  });
  if (captureFailure) {
    const extraction = captureFailureExtractionResult({
      env,
      url,
      runId,
      now,
      failure: captureFailure,
    });
    const captureResult = createCaptureFailureResult({
      stage: "page_fetch",
      reason: captureFailure.reason,
      message: captureFailure.message,
      retryable: true,
      sourceUrl: url,
      diagnostics: [
        {
          key: "capture_failure_marker",
          value: captureFailure.marker,
        },
        captureFailure.finalUrl
          ? {
              key: "final_url",
              value: captureFailure.finalUrl,
            }
          : undefined,
      ].filter(Boolean),
    });
    return failedCaptureRunResult({ url, runId, extraction, captureResult });
  }
  const articleBundle = buildWechatArticleBundleFromPage({
    url,
    canonicalUrl: page.canonicalUrl,
    finalUrl: page.finalUrl,
    text: page.text,
    html: page.html,
    title: page.title,
    authorName: page.authorName,
    publishedAt: page.publishedAt,
    links: page.links,
    miniPrograms: page.miniPrograms,
    diagnostics: page.diagnostics,
    captureWarnings: page.captureWarnings,
    now,
  });
  const captureResult = createCaptureSuccessResult({
    bundle: articleBundle,
    diagnostics: page.diagnostics ?? [],
    captureWarnings: page.captureWarnings ?? [],
  });
  const extractionInput = articleBundleToExtractionInput(articleBundle);
  const shouldStoreImages =
    storeImages ?? Boolean(putPublicAsset || env.BLOB_READ_WRITE_TOKEN?.trim());
  const evidenceAssets =
    shouldStoreImages && extractionInput.evidenceAssets.length
      ? await storeImageEvidenceAssets({
          evidenceAssets: extractionInput.evidenceAssets,
          fetchImpl,
          putPublicAsset,
        })
      : extractionInput.evidenceAssets;
  const articleSnapshot = {
    ...extractionInput.articleSnapshot,
    evidenceAssetIds: evidenceAssets.map((asset) => asset.assetId),
  };
  const extraction = await extract({
    env,
    articleSnapshot,
    evidenceAssets,
    fetchImpl,
    now,
    runId,
    upload,
  });
  return {
    url,
    runId,
    articleTitle: articleSnapshot.title,
    articleBundle,
    captureResult,
    articleSnapshot,
    extraction,
    draftSummaries: summarizeDrafts(extraction.eventDrafts ?? []),
    failureSummaries: (extraction.failures ?? []).map((failure) => failure.payload),
  };
}

export function detectWechatArticleCaptureFailure({ finalUrl, text, html }) {
  const finalUrlText = String(finalUrl ?? "");
  if (isWechatCaptchaUrl(finalUrlText)) {
    return {
      reason: "captcha_required",
      message: "WeChat opened a verification page instead of the article.",
      marker: "final_url_wappoc_appmsgcaptcha",
      finalUrl: finalUrlText,
    };
  }

  const body = `${text ?? ""}\n${html ?? ""}`;
  if (/mmbizwap:secitptpage\/verify\.html/i.test(body)) {
    return {
      reason: "captcha_required",
      message: "WeChat article capture returned a verification page.",
      marker: "secitptpage_verify_html",
      finalUrl: finalUrlText || undefined,
    };
  }
  if (/wappoc_appmsgcaptcha/i.test(body)) {
    return {
      reason: "captcha_required",
      message: "WeChat article capture returned a captcha page.",
      marker: "body_wappoc_appmsgcaptcha",
      finalUrl: finalUrlText || undefined,
    };
  }

  return undefined;
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

export async function readWechatArticleTextWithAgentBrowser({
  url,
  session,
  keepOpen = false,
}) {
  return (await readWechatArticlePageWithAgentBrowser({ url, session, keepOpen }))
    .text;
}

export async function readWechatArticlePageWithAgentBrowser({
  url,
  session,
  keepOpen = false,
  execAgentBrowser: run = execAgentBrowser,
}) {
  try {
    await run(["--session", session, "open", url]);
    await run(["--session", session, "wait", "--load", "networkidle"]);
    const extracted = await run([
      "--session",
      session,
      "eval",
      pageExtractionScript(),
      "--json",
    ]);
    const raw = extracted?.data?.result ?? extracted?.result ?? extracted ?? {};
    return normalizeDomPageCapture(raw, { url });
  } catch (error) {
    throw Object.assign(
      new Error(
        `agent_browser_failed:${error instanceof Error ? error.message : String(error)}`,
      ),
      {
        reason: error?.reason ?? mapCaptureErrorToFailureReason(error),
        stage: error?.stage ?? "page_fetch",
        retryable: error?.retryable ?? true,
        diagnostics: error?.diagnostics ?? [],
      },
    );
  } finally {
    if (!keepOpen) {
      await run(["--session", session, "close"]).catch(() => undefined);
    }
  }
}

async function execAgentBrowser(args) {
  const { stdout } = await execFileAsync("agent-browser", args, {
    encoding: "utf8",
    maxBuffer: 2_000_000,
  });
  const trimmed = stdout.trim();
  if (args.includes("--json")) {
    return trimmed ? JSON.parse(trimmed) : {};
  }
  return trimmed;
}

function normalizeDomPageCapture(raw, { url }) {
  const page = raw && typeof raw === "object" ? raw : {};
  return {
    finalUrl: clean(page.finalUrl) ?? url,
    canonicalUrl: clean(page.canonicalUrl),
    title: clean(page.title),
    authorName: clean(page.authorName),
    publishedAt: clean(page.publishedAt),
    text: cleanText(page.text),
    html: page.html == null ? undefined : String(page.html),
    links: Array.isArray(page.links) ? page.links : [],
    miniPrograms: Array.isArray(page.miniPrograms) ? page.miniPrograms : [],
    diagnostics: uniqueDiagnostics([
      { key: "dom_eval", value: "ok" },
      ...(Array.isArray(page.diagnostics) ? page.diagnostics : []),
    ]),
    captureWarnings: Array.isArray(page.captureWarnings)
      ? page.captureWarnings
      : [],
  };
}

function pageExtractionScript() {
  return `(() => {
  const textOf = (selector) => document.querySelector(selector)?.textContent?.trim() || "";
  const attr = (selector, name) => document.querySelector(selector)?.getAttribute(name)?.trim() || "";
  const meta = (name) =>
    document.querySelector(\`meta[property="\${name}"]\`)?.getAttribute("content")?.trim() ||
    document.querySelector(\`meta[name="\${name}"]\`)?.getAttribute("content")?.trim() ||
    "";
  const normalizeUrl = (value) => {
    if (!value) return "";
    try {
      return new URL(value, location.href).toString();
    } catch {
      return "";
    }
  };
  const links = Array.from(document.querySelectorAll("a[href]"))
    .map((node) => ({
      url: normalizeUrl(node.getAttribute("href")),
      text: node.textContent?.trim() || node.getAttribute("aria-label") || "",
      role: /报名|预约|注册|register|sign\\s*up|rsvp/i.test(
        [node.textContent, node.getAttribute("href")].filter(Boolean).join(" "),
      )
        ? "registration"
        : "article_link",
    }))
    .filter((link) => link.url);
  const miniPrograms = Array.from(
    document.querySelectorAll("[data-miniprogram-appid], [data-weapp-appid], [data-appid], weapp, mp-miniprogram"),
  )
    .map((node) => ({
      appId:
        node.getAttribute("data-miniprogram-appid") ||
        node.getAttribute("data-weapp-appid") ||
        node.getAttribute("data-appid") ||
        node.getAttribute("appid") ||
        "",
      path:
        node.getAttribute("data-miniprogram-path") ||
        node.getAttribute("data-weapp-path") ||
        node.getAttribute("data-path") ||
        node.getAttribute("path") ||
        "",
      text: node.textContent?.trim() || node.getAttribute("aria-label") || "",
      actionType: /报名|预约|注册|register|sign\\s*up|rsvp/i.test(
        [node.textContent, node.getAttribute("data-miniprogram-path"), node.getAttribute("data-weapp-path")]
          .filter(Boolean)
          .join(" "),
      )
        ? "registration"
        : "mini_program",
      source: "dom",
    }))
    .filter((entry) => entry.appId || entry.path || entry.text);
  return {
    finalUrl: location.href,
    canonicalUrl: attr('link[rel="canonical"]', "href") || meta("og:url") || location.href,
    title: meta("og:title") || textOf("#activity-name") || document.title,
    authorName: meta("author") || textOf("#js_name"),
    publishedAt: meta("article:published_time") || textOf("#publish_time"),
    text: document.body?.innerText || "",
    html: document.body?.outerHTML || document.documentElement?.outerHTML || "",
    links,
    miniPrograms,
  };
})()`;
}

function uniqueDiagnostics(entries) {
  const seen = new Set();
  return entries.filter((entry) => {
    const key = `${entry?.key ?? ""}\u001f${entry?.value ?? ""}`;
    if (!entry?.key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function failedCaptureRunResult({ url, runId, extraction, captureResult }) {
  return {
    url,
    runId,
    articleTitle: undefined,
    articleBundle: undefined,
    captureResult,
    articleSnapshot: undefined,
    extraction,
    draftSummaries: [],
    failureSummaries: extraction.failures.map((failure) => failure.payload),
  };
}

function mapCaptureErrorToFailureReason(error) {
  const message = String(error?.message ?? error ?? "").toLowerCase();
  if (message.includes("captcha") || message.includes("verify")) {
    return "captcha_required";
  }
  if (message.includes("login") || message.includes("401") || message.includes("403")) {
    return "login_required";
  }
  if (message.includes("404") || message.includes("not_found")) return "not_found";
  if (message.includes("blocked") || message.includes("429")) return "fetch_blocked";
  return "browser_error";
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

function captureFailureExtractionResult({ env, url, runId, now, failure }) {
  return {
    kind: "failed",
    runId,
    eventDrafts: [],
    evidenceAssets: [],
    llmUsage: [],
    failures: [
      {
        collectorId: clean(env.COLLECTOR_ID) ?? "unknown-collector",
        runId,
        observedAt: now.toISOString(),
        payloadVersion: collectorPayloadVersion,
        payload: removeUndefined({
          articleUrl: url,
          stage: "page_fetch",
          reason: failure.reason,
          message: failure.message,
          retryable: failure.retryable ?? true,
          diagnostics:
            failure.diagnostics?.length
              ? failure.diagnostics
              : [
                  failure.marker
                    ? {
                        key: "capture_failure_marker",
                        value: failure.marker,
                      }
                    : undefined,
                  failure.finalUrl
                    ? {
                        key: "final_url",
                        value: failure.finalUrl,
                      }
                    : undefined,
                ].filter(Boolean),
        }),
      },
    ],
  };
}

function isWechatCaptchaUrl(value) {
  try {
    const parsed = new URL(value);
    return (
      parsed.hostname === "mp.weixin.qq.com" &&
      parsed.pathname === "/mp/wappoc_appmsgcaptcha"
    );
  } catch {
    return false;
  }
}

function removeUndefined(input) {
  return Object.fromEntries(
    Object.entries(input).filter(([, value]) => value !== undefined),
  );
}

function clean(value) {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

function usage() {
  return `Usage: pnpm extractor:wechat-url --url <mp.weixin.qq.com/s/...> [--env-file .env.collector] [--upload] [--session name] [--keep-open]

Runs one WeChat article URL through agent-browser text capture and the lightweight LLM extractor.
Default behavior is dry-run and does not upload collector payloads.
Default behavior closes the agent-browser session opened for capture. Use --keep-open only for operator debugging.

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
    keepOpen: args.keepOpen,
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
