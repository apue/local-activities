#!/usr/bin/env node

import { fileURLToPath } from "node:url";

import {
  formatFixtureSummary,
  runCollectorFixture,
} from "./collector-fixture-run.mjs";
import { loadEnvFile, mergeEnvs } from "./env-inventory.mjs";
import {
  assertHostedWriteAllowed,
  writeTargetSummary,
} from "../src/config/write-guard.mjs";

export function buildAdminHeaders(adminToken) {
  return {
    authorization: `Bearer ${adminToken}`,
    "content-type": "application/json",
  };
}

export async function runE2eFixtureSmoke({
  env = process.env,
  fetchImpl = fetch,
  now = new Date(),
  seedUrl,
  runId,
  allowHostedWrite = false,
  allowPublicFixtureData = false,
}) {
  const config = readSmokeConfig(env);
  if (!seedUrl) throw new Error("missing_seed_url");
  if (!allowHostedWrite) {
    throw new Error("e2e_fixture_smoke_requires_allow_hosted_write");
  }
  if (!allowPublicFixtureData) {
    throw new Error("e2e_fixture_smoke_requires_allow_public_fixture_data");
  }
  const target = assertHostedWriteAllowed({
    command: "e2e_fixture_smoke",
    baseUrl: config.baseUrl,
    allowHostedWrite,
    allowPublicFixtureData,
    requiresPublicFixtureData: true,
  });

  const createdJob = await postJson({
    baseUrl: config.baseUrl,
    path: "/api/admin/collector-jobs",
    headers: config.adminHeaders,
    fetchImpl,
    body: { seedUrl, preferredRunner: "local_collector" },
  });
  const jobId = createdJob.job?.jobId;
  if (!jobId) throw new Error("admin_job_create_failed");

  const collectorResult = await runCollectorFixture({
    env: {
      ...env,
      COLLECTOR_BASE_URL: config.baseUrl,
    },
    fetchImpl,
    now,
    claimOnce: true,
    expectedJobId: jobId,
    fixture: "ready-event",
    runId,
  });
  if (collectorResult.kind !== "uploaded") {
    throw new Error("collector_fixture_no_job");
  }

  const draftId = collectorResult.uploadedIds.eventDraftId;
  if (!draftId) throw new Error("collector_fixture_missing_draft");

  const published = await postJson({
    baseUrl: config.baseUrl,
    path: `/api/admin/event-drafts/${draftId}/publish`,
    headers: config.adminHeaders,
    fetchImpl,
    body: {},
  });
  const eventId = published.event?.id;
  if (!eventId) throw new Error("admin_publish_failed");

  const publicUrl = `${config.baseUrl}/events/${eventId}`;
  const publicResponse = await fetchImpl(publicUrl);
  const publicHtml = await publicResponse.text();
  const title = published.event?.title ?? "Fixture Cultural Activity";
  if (!publicResponse.ok || !publicHtml.includes(title)) {
    throw new Error("public_event_detail_check_failed");
  }

  return {
    kind: "passed",
    jobId,
    runId: collectorResult.runId,
    draftId,
    eventId,
    publicUrl,
    target,
    writeMode: "publish_fixture_event",
  };
}

export function formatSmokeSummary(result) {
  if (result.kind === "passed") {
    return [
      "E2E fixture smoke passed",
      `jobId=${result.jobId}`,
      `runId=${result.runId}`,
      `draftId=${result.draftId}`,
      `eventId=${result.eventId}`,
      `publicUrl=${result.publicUrl}`,
      result.target
        ? writeTargetSummary({
            command: "e2e_fixture_smoke",
            target: result.target,
            runId: result.runId,
            writeMode: result.writeMode,
          })
        : undefined,
    ]
      .filter(Boolean)
      .join(" ");
  }

  return formatFixtureSummary(result);
}

function readSmokeConfig(env) {
  const baseUrl = normalizeBaseUrl(
    env.APP_BASE_URL ?? env.COLLECTOR_BASE_URL ?? "",
  );
  const adminToken = env.ADMIN_ACCESS_TOKEN?.trim();

  if (!baseUrl) throw new Error("missing_app_base_url");
  if (!adminToken) throw new Error("missing_admin_access_token");
  if (!env.COLLECTOR_API_KEY?.trim()) throw new Error("missing_collector_api_key");
  if (!env.COLLECTOR_ID?.trim()) throw new Error("missing_collector_id");

  return {
    baseUrl,
    adminHeaders: buildAdminHeaders(adminToken),
  };
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
      `smoke_request_failed:${path}:${response.status}:${data.error ?? "unknown"}`,
    );
  }

  return data;
}

function normalizeBaseUrl(value) {
  return value.trim().replace(/\/+$/, "");
}

function parseArgs(argv) {
  const args = {
    envFile: undefined,
    seedUrl: undefined,
    runId: undefined,
    allowHostedWrite: false,
    allowPublicFixtureData: false,
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
    } else if (arg === "--run-id") {
      args.runId = argv[index + 1];
      index += 1;
    } else if (arg === "--allow-hosted-write") {
      args.allowHostedWrite = true;
    } else if (arg === "--allow-public-fixture-data") {
      args.allowPublicFixtureData = true;
    } else {
      throw new Error(`unknown_arg:${arg}`);
    }
  }

  return args;
}

function printHelp() {
  console.log(`Usage: pnpm smoke:e2e-fixture --env-file .env.local --seed-url URL

Runs the deterministic deployed MVP smoke flow:
  admin job create -> collector claim/upload/report -> admin publish -> public detail check

Required environment:
  APP_BASE_URL
  ADMIN_ACCESS_TOKEN
  COLLECTOR_API_KEY
  COLLECTOR_ID

Options:
  --env-file  Optional dotenv file merged over the current process env.
  --seed-url  Seed URL to queue through the admin API.
  --run-id    Optional deterministic local run id.
  --allow-hosted-write        Required for hosted/preview/production targets.
  --allow-public-fixture-data Required because this smoke publishes fixture data.
  --help      Show this help text.`);
}

export async function runCli(argv = process.argv.slice(2), baseEnv = process.env) {
  const args = parseArgs(argv);
  if (args.help) {
    printHelp();
    return 0;
  }
  if (!args.seedUrl) throw new Error("missing_seed_url");

  const env = mergeEnvs(baseEnv, loadEnvFile(args.envFile));
  const result = await runE2eFixtureSmoke({
    env,
    seedUrl: args.seedUrl,
    runId: args.runId,
    allowHostedWrite: args.allowHostedWrite,
    allowPublicFixtureData: args.allowPublicFixtureData,
  });

  console.log(formatSmokeSummary(result));
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
