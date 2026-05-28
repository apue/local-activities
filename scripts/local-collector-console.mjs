#!/usr/bin/env node

import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  createCollectorHeaders,
  runCollectorFixture,
} from "./collector-fixture-run.mjs";
import { runCollectorExtract } from "./collector-extract-processor.mjs";
import { loadEnvFile, mergeEnvs } from "./env-inventory.mjs";

const activeStates = new Set(["capturing", "extracting", "uploading"]);
const terminalStates = new Set(["uploaded", "failed", "cancelled"]);
const defaultPort = 4317;
const defaultCapabilities = [
  "wechat_browser",
  "dom_text",
  "image_capture",
  "vision_extraction",
];

export class JsonRunStore {
  constructor({ filePath }) {
    this.filePath = filePath;
  }

  async enqueue({ seedUrl, now = new Date() }) {
    assertHttpUrl(seedUrl);
    const data = await this.#readData();
    const sequence = data.runs.length + 1;
    const run = {
      id: createLocalRunId(now, sequence),
      seedUrl,
      state: "queued",
      attemptNumber: 1,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
      history: [{ state: "queued", at: now.toISOString() }],
    };

    data.runs.push(run);
    await this.#writeData(data);
    return run;
  }

  async enqueueVercelJob({ job, now = new Date() }) {
    assertHttpUrl(job.seedUrl);
    const data = await this.#readData();
    const existing = data.runs.find(
      (entry) => entry.vercelJob?.jobId === job.jobId,
    );
    if (existing) {
      return { ...existing, duplicate: true };
    }

    const sequence = data.runs.length + 1;
    const run = {
      id: createLocalRunId(now, sequence),
      source: "vercel_job",
      seedUrl: job.seedUrl,
      state: "queued",
      attemptNumber: job.attemptNumber ?? 1,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
      vercelJob: removeUndefined({
        jobId: job.jobId,
        requestedAt: job.requestedAt,
        leaseExpiresAt: job.leaseExpiresAt,
        attemptNumber: job.attemptNumber,
        requestedMode: job.requestedMode,
      }),
      history: [{ state: "queued", at: now.toISOString() }],
    };

    data.runs.push(run);
    await this.#writeData(data);
    return run;
  }

  async list() {
    const data = await this.#readData();
    return data.runs;
  }

  async get(id) {
    const data = await this.#readData();
    const run = data.runs.find((entry) => entry.id === id);
    if (!run) throw new Error("local_run_not_found");
    return run;
  }

  async firstQueued() {
    const data = await this.#readData();
    return data.runs.find((entry) => entry.state === "queued") ?? null;
  }

  async activeRun() {
    const data = await this.#readData();
    return data.runs.find((entry) => activeStates.has(entry.state)) ?? null;
  }

  async transition(id, state, { now = new Date(), patch = {} } = {}) {
    const data = await this.#readData();
    const run = data.runs.find((entry) => entry.id === id);
    if (!run) throw new Error("local_run_not_found");

    Object.assign(run, patch, {
      state,
      updatedAt: now.toISOString(),
      history: [...(run.history ?? []), { state, at: now.toISOString() }],
    });
    await this.#writeData(data);
    return run;
  }

  async retry(id, { now = new Date() } = {}) {
    const run = await this.get(id);
    if (run.state !== "failed") throw new Error("local_run_not_retryable");

    return this.transition(id, "queued", {
      now,
      patch: {
        attemptNumber: (run.attemptNumber ?? 1) + 1,
        failureReason: undefined,
        uploadedIds: undefined,
        processorResult: undefined,
      },
    });
  }

  async cancel(id, { now = new Date() } = {}) {
    const run = await this.get(id);
    if (terminalStates.has(run.state)) throw new Error("local_run_not_cancelable");

    return this.transition(id, "cancelled", { now });
  }

