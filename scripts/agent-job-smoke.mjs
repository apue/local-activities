#!/usr/bin/env node

import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

import { createClient } from "@supabase/supabase-js";

import { loadEnvFile, mergeEnvs } from "./env-inventory.mjs";

const terminalStates = new Set([
  "completed",
  "partial",
  "failed",
  "cancelled",
  "expired",
]);
const reviewableStates = new Set([
  "ready_for_review",
  "needs_review",
  "needs_info",
  "possible_duplicate",
]);
const publishedDraftStates = new Set(["approved"]);

export async function runAgentJobSmoke({
  env = process.env,
  seedUrl,
  requestImpl,
  dbClient,
  waitMs = sleep,
  maxPolls,
  pollIntervalMs,
}) {
  const config = readAgentJobSmokeConfig(env, {
    maxPolls,
    pollIntervalMs,
  });
  if (!seedUrl) throw new Error("missing_seed_url");

  const createResponse = await (requestImpl ?? requestHttp)({
    baseUrl: config.baseUrl,
    proxyUrl: config.proxyUrl,
    method: "POST",
    path: "/api/admin/collector-jobs",
    headers: buildAdminHeaders(config.adminToken),
    body: {
      seedUrl,
      preferredRunner: "vercel_sandbox",
    },
  });
  const createdJob = parseOkJson(createResponse, "/api/admin/collector-jobs")
    .job;
  const jobId = createdJob?.jobId;
  if (!jobId) throw new Error("agent_job_create_missing_job_id");

  const startedAt = Date.now();
  let currentJob = createdJob;
  let outcome = classifyAgentJobOutcome(currentJob);

  for (let poll = 0; poll < config.maxPolls && !outcome.terminal; poll += 1) {
    await waitMs(config.pollIntervalMs);
    currentJob = await fetchAdminJob({
      baseUrl: config.baseUrl,
      proxyUrl: config.proxyUrl,
      adminToken: config.adminToken,
      jobId,
      requestImpl,
    });
    outcome = classifyAgentJobOutcome(currentJob);
  }

  if (!outcome.terminal) {
    throw new Error(`agent_job_smoke_timeout:${jobId}`);
  }

  const verifier =
    dbClient ??
    createSupabaseSmokeVerifier({
      supabaseUrl: config.supabaseUrl,
      supabaseSecretKey: config.supabaseSecretKey,
    });
  const dbResult = await verifyJobRecords(currentJob, verifier);
  const publicUrls =
    dbResult.events.length > 0
      ? await verifyPublicEvents({
          baseUrl: config.baseUrl,
          proxyUrl: config.proxyUrl,
          requestImpl,
          events: dbResult.events,
        })
      : [];

  if (!outcome.passed) {
    throw new Error(
      `agent_job_smoke_failed:${jobId}:${outcome.outcome}:${currentJob.runnerState}`,
    );
  }

  return {
    kind: "passed",
    jobId,
    outcome: refineOutcome(outcome.outcome, dbResult),
    state: currentJob.state,
    runnerState: currentJob.runnerState,
    actualRunner: currentJob.actualRunner,
    fallbackEligible: currentJob.fallbackEligible,
    fallbackReason: currentJob.fallbackReason,
    draftIds: currentJob.eventDraftIds ?? [],
    reviewStates: dbResult.reviewStates,
    eventIds: dbResult.events.map((event) => event.event_id),
    publicUrls,
    failureIds: currentJob.failureIds ?? [],
    elapsedSeconds: Math.round((Date.now() - startedAt) / 1000),
  };
}

function refineOutcome(outcome, dbResult) {
  if (outcome !== "draft_created") return outcome;
  if (dbResult.events.length > 0) return "event_published";
  if (dbResult.reviewStates.includes("ready_for_review")) return "draft_ready_for_review";
  if (dbResult.reviewStates.includes("needs_info")) return "draft_needs_info";
  if (dbResult.reviewStates.includes("needs_review")) return "draft_needs_review";
  if (dbResult.reviewStates.includes("possible_duplicate")) return "draft_possible_duplicate";
  return outcome;
}

export function classifyAgentJobOutcome(job) {
  const draftIds = job.eventDraftIds ?? [];
  const failureIds = job.failureIds ?? [];

  if (draftIds.length > 0) {
    return {
      outcome: "draft_created",
      terminal: true,
      passed: true,
    };
  }

  if (job.suggestedDisposition === "not_activity") {
    return {
      outcome: "not_activity",
      terminal: true,
      passed: true,
    };
  }

  if (
    failureIds.length > 0 ||
    (job.suggestedDisposition === "failed" && job.resultMessage)
  ) {
    return {
      outcome: "structured_failure",
      terminal: true,
      passed: true,
    };
  }

  if (terminalStates.has(job.state)) {
    return {
      outcome: job.state === "failed" ? "failed_without_details" : job.state,
      terminal: true,
      passed: job.state === "completed" || job.state === "partial",
    };
  }

  return {
    outcome: "pending",
    terminal: false,
    passed: false,
  };
}

