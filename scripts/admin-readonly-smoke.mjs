#!/usr/bin/env node

import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

import { loadEnvFile, mergeEnvs } from "./env-inventory.mjs";

const invalidAdminToken = "smoke-invalid-admin-token";

export function buildAdminReadonlySmokeRequests({
  adminToken,
  invalidToken = invalidAdminToken,
}) {
  return [
    {
      name: "public_home",
      method: "GET",
      path: "/",
      headers: {},
      validate: (response) => expectStatus(response, 200),
    },
    {
      name: "admin_page",
      method: "GET",
      path: "/admin",
      headers: {},
      validate: (response) => expectStatus(response, 200),
    },
    {
      name: "admin_jobs_json",
      method: "GET",
      path: "/api/admin/collector-jobs",
      headers: buildAdminHeaders(adminToken),
      validate: (response) => {
        expectStatus(response, 200);
        if (response.json?.ok !== true || !Array.isArray(response.json.jobs)) {
          throw new Error("admin_jobs_shape_failed");
        }
      },
    },
    {
      name: "admin_drafts_json",
      method: "GET",
      path: "/api/admin/event-drafts",
      headers: buildAdminHeaders(adminToken),
      validate: (response) => {
        expectStatus(response, 200);
        if (
          response.json?.ok !== true ||
          !Array.isArray(response.json.drafts)
        ) {
          throw new Error("admin_drafts_shape_failed");
        }
      },
    },
    {
      name: "admin_invalid_token_json",
      method: "GET",
      path: "/api/admin/collector-jobs",
      headers: buildAdminHeaders(invalidToken),
      validate: (response) => {
        expectStatus(response, 401);
        if (
          response.json?.ok !== false ||
          response.json.error !== "invalid_admin_token"
        ) {
          throw new Error("admin_invalid_token_shape_failed");
        }
      },
    },
  ];
}

export async function runAdminReadonlySmoke({
  env = process.env,
  requestImpl,
}) {
  const config = readAdminReadonlySmokeConfig(env);
  const requests = buildAdminReadonlySmokeRequests({
    adminToken: config.adminToken,
  });

  for (const request of requests) {
    const response = await (requestImpl ?? requestHttp)({
      ...request,
      baseUrl: config.baseUrl,
      proxyUrl: config.proxyUrl,
    });
    request.validate(response);
  }

  return {
    kind: "passed",
    baseUrl: config.baseUrl,
    checked: requests.map((request) => request.name),
    proxyUrl: config.proxyUrl,
  };
}

export function formatAdminReadonlySmokeSummary(result) {
  return [
    "Admin readonly smoke passed",
    `baseUrl=${result.baseUrl}`,
    `checked=${result.checked.join(",")}`,
    `proxy=${result.proxyUrl ? "enabled" : "disabled"}`,
  ].join(" ");
}

function readAdminReadonlySmokeConfig(env) {
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
  });
  const text = await response.text();

  return {
    status: response.status,
    text,
    json: parseJson(text),
  };
}

async function requestWithCurl(request) {
  const args = [
    "--silent",
    "--show-error",
    "--location",
    "--config",
    "-",
  ];
  const config = [
    curlConfigLine("max-time", "30"),
    curlConfigLine("proxy", request.proxyUrl),
    curlConfigLine("request", request.method),
  ];

  for (const [name, value] of Object.entries(request.headers)) {
    config.push(curlConfigLine("header", `${name}: ${value}`));
  }

  config.push(
    curlConfigLine("write-out", "\n__HTTP_STATUS__:%{http_code}"),
    curlConfigLine("url", `${request.baseUrl}${request.path}`),
  );

  const configText = `${config.join("\n")}\n`;
  try {
    const { stdout } = await runCurl(args, configText);
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

function expectStatus(response, expectedStatus) {
  if (response.status !== expectedStatus) {
    throw new Error(`smoke_status_failed:${expectedStatus}:${response.status}`);
  }
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

function parseArgs(argv) {
  const args = {
    envFile: undefined,
    baseUrl: undefined,
    proxyUrl: undefined,
    help: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") {
      args.help = true;
    } else if (arg === "--env-file") {
      args.envFile = argv[index + 1];
      index += 1;
    } else if (arg === "--base-url") {
      args.baseUrl = argv[index + 1];
      index += 1;
    } else if (arg === "--proxy-url") {
      args.proxyUrl = argv[index + 1];
      index += 1;
    } else {
      throw new Error(`unknown_arg:${arg}`);
    }
  }

  return args;
}

function printHelp() {
  console.log(`Usage: pnpm smoke:admin-readonly --env-file .env.local

Runs a read-only deployed app smoke:
  / -> /admin -> admin job list -> admin draft list -> invalid admin token

Required environment:
  APP_BASE_URL or NEXT_PUBLIC_APP_URL
  ADMIN_ACCESS_TOKEN

Optional local test proxy:
  LOCAL_TEST_HTTPS_PROXY
  LOCAL_TEST_HTTP_PROXY

Options:
  --env-file   Optional dotenv file merged over the current process env.
  --base-url   Override APP_BASE_URL/NEXT_PUBLIC_APP_URL for this run.
  --proxy-url  Override LOCAL_TEST_*_PROXY for this run.
  --help       Show this help text.`);
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

  const env = mergeEnvs(baseEnv, loadEnvFile(args.envFile));
  if (args.baseUrl) env.APP_BASE_URL = args.baseUrl;
  if (args.proxyUrl) {
    env.LOCAL_TEST_HTTP_PROXY = args.proxyUrl;
    env.LOCAL_TEST_HTTPS_PROXY = args.proxyUrl;
  }

  const result = await runAdminReadonlySmoke({ env });
  console.log(formatAdminReadonlySmokeSummary(result));
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