  async status() {
    const runs = await this.list();
    const activeRun = runs.find((entry) => activeStates.has(entry.state));
    const lastResult = [...runs]
      .reverse()
      .find((entry) => terminalStates.has(entry.state));

    return {
      queueDepth: runs.filter((entry) => entry.state === "queued").length,
      activeRun: activeRun ? sanitizeRun(activeRun) : null,
      lastResult: lastResult ? sanitizeRun(lastResult) : null,
    };
  }

  async #readData() {
    try {
      const text = await readFile(this.filePath, "utf8");
      const parsed = JSON.parse(text);
      return {
        runs: Array.isArray(parsed.runs) ? parsed.runs : [],
      };
    } catch (error) {
      if (error?.code === "ENOENT") return { runs: [] };
      throw error;
    }
  }

  async #writeData(data) {
    await mkdir(path.dirname(this.filePath), { recursive: true });
    const tmpPath = `${this.filePath}.tmp`;
    await writeFile(tmpPath, `${JSON.stringify(data, null, 2)}\n`);
    await rename(tmpPath, this.filePath);
  }
}

export function createLocalCollectorRuntime({ store, config, processor }) {
  const runtime = {
    store,
    config,
    polling: createPollingState(),
    processor: processor ?? createProcessor(config),
  };

  return {
    ...runtime,
    heartbeat: createHeartbeatClient(config),
    report: createReportClient(config),
  };
}

export async function processNextRun({
  store,
  processor,
  heartbeat,
  report,
  now = new Date(),
}) {
  const activeRun = await store.activeRun();
  if (activeRun) {
    return { kind: "busy", activeRunId: activeRun.id };
  }

  const queued = await store.firstQueued();
  if (!queued) return { kind: "idle" };

  try {
    await store.transition(queued.id, "capturing", { now });
    await heartbeatVercelJob({ run: queued, stage: "capturing", heartbeat });
    await store.transition(queued.id, "extracting", { now });
    await heartbeatVercelJob({ run: queued, stage: "extracting", heartbeat });
    await store.transition(queued.id, "uploading", { now });
    await heartbeatVercelJob({ run: queued, stage: "uploading", heartbeat });
    const processorResult = await processor({
      seedUrl: queued.seedUrl,
      localRunId: queued.id,
      vercelJobId: queued.vercelJob?.jobId,
    });
    const uploaded = await store.transition(queued.id, "uploaded", {
      now,
      patch: {
        uploadedIds: processorResult.uploadedIds ?? {},
        processorResult: sanitizeProcessorResult(processorResult),
      },
    });
    await reportVercelJob({
      run: uploaded,
      processorResult,
      report,
    });
    return sanitizeRun(uploaded);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const failed = await store.transition(queued.id, "failed", {
      now,
      patch: {
        failureReason: message,
      },
    });
    await reportVercelJob({
      run: failed,
      failureReason: message,
      report,
    });
    return sanitizeRun(failed);
  }
}