export function formatAgentJobSmokeSummary(result) {
  return [
    "Agent job smoke passed",
    `jobId=${result.jobId}`,
    `outcome=${result.outcome}`,
    `state=${result.state}`,
    `runnerState=${result.runnerState}`,
    `actualRunner=${result.actualRunner ?? "unknown"}`,
    `fallbackEligible=${result.fallbackEligible}`,
    result.fallbackReason ? `fallbackReason=${result.fallbackReason}` : null,
    `drafts=${result.draftIds.length ? result.draftIds.join(",") : "none"}`,
    result.reviewStates.length
      ? `reviewStates=${result.reviewStates.join(",")}`
      : null,
    result.eventIds?.length ? `events=${result.eventIds.join(",")}` : null,
    result.publicUrls?.length
      ? `publicUrls=${result.publicUrls.join(",")}`
      : null,
    `failures=${
      result.failureIds.length ? result.failureIds.join(",") : "none"
    }`,
    `elapsedSeconds=${result.elapsedSeconds}`,
  ]
    .filter(Boolean)
    .join(" ");
}

async function fetchAdminJob({
  baseUrl,
  proxyUrl,
  adminToken,
  jobId,
  requestImpl,
}) {
  const response = await (requestImpl ?? requestHttp)({
    baseUrl,
    proxyUrl,
    method: "GET",
    path: "/api/admin/collector-jobs",
    headers: buildAdminHeaders(adminToken),
  });
  const body = parseOkJson(response, "/api/admin/collector-jobs");
  const job = body.jobs?.find((candidate) => candidate.jobId === jobId);
  if (!job) throw new Error(`agent_job_not_found:${jobId}`);
  return job;
}

async function verifyJobRecords(job, dbClient) {
  const reviewStates = [];
  const articleUrls = [];
  let events = [];

  await verifyIds(dbClient, "source_runs", compact([job.sourceRunId]));
  await verifyIds(dbClient, "article_snapshots", job.articleSnapshotIds ?? []);
  await verifyIds(dbClient, "evidence_assets", job.evidenceAssetIds ?? []);
  await verifyIds(dbClient, "collector_failures", job.failureIds ?? []);

  const draftIds = job.eventDraftIds ?? [];
  if (draftIds.length > 0) {
    const drafts = await dbClient.listDraftsByIds(draftIds);
    const foundIds = new Set(drafts.map((draft) => String(draft.id)));
    const missingIds = draftIds.filter((id) => !foundIds.has(id));
    if (missingIds.length > 0) {
      throw new Error(`agent_job_db_missing:event_drafts:${missingIds.join(",")}`);
    }
    for (const draft of drafts) {
      reviewStates.push(draft.review_state);
      if (draft.article_url) articleUrls.push(draft.article_url);
    }
    if (
      reviewStates.length > 0 &&
      !reviewStates.some(
        (state) => reviewableStates.has(state) || publishedDraftStates.has(state),
      )
    ) {
      throw new Error(
        `agent_job_no_acceptable_draft:${reviewStates.join(",")}`,
      );
    }
    if (reviewStates.some((state) => publishedDraftStates.has(state))) {
      events = await dbClient.listPublishedEventsBySourceUrls(articleUrls);
      if (events.length === 0) {
        throw new Error(`agent_job_no_published_event:${articleUrls.join(",")}`);
      }
    }
  }

  return { reviewStates, events };
}

async function verifyPublicEvents({
  baseUrl,
  proxyUrl,
  requestImpl,
  events,
}) {
  const list = await (requestImpl ?? requestHttp)({
    baseUrl,
    proxyUrl,
    method: "GET",
    path: "/",
    headers: {},
  });
  assertPublicResponseContains(list, "/", [events[0]?.title]);

  const publicUrls = [];
  for (const event of events) {
    const path = `/events/${event.event_id}`;
    const detail = await (requestImpl ?? requestHttp)({
      baseUrl,
      proxyUrl,
      method: "GET",
      path,
      headers: {},
    });
    assertPublicResponseContains(detail, path, [
      event.title,
      event.source_url,
      event.venue_name ?? event.venue_address,
    ]);
    publicUrls.push(`${baseUrl}${path}`);
  }
  return publicUrls;
}