export async function pollVercelJobOnce({ runtime, now = new Date() }) {
  const activeRun = await runtime.store.activeRun();
  if (activeRun) {
    const result = {
      kind: "local-busy",
      reason: "active",
      runId: activeRun.id,
      nextDelayMs: runtime.config.polling.idlePollMs,
    };
    updatePollingState(runtime.polling, result, now);
    return result;
  }

  const queuedRun = await runtime.store.firstQueued();
  if (queuedRun) {
    const result = {
      kind: "local-busy",
      reason: "queued",
      runId: queuedRun.id,
      nextDelayMs: runtime.config.polling.idlePollMs,
    };
    updatePollingState(runtime.polling, result, now);
    return result;
  }

  try {
    const data = await postJson({
      baseUrl: runtime.config.baseUrl,
      path: "/api/collector/jobs/claim",
      headers: collectorHeaders(runtime.config),
      fetchImpl: runtime.config.fetchImpl ?? fetch,
      body: {
        collectorId: runtime.config.collectorId,
        capabilities: runtime.config.capabilities,
        maxJobs: 1,
      },
    });

    if (!data.job) {
      const retryAfterSeconds =
        data.retryAfterSeconds
        ?? computeNoJobDelayMs(runtime.polling, runtime.config.polling) / 1000;
      const result = {
        kind: "no-job",
        retryAfterSeconds,
        nextDelayMs: retryAfterSeconds * 1000,
      };
      updatePollingState(runtime.polling, result, now);
      return result;
    }

    const run = await runtime.store.enqueueVercelJob({ job: data.job, now });
    const result = run.duplicate
      ? {
          kind: "duplicate",
          jobId: data.job.jobId,
          runId: run.id,
          nextDelayMs: runtime.config.polling.idlePollMs,
        }
      : {
          kind: "claimed",
          jobId: data.job.jobId,
          runId: run.id,
          nextDelayMs: 0,
        };
    updatePollingState(runtime.polling, result, now);
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const result = {
      kind: "error",
      error: message,
      nextDelayMs: computeErrorDelayMs(runtime.polling, runtime.config.polling),
    };
    updatePollingState(runtime.polling, result, now);
    return result;
  }
}

export async function handleConsoleRequest(request, runtime) {
  if (!isAuthorized(request, runtime.config)) {
    return jsonResponse({ error: "unauthorized" }, 401);
  }

  const url = new URL(request.url);
  const method = request.method.toUpperCase();

  try {
    if (method === "GET" && url.pathname === "/") {
      return htmlResponse(await renderConsoleHtml(runtime.store));
    }

    if (method === "GET" && url.pathname === "/health") {
      return jsonResponse({
        ok: true,
        host: runtime.config.host,
        port: runtime.config.port,
        processor: runtime.config.processor,
        polling: sanitizePollingState(runtime.polling),
        ...(await runtime.store.status()),
      });
    }

    if (method === "GET" && url.pathname === "/runs") {
      const runs = await runtime.store.list();
      return jsonResponse({ runs: runs.map(sanitizeRun) });
    }

    if (method === "POST" && url.pathname === "/runs") {
      const body = await readJsonBody(request);
      const run = await runtime.store.enqueue({ seedUrl: body.seedUrl });
      if (!isJsonRequest(request) && acceptsHtml(request)) {
        return redirectResponse(`/runs/${encodeURIComponent(run.id)}`);
      }
      return jsonResponse({ run: sanitizeRun(run) }, 201);
    }

    if (method === "POST" && url.pathname === "/worker/process-next") {
      const result = await processNextRun(runtime);
      return jsonResponse({ result });
    }

    const runMatch = url.pathname.match(/^\/runs\/([^/]+)$/);
    if (runMatch && method === "GET") {
      const run = await runtime.store.get(runMatch[1]);
      if (acceptsHtml(request)) {
        return htmlResponse(renderRunDetailHtml(run));
      }
      return jsonResponse({ run: sanitizeRun(run) });
    }

    const retryMatch = url.pathname.match(/^\/runs\/([^/]+)\/retry$/);
    if (retryMatch && method === "POST") {
      const run = await runtime.store.retry(retryMatch[1]);
      return jsonResponse({ run: sanitizeRun(run) });
    }

    const cancelMatch = url.pathname.match(/^\/runs\/([^/]+)\/cancel$/);
    if (cancelMatch && method === "POST") {
      const run = await runtime.store.cancel(cancelMatch[1]);
      return jsonResponse({ run: sanitizeRun(run) });
    }

    return jsonResponse({ error: "not_found" }, 404);
  } catch (error) {
    return jsonResponse(
      { error: error instanceof Error ? error.message : String(error) },
      400,
    );
  }
}