function assertPublicResponseContains(response, path, values) {
  if (response.status < 200 || response.status >= 300) {
    throw new Error(`public_page_failed:${path}:${response.status}`);
  }
  const text = response.text ?? JSON.stringify(response.json ?? {});
  for (const value of values.filter(Boolean)) {
    if (!text.includes(value)) {
      throw new Error(`public_page_missing_text:${path}:${value}`);
    }
  }
}

async function verifyIds(dbClient, table, ids) {
  for (const id of ids) {
    const row = await dbClient.findById(table, id);
    if (!row) throw new Error(`agent_job_db_missing:${table}:${id}`);
  }
}

function createSupabaseSmokeVerifier({ supabaseUrl, supabaseSecretKey }) {
  if (!supabaseUrl || !supabaseSecretKey) {
    throw new Error("missing_supabase_smoke_config");
  }

  const client = createClient(supabaseUrl, supabaseSecretKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
    },
  });

  return {
    async findById(table, id) {
      const idColumnByTable = {
        source_runs: "id",
        article_snapshots: "id",
        evidence_assets: "id",
        collector_failures: "id",
      };
      const column = idColumnByTable[table];
      if (!column) throw new Error(`unknown_smoke_table:${table}`);
      const { data, error } = await client
        .from(table)
        .select("id")
        .eq(column, id)
        .maybeSingle();
      if (error) throw new Error(`agent_job_db_query_failed:${table}`);
      return data;
    },
    async listDraftsByIds(ids) {
      const { data, error } = await client
        .from("event_drafts")
        .select("id,draft_id,article_url,review_state")
        .in("id", ids);
      if (error) throw new Error("agent_job_db_query_failed:event_drafts");
      return data ?? [];
    },
    async listPublishedEventsBySourceUrls(sourceUrls) {
      const { data, error } = await client
        .from("canonical_events")
        .select("event_id,title,source_url,venue_name,venue_address,starts_at")
        .eq("status", "published")
        .in("source_url", sourceUrls);
      if (error) throw new Error("agent_job_db_query_failed:canonical_events");
      return data ?? [];
    },
  };
}

function parseOkJson(response, path) {
  if (!response.json) throw new Error(`smoke_non_json_response:${path}`);
  if (response.status < 200 || response.status >= 300) {
    throw new Error(
      `smoke_request_failed:${path}:${response.status}:${
        response.json.error ?? "unknown"
      }`,
    );
  }
  return response.json;
}

function readAgentJobSmokeConfig(env, overrides) {
  const baseUrl = normalizeBaseUrl(
    env.APP_BASE_URL ?? env.NEXT_PUBLIC_APP_URL ?? "",
  );
  const adminToken = env.ADMIN_ACCESS_TOKEN?.trim();

  if (!baseUrl) throw new Error("missing_app_base_url");
  if (!adminToken) throw new Error("missing_admin_access_token");

  return {
    baseUrl,
    adminToken,
    proxyUrl: selectProxyUrl(baseUrl, env),
    supabaseUrl: env.NEXT_PUBLIC_SUPABASE_URL?.trim(),
    supabaseSecretKey:
      env.SUPABASE_SECRET_KEY?.trim() ?? env.SUPABASE_SERVICE_ROLE_KEY?.trim(),
    maxPolls: overrides.maxPolls ?? Number(env.AGENT_JOB_SMOKE_MAX_POLLS ?? 40),
    pollIntervalMs:
      overrides.pollIntervalMs ??
      Number(env.AGENT_JOB_SMOKE_POLL_INTERVAL_MS ?? 15_000),
  };
}

function selectProxyUrl(baseUrl, env) {
  const protocol = new URL(baseUrl).protocol;
  if (protocol === "https:") {
    return (
      env.LOCAL_TEST_HTTPS_PROXY?.trim() ||
      env.LOCAL_TEST_HTTP_PROXY?.trim() ||
      undefined
    );
  }

  return (
    env.LOCAL_TEST_HTTP_PROXY?.trim() ||
    env.LOCAL_TEST_HTTPS_PROXY?.trim() ||
    undefined
  );
}

function buildAdminHeaders(adminToken) {
  return {
    authorization: `Bearer ${adminToken}`,
    "content-type": "application/json",
  };
}

async function requestHttp(request) {
  if (request.proxyUrl) return requestWithCurl(request);
  return requestWithFetch(request);
}

async function requestWithFetch(request) {
  const response = await fetch(`${request.baseUrl}${request.path}`, {
    method: request.method,
    headers: request.headers,
    body: request.body ? JSON.stringify(request.body) : undefined,
  });
  const text = await response.text();

  return {
    status: response.status,
    text,
    json: parseJson(text),
  };
}