export function readConsoleConfig(env = process.env) {
  const host = env.COLLECTOR_CONSOLE_HOST?.trim() || "127.0.0.1";
  const port = Number.parseInt(env.COLLECTOR_CONSOLE_PORT ?? "", 10)
    || defaultPort;
  const processor = env.LOCAL_COLLECTOR_PROCESSOR?.trim() || "fixture";
  const baseUrl = normalizeBaseUrl(
    env.COLLECTOR_BASE_URL ?? env.APP_BASE_URL ?? "",
  );
  const collectorId = env.COLLECTOR_ID?.trim();
  const collectorApiKey = env.COLLECTOR_API_KEY?.trim();
  const consoleToken = env.LOCAL_COLLECTOR_CONSOLE_TOKEN?.trim();
  const idlePollMs = parseDurationMs(env.COLLECTOR_POLL_INTERVAL_SECONDS, 60);
  const errorPollMs = parseDurationMs(
    env.COLLECTOR_ERROR_BACKOFF_SECONDS,
    60,
  );

  if (!["fixture", "extract"].includes(processor)) {
    throw new Error(`unsupported_local_collector_processor:${processor}`);
  }
  if (!baseUrl) throw new Error("missing_collector_base_url");
  if (!collectorId) throw new Error("missing_collector_id");
  if (!collectorApiKey) throw new Error("missing_collector_api_key");
  if (!isLocalHost(host) && !consoleToken) {
    throw new Error("missing_local_console_token_for_lan_bind");
  }

  return {
    host,
    port,
    processor,
    baseUrl,
    collectorId,
    collectorApiKey,
    consoleToken,
    capabilities: parseCapabilities(env.COLLECTOR_CAPABILITIES),
    polling: {
      enabled: env.COLLECTOR_POLLING_ENABLED !== "false",
      idlePollMs,
      errorPollMs,
    },
    fetchImpl: fetch,
    queueFile: env.LOCAL_COLLECTOR_QUEUE_FILE?.trim()
      || ".collector-runs.json",
    env,
  };
}

export function formatConsoleHelp() {
  return `Usage: pnpm collector:console [--env-file .env] [--host 127.0.0.1] [--port 4317]

Starts the home-machine collector console and local queue worker.

Processor:
  LOCAL_COLLECTOR_PROCESSOR=fixture or extract
  COLLECTOR_CAPTURE_ADAPTER=http or browser when processor=extract

Required collector environment:
  APP_BASE_URL or COLLECTOR_BASE_URL
  COLLECTOR_API_KEY
  COLLECTOR_ID

Local console environment:
  COLLECTOR_CONSOLE_HOST defaults to 127.0.0.1
  COLLECTOR_CONSOLE_PORT defaults to 4317
  LOCAL_COLLECTOR_QUEUE_FILE defaults to .collector-runs.json
  COLLECTOR_POLLING_ENABLED defaults to true
  COLLECTOR_POLL_INTERVAL_SECONDS defaults to 60
  COLLECTOR_ERROR_BACKOFF_SECONDS defaults to 60
  COLLECTOR_CAPABILITIES defaults to wechat_browser,dom_text,image_capture,vision_extraction
  LOCAL_COLLECTOR_CONSOLE_TOKEN is required when binding outside localhost

Options:
  --env-file  Optional dotenv file merged over the current process env.
  --host      Override COLLECTOR_CONSOLE_HOST.
  --port      Override COLLECTOR_CONSOLE_PORT.
  --help      Show this help text.`;
}

export async function runCli(argv = process.argv.slice(2), baseEnv = process.env) {
  const args = parseArgs(argv);
  if (args.help) {
    console.log(formatConsoleHelp());
    return 0;
  }

  const env = mergeEnvs(baseEnv, loadEnvFile(args.envFile), {
    ...removeUndefined({
      COLLECTOR_CONSOLE_HOST: args.host,
      COLLECTOR_CONSOLE_PORT: args.port,
    }),
  });
  const config = readConsoleConfig(env);
  const store = new JsonRunStore({ filePath: config.queueFile });
  const runtime = createLocalCollectorRuntime({ store, config });
  const server = await startConsoleServer({ runtime, config });
  startWorkerLoop({ runtime });
  if (config.polling.enabled) startPollingLoop({ runtime });

  console.log(
    `Local collector console listening on http://${config.host}:${config.port}`,
  );
  return new Promise((resolve) => {
    server.on("close", () => resolve(0));
  });
}

export async function startConsoleServer({ runtime, config }) {
  const server = http.createServer(async (req, res) => {
    const request = await toFetchRequest(req);
    const response = await handleConsoleRequest(request, runtime);
    res.statusCode = response.status;
    for (const [key, value] of response.headers) {
      res.setHeader(key, value);
    }
    res.end(Buffer.from(await response.arrayBuffer()));
  });

  await new Promise((resolve) => server.listen(config.port, config.host, resolve));
  return server;
}

export function startWorkerLoop({ runtime, intervalMs = 5_000 }) {
  const tick = () => {
    processNextRun(runtime).catch((error) => {
      console.error(error instanceof Error ? error.message : String(error));
    });
  };
  const timer = setInterval(tick, intervalMs);
  timer.unref?.();
  tick();
  return timer;
}

export function startPollingLoop({ runtime }) {
  const tick = async () => {
    const result = await pollVercelJobOnce({ runtime });
    setTimeout(tick, result.nextDelayMs).unref?.();
  };
  tick();
}

function createProcessor(config) {
  if (config.processor === "extract") {
    return async ({ seedUrl, localRunId }) =>
      runCollectorExtract({
        env: config.env,
        fetchImpl: config.fetchImpl ?? fetch,
        seedUrl,
        runId: localRunId,
      });
  }

  return async ({ seedUrl, localRunId }) =>
    runCollectorFixture({
      env: config.env,
      fetchImpl: config.fetchImpl ?? fetch,
      seedUrl,
      runId: localRunId,
      fixture: "ready-event",
    });
}

function createHeartbeatClient(config) {
  return async ({ jobId, localRunId, stage }) =>
    postJson({
      baseUrl: config.baseUrl,
      path: `/api/collector/jobs/${jobId}/heartbeat`,
      headers: collectorHeaders(config),
      fetchImpl: config.fetchImpl ?? fetch,
      body: {
        collectorId: config.collectorId,
        localRunId,
        stage,
        message: `Local collector ${stage}`,
        extendLeaseSeconds: 300,
      },
    });
}

function createReportClient(config) {
  return async (input) =>
    postJson({
      baseUrl: config.baseUrl,
      path: `/api/collector/jobs/${input.jobId}/report`,
      headers: collectorHeaders(config),
      fetchImpl: config.fetchImpl ?? fetch,
      body: buildJobReport({
        collectorId: config.collectorId,
        ...input,
      }),
    });
}

function collectorHeaders(config) {
  return createCollectorHeaders({
    collectorId: config.collectorId,
    collectorApiKey: config.collectorApiKey,
  });
}

async function heartbeatVercelJob({ run, stage, heartbeat }) {
  if (!run.vercelJob?.jobId || !heartbeat) return;
  await heartbeat({
    jobId: run.vercelJob.jobId,
    localRunId: run.id,
    stage,
  });
}

async function reportVercelJob({
  run,
  processorResult,
  failureReason,
  report,
}) {
  if (!run.vercelJob?.jobId || !report) return;
  const uploadedIds = processorResult?.uploadedIds ?? {};

  await report(removeUndefined({
    jobId: run.vercelJob.jobId,
    localRunId: run.id,
    status: failureReason ? "failed" : "completed",
    sourceRunId: uploadedIds.sourceRunId,
    articleSnapshotIds: uploadedIds.articleSnapshotId
      ? [uploadedIds.articleSnapshotId]
      : undefined,
    eventDraftIds: uploadedIds.eventDraftId
      ? [uploadedIds.eventDraftId]
      : undefined,
    evidenceAssetIds: uploadedIds.evidenceAssetIds,
    failureIds: uploadedIds.failureId ? [uploadedIds.failureId] : undefined,
    suggestedDisposition: failureReason ? "failed" : "ready_for_review",
    message: failureReason,
  }));
}