async function requestWithCurl(request) {
  const config = [
    curlConfigLine("max-time", "30"),
    curlConfigLine("proxy", request.proxyUrl),
    curlConfigLine("request", request.method),
  ];

  for (const [name, value] of Object.entries(request.headers)) {
    config.push(curlConfigLine("header", `${name}: ${value}`));
  }

  if (request.body) {
    config.push(curlConfigLine("data", JSON.stringify(request.body)));
  }

  config.push(
    curlConfigLine("write-out", "\n__HTTP_STATUS__:%{http_code}"),
    curlConfigLine("url", `${request.baseUrl}${request.path}`),
  );

  try {
    const { stdout } = await runCurl(
      ["--silent", "--show-error", "--location", "--config", "-"],
      `${config.join("\n")}\n`,
    );
    return parseCurlResponse(request, stdout);
  } catch (error) {
    throw new Error(`smoke_network_failed:${request.path}:${error.message}`);
  }
}

function parseCurlResponse(request, stdout) {
  const [text, statusText] = stdout.split("\n__HTTP_STATUS__:");
  const status = Number.parseInt(statusText, 10);
  if (!Number.isInteger(status)) {
    throw new Error(`smoke_response_status_missing:${request.path}`);
  }

  return {
    status,
    text,
    json: parseJson(text),
  };
}

function runCurl(args, input) {
  return new Promise((resolve, reject) => {
    const child = spawn("curl", args, {
      stdio: ["pipe", "pipe", "pipe"],
    });
    const stdout = [];
    const stderr = [];

    child.stdout.on("data", (chunk) => stdout.push(chunk));
    child.stderr.on("data", (chunk) => stderr.push(chunk));
    child.on("error", reject);
    child.on("close", (code) => {
      const output = Buffer.concat(stdout).toString("utf8");
      const errorOutput = Buffer.concat(stderr).toString("utf8").trim();
      if (code === 0) {
        resolve({ stdout: output });
      } else {
        reject(new Error(errorOutput || `curl_exit_${code}`));
      }
    });

    child.stdin.end(input);
  });
}

function curlConfigLine(name, value) {
  return `${name} = "${escapeCurlConfigValue(value)}"`;
}

function escapeCurlConfigValue(value) {
  return String(value)
    .replaceAll("\\", "\\\\")
    .replaceAll('"', '\\"')
    .replaceAll("\n", "\\n");
}

function parseJson(text) {
  try {
    return text ? JSON.parse(text) : undefined;
  } catch {
    return undefined;
  }
}

function normalizeBaseUrl(value) {
  return value.trim().replace(/\/+$/, "");
}

function compact(values) {
  return values.filter(Boolean);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseArgs(argv) {
  const args = {
    envFile: undefined,
    seedUrl: undefined,
    help: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") {
      args.help = true;
    } else if (arg === "--env-file") {
      args.envFile = argv[index + 1];
      index += 1;
    } else if (arg === "--seed-url") {
      args.seedUrl = argv[index + 1];
      index += 1;
    } else {
      throw new Error(`unknown_arg:${arg}`);
    }
  }

  return args;
}

function printHelp() {
  console.log(`Usage: pnpm smoke:agent-job --env-file .env.local --seed-url URL

Runs a real Agent/Sandbox smoke:
  admin job create -> poll admin job state -> verify Supabase records -> verify public pages

Required environment:
  APP_BASE_URL or NEXT_PUBLIC_APP_URL
  ADMIN_ACCESS_TOKEN
  NEXT_PUBLIC_SUPABASE_URL
  SUPABASE_SECRET_KEY

Optional local test proxy:
  LOCAL_TEST_HTTPS_PROXY
  LOCAL_TEST_HTTP_PROXY

Optional polling controls:
  AGENT_JOB_SMOKE_MAX_POLLS
  AGENT_JOB_SMOKE_POLL_INTERVAL_MS

Required on the target Vercel deployment for live extraction:
  AGENT_PROVIDER=openai
  OPENAI_API_KEY
  OPENAI_MODEL

The command expects parsed drafts to auto-publish when minimum public fields are present.`);
}

export async function runCli(
  argv = process.argv.slice(2),
  baseEnv = process.env,
) {
  const args = parseArgs(argv);
  if (args.help) {
    printHelp();
    return 0;
  }

  if (!args.seedUrl) throw new Error("missing_seed_url");

  const env = mergeEnvs(baseEnv, loadEnvFile(args.envFile));
  const result = await runAgentJobSmoke({
    env,
    seedUrl: args.seedUrl,
  });
  console.log(formatAgentJobSmokeSummary(result));
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