function buildJobReport({
  collectorId,
  jobId: _jobId,
  localRunId,
  status,
  sourceRunId,
  articleSnapshotIds,
  eventDraftIds,
  evidenceAssetIds,
  failureIds,
  suggestedDisposition,
  message,
}) {
  return removeUndefined({
    collectorId,
    localRunId,
    status,
    sourceRunId,
    articleSnapshotIds,
    eventDraftIds,
    evidenceAssetIds,
    failureIds,
    suggestedDisposition,
    message,
  });
}

async function postJson({ baseUrl, path, headers, fetchImpl, body }) {
  const response = await fetchImpl(`${baseUrl}${path}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(
      `collector_request_failed:${path}:${response.status}:${data.error ?? "unknown"}`,
    );
  }
  return data;
}

function createPollingState() {
  return {
    lastKind: "never",
    lastPollAt: null,
    lastJobId: null,
    lastRunId: null,
    lastError: null,
    nextDelayMs: null,
    consecutiveNoJob: 0,
    consecutiveErrors: 0,
  };
}

function updatePollingState(state, result, now) {
  state.consecutiveNoJob = result.kind === "no-job"
    ? state.consecutiveNoJob + 1
    : 0;
  state.consecutiveErrors = result.kind === "error"
    ? state.consecutiveErrors + 1
    : 0;
  state.lastKind = result.kind;
  state.lastPollAt = now.toISOString();
  state.lastJobId = result.jobId ?? state.lastJobId;
  state.lastRunId = result.runId ?? state.lastRunId;
  state.lastError = result.error ?? null;
  state.nextDelayMs = result.nextDelayMs;
}

function isAuthorized(request, config) {
  if (!config.consoleToken) return true;
  const authorization = request.headers.get("authorization") ?? "";
  const bearer = authorization.match(/^Bearer\s+(.+)$/i)?.[1];
  const headerToken = request.headers.get("x-local-collector-token");
  return bearer === config.consoleToken || headerToken === config.consoleToken;
}

async function renderConsoleHtml(store) {
  const runs = await store.list();
  const rows = runs
    .map(
      (run) =>
        `<li><a href="/runs/${escapeHtml(run.id)}">${escapeHtml(run.id)}</a> ${escapeHtml(run.state)} ${escapeHtml(run.seedUrl)}</li>`,
    )
    .join("");

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Local Collector</title>
</head>
<body>
  <main>
    <h1>Local Collector</h1>
    <form method="post" action="/runs">
      <input name="seedUrl" type="url" placeholder="https://mp.weixin.qq.com/s/example">
      <button type="submit">Start</button>
    </form>
    <ul>${rows}</ul>
  </main>
</body>
</html>`;
}

async function readJsonBody(request) {
  const contentType = request.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    return request.json();
  }

  const form = await request.formData();
  return Object.fromEntries(form.entries());
}

function jsonResponse(body, status = 200) {
  return new Response(`${JSON.stringify(body)}\n`, {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

function htmlResponse(body, status = 200) {
  return new Response(body, {
    status,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

function redirectResponse(location) {
  return new Response(null, {
    status: 303,
    headers: { location },
  });
}

function acceptsHtml(request) {
  return (request.headers.get("accept") ?? "").includes("text/html");
}

function isJsonRequest(request) {
  return (request.headers.get("content-type") ?? "").includes(
    "application/json",
  );
}

function renderRunDetailHtml(run) {
  const safe = sanitizeRun(run);
  const history = (safe.history ?? [])
    .map(
      (entry) =>
        `<li>${escapeHtml(entry.at)} ${escapeHtml(entry.state)}</li>`,
    )
    .join("");

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(safe.id)}</title>
</head>
<body>
  <main>
    <a href="/">Back</a>
    <h1>${escapeHtml(safe.id)}</h1>
    <dl>
      <dt>State</dt><dd>${escapeHtml(safe.state)}</dd>
      <dt>Seed URL</dt><dd>${escapeHtml(safe.seedUrl)}</dd>
      <dt>Attempt</dt><dd>${escapeHtml(safe.attemptNumber)}</dd>
    </dl>
    <ol>${history}</ol>
  </main>
</body>
</html>`;
}

async function toFetchRequest(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const body = chunks.length ? Buffer.concat(chunks) : undefined;
  const host = req.headers.host ?? "127.0.0.1";

  return new Request(`http://${host}${req.url}`, {
    method: req.method,
    headers: req.headers,
    body,
  });
}

function sanitizeRun(run) {
  return removeUndefined({
    id: run.id,
    source: run.source,
    seedUrl: run.seedUrl,
    state: run.state,
    attemptNumber: run.attemptNumber,
    createdAt: run.createdAt,
    updatedAt: run.updatedAt,
    failureReason: run.failureReason,
    vercelJob: run.vercelJob,
    uploadedIds: run.uploadedIds,
    processorResult: run.processorResult,
    history: run.history,
  });
}

function sanitizePollingState(state) {
  return removeUndefined({
    lastKind: state.lastKind,
    lastPollAt: state.lastPollAt,
    lastJobId: state.lastJobId,
    lastRunId: state.lastRunId,
    lastError: state.lastError,
    nextDelayMs: state.nextDelayMs,
    consecutiveNoJob: state.consecutiveNoJob,
    consecutiveErrors: state.consecutiveErrors,
  });
}

function sanitizeProcessorResult(result) {
  return removeUndefined({
    kind: result.kind,
    runId: result.runId,
    jobId: result.jobId,
    uploadedIds: result.uploadedIds,
  });
}

function removeUndefined(value) {
  return Object.fromEntries(
    Object.entries(value).filter(([, entryValue]) => entryValue !== undefined),
  );
}

function assertHttpUrl(value) {
  const url = new URL(value);
  if (!["http:", "https:"].includes(url.protocol)) {
    throw new Error("invalid_seed_url");
  }
}

function createLocalRunId(now, sequence) {
  const stamp = now.toISOString().replace(/[^0-9]/g, "").slice(0, 17);
  return `local-${stamp}-${String(sequence).padStart(3, "0")}`;
}

function isLocalHost(host) {
  return ["127.0.0.1", "localhost", "::1"].includes(host);
}

function normalizeBaseUrl(value) {
  return value.trim().replace(/\/+$/, "");
}

function parseCapabilities(value) {
  if (!value?.trim()) return defaultCapabilities;
  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function parseDurationMs(value, defaultSeconds) {
  const seconds = Number.parseInt(value ?? "", 10);
  return (Number.isFinite(seconds) && seconds > 0 ? seconds : defaultSeconds)
    * 1000;
}

function computeNoJobDelayMs(state, polling) {
  if (state.consecutiveNoJob < 10) return polling.idlePollMs;
  return Math.min(300_000, Math.max(120_000, polling.idlePollMs * 2));
}

function computeErrorDelayMs(state, polling) {
  const multipliers = [1, 2, 5, 10];
  const index = Math.min(state.consecutiveErrors, multipliers.length - 1);
  return Math.min(600_000, polling.errorPollMs * multipliers[index]);
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function parseArgs(argv) {
  const args = {
    envFile: undefined,
    host: undefined,
    port: undefined,
    help: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") {
      args.help = true;
    } else if (arg === "--env-file") {
      args.envFile = argv[index + 1];
      index += 1;
    } else if (arg === "--host") {
      args.host = argv[index + 1];
      index += 1;
    } else if (arg === "--port") {
      args.port = argv[index + 1];
      index += 1;
    } else {
      throw new Error(`unknown_arg:${arg}`);
    }
  }

  return args;
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
